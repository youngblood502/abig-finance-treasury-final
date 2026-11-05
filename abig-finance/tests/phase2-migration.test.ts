import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { actAs, authorized, fn, mk, rows, setupDb, user } from "./helpers";

// Existing data is created on the schema as it was before Phase 2, then the Phase 2 migration runs over it.
let owner: Client; const ids: Record<string, string> = {}; let before: Record<string, unknown[]> = {};
const snapshot = async () => ({
  requests: await rows(owner, "SELECT id, workflow_state, version, supplier_id, supplier_bank_detail_id, debit_account_id, total_amount, payment_method FROM payment_requests ORDER BY id"),
  accounts: await rows(owner, "SELECT id, account_label, account_last4, bank_id, current_balance, reserved_balance, available_balance FROM company_bank_accounts ORDER BY id"),
  approvals: await rows(owner, "SELECT * FROM approval_events ORDER BY id"), events: await rows(owner, "SELECT * FROM request_events ORDER BY id"),
  audit: await rows(owner, "SELECT * FROM audit_events ORDER BY id"), history: await rows(owner, "SELECT * FROM bank_balance_history ORDER BY id"),
});

beforeAll(async () => {
  const d = await setupDb("abig_test_phase2_migration", { before: "20261106000000" }); owner = d.owner;
  await owner.query("BEGIN");
  ids.paid = (await authorized(owner, { amounts: [4000] })).id;
  await actAs(owner, user.meron);
  ids.held = await mk(owner, user.meron, { amounts: [5000] }); await fn(owner, "wf_submit", ids.held);
  ids.draft = await mk(owner, user.meron, { amounts: [6000] });
  await owner.query("COMMIT");
  before = await snapshot();
  await d.migrateRest();
});
afterAll(async () => { await owner?.end(); });

describe("Phase 2 migration over existing data", () => {
  it("changes no request, balance or history", async () => { expect(await snapshot()).toEqual(before); });
  it("existing requests pay suppliers, and existing accounts are bank accounts", async () => {
    expect((await rows(owner, "SELECT DISTINCT payee_type::text t FROM payment_requests")).map((r) => r.t)).toEqual(["SUPPLIER"]);
    expect((await rows(owner, "SELECT DISTINCT account_kind::text k FROM company_bank_accounts")).map((r) => r.k)).toEqual(["BANK"]);
  });
  it("gives the new permissions to the right roles only", async () => {
    const r = await rows(owner, "SELECT ro.code, array_agg(p.code ORDER BY p.code) AS perms FROM role_permissions rp JOIN roles ro ON ro.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id WHERE p.code LIKE 'payee:%' GROUP BY 1 ORDER BY 1");
    expect(r).toEqual([{ code: "ACCOUNTANT", perms: ["payee:manage", "payee:view", "payee:view_identity"] }, { code: "FINANCE_MANAGER", perms: ["payee:manage", "payee:view", "payee:view_identity"] }, { code: "OWNER", perms: ["payee:view", "payee:view_identity"] }]);
  });
  it("requests already moving carry on, and the integrity check is clean", async () => {
    await owner.query("BEGIN");
    await actAs(owner, user.dawit); const v = await fn(owner, "wf_verify", ids.held, (await rows(owner, "SELECT version FROM payment_requests WHERE id=$1", [ids.held]))[0].version);
    await actAs(owner, user.kebede); await fn(owner, "wf_authorize", ids.held, v);
    const sql = readFileSync(join(__dirname, "../ops/verify-integrity.sql"), "utf8").replace(/^\\set.*$/m, "");
    expect((await owner.query(sql)).rows.filter((r) => Number(r.violations) > 0)).toEqual([]);
    await owner.query("ROLLBACK");
  });
});
