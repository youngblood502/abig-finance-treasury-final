import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, Pool } from "pg";
import { ASKU, fails, rows, S_HAWASSA, setupDb, user } from "./helpers";
import { tick, type Mail } from "../src/worker/mail";

// Delivery reliability. Every event below is REQUEST_SUBMITTED on a draft Meron created, so its recipients are ASKU's Finance Managers other than her:
// Dawit and Yared. Events are inserted by hand so that each test controls exactly what is in the outbox.
const DAWIT = "dawit@abig.test", YARED = "yared@abig.test";
let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"]; let workerUrl: string; let request: string;
const pools: Pool[] = [];
const workerPool = () => { const p = new Pool({ connectionString: workerUrl, max: 3 }); pools.push(p); return p; };
const worker = async () => { const c = new Client({ connectionString: workerUrl }); await c.connect(); return c; };
const one = async <T = any,>(c: Client | Pool, sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows[0] as T;
const event = async (type = "REQUEST_SUBMITTED", req: string | null = request, payload: object = { request_no: "PR-TEST" }) =>
  (await one<{ id: string }>(owner, "INSERT INTO notification_outbox (event_type, request_id, payload) VALUES ($1,$2,$3) RETURNING id", [type, req, payload])).id;
const state = (id: string) => one(owner, "SELECT outcome, attempts, delivered_at, dead_at, last_error, lease_token, available_at > now() AS later FROM notification_outbox WHERE id = $1", [id]);
const deliveries = async (id: string) => Object.fromEntries((await rows(owner, "SELECT email, status, attempts FROM notification_deliveries WHERE event_id = $1", [id])).map((r) => [r.email, [r.status, r.attempts]]));
const dueNow = (id: string) => owner.query("UPDATE notification_outbox SET available_at = now() - interval '1 second' WHERE id = $1", [id]);
/** A sender that records what it sent and fails for the addresses given. */
const sender = (failFor: string[] = [], delayMs = 0) => { const sent: Mail[] = []; const send = async (m: Mail) => { if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); if (failFor.includes(m.to)) throw new Error(`550 mailbox unavailable: ${m.to}`); sent.push(m); }; return { sent, send }; };
/** Only the outbox rows of these tests are open, so a tick handles exactly them. */
const clearOutbox = () => owner.query("DELETE FROM notification_outbox");

beforeAll(async () => {
  const d = await setupDb("abig_test_outbox"); owner = d.owner; as = d.as; workerUrl = d.workerUrl;
  request = (await one<{ id: string }>(owner, "INSERT INTO payment_requests (debtor_company_id, supplier_id, created_by, total_amount) VALUES ($1,$2,$3,10) RETURNING id", [ASKU, S_HAWASSA, user.meron])).id;
});
afterAll(async () => { for (const p of pools) await p.end(); await owner?.end(); });

describe("partial delivery", () => {
  it("a retry emails only the recipients who did not get it, then the event is delivered", async () => {
    await clearOutbox(); const id = await event(); const pool = workerPool();
    const first = sender([YARED]);
    expect(await tick(pool, first.send, "https://x.test")).toBe(1);
    expect(first.sent.map((m) => m.to)).toEqual([DAWIT]);
    expect(await state(id)).toMatchObject({ outcome: null, attempts: 1, delivered_at: null, later: true, lease_token: null, last_error: expect.stringContaining(YARED) });
    expect(await deliveries(id)).toEqual({ [DAWIT]: ["SENT", 1], [YARED]: ["FAILED", 1] });

    await dueNow(id);
    const second = sender();
    await tick(pool, second.send, "https://x.test");
    expect(second.sent.map((m) => m.to)).toEqual([YARED]);   // Dawit is not emailed again
    expect(await state(id)).toMatchObject({ outcome: "DELIVERED", attempts: 2, last_error: null, lease_token: null });
    expect((await state(id)).delivered_at).toBeInstanceOf(Date);
    expect(await deliveries(id)).toEqual({ [DAWIT]: ["SENT", 1], [YARED]: ["SENT", 2] });

    await dueNow(id);
    const third = sender();
    expect(await tick(pool, third.send, "https://x.test")).toBe(0);   // finished events are never claimed again
    expect(third.sent).toEqual([]);
  });
  it("keeps the existing backoff and gives up after 8 attempts as DEAD, without re-sending to those already sent", async () => {
    await clearOutbox(); const id = await event(); const pool = workerPool(); const all: Mail[] = [];
    for (let i = 1; i <= 8; i++) {
      const s = sender([YARED]); await tick(pool, s.send, "https://x.test"); all.push(...s.sent);
      const st = await state(id);
      if (i < 8) {
        expect(st).toMatchObject({ outcome: null, attempts: i, dead_at: null });
        const wait = Number((await one(owner, "SELECT extract(epoch FROM available_at - now()) s FROM notification_outbox WHERE id = $1", [id])).s);
        expect(wait).toBeGreaterThan(Math.min(2 ** i, 60) * 60 - 30); expect(wait).toBeLessThanOrEqual(Math.min(2 ** i, 60) * 60);
        await dueNow(id);
      } else expect(st).toMatchObject({ outcome: "DEAD", attempts: 8, delivered_at: null });
    }
    expect((await state(id)).dead_at).toBeInstanceOf(Date);
    expect(all.map((m) => m.to)).toEqual([DAWIT]);   // once, on the first attempt
    expect(await deliveries(id)).toEqual({ [DAWIT]: ["SENT", 1], [YARED]: ["FAILED", 8] });
  });
});

describe("concurrent workers", () => {
  it("claims never overlap, and each claim gets its own token", async () => {
    await clearOutbox(); const ids = [await event(), await event(), await event()];
    const a = await worker(), b = await worker();
    try {
      await a.query("BEGIN"); await b.query("BEGIN");
      const ca = (await a.query("SELECT id, lease_token FROM outbox_claim(2)")).rows, cb = (await b.query("SELECT id, lease_token FROM outbox_claim(2)")).rows;
      await a.query("COMMIT"); await b.query("COMMIT");
      expect(ca).toHaveLength(2); expect(cb).toHaveLength(1);
      expect(new Set([...ca, ...cb].map((r) => r.id))).toEqual(new Set(ids));
      expect(new Set([...ca, ...cb].map((r) => r.lease_token)).size).toBe(3);
      expect((await a.query("SELECT id FROM outbox_claim(5)")).rows).toHaveLength(0);
    } finally { await a.end(); await b.end(); }
  });
  it("two workers running at once send each event to each recipient exactly once", async () => {
    await clearOutbox(); const ids = [] as string[]; for (let i = 0; i < 6; i++) ids.push(await event("REQUEST_SUBMITTED", request, { request_no: `PR-C${i}` }));
    const s1 = sender([], 20), s2 = sender([], 20);
    await Promise.all([tick(workerPool(), s1.send, "https://x.test"), tick(workerPool(), s2.send, "https://x.test")]);
    const sent = [...s1.sent, ...s2.sent];
    expect(sent).toHaveLength(12);
    expect(new Set(sent.map((m) => `${m.to} ${m.subject}`)).size).toBe(12);   // no event reached anyone twice
    for (const id of ids) { expect((await state(id)).outcome).toBe("DELIVERED"); expect(await deliveries(id)).toEqual({ [DAWIT]: ["SENT", 1], [YARED]: ["SENT", 1] }); }
  });
});

describe("an expired lease", () => {
  it("the first worker loses the event to the second and can no longer record anything for it", async () => {
    await clearOutbox(); const id = await event();
    const a = await worker(), b = await worker(), c = await worker();
    try {
      const ta = (await one(a, "SELECT lease_token FROM outbox_claim(1)")).lease_token;
      expect((await one(a, "SELECT outbox_begin_delivery($1,$2,$3,$4) s", [id, ta, user.dawit, DAWIT])).s).toBe("SEND");
      await dueNow(id);                                                        // A is slow: its lease runs out mid-send
      const tb = (await one(b, "SELECT lease_token FROM outbox_claim(1)")).lease_token;
      expect(tb).not.toBe(ta);
      expect((await one(b, "SELECT outbox_begin_delivery($1,$2,$3,$4) s", [id, tb, user.dawit, DAWIT])).s).toBe("BUSY");   // A may still be sending to Dawit
      expect((await one(b, "SELECT outbox_begin_delivery($1,$2,$3,$4) s", [id, tb, user.yared, YARED])).s).toBe("SEND");
      expect((await one(b, "SELECT outbox_record_delivery($1,$2,$3,NULL) s", [id, tb, user.yared])).s).toBe(true);
      // A wakes up: its send to Dawit did go out, and that is recorded, but it cannot move on with the event or finish or fail it.
      expect((await one(a, "SELECT outbox_record_delivery($1,$2,$3,NULL) s", [id, ta, user.dawit])).s).toBe(true);
      expect((await one(a, "SELECT outbox_begin_delivery($1,$2,$3,$4) s", [id, ta, user.yared, YARED])).s).toBe("LOST");
      expect((await one(a, "SELECT outbox_finish($1,$2) s", [id, ta])).s).toBe("LOST");
      expect((await one(a, "SELECT outbox_fail($1,$2,'late') s", [id, ta])).s).toBe("LOST");
      expect(await state(id)).toMatchObject({ outcome: null, lease_token: tb, last_error: null });
      // B saw Dawit busy, so it retries later; the retry finds both sent and emails nobody.
      expect((await one(b, "SELECT outbox_fail($1,$2,$3) s", [id, tb, `${DAWIT}: an earlier attempt may still be sending`])).s).toBe("RETRY");
      await dueNow(id);
      const s = sender(); await tick(workerPool(), s.send, "https://x.test");
      expect(s.sent).toEqual([]);
      expect((await state(id)).outcome).toBe("DELIVERED");
      expect(await deliveries(id)).toEqual({ [DAWIT]: ["SENT", 1], [YARED]: ["SENT", 1] });
      // A token from any earlier claim stays dead after the event is finished.
      expect((await one(c, "SELECT outbox_begin_delivery($1,$2,$3,$4) s", [id, tb, user.dawit, DAWIT])).s).toBe("LOST");
    } finally { await a.end(); await b.end(); await c.end(); }
  });
  it("a worker that renews its lease per recipient keeps the event while it works", async () => {
    await clearOutbox(); const id = await event();
    const a = await worker(), b = await worker();
    try {
      const ta = (await one(a, "SELECT lease_token FROM outbox_claim(1)")).lease_token;
      await owner.query("UPDATE notification_outbox SET available_at = now() + interval '10 seconds' WHERE id = $1", [id]);   // nearly out
      expect((await one(a, "SELECT outbox_begin_delivery($1,$2,$3,$4) s", [id, ta, user.dawit, DAWIT])).s).toBe("SEND");
      expect(Number((await one(owner, "SELECT extract(epoch FROM available_at - now()) s FROM notification_outbox WHERE id = $1", [id])).s)).toBeGreaterThan(280);
      expect((await b.query("SELECT id FROM outbox_claim(5)")).rows).toHaveLength(0);
    } finally { await a.end(); await b.end(); }
  });
  it("a recipient left SENDING by a worker that crashed is taken over after 15 minutes", async () => {
    await clearOutbox(); const id = await event();
    const a = await worker(), b = await worker();
    try {
      const ta = (await one(a, "SELECT lease_token FROM outbox_claim(1)")).lease_token;
      await one(a, "SELECT outbox_begin_delivery($1,$2,$3,$4) s", [id, ta, user.dawit, DAWIT]);   // then A dies
      await owner.query("UPDATE notification_deliveries SET started_at = now() - interval '16 minutes' WHERE event_id = $1", [id]);
      await dueNow(id);
      const tb = (await one(b, "SELECT lease_token FROM outbox_claim(1)")).lease_token;
      expect((await one(b, "SELECT outbox_begin_delivery($1,$2,$3,$4) s", [id, tb, user.dawit, DAWIT])).s).toBe("SEND");
      expect((await one(a, "SELECT outbox_record_delivery($1,$2,$3,NULL) s", [id, ta, user.dawit])).s).toBe(false);   // A's old mark no longer counts
    } finally { await a.end(); await b.end(); }
  });
});

describe("no recipients", () => {
  it("ends as NO_RECIPIENTS, not delivered, sends nothing and is not retried", async () => {
    await clearOutbox();
    const id = await event("ACCOUNT_SHORTFALL", null, { account_id: randomUUID(), account_label: "Nobody's account", balance: 0, reserved: 1, shortfall_amount: 1 });
    const s = sender(); const pool = workerPool();
    expect(await tick(pool, s.send, "https://x.test")).toBe(1);
    expect(s.sent).toEqual([]);
    expect(await state(id)).toMatchObject({ outcome: "NO_RECIPIENTS", delivered_at: null, dead_at: null, last_error: "no recipients", lease_token: null });
    expect(await deliveries(id)).toEqual({});
    await dueNow(id);
    expect(await tick(pool, s.send, "https://x.test")).toBe(0);
  });
  it("a request event whose only possible recipient is excluded ends the same way", async () => {
    await clearOutbox();
    // Daily Mart has no Finance Manager, so a submitted Daily Mart request has nobody to verify it.
    const dm = (await one<{ id: string }>(owner, "SELECT id FROM companies WHERE code = 'DAILYMART'")).id;
    const req = (await one<{ id: string }>(owner, "INSERT INTO payment_requests (debtor_company_id, supplier_id, created_by, total_amount) VALUES ($1,$2,$3,10) RETURNING id", [dm, S_HAWASSA, user.bereket])).id;
    const id = await event("REQUEST_SUBMITTED", req);
    await tick(workerPool(), sender().send, "https://x.test");
    expect((await state(id)).outcome).toBe("NO_RECIPIENTS");
  });
});

describe("who can touch it", () => {
  it("the application role cannot call the delivery functions or read deliveries; the worker reads no table directly", async () => {
    await as(user.dawit, async (c) => {
      for (const sql of ["SELECT outbox_begin_delivery($1,$1,$1,'x')", "SELECT outbox_record_delivery($1,$1,$1,NULL)", "SELECT outbox_finish($1,$1)", "SELECT outbox_fail($1,$1,'x')"])
        expect(await fails(c, sql, [randomUUID()])).toMatch(/permission denied/);
      expect(await fails(c, "SELECT * FROM notification_deliveries")).toMatch(/permission denied/);
    });
    const w = await worker();
    try {
      await w.query("BEGIN");
      expect(await fails(w, "SELECT * FROM notification_deliveries")).toMatch(/permission denied/);
      expect(await fails(w, "SELECT * FROM notification_outbox")).toMatch(/permission denied/);
      await w.query("ROLLBACK");
      expect(await one(w, "SELECT to_regprocedure('outbox_complete(uuid)') f")).toEqual({ f: null });   // the unfenced versions are gone
      expect(await one(w, "SELECT to_regprocedure('outbox_fail(uuid,text)') f")).toEqual({ f: null });
    } finally { await w.end(); }
  });
});
