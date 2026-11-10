import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { actAs, ASKU, authorized, CBE, fails, fn, mk, rows, setupDb, user } from "./helpers";

// Phase 6 Task 4: outbox retention, and a rehearsal of the prepared (not applied) legacy removal script.
let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"]; let workerUrl: string; let request: string;
beforeAll(async () => {
  const d = await setupDb("abig_test_retention"); owner = d.owner; as = d.as; workerUrl = d.workerUrl;
  request = (await rows(owner, "INSERT INTO payment_requests (debtor_company_id, supplier_id, created_by, total_amount) VALUES ($1,'d0000000-0000-4000-8000-000000000001',$2,10) RETURNING id", [ASKU, user.meron]))[0].id;
});
afterAll(async () => { await owner?.end(); });

async function tx<T>(f: (c: Client) => Promise<T>): Promise<T> { await owner.query("BEGIN"); try { return await f(owner); } finally { await owner.query("ROLLBACK"); } }
const NOW = "2027-06-15T12:00:00+03:00";
const clock = (c: Client, at = NOW) => c.query(`CREATE OR REPLACE FUNCTION treasury_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $f$ SELECT '${at}'::timestamptz $f$`);
const ago = (months: number, days = 0) => `('${NOW}'::timestamptz - interval '${months} months' - interval '${days} days')`;
/** An outbox event in a given state; every column is set explicitly, as the worker would have left it. */
const event = async (c: Client, s: { outcome?: string | null; delivered?: string | null; dead?: string | null; lease?: boolean; inApp?: boolean; created?: string }) =>
  (await rows(c, `INSERT INTO notification_outbox (event_type, request_id, payload, outcome, delivered_at, dead_at, lease_token, in_app_at, attempts, created_at)
    VALUES ('REQUEST_SUBMITTED', $1, '{"request_no":"PR-T"}', $2, ${s.delivered ?? "NULL"}, ${s.dead ?? "NULL"}, ${s.lease ? "gen_random_uuid()" : "NULL"}, ${s.inApp === false ? "NULL" : "now()"}, 1, ${s.created ?? "now()"}) RETURNING id`,
    [request, s.outcome ?? null]))[0].id as string;
const exists = async (c: Client, id: string) => (await rows(c, "SELECT 1 FROM notification_outbox WHERE id = $1", [id])).length === 1;
const integrity = async (c: Client) => (await c.query(readFileSync(join(__dirname, "../ops/verify-integrity.sql"), "utf8").replace(/^\\set.*$/m, ""))).rows.filter((r) => Number(r.violations) > 0);

describe("retention rules", () => {
  it("the cutoff is the treasury clock minus 6 months, and only old delivered events that the bell has taken are eligible", async () => {
    await tx(async (c) => {
      await clock(c);
      expect((await rows(c, "SELECT outbox_retention_cutoff() = $1::timestamptz - interval '6 months' AS ok", [NOW]))[0].ok).toBe(true);
      await c.query("DELETE FROM notification_outbox");
      const ids = {
        old: await event(c, { outcome: "DELIVERED", delivered: ago(7) }),
        justOld: await event(c, { outcome: "DELIVERED", delivered: `${ago(6)} - interval '1 second'` }),
        atCutoff: await event(c, { outcome: "DELIVERED", delivered: ago(6) }),
        recent: await event(c, { outcome: "DELIVERED", delivered: ago(5) }),
        dead: await event(c, { outcome: "DEAD", dead: ago(12), created: ago(12) }),
        noRecipients: await event(c, { outcome: "NO_RECIPIENTS", created: ago(12) }),
        open: await event(c, { created: ago(12) }),
        leased: await event(c, { outcome: "DELIVERED", delivered: ago(9), lease: true }),
        notInBell: await event(c, { outcome: "DELIVERED", delivered: ago(9), inApp: false }),
      };
      expect(await fn(c, "purge_outbox", 500, 20)).toBe(2);
      const left = Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([k, id]) => [k, await exists(c, id)])));
      expect(left).toEqual({ old: false, justOld: false, atCutoff: true, recent: true, dead: true, noRecipients: true, open: true, leased: true, notInBell: true });
      expect(await fn(c, "purge_outbox", 500, 20)).toBe(0);
    });
  });
  it("recipient records go with the event; in-app notifications and audit history stay; the purge itself is audited", async () => {
    await tx(async (c) => {
      await clock(c);
      const id = await event(c, { outcome: "DELIVERED", delivered: ago(8) });
      await c.query("INSERT INTO notification_deliveries (event_id, user_id, email, status, attempts, sent_at) VALUES ($1,$2,'dawit@abig.test','SENT',1,now())", [id, user.dawit]);
      const note = (await rows(c, "INSERT INTO user_notifications (user_id, event_id, event_type, request_id, payload) VALUES ($1,$2,'REQUEST_SUBMITTED',$3,'{\"request_no\":\"PR-T\"}') RETURNING id", [user.dawit, id, request]))[0].id;
      await c.query("INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,'ADMIN_NOTIFICATION_RETRIED','NOTIFICATION',$2,'{}')", [user.admin, id]);
      const auditBefore = Number((await rows(c, "SELECT count(*) n FROM audit_events"))[0].n);
      expect(await fn(c, "purge_outbox", 500, 20)).toBeGreaterThanOrEqual(1);
      expect(await rows(c, "SELECT 1 FROM notification_deliveries WHERE event_id = $1", [id])).toHaveLength(0);
      expect((await rows(c, "SELECT event_id, event_type, payload FROM user_notifications WHERE id = $1", [note]))[0]).toEqual({ event_id: null, event_type: "REQUEST_SUBMITTED", payload: { request_no: "PR-T" } });
      expect(await rows(c, "SELECT 1 FROM audit_events WHERE action = 'ADMIN_NOTIFICATION_RETRIED' AND entity_id = $1", [id])).toHaveLength(1);
      expect(Number((await rows(c, "SELECT count(*) n FROM audit_events"))[0].n)).toBe(auditBefore + 1);
      const purged = (await rows(c, "SELECT actor_id, company_id, metadata FROM audit_events WHERE action = 'NOTIFICATIONS_PURGED'"))[0];
      expect(purged).toMatchObject({ actor_id: "00000000-0000-4000-8000-000000000000", company_id: null, metadata: { removed: expect.any(Number) } });
    });
  });
  it("works in batches: a capped run removes up to its limit, the next run the rest", async () => {
    await tx(async (c) => {
      await clock(c); await c.query("DELETE FROM notification_outbox");
      for (let i = 0; i < 25; i++) await event(c, { outcome: "DELIVERED", delivered: `${ago(7)} - interval '${i} minutes'` });
      expect(await fn(c, "purge_outbox", 10, 2)).toBe(20);
      expect(await fn(c, "purge_outbox", 10, 2)).toBe(5);
      expect(await fn(c, "purge_outbox", 10, 2)).toBe(0);
    });
  });
  it("de-duplication still holds after old events are removed: this week's opening reminder is still queued once", async () => {
    await tx(async (c) => {
      await clock(c, "2027-06-15T09:00:00+03:00");
      // A delivered reminder for a week 8 months ago is removed; this week's reminders are queued once, however often the job runs.
      await c.query(`INSERT INTO notification_outbox (event_type, payload, outcome, delivered_at, in_app_at) VALUES ('ACCOUNT_OPENING_OVERDUE', jsonb_build_object('account_id', $1::text, 'week_start', '2026-10-12'), 'DELIVERED', ${ago(8)}, now())`, [CBE]);
      expect(await fn(c, "purge_outbox", 500, 20)).toBe(1);
      const first = Number(await fn(c, "enqueue_missing_openings")); expect(first).toBeGreaterThan(0);
      expect(await fn(c, "enqueue_missing_openings")).toBe(0);
    });
  });
});

describe("safety", () => {
  it("only the worker may run it; overlapping committed runs remove each eligible event once", async () => {
    await as(user.admin, async (c) => { expect(await fails(c, "SELECT purge_outbox(10, 1)")).toMatch(/permission denied/); });
    await owner.query("DELETE FROM notification_outbox");
    for (let i = 0; i < 30; i++) await owner.query(`INSERT INTO notification_outbox (event_type, request_id, payload, outcome, delivered_at, in_app_at, attempts) VALUES ('REQUEST_SUBMITTED', $1, '{}', 'DELIVERED', now() - interval '7 months' - interval '${i} minutes', now(), 1)`, [request]);
    await owner.query(`INSERT INTO notification_outbox (event_type, request_id, payload, created_at) VALUES ('REQUEST_SUBMITTED', $1, '{}', now() - interval '1 year')`, [request]);   // open: must stay
    const run = async () => { const w = new Client({ connectionString: workerUrl }); await w.connect(); try { return Number((await w.query("SELECT purge_outbox(7, 3) n")).rows[0].n); } finally { await w.end(); } };
    const [a, b] = await Promise.all([run(), run()]);
    let total = a + b; for (let i = 0; i < 5 && total < 30; i++) total += await run();
    expect(total).toBe(30);
    expect((await rows(owner, "SELECT outcome FROM notification_outbox"))).toEqual([{ outcome: null }]);
    expect(await integrity(owner)).toEqual([]);
  });
  it("the delivery engine is untouched: a fresh event is still claimed, sent and delivered after a purge", async () => {
    const id = await (async () => { await owner.query("BEGIN"); try { await actAs(owner, user.meron); const r = await mk(owner, user.meron, { amounts: [10] }); await fn(owner, "wf_submit", r); await owner.query("COMMIT"); return r; } catch (e) { await owner.query("ROLLBACK"); throw e; } })();
    const w = new Client({ connectionString: workerUrl }); await w.connect();
    try {
      await w.query("SELECT purge_outbox(500, 20)");
      const claimed = (await w.query("SELECT id, lease_token FROM outbox_claim(20) WHERE request_id = $1", [id])).rows;
      expect(claimed.length).toBeGreaterThan(0);
    } finally { await w.end(); }
  });
});

describe("the prepared legacy removal (rehearsed in a transaction that is always rolled back)", () => {
  const SQL = readFileSync(join(__dirname, "../ops/pending/remove-legacy-engine.sql"), "utf8");
  const LEGACY = ["cash_reservations", "cash_ledger_entries", "payment_transactions", "payment_reversals", "bank_balance_snapshots", "account_use_approvals"];
  it("is not a migration, so ops/migrate.mjs never runs it", () => {
    expect(readFileSync(join(__dirname, "../ops/migrate.mjs"), "utf8")).toMatch(/prisma", "migrations"/);
    expect(SQL).toMatch(/PREPARED, NOT APPLIED/);
  });
  it("removes the six tables and their functions cleanly, and the current workflow, access withdrawal and integrity check still work", async () => {
    await tx(async (c) => {
      await c.query(SQL);
      expect((await rows(c, "SELECT count(*)::int n FROM pg_class WHERE relname = ANY($1) AND relkind = 'r'", [LEGACY]))[0].n).toBe(0);
      expect((await rows(c, "SELECT count(*)::int n FROM pg_proc WHERE proname IN ('treasury_reserve','_cash_position','access_revoked_release','installment_outstanding','report_payments')"))[0].n).toBe(0);
      expect(await rows(c, "SELECT 1 FROM pg_type WHERE typname = 'cash_position'")).toHaveLength(0);
      // The current money workflow still runs end to end.
      const { id } = await authorized(c, { amounts: [500] });
      expect((await rows(c, "SELECT workflow_state::text s FROM payment_requests WHERE id = $1", [id]))[0].s).toBe("AUTHENTICATED");
      // Withdrawing a company's access to a shared account still works now that its old trigger is gone.
      await actAs(c, user.abebe);
      await c.query("UPDATE company_bank_account_access SET revoked_at = now() WHERE account_id = $1 AND company_id = 'c0000000-0000-4000-8000-000000000002'", [CBE]);
      expect(await integrity(c)).toEqual([]);
    });
    // Rolled back: everything is still there.
    expect((await rows(owner, "SELECT count(*)::int n FROM pg_class WHERE relname = ANY($1) AND relkind = 'r'", [LEGACY]))[0].n).toBe(6);
    expect((await rows(owner, "SELECT count(*)::int n FROM pg_trigger WHERE tgname = 'account_access_release'"))[0].n).toBe(1);
  });
  it("refuses to run when a legacy table is not empty", async () => {
    await tx(async (c) => {
      await c.query("ALTER TABLE bank_balance_snapshots DISABLE TRIGGER USER");
      const cols = await rows(c, "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'bank_balance_snapshots' AND is_nullable = 'NO' AND column_default IS NULL");
      const vals = cols.map((k) => (k.column_name === "account_id" ? `'${CBE}'` : k.column_name === "entered_by" ? `'${user.samuel}'` : k.data_type.includes("time") ? "now()" : k.data_type === "date" ? "current_date" : k.data_type === "numeric" ? "1" : "'X'"));
      await c.query(`INSERT INTO bank_balance_snapshots (${cols.map((k) => k.column_name).join(",")}) VALUES (${vals.join(",")})`);
      expect(await fails(c, SQL)).toMatch(/legacy table bank_balance_snapshots still has 1 row/);
    });
  });
});
