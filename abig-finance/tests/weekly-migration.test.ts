import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { actAs, authorized, AWASH, fn, mk, rows, setupDb, user } from "./helpers";

// Existing data is created on the schema as it was before Phase 3, then the Phase 3 migration runs over it.
let owner: Client; const ids: Record<string, string> = {}; let before: Record<string, unknown[]> = {};
const snapshot = async () => ({
  requests: await rows(owner, "SELECT id, workflow_state, version, total_amount, payment_method, debit_account_id, paid_at, bank_processed_at FROM payment_requests ORDER BY id"),
  accounts: await rows(owner, "SELECT id, account_label, current_balance, reserved_balance, available_balance, shortfall_amount FROM company_bank_accounts ORDER BY id"),
  approvals: await rows(owner, "SELECT * FROM approval_events ORDER BY id"), events: await rows(owner, "SELECT * FROM request_events ORDER BY id"), audit: await rows(owner, "SELECT * FROM audit_events ORDER BY id"),
  history: await rows(owner, "SELECT id, account_id, previous_balance, new_balance, updated_by, updated_at, request_id FROM bank_balance_history ORDER BY id"),
});

beforeAll(async () => {
  const d = await setupDb("abig_test_weekly_migration", { before: "20261107000000" }); owner = d.owner;
  await owner.query("BEGIN");
  await actAs(owner, user.meron); await owner.query("SELECT update_bank_balance($1, 900000)", [AWASH]);
  ids.authenticated = (await authorized(owner, { amounts: [4000], method: "CHEQUE" })).id;
  await actAs(owner, user.meron);
  ids.held = await mk(owner, user.meron, { amounts: [5000] }); await fn(owner, "wf_submit", ids.held);
  await owner.query("COMMIT");
  before = await snapshot();
  await d.migrateRest();
});
afterAll(async () => { await owner?.end(); });

describe("Phase 3 migration over existing data", () => {
  it("changes no request, balance, approval, audit entry or logged figure", async () => { expect(await snapshot()).toEqual(before); });
  it("labels past log entries and creates no weeks", async () => {
    expect((await rows(owner, "SELECT entry_kind::text k, bank_figure f, implied_deposit i, week_id w FROM bank_balance_history ORDER BY updated_at"))).toEqual([
      { k: "CHECK", f: "900000.0000", i: null, w: null }, { k: "PAYMENT", f: null, i: null, w: null }]);
    expect(await rows(owner, "SELECT id FROM treasury_weeks")).toEqual([]);
  });
  it("gives the new permissions to the right roles only", async () => {
    const r = await rows(owner, "SELECT ro.code, array_agg(p.code ORDER BY p.code) AS perms FROM role_permissions rp JOIN roles ro ON ro.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id WHERE p.code LIKE 'reconciliation:%' GROUP BY 1 ORDER BY 1");
    expect(r).toEqual([{ code: "ACCOUNTANT", perms: ["reconciliation:prepare", "reconciliation:view"] }, { code: "FINANCE_MANAGER", perms: ["reconciliation:lock", "reconciliation:view"] }, { code: "OWNER", perms: ["reconciliation:view"] }]);
  });
  it("an authenticated payment from before the migration is outstanding, and a request already moving carries on", async () => {
    await owner.query("BEGIN");
    await actAs(owner, user.meron);
    expect((await rows(owner, "SELECT id FROM outstanding_payments($1)", [AWASH])).map((r) => r.id)).toEqual([ids.authenticated]);
    await owner.query("SELECT record_opening_balance($1, 896000)", [AWASH]);
    expect(Number((await rows(owner, "SELECT current_balance c FROM company_bank_accounts WHERE id = $1", [AWASH]))[0].c)).toBe(892000);
    await actAs(owner, user.dawit); const v = await fn(owner, "wf_verify", ids.held, (await rows(owner, "SELECT version FROM payment_requests WHERE id=$1", [ids.held]))[0].version);
    await actAs(owner, user.kebede); await fn(owner, "wf_authorize", ids.held, v);
    const sql = readFileSync(join(__dirname, "../ops/verify-integrity.sql"), "utf8").replace(/^\\set.*$/m, "");
    expect((await owner.query(sql)).rows.filter((r) => Number(r.violations) > 0)).toEqual([]);
    await owner.query("ROLLBACK");
  });
});
