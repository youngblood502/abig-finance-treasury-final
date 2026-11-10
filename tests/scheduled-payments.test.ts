import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { actAs, ASKU, AWASH, CBE, fails, fn, mk, rows, S_HAWASSA, setupDb, user } from "./helpers";
import { compose } from "../src/worker/mail";

// Scheduled payments (Phase 6 Task 3B). Meron (ASKU accountant) creates and schedules; Dawit and Yared are ASKU's Finance Managers.
// Most tests run in a rolled-back transaction on the owner connection with the treasury clock set, as the weekly treasury tests do.
const SYSTEM = "00000000-0000-4000-8000-000000000000";
let owner: Client; let workerUrl: string; let today: string;
beforeAll(async () => {
  const d = await setupDb("abig_test_scheduled"); owner = d.owner; workerUrl = d.workerUrl;
  today = (await rows(owner, "SELECT addis_day(clock_timestamp())::text AS d"))[0].d;
});
afterAll(async () => { await owner?.end(); });

async function tx<T>(f: (c: Client) => Promise<T>): Promise<T> { await owner.query("BEGIN"); try { return await f(owner); } finally { await owner.query("ROLLBACK"); } }
const day = (offset: number) => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const clock = (c: Client, offset: number) => c.query(`CREATE OR REPLACE FUNCTION treasury_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $f$ SELECT '${day(offset)}T09:00:00+03:00'::timestamptz $f$`);
const reserved = async (c: Client) => Number((await rows(c, "SELECT reserved_balance r FROM company_bank_accounts WHERE id = $1", [AWASH]))[0].r);
const req = async (c: Client, id: string) => (await rows(c, "SELECT workflow_state::text s, version, created_by, scheduled_for::text sf, schedule_error, schedule_notified_at FROM payment_requests WHERE id = $1", [id]))[0];
const events = async (c: Client, id: string, type: string) => rows(c, "SELECT id, event_type, request_id, payload FROM notification_outbox WHERE request_id = $1 AND event_type = $2", [id, type]);
const to = async (c: Client, eventId: string) => (await rows(c, "SELECT email FROM outbox_recipients($1)", [eventId])).map((r) => r.email.replace("@abig.test", ""));
/** A complete draft by Meron, paying Hawassa from ASKU's Awash account, with its first installment due in 20 days. */
const draft = async (c: Client, amounts = [1000], dues = [day(20)]) => { await actAs(c, user.meron); return mk(c, user.meron, { amounts, dues }); };
const release = async (c: Client) => Number(await fn(c, "release_scheduled_requests"));

describe("scheduling a draft", () => {
  it("only its creator schedules it, for a date after today and on or before the first due date; nothing is reserved", async () => {
    await tx(async (c) => {
      await clock(c, 0);
      const id = await draft(c, [600, 400], [day(20), day(30)]);
      const before = await reserved(c);
      await actAs(c, user.meron);
      for (const [d, err] of [[day(0), /after today/], [day(-1), /after today/], [day(21), /on or before the first installment's due date/]] as const)
        expect(await fails(c, "SELECT wf_schedule($1,$2::date)", [id, d])).toMatch(err);
      await actAs(c, user.lidya); expect(await fails(c, "SELECT wf_schedule($1,$2::date)", [id, day(5)])).toMatch(/request not found|only the creator/);
      await actAs(c, user.dawit); expect(await fails(c, "SELECT wf_schedule($1,$2::date)", [id, day(5)])).toMatch(/request not found|permission/);
      await actAs(c, user.meron); await fn(c, "wf_schedule", id, day(20));   // the first due date itself is allowed
      expect(await req(c, id)).toMatchObject({ s: "SCHEDULED", sf: day(20), created_by: user.meron });
      expect(await reserved(c)).toBe(before);
      expect(await fails(c, "SELECT wf_schedule($1,$2::date)", [id, day(5)])).toMatch(/only a draft can be scheduled/);
      const trail = (await rows(c, "SELECT action, actor_id, actor_role, reason FROM approval_events WHERE request_id = $1", [id]))[0];
      expect(trail).toEqual({ action: "SCHEDULE", actor_id: user.meron, actor_role: "ACCOUNTANT", reason: `Scheduled for ${day(20)}` });
      const audit = (await rows(c, "SELECT metadata FROM audit_events WHERE entity_id = $1 AND action = 'REQUEST_SCHEDULE'", [id]))[0].metadata;
      expect(audit.details).toMatchObject({ scheduled_for: day(20), total_amount: 1000, installments: [{ seq: 1, amount: 600 }, { seq: 2, amount: 400 }] });
      expect(await events(c, id, "REQUEST_SUBMITTED")).toHaveLength(0);
    });
  });
  it("is refused when the draft could not be submitted today, or without the schedule permission", async () => {
    await tx(async (c) => {
      await clock(c, 0);
      await actAs(c, user.meron); const noAccount = await mk(c, user.meron, { amounts: [1000], dues: [day(20)], account: null });
      expect(await fails(c, "SELECT wf_schedule($1,$2::date)", [noAccount, day(5)])).toMatch(/choose the account/);
      await c.query("DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'payment_request:schedule')");
      const id = await draft(c);
      expect(await fails(c, "SELECT wf_schedule($1,$2::date)", [id, day(5)])).toMatch(/may not schedule/);
    });
  });
});

describe("the worker on the scheduled date", () => {
  it("submits it as System, reserves the funds once, keeps the creator, and the normal approvals follow", async () => {
    await tx(async (c) => {
      await clock(c, 0); const id = await draft(c, [1000]); await actAs(c, user.meron); await fn(c, "wf_schedule", id, day(3));
      const before = await reserved(c);
      await clock(c, 2); expect(await release(c)).toBe(0);               // the day before: nothing happens
      expect((await req(c, id)).s).toBe("SCHEDULED");
      await clock(c, 3); expect(await release(c)).toBe(1);
      expect(await req(c, id)).toMatchObject({ s: "RESERVED", created_by: user.meron, schedule_error: null });
      expect(await reserved(c)).toBe(before + 1000);
      expect(await release(c)).toBe(0);                                  // a second run submits nothing again
      expect(await reserved(c)).toBe(before + 1000);
      const submit = await rows(c, "SELECT actor_id, actor_role, reason FROM approval_events WHERE request_id = $1 AND action = 'SUBMIT'", [id]);
      expect(submit).toEqual([{ actor_id: SYSTEM, actor_role: "SYSTEM", reason: `Submitted automatically on its scheduled date (${day(3)})` }]);
      expect((await rows(c, "SELECT u.full_name FROM audit_events a JOIN users u ON u.id = a.actor_id WHERE a.entity_id = $1 AND a.action = 'REQUEST_SUBMIT'", [id]))[0].full_name).toBe("System (automatic actions)");
      const sub = await events(c, id, "REQUEST_SUBMITTED"); expect(sub).toHaveLength(1);
      expect(await to(c, sub[0].id)).toEqual(["dawit", "yared"]);       // verifiers, not the creator
      expect(await events(c, id, "REQUEST_SCHEDULE_BLOCKED")).toHaveLength(0);
      // Separation of duties is unchanged: the creator still cannot verify it; a Finance Manager can.
      const v = (await req(c, id)).version;
      await actAs(c, user.meron); expect(await fails(c, "SELECT wf_verify($1,$2)", [id, v])).toMatch(/creator|permission/);
      await actAs(c, user.dawit); await fn(c, "wf_verify", id, v);
      expect((await req(c, id)).s).toBe("VERIFIED");
    });
  });
  it("not enough funds: stays Scheduled, nothing reserved, and the creator is told once with the reason", async () => {
    await tx(async (c) => {
      await clock(c, 0); const id = await draft(c, [5000000]); await actAs(c, user.meron); await fn(c, "wf_schedule", id, day(2));
      const before = await reserved(c);
      await clock(c, 2); expect(await release(c)).toBe(0);
      const r1 = await req(c, id);
      expect(r1).toMatchObject({ s: "SCHEDULED", schedule_error: expect.stringMatching(/more than the available balance/) });
      expect(await reserved(c)).toBe(before);
      const blocked = await events(c, id, "REQUEST_SCHEDULE_BLOCKED");
      expect(blocked).toHaveLength(1);
      expect(await to(c, blocked[0].id)).toEqual(["meron"]);
      const mail = compose(blocked[0] as never, "https://x.test");
      expect(mail.subject).toMatch(/^PR-\d+ was not submitted on its scheduled date$/);
      expect(mail.text).toMatch(/Reason: The requested amount .* is more than the available balance/);
      expect(mail.text).toContain("You are not told again");
      // Hourly retries: no new notification, and the request is not touched while the reason is the same.
      for (let i = 0; i < 3; i++) expect(await release(c)).toBe(0);
      expect(await events(c, id, "REQUEST_SCHEDULE_BLOCKED")).toHaveLength(1);
      expect((await req(c, id)).version).toBe(r1.version);
      // A different reason later updates what the request shows, still without telling anyone again.
      await c.query("UPDATE suppliers SET is_active = false WHERE id = $1", [S_HAWASSA]);
      await release(c);
      expect((await req(c, id)).schedule_error).toMatch(/verified supplier bank details|supplier is not active/);
      expect(await events(c, id, "REQUEST_SCHEDULE_BLOCKED")).toHaveLength(1);
    });
  });
  it("re-checks everything a submission needs: account access, supplier, and the creator's own permission", async () => {
    for (const [what, breakIt, reason, account] of [
      ["access to the shared account withdrawn", (c: Client) => c.query("UPDATE company_bank_account_access SET revoked_at = now() WHERE account_id = $1 AND company_id = $2", [CBE, ASKU]), /debit account is not available/, CBE],
      ["supplier link inactive", (c: Client) => c.query("UPDATE company_suppliers SET status = 'INACTIVE' WHERE company_id = $1 AND supplier_id = $2", [ASKU, S_HAWASSA]), /supplier is not active/, AWASH],
      ["account deactivated", (c: Client) => c.query("UPDATE company_bank_accounts SET is_active = false WHERE id = $1", [AWASH]), /debit account is not available/, AWASH],
      ["creator deactivated", (c: Client) => c.query("UPDATE users SET is_active = false WHERE id = $1", [user.meron]), /can no longer submit payment requests/, AWASH],
    ] as const) await tx(async (c) => {
      await clock(c, 0); await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [1000], dues: [day(20)], account }); await fn(c, "wf_schedule", id, day(1));
      const before = await reserved(c);
      await breakIt(c);
      await clock(c, 1); expect({ what, n: await release(c) }).toEqual({ what, n: 0 });
      expect({ what, ...(await req(c, id)) }).toMatchObject({ what, s: "SCHEDULED", schedule_error: expect.stringMatching(reason) });
      expect(await reserved(c)).toBe(before);
      expect((await events(c, id, "REQUEST_SCHEDULE_BLOCKED")).length).toBe(1);
    });
  });
  it("one blocked request does not stop the others", async () => {
    await tx(async (c) => {
      await clock(c, 0);
      const big = await draft(c, [5000000]); const ok = await draft(c, [1000]);
      await actAs(c, user.meron); await fn(c, "wf_schedule", big, day(1)); await fn(c, "wf_schedule", ok, day(1));
      await clock(c, 1); expect(await release(c)).toBe(1);
      expect([(await req(c, big)).s, (await req(c, ok)).s]).toEqual(["SCHEDULED", "RESERVED"]);
    });
  });
});

describe("changing or cancelling a Scheduled request", () => {
  it("the creator changes it in one step, revalidated, with the details before and after in the audit history", async () => {
    await tx(async (c) => {
      await clock(c, 0); const id = await draft(c, [1000]); await actAs(c, user.meron); await fn(c, "wf_schedule", id, day(5));
      const v = (await req(c, id)).version;
      await actAs(c, user.lidya); expect(await fails(c, "SELECT wf_unschedule($1,$2)", [id, v])).toMatch(/request not found|only the creator/);
      await actAs(c, user.meron); expect(await fails(c, "SELECT wf_unschedule($1,$2)", [id, v - 1])).toMatch(/reload it/);
      // What the edit action does, in one transaction: back to a draft, change it, schedule it again.
      await fn(c, "wf_unschedule", id, v);
      expect((await req(c, id)).s).toBe("DRAFT");
      await c.query("UPDATE payment_requests SET total_amount = 1500 WHERE id = $1", [id]);
      await c.query("UPDATE payment_installments SET amount = 1500, due_date = $2::date WHERE request_id = $1", [id, day(15)]);
      await fn(c, "wf_schedule", id, day(10));
      expect(await req(c, id)).toMatchObject({ s: "SCHEDULED", sf: day(10) });
      const audit = await rows(c, "SELECT action, metadata->'details' AS d FROM audit_events WHERE entity_id = $1 AND action IN ('REQUEST_UNSCHEDULE','REQUEST_SCHEDULE') ORDER BY occurred_at, action DESC", [id]);
      const before = audit.find((a) => a.action === "REQUEST_UNSCHEDULE")!.d, after = audit.filter((a) => a.action === "REQUEST_SCHEDULE").map((a) => a.d).find((d) => d.total_amount === 1500);
      expect(before).toMatchObject({ scheduled_for: day(5), total_amount: 1000 });
      expect(after).toMatchObject({ scheduled_for: day(10), total_amount: 1500, installments: [{ due_date: day(15), amount: 1500 }] });
    });
  });
  it("a change that is refused leaves it Scheduled exactly as it was", async () => {
    await tx(async (c) => {
      await clock(c, 0); const id = await draft(c, [1000]); await actAs(c, user.meron); await fn(c, "wf_schedule", id, day(5));
      const was = await req(c, id);
      await c.query("SAVEPOINT edit");
      await fn(c, "wf_unschedule", id, was.version);
      await expect(c.query("SELECT wf_schedule($1,$2::date)", [id, day(25)])).rejects.toThrow(/on or before the first installment's due date/);
      await c.query("ROLLBACK TO SAVEPOINT edit");   // the server action's transaction rolls back the same way
      expect(await req(c, id)).toEqual(was);
    });
  });
  it("a submitted one can no longer be changed this way, and a Scheduled one can be cancelled with nothing reserved", async () => {
    await tx(async (c) => {
      await clock(c, 0); const a = await draft(c, [1000]), b = await draft(c, [1000]); await actAs(c, user.meron);
      await fn(c, "wf_schedule", a, day(1)); await fn(c, "wf_schedule", b, day(1));
      const before = await reserved(c);
      await fn(c, "wf_cancel", b, (await req(c, b)).version, "No longer needed");
      await clock(c, 1); expect(await release(c)).toBe(1);
      expect([(await req(c, a)).s, (await req(c, b)).s]).toEqual(["RESERVED", "CANCELLED"]);
      expect(await reserved(c)).toBe(before + 1000);
      await actAs(c, user.meron); expect(await fails(c, "SELECT wf_unschedule($1,$2)", [a, (await req(c, a)).version])).toMatch(/only a scheduled request/);
    });
  });
});

describe("safety", () => {
  it("only the worker may run the release; the app role may schedule but not set the schedule fields itself", async () => {
    expect((await rows(owner, "SELECT has_function_privilege('abig_worker','release_scheduled_requests()','EXECUTE') w, has_function_privilege('abig_app','release_scheduled_requests()','EXECUTE') a, has_function_privilege('abig_app','wf_schedule(uuid,date)','EXECUTE') s"))[0]).toEqual({ w: true, a: false, s: true });
    for (const col of ["scheduled_for", "schedule_error", "schedule_notified_at", "workflow_state"])
      expect({ col, ok: (await rows(owner, "SELECT has_column_privilege('abig_app','payment_requests',$1,'UPDATE') OR has_column_privilege('abig_app','payment_requests',$1,'INSERT') AS ok", [col]))[0].ok }).toEqual({ col, ok: false });
    await tx(async (c) => {
      expect(await fails(c, "INSERT INTO company_memberships (company_id, user_id) VALUES ($1,$2)", [ASKU, SYSTEM])).toMatch(/System user cannot be a member/);
      expect(await fails(c, "UPDATE users SET is_active = true WHERE id = $1", [SYSTEM])).toMatch(/System user records automatic actions/);
    });
  });
  it("two workers running at once submit a due request exactly once (committed, real clock)", async () => {
    await actAs(owner, user.meron);
    const id = await mk(owner, user.meron, { amounts: [1000], dues: [day(20)] });
    await owner.query("SELECT set_config('app.wf','on',false)");
    await owner.query("UPDATE payment_requests SET workflow_state = 'SCHEDULED', scheduled_for = $2::date WHERE id = $1", [id, today]);
    await owner.query("SELECT set_config('app.wf','off',false)");
    const before = await reserved(owner);
    const run = async () => { const w = new Client({ connectionString: workerUrl }); await w.connect(); try { return Number((await w.query("SELECT release_scheduled_requests() n")).rows[0].n); } finally { await w.end(); } };
    const [a, b] = await Promise.all([run(), run()]);
    expect(a + b).toBe(1);
    expect((await req(owner, id)).s).toBe("RESERVED");
    expect(await reserved(owner)).toBe(before + 1000);
    expect(await rows(owner, "SELECT 1 FROM approval_events WHERE request_id = $1 AND action = 'SUBMIT'", [id])).toHaveLength(1);
  });
});
