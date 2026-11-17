import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { fails, rows, setupDb, user } from "./helpers";
import { compose } from "../src/worker/mail";

// Phase 6 Task 3A revoked EXECUTE on the old engine's scheduler and money functions; Task 4 (20261110000400_remove_legacy_engine) then removed
// those that used the six legacy tables. The forecast functions stay (their table, cash_forecast_items, is kept) and still cannot be called.
// The functions the current workflow uses keep their permissions.
const KEPT_BUT_REVOKED = ["forecast_add(uuid,text,numeric,date,text)", "forecast_cancel(uuid,text)"];
const REMOVED = [
  "account_forecast(uuid,integer)", "installment_balances(uuid)", "report_outstanding()", "report_payments(date,date)", "treasury_confirm_schedule(uuid,uuid,date,text,numeric)",
  "treasury_enqueue_overdue()", "treasury_manual_movement(uuid,numeric,timestamptz,text)", "treasury_recommend(uuid)", "treasury_record_payment(uuid,uuid,numeric,timestamptz,text,text)",
  "treasury_release(uuid,text)", "treasury_release_orphaned()", "treasury_reserve(uuid,uuid,numeric,date,text)", "treasury_reverse_payment(uuid,text)", "treasury_schedule_queue()",
];
// Current functions that must stay callable, by role.
const KEPT: [string, string][] = [
  ["abig_app", "wf_submit(uuid)"], ["abig_app", "wf_verify(uuid,integer)"], ["abig_app", "wf_authorize(uuid,integer)"], ["abig_app", "record_opening_balance(uuid,numeric,uuid[],uuid[])"],
  ["abig_app", "record_balance_check(uuid,numeric,uuid[],uuid[])"], ["abig_app", "lock_week(uuid,integer)"], ["abig_app", "register_bank_account(uuid,text,text,text,text,numeric)"],
  ["abig_app", "reveal_account_number(uuid)"], ["abig_app", "admin_notification_retry(uuid)"],
  ["abig_worker", "outbox_claim(integer)"], ["abig_worker", "outbox_recipients(uuid)"], ["abig_worker", "enqueue_overdue_requests()"],
  ["abig_worker", "enqueue_missing_openings()"], ["abig_worker", "purge_expired_sessions()"],
];
let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"]; let workerUrl: string;
beforeAll(async () => { const d = await setupDb("abig_test_obsolete"); owner = d.owner; as = d.as; workerUrl = d.workerUrl; });
afterAll(async () => { await owner?.end(); });

describe("obsolete old-engine functions", () => {
  it("the forecast functions still exist, but no application, worker, sign-in or PUBLIC role may execute them", async () => {
    for (const f of KEPT_BUT_REVOKED) {
      const r = (await rows(owner, `SELECT to_regprocedure($1) IS NOT NULL AS exists, has_function_privilege('abig_app', $1, 'EXECUTE') AS app,
        has_function_privilege('abig_worker', $1, 'EXECUTE') AS worker, has_function_privilege('abig_auth', $1, 'EXECUTE') AS auth,
        EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid = to_regprocedure($1))) a WHERE a.grantee = 0) AS public`, [f]))[0];
      expect({ f, ...r }).toEqual({ f, exists: true, app: false, worker: false, auth: false, public: false });
    }
  });
  it("the ones that used the legacy tables are gone after a fresh installation", async () => {
    for (const f of REMOVED) expect({ f, exists: (await rows(owner, "SELECT to_regprocedure($1) IS NOT NULL AS e", [f]))[0].e }).toEqual({ f, exists: false });
  });
  it("calling one as the application or the worker is refused", async () => {
    await as(user.admin, async (c) => {
      expect(await fails(c, "SELECT forecast_cancel($1, 'x')", ["00000000-0000-4000-8000-000000000000"])).toMatch(/permission denied/);
      expect(await fails(c, "SELECT * FROM treasury_schedule_queue()")).toMatch(/does not exist/);
    });
    const w = new Client({ connectionString: workerUrl }); await w.connect();
    try {
      await w.query("BEGIN");
      expect(await fails(w, "SELECT forecast_cancel($1, 'x')", ["00000000-0000-4000-8000-000000000000"])).toMatch(/permission denied/);
      expect(await fails(w, "SELECT treasury_release_orphaned()")).toMatch(/does not exist/);
      await w.query("ROLLBACK");
    } finally { await w.end(); }
  });
  it("the current workflow, worker and admin functions keep their permissions", async () => {
    for (const [role, f] of KEPT) expect({ role, f, ok: (await rows(owner, "SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [role, f]))[0].ok }).toEqual({ role, f, ok: true });
  });
});

describe("email wording", () => {
  const mail = (event_type: string) => compose({ id: "1", event_type, request_id: "r1", payload: { request_no: "PR-000042", reason: "Supplier agreed a later date" } }, "https://x.test");
  it("an authenticated request is ready to be paid, with no funding step", () => {
    const m = mail("REQUEST_AUTHORIZED");
    expect(m.subject).toBe("PR-000042 is authenticated and ready to be paid");
    expect(m.text).toContain("deducted from the account's system balance");
    expect(m.text).toContain("marked Paid when the weekly reconciliation matches it");
    expect(`${m.subject} ${m.text}`).not.toMatch(/fund(ed|ing)/i);
  });
  it("a due-date change asks for nothing: approvals and reserved funds stay", () => {
    const m = mail("REQUEST_RESCHEDULE_NEEDED");
    expect(m.subject).toBe("PR-000042: a due date was changed");
    expect(m.text).toContain("Reason: Supplier agreed a later date");
    expect(m.text).toContain("keeps its approvals and its reserved funds, and nothing else is needed");
    expect(`${m.subject} ${m.text}`).not.toMatch(/confirm|funding|funded/i);
  });
});
