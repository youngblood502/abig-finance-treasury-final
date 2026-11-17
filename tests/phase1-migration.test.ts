import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { actAs, authorized, AWASH, CBE, fn, mk, rows, setupDb, user } from "./helpers";

// Existing data is created on the schema as it was before Phase 1, then the Phase 1 migrations run over it.
const PHASE1 = "20261105000000";
let owner: Client; const ids: Record<string, string> = {}; let before: Record<string, any> = {};

const state = async (id: string) => (await rows(owner, "SELECT workflow_state::text s FROM payment_requests WHERE id = $1", [id]))[0].s;
const account = async (id: string) => (await rows(owner, "SELECT current_balance, reserved_balance, available_balance FROM company_bank_accounts WHERE id = $1", [id]))[0];
const version = async (id: string) => (await rows(owner, "SELECT version FROM payment_requests WHERE id = $1", [id]))[0].version;

beforeAll(async () => {
  const d = await setupDb("abig_test_phase1_migration", { before: PHASE1 }); owner = d.owner;
  await owner.query("BEGIN");
  await actAs(owner, user.meron);
  ids.cancelledReserved = await mk(owner, user.meron, { amounts: [1000], ref: "REUSED-INV" }); await fn(owner, "wf_submit", ids.cancelledReserved);
  await fn(owner, "wf_cancel", ids.cancelledReserved, await version(ids.cancelledReserved), "Not needed");
  ids.cancelledDraft = await mk(owner, user.meron, { account: null, amounts: [2000] });
  await fn(owner, "wf_cancel", ids.cancelledDraft, await version(ids.cancelledDraft), "Entered by mistake");

  ids.rejected = await mk(owner, user.meron, { amounts: [3000] }); await fn(owner, "wf_submit", ids.rejected);
  await actAs(owner, user.dawit); await fn(owner, "wf_verify", ids.rejected, await version(ids.rejected));
  await actAs(owner, user.kebede); await fn(owner, "wf_reject", ids.rejected, await version(ids.rejected), "Duplicate");

  ids.authenticated = (await authorized(owner, { amounts: [4000] })).id;
  await actAs(owner, user.meron);
  ids.reserved = await mk(owner, user.meron, { amounts: [5000] }); await fn(owner, "wf_submit", ids.reserved);
  ids.reusesInvoice = await mk(owner, user.meron, { amounts: [1000], ref: "REUSED-INV" }); await fn(owner, "wf_submit", ids.reusesInvoice);

  // A cancellation from before the approval log: REJECTED, with only the old CANCELLED state in its history.
  ids.oldCancelled = await mk(owner, user.meron, { amounts: [6000] });
  await owner.query("SELECT wf_set_state($1, 'REJECTED')", [ids.oldCancelled]);
  await owner.query("INSERT INTO request_events (request_id, from_state, to_state, version) VALUES ($1, 'SUBMITTED', 'CANCELLED', 2)", [ids.oldCancelled]);
  await owner.query("UPDATE company_bank_accounts SET owner_approval_required = true WHERE id = $1", [CBE]);
  await owner.query("COMMIT");

  before = {
    approvals: await rows(owner, "SELECT * FROM approval_events ORDER BY id"),
    events: await rows(owner, "SELECT * FROM request_events ORDER BY id"),
    audit: await rows(owner, "SELECT * FROM audit_events ORDER BY id"),
    awash: await account(AWASH),
  };
  await d.migrateRest();
});
afterAll(async () => { await owner?.end(); });

describe("Phase 1 migration over existing data", () => {
  it("maps past cancellations to Cancelled, including one from before the approval log and a draft with no account", async () => {
    expect(await state(ids.cancelledReserved)).toBe("CANCELLED");
    expect(await state(ids.cancelledDraft)).toBe("CANCELLED");
    expect(await state(ids.oldCancelled)).toBe("CANCELLED");
  });
  it("leaves a true rejection, an authenticated payment and a reservation exactly as they were", async () => {
    expect(await state(ids.rejected)).toBe("REJECTED");
    expect(await state(ids.authenticated)).toBe("AUTHENTICATED");
    expect(await state(ids.reserved)).toBe("RESERVED");
  });
  it("marks nothing Paid by itself", async () => {
    expect(await rows(owner, "SELECT id FROM payment_requests WHERE workflow_state = 'PAID' OR paid_at IS NOT NULL")).toHaveLength(0);
  });
  it("keeps every piece of history and records each correction", async () => {
    expect(await rows(owner, "SELECT * FROM approval_events ORDER BY id")).toEqual(before.approvals);
    expect(await rows(owner, "SELECT * FROM audit_events ORDER BY id")).toEqual(before.audit);
    const events = await rows(owner, "SELECT * FROM request_events ORDER BY id");
    expect(events).toEqual(expect.arrayContaining(before.events));
    const added = events.filter((e) => !before.events.some((b: any) => b.id === e.id));
    expect(added.map((e) => [e.request_id, e.from_state, e.to_state, e.actor_id]).sort()).toEqual(
      [ids.cancelledReserved, ids.cancelledDraft, ids.oldCancelled].map((id) => [id, "REJECTED", "CANCELLED", null]).sort());
  });
  it("moves no money: the balance and the reserved funds are unchanged, and available now keeps the buffer", async () => {
    const a = await account(AWASH);
    expect([a.current_balance, a.reserved_balance]).toEqual([before.awash.current_balance, before.awash.reserved_balance]);
    expect(Number(a.available_balance)).toBe(Number(before.awash.available_balance) - 100000);
  });
  it("existing requests become transfers, and an account's old owner-approval setting is kept in the archive", async () => {
    expect((await rows(owner, "SELECT DISTINCT payment_method::text m FROM payment_requests")).map((r) => r.m)).toEqual(["TRANSFER"]);
    expect((await rows(owner, "SELECT account_id FROM removed_owner_approval_settings")).map((r) => r.account_id)).toEqual([CBE]);
  });
  it("a request cancelled before Phase 1 and one reusing its invoice both stand, and the integrity check is clean", async () => {
    expect(await state(ids.reusesInvoice)).toBe("RESERVED");
    const sql = readFileSync(join(__dirname, "../ops/verify-integrity.sql"), "utf8").replace(/^\\set.*$/m, "");
    expect((await owner.query(sql)).rows.filter((r) => Number(r.violations) > 0)).toEqual([]);
  });
  it("the old workflow keeps working on migrated requests", async () => {
    await owner.query("BEGIN");
    await actAs(owner, user.dawit); const v = await fn(owner, "wf_verify", ids.reserved, await version(ids.reserved));
    await actAs(owner, user.kebede); await fn(owner, "wf_authorize", ids.reserved, v);
    expect(await state(ids.reserved)).toBe("AUTHENTICATED");
    await owner.query("ROLLBACK");
  });
});
