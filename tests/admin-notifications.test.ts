import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, Pool } from "pg";
import { ASKU, fails, rows, S_HAWASSA, setupDb, user } from "./helpers";
import { notificationFilters, notificationList, notificationSummary, notificationSubject } from "../src/lib/admin";
import { tick, type Mail } from "../src/worker/mail";

// Notification monitoring for system administrators. Events are inserted by hand so each test controls the outbox; REQUEST_SUBMITTED on a draft by
// Meron goes to ASKU's Finance Managers, Dawit and Yared.
let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"]; let appUrl: string; let workerUrl: string; let request: string;
const pools: Pool[] = [];
const one = async <T = any,>(c: Client, sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows[0] as T;
const event = async (type: string, req: string | null, payload: object, extra: Record<string, unknown> = {}) => {
  const cols = ["event_type", "request_id", "payload", ...Object.keys(extra)], vals = [type, req, payload, ...Object.values(extra)];
  return (await one<{ id: string }>(owner, `INSERT INTO notification_outbox (${cols.join(",")}) VALUES (${cols.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING id`, vals)).id;
};
const delivery = (id: string, who: string, email: string, status: string, attempts: number, error: string | null = null) =>
  owner.query("INSERT INTO notification_deliveries (event_id, user_id, email, status, attempts, sent_at, last_error) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, who, email, status, attempts, status === "SENT" ? new Date() : null, error]);
/** A committed call as the application role, signed in as this person, as the admin page and its action make it. */
const asApp = async <T,>(who: string, f: (c: Client) => Promise<T>) => {
  const c = new Client({ connectionString: appUrl }); await c.connect();
  try { await c.query("SELECT set_config('app.user_id', $1, false)", [who]); return await f(c); } finally { await c.end(); }
};
const tx = (c: Client) => ({ q: async (sql: string, p?: unknown[]) => (await c.query(sql, p as unknown[])).rows });
const sender = () => { const sent: Mail[] = []; return { sent, send: async (m: Mail) => { sent.push(m); } }; };

beforeAll(async () => {
  const d = await setupDb("abig_test_admin_notifications"); owner = d.owner; as = d.as; appUrl = d.appUrl; workerUrl = d.workerUrl;
  request = (await one<{ id: string }>(owner, "INSERT INTO payment_requests (debtor_company_id, supplier_id, created_by, total_amount) VALUES ($1,$2,$3,10) RETURNING id", [ASKU, S_HAWASSA, user.meron])).id;
});
afterAll(async () => { for (const p of pools) await p.end(); await owner?.end(); });
const reset = () => owner.query("DELETE FROM notification_outbox");

describe("only system administrators", () => {
  it("can see or retry notifications; everyone else is refused, and nobody reads the tables directly", async () => {
    await reset(); const id = await event("REQUEST_SUBMITTED", request, { request_no: "PR-1" }, { outcome: "DEAD", attempts: 8, dead_at: new Date(), last_error: "550" });
    for (const who of [user.dawit, user.kebede, user.meron, user.selam]) await as(who, async (c) => {
      expect(await fails(c, "SELECT * FROM admin_notification_summary()")).toMatch(/only a system administrator/);
      expect(await fails(c, "SELECT * FROM admin_notification_list()")).toMatch(/only a system administrator/);
      expect(await fails(c, "SELECT admin_notification_retry($1)", [id])).toMatch(/only a system administrator/);
    });
    await as(null, async (c) => { expect(await fails(c, "SELECT * FROM admin_notification_summary()")).toMatch(/only a system administrator/); });
    await as(user.admin, async (c) => {
      expect(await fails(c, "SELECT * FROM notification_outbox")).toMatch(/permission denied/);
      expect(await fails(c, "SELECT * FROM notification_deliveries")).toMatch(/permission denied/);
      expect(await fails(c, "SELECT notification_status(o) FROM (SELECT NULL::notification_outbox o) x")).toMatch(/permission denied/);
    });
    const w = new Client({ connectionString: workerUrl }); await w.connect();
    try { await w.query("BEGIN"); expect(await fails(w, "SELECT admin_notification_retry($1)", [id])).toMatch(/permission denied/); await w.query("ROLLBACK"); } finally { await w.end(); }
    expect((await one(owner, "SELECT outcome FROM notification_outbox WHERE id = $1", [id])).outcome).toBe("DEAD");
  });
});

describe("summary and list", () => {
  it("counts each state and lists the newest matching events with their recipients, without the payload's other fields", async () => {
    await reset();
    const waiting = await event("REQUEST_SUBMITTED", request, { request_no: "PR-1" });
    const retrying = await event("REQUEST_SUBMITTED", request, { request_no: "PR-2" }, { attempts: 2, last_error: "421 try later", available_at: new Date(Date.now() + 600000) });
    const dead = await event("ACCOUNT_SHORTFALL", null, { account_id: randomUUID(), account_label: "BEES CBE current", balance: 1, reserved: 2, shortfall_amount: 1 }, { outcome: "DEAD", attempts: 8, dead_at: new Date(), last_error: "550 no such user" });
    await event("SUPPLIER_BANK_DETAILS_PENDING", null, { detail_id: randomUUID(), supplier_name: "Hawassa Packaging PLC", version: 2 }, { outcome: "NO_RECIPIENTS", last_error: "no recipients" });
    const delivered = await event("REQUEST_PAID", request, { request_no: "PR-3", state: "PAID" }, { outcome: "DELIVERED", attempts: 1, delivered_at: new Date() });
    await delivery(dead, user.abebe, "abebe@abig.test", "FAILED", 8, "550 no such user");
    await delivery(delivered, user.meron, "meron@abig.test", "SENT", 1);
    await as(user.admin, async (c) => {
      expect(await notificationSummary(tx(c))).toMatchObject({ waiting: 2, due: 1, retrying: 1, dead: 1, no_recipients: 1, delivered_24h: 1 });
      const all = await notificationList(tx(c), notificationFilters(() => null));
      expect(all).toHaveLength(5);
      expect(Object.fromEntries(all.map((n) => [n.id, n.status]))).toMatchObject({ [waiting]: "WAITING", [retrying]: "RETRYING", [dead]: "DEAD", [delivered]: "DELIVERED" });
      const d = all.find((n) => n.id === dead)!;
      expect(d.deliveries).toEqual([{ email: "abebe@abig.test", status: "FAILED", attempts: 8, sent_at: null, last_error: "550 no such user" }]);
      expect(notificationSubject(d)).toBe("BEES CBE current");
      expect(JSON.stringify(all)).not.toMatch(/shortfall_amount|"balance"|"reserved"|account_id/);   // only the naming fields leave the database
      const by = async (q: Record<string, string>) => (await notificationList(tx(c), notificationFilters((k) => q[k]))).map((n) => n.id).sort();
      expect(await by({ nstatus: "DEAD" })).toEqual([dead]);
      expect(await by({ nstatus: "OPEN" })).toEqual([waiting, retrying].sort());
      expect(await by({ ntype: "REQUEST_PAID" })).toEqual([delivered]);
      expect(await by({ nq: "PR-2" })).toEqual([retrying]);
      expect(await by({ nq: "meron@" })).toEqual([delivered]);           // by recipient email
      expect(await by({ nq: "hawassa" })).toHaveLength(1);
      expect(await by({ nfrom: "2000-01-01", nto: "2000-01-31" })).toEqual([]);
      expect(await by({ nstatus: "NOPE", ntype: "DROP TABLE", nfrom: "yesterday" })).toHaveLength(5);   // unknown filters are ignored
      expect(await by({ nstatus: "constructor", ntype: "toString", nfrom: "2026-02-30", nto: "2026-04-31" })).toHaveLength(5);   // built-in names and impossible days too
      expect(notificationFilters((k) => ({ nstatus: "__proto__", nfrom: "2026-13-01", nto: "2028-02-29" } as Record<string, string>)[k])).toMatchObject({ status: null, from: null, to: "2028-02-29" });
    });
  });
  it("returns at most 200, newest first", async () => {
    await reset();
    await owner.query("INSERT INTO notification_outbox (event_type, request_id, payload, created_at) SELECT 'REQUEST_SUBMITTED', $1, jsonb_build_object('request_no', 'PR-' || g), now() - g * interval '1 minute' FROM generate_series(1, 205) g", [request]);
    await as(user.admin, async (c) => {
      const list = await notificationList(tx(c), notificationFilters(() => null));
      expect(list).toHaveLength(200); expect(list[0].request_no).toBe("PR-1");
      expect((await rows(c, "SELECT * FROM admin_notification_list(NULL,NULL,NULL,NULL,NULL,100000)"))).toHaveLength(200);
    });
  });
});

describe("sending again", () => {
  it("a DEAD event is reopened with fresh attempts, audited, and the worker emails only those not already sent it", async () => {
    await reset();
    const dead = await event("REQUEST_SUBMITTED", request, { request_no: "PR-9" }, { outcome: "DEAD", attempts: 8, dead_at: new Date(), last_error: "yared@abig.test: 550" });
    await delivery(dead, user.dawit, "dawit@abig.test", "SENT", 1);
    await delivery(dead, user.yared, "yared@abig.test", "FAILED", 8, "550");
    expect(await asApp(user.admin, async (c) => (await one(c, "SELECT admin_notification_retry($1) AS r", [dead])).r)).toBe("QUEUED");
    expect(await one(owner, "SELECT outcome, attempts, dead_at, last_error, lease_token, available_at <= now() AS due FROM notification_outbox WHERE id = $1", [dead]))
      .toEqual({ outcome: null, attempts: 0, dead_at: null, last_error: null, lease_token: null, due: true });
    const audit = await one(owner, "SELECT actor_id, company_id, entity_type, metadata FROM audit_events WHERE action = 'ADMIN_NOTIFICATION_RETRIED' AND entity_id = $1", [dead]);
    expect(audit).toMatchObject({ actor_id: user.admin, company_id: null, entity_type: "NOTIFICATION", metadata: { event_type: "REQUEST_SUBMITTED", previous_outcome: "DEAD", attempts: 8, last_error: "yared@abig.test: 550" } });
    expect(audit.metadata.dead_at).toBeTruthy();

    const s = sender(); const pool = new Pool({ connectionString: workerUrl }); pools.push(pool);
    expect(await tick(pool, s.send, "https://x.test")).toBe(1);
    expect(s.sent.map((m) => m.to)).toEqual(["yared@abig.test"]);   // Dawit already had it
    expect((await one(owner, "SELECT outcome, attempts FROM notification_outbox WHERE id = $1", [dead]))).toEqual({ outcome: "DELIVERED", attempts: 1 });
  });
  it("a NO_RECIPIENTS event is resolved again: someone given the role since then receives it", async () => {
    await reset();
    const dm = (await one(owner, "SELECT id FROM companies WHERE code = 'DAILYMART'")).id;
    const dmReq = (await one(owner, "INSERT INTO payment_requests (debtor_company_id, supplier_id, created_by, total_amount) VALUES ($1,$2,$3,10) RETURNING id", [dm, S_HAWASSA, user.bereket])).id;
    const id = await event("REQUEST_SUBMITTED", dmReq, { request_no: "PR-DM" });
    const pool = new Pool({ connectionString: workerUrl }); pools.push(pool);
    await tick(pool, sender().send, "https://x.test");
    expect((await one(owner, "SELECT outcome FROM notification_outbox WHERE id = $1", [id])).outcome).toBe("NO_RECIPIENTS");
    // Daily Mart gets a Finance Manager, then the administrator sends it again.
    const fm = (await one(owner, "INSERT INTO users (email, full_name) VALUES ('tsion@abig.test', 'Tsion (Daily Mart finance manager)') RETURNING id")).id;
    const m = (await one(owner, "INSERT INTO company_memberships (company_id, user_id) VALUES ($1,$2) RETURNING id", [dm, fm])).id;
    await owner.query("INSERT INTO membership_roles (membership_id, role_id) SELECT $1, id FROM roles WHERE code = 'FINANCE_MANAGER'", [m]);
    await asApp(user.admin, (c) => c.query("SELECT admin_notification_retry($1)", [id]));
    const s = sender(); await tick(pool, s.send, "https://x.test");
    expect(s.sent.map((x) => x.to)).toEqual(["tsion@abig.test"]);
    expect((await one(owner, "SELECT outcome FROM notification_outbox WHERE id = $1", [id])).outcome).toBe("DELIVERED");
  });
  it("is refused for delivered, open and unknown notifications, and a second retry of the same one", async () => {
    await reset();
    const delivered = await event("REQUEST_PAID", request, { request_no: "PR-3" }, { outcome: "DELIVERED", attempts: 1, delivered_at: new Date() });
    const open = await event("REQUEST_SUBMITTED", request, { request_no: "PR-4" });
    const dead = await event("REQUEST_SUBMITTED", request, { request_no: "PR-5" }, { outcome: "DEAD", attempts: 8, dead_at: new Date(), last_error: "x" });
    await as(user.admin, async (c) => {
      for (const id of [delivered, open]) expect(await fails(c, "SELECT admin_notification_retry($1)", [id])).toMatch(/only a notification that failed or found nobody/);
      expect(await fails(c, "SELECT admin_notification_retry($1)", [randomUUID()])).toMatch(/notification not found/);
      await c.query("SELECT admin_notification_retry($1)", [dead]);
      expect(await fails(c, "SELECT admin_notification_retry($1)", [dead])).toMatch(/only a notification that failed or found nobody/);
      expect(Number((await one(c, "SELECT count(*) n FROM audit_events WHERE action = 'ADMIN_NOTIFICATION_RETRIED' AND entity_id = $1", [dead])).n)).toBe(1);
    });
    expect((await one(owner, "SELECT outcome FROM notification_outbox WHERE id = $1", [delivered])).outcome).toBe("DELIVERED");
  });
});
