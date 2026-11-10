import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { authorized, AWASH, fn, mk, rows, setupDb, user } from "./helpers";

// A double click, a repeated Enter or a retried request can reach the server twice even with the buttons disabled. These tests send the same
// financial action twice at the same moment, on two real connections that each commit, and check that the database lets it happen only once:
// the version check and row lock in each workflow function, and the unique indexes, are the real protection; the client lock only saves a trip.
// They COMMIT data, so they get a database of their own.
let owner: Client; let appUrl: string;
beforeAll(async () => { const d = await setupDb("abig_test_duplicates"); owner = d.owner; appUrl = d.appUrl; });
afterAll(async () => { await owner?.end(); });

/** Runs `sql` as `who` in its own committed transaction; returns "ok" and the value, or the error message. */
async function attempt(who: string, sql: string, params: unknown[] = []): Promise<{ ok: true; v: unknown } | { ok: false; error: string }> {
  const c = new Client({ connectionString: appUrl }); await c.connect();
  try {
    await c.query("BEGIN"); await c.query("SELECT set_config('app.user_id',$1,true)", [who]);
    const v = (await c.query(sql, params)).rows[0]?.v;
    await c.query("COMMIT"); return { ok: true, v };
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); return { ok: false, error: (e as Error).message }; }
  finally { await c.end(); }
}
/** The same action sent twice at once, as a double click that got past the browser would. */
const twice = (who: string, sql: string, params: unknown[] = []) => Promise.all([attempt(who, sql, params), attempt(who, sql, params)]);
const succeeded = (r: Awaited<ReturnType<typeof attempt>>[]) => r.filter((x) => x.ok).length;
const errors = (r: Awaited<ReturnType<typeof attempt>>[]) => r.flatMap((x) => (x.ok ? [] : [x.error]));

/** Commits work done as `who` on one connection, for setting up a test. */
async function committed<T>(who: string, f: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: appUrl }); await c.connect();
  try { await c.query("BEGIN"); await c.query("SELECT set_config('app.user_id',$1,true)", [who]); const r = await f(c); await c.query("COMMIT"); return r; }
  finally { await c.end(); }
}
const account = async () => (await rows(owner, "SELECT current_balance::float8 c, reserved_balance::float8 r FROM company_bank_accounts WHERE id = $1", [AWASH]))[0] as { c: number; r: number };
const state = async (id: string) => (await rows(owner, "SELECT workflow_state::text s, version FROM payment_requests WHERE id = $1", [id]))[0];
const outbox = async (id: string, type: string) => Number((await rows(owner, "SELECT count(*) n FROM notification_outbox WHERE request_id = $1 AND event_type = $2", [id, type]))[0].n);
const history = async () => Number((await rows(owner, "SELECT count(*) n FROM bank_balance_history WHERE account_id = $1", [AWASH]))[0].n);

describe("the same financial action sent twice at once runs only once", { timeout: 30_000 }, () => {
  it("submitting a request: one reservation, one REQUEST_SUBMITTED notification", async () => {
    const id = await committed(user.meron, (c) => mk(c, user.meron, { amounts: [12345] }));
    const before = await account();
    const r = await twice(user.meron, "SELECT wf_submit($1) v", [id]);
    expect(succeeded(r)).toBe(1);
    expect(errors(r)[0]).toMatch(/draft|state|changed|already/i);
    expect((await account()).r).toBe(before.r + 12345);
    expect(await outbox(id, "REQUEST_SUBMITTED")).toBe(1);
    expect((await state(id)).s).toBe("RESERVED");
  });

  it("verifying with the same version: one verification, one notification", async () => {
    const { id, v } = await committed(user.meron, async (c) => { const id = await mk(c, user.meron, { amounts: [2000] }); return { id, v: await fn(c, "wf_submit", id) }; });
    const r = await twice(user.dawit, "SELECT wf_verify($1,$2) v", [id, v]);
    expect(succeeded(r)).toBe(1);
    expect(errors(r)[0]).toMatch(/changed|not waiting|already/i);
    expect((await state(id)).s).toBe("VERIFIED");
    expect(Number((await rows(owner, "SELECT count(*) n FROM audit_events WHERE entity_id = $1 AND action ILIKE '%VERIF%'", [id]))[0].n)).toBe(1);
  });

  it("authorizing with the same version: the account is debited once, with one balance-history row", async () => {
    const { id, v } = await committed(user.meron, async (c) => {
      const id = await mk(c, user.meron, { amounts: [3000] }); const v1 = await fn(c, "wf_submit", id);
      await c.query("SELECT set_config('app.user_id',$1,true)", [user.dawit]); return { id, v: await fn(c, "wf_verify", id, v1) };
    });
    const before = await account(), rowsBefore = await history();
    const r = await twice(user.kebede, "SELECT wf_authorize($1,$2) v", [id, v]);
    expect(succeeded(r)).toBe(1);
    expect(errors(r)[0]).toMatch(/changed|not waiting|already/i);
    const after = await account();
    expect(after.c).toBe(before.c - 3000);
    expect(after.r).toBe(before.r - 3000);
    expect(await history()).toBe(rowsBefore + 1);
    expect((await state(id)).s).toBe("AUTHENTICATED");
  });

  it("recording the bank reference twice moves no money: the reference is just stored again", async () => {
    const { id } = await committed(user.meron, (c) => authorized(c, { amounts: [700] }));
    const before = await account(), rowsBefore = await history();
    const r = await twice(user.meron, "SELECT record_execution($1, NULL, 'FT-DOUBLE') v", [id]);
    expect(succeeded(r)).toBe(2);   // the row lock puts one after the other; both store the same reference
    expect(await account()).toEqual(before);
    expect(await history()).toBe(rowsBefore);
    expect((await rows(owner, "SELECT workflow_state::text s, bank_reference FROM payment_requests WHERE id = $1", [id]))[0]).toEqual({ s: "AUTHENTICATED", bank_reference: "FT-DOUBLE" });
  });

  it("scheduling a draft: it is scheduled once and nothing is reserved", async () => {
    const today = (await rows(owner, "SELECT addis_day(clock_timestamp()) + 20 AS due, addis_day(clock_timestamp()) + 5 AS on_day"))[0];
    const iso = (d: Date | string) => (typeof d === "string" ? d : d.toISOString().slice(0, 10));
    const id = await committed(user.meron, (c) => mk(c, user.meron, { amounts: [900], dues: [iso(today.due)] }));
    const before = await account();
    const r = await twice(user.meron, "SELECT wf_schedule($1,$2::date) v", [id, iso(today.on_day)]);
    expect(succeeded(r)).toBe(1);
    expect(errors(r)[0]).toMatch(/only a draft can be scheduled|changed/i);
    expect((await state(id)).s).toBe("SCHEDULED");
    expect((await account()).r).toBe(before.r);
  });

  it("Save and submit sent twice for the same supplier invoice: only one request reserves funds", async () => {
    // Drafts may share an invoice (the index leaves drafts out, by design); the database refuses the second when it is submitted.
    const saveAndSubmit = () => committed(user.meron, async (c) => { const id = await mk(c, user.meron, { ref: "DUP-INV-1", amounts: [100] }); await fn(c, "wf_submit", id); return id; })
      .then(() => "ok", (e: Error) => e.message);
    const before = await account();
    const r = await Promise.all([saveAndSubmit(), saveAndSubmit()]);
    expect(r.filter((x) => x === "ok")).toHaveLength(1);
    expect(r.find((x) => x !== "ok")).toMatch(/payment_requests_invoice_once|duplicate key|deadlock detected/i);   // the unique index, or Postgres breaking the tie; either way it rolls back whole
    expect((await account()).r).toBe(before.r + 100);
    expect(Number((await rows(owner, "SELECT count(*) n FROM payment_requests WHERE lower(invoice_ref) = 'dup-inv-1'"))[0].n)).toBe(1);   // the refused one rolled back whole
  });

  it("submitting a reconciliation twice with the same revision: it is submitted once", async () => {
    const mon = (await rows(owner, "SELECT week_monday(addis_day(clock_timestamp()))::text d"))[0].d;
    const week = await committed(user.yared, async (c) => {
      const opened = (await c.query("SELECT 1 FROM treasury_weeks WHERE account_id = $1 AND week_start = treasury_week_start($1) AND opening_entry_id IS NOT NULL", [AWASH])).rowCount;
      if (!opened) await c.query("SELECT record_opening_balance($1, 1000000)", [AWASH]);
      return fn(c, "start_reconciliation", AWASH, mon, 1000000, 0);
    });
    expect(week).toBeTruthy();
    const rev = (await committed(user.meron, (c) => rows(c, "SELECT revision FROM reconciliation_summary($1)", [week])))[0].revision;
    // payments authenticated by the tests above are not matched this week: each needs a reason to carry it forward
    const reasons = Object.fromEntries((await rows(owner, "SELECT id FROM payment_requests WHERE debit_account_id = $1 AND workflow_state = 'AUTHENTICATED'", [AWASH])).map((x) => [x.id, "Not cleared yet"]));
    const r = await twice(user.meron, "SELECT submit_reconciliation($1,$2,$3::jsonb) v", [week, rev, JSON.stringify(reasons)]);
    expect(succeeded(r), JSON.stringify(r)).toBe(1);
    expect(errors(r)[0]).toMatch(/with the Finance Manager|changed|revision|already/i);
  });

  it("marking all notifications read twice: the second finds nothing left to mark", async () => {
    await owner.query("INSERT INTO user_notifications (user_id, event_type, payload) VALUES ($1,'REQUEST_SUBMITTED','{}'), ($1,'REQUEST_SUBMITTED','{}')", [user.meron]);
    const unread = Number((await rows(owner, "SELECT count(*) n FROM user_notifications WHERE user_id = $1 AND read_at IS NULL", [user.meron]))[0].n);
    const r = await twice(user.meron, "SELECT mark_all_notifications_read() v");
    expect(succeeded(r)).toBe(2);
    expect(r.map((x) => (x.ok ? Number(x.v) : -1)).sort((a, b) => a - b)).toEqual([0, unread]);
  });
});
