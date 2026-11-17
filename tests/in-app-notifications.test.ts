import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, Pool } from "pg";
import { actAs, authorized, fails, fn, mk, rows, setupDb, user } from "./helpers";
import { loadBell } from "../src/lib/notifications";
import { tick } from "../src/worker/mail";

// In-app notifications (Phase 6 Task 3D). Events are made by the real workflow and committed; the bell is read as the application role.
let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"]; let workerUrl: string;
beforeAll(async () => { const d = await setupDb("abig_test_bell"); owner = d.owner; as = d.as; workerUrl = d.workerUrl; });
afterAll(async () => { await owner?.end(); });

const tx = (c: Client) => ({ q: async (s: string, p?: unknown[]) => (await c.query(s, p as unknown[])).rows });
const committed = async <T,>(f: (c: Client) => Promise<T>) => { await owner.query("BEGIN"); try { const r = await f(owner); await owner.query("COMMIT"); return r; } catch (e) { await owner.query("ROLLBACK"); throw e; } };
const fanOut = async () => { const w = new Client({ connectionString: workerUrl }); await w.connect(); try { return Number((await w.query("SELECT fan_out_notifications(200) n")).rows[0].n); } finally { await w.end(); } };
const mine = (who: string) => as(who, async (c) => rows(c, "SELECT id, event_type, request_id, payload, read_at FROM user_notifications ORDER BY created_at, id"));
const bell = (who: string) => as(who, (c) => loadBell(tx(c)));
const forRequest = async (id: string) => (await rows(owner, "SELECT u.email, n.event_type FROM user_notifications n JOIN users u ON u.id = n.user_id WHERE n.request_id = $1 ORDER BY 2, 1", [id])).map((r) => `${r.event_type}:${r.email.replace("@abig.test", "")}`);

describe("who gets a notification", () => {
  it("the same people as the email, with separation of duties: verifiers for a submission, never the creator; the requester for the result", async () => {
    const id = await committed(async (c) => { await actAs(c, user.meron); const r = await mk(c, user.meron, { amounts: [1000] }); await fn(c, "wf_submit", r); return r; });
    await fanOut();
    expect(await forRequest(id)).toEqual(["REQUEST_SUBMITTED:dawit", "REQUEST_SUBMITTED:yared"]);
    await committed(async (c) => { await actAs(c, user.dawit); const v = (await rows(c, "SELECT version FROM payment_requests WHERE id = $1", [id]))[0].version; await fn(c, "wf_verify", id, v); });
    await fanOut();
    // Authentication is offered to Owners who did not verify it; Dawit verified, so he is not asked again.
    expect((await forRequest(id)).filter((x) => x.startsWith("REQUEST_VERIFIED"))).toEqual(["REQUEST_VERIFIED:kebede", "REQUEST_VERIFIED:yared"]);
    await committed(async (c) => { await actAs(c, user.kebede); const v = (await rows(c, "SELECT version FROM payment_requests WHERE id = $1", [id]))[0].version; await fn(c, "wf_return", id, v, "Wrong invoice"); });
    await fanOut();
    expect((await forRequest(id)).filter((x) => x.startsWith("REQUEST_RETURNED"))).toEqual(["REQUEST_RETURNED:meron"]);
    const returned = (await mine(user.meron)).find((n) => n.request_id === id && n.event_type === "REQUEST_RETURNED")!;
    expect(returned.payload).toEqual({ request_no: expect.stringMatching(/^PR-/), reason: "Wrong invoice" });   // only the fields the bell shows
  });
  it("company-wide and informational events stay email only, and are not offered again", async () => {
    const { id } = await committed((c) => authorized(c, { amounts: [700] }));   // submitted, verified, authenticated
    await committed(async (c) => { await actAs(c, user.abebe); await c.query("INSERT INTO company_bank_account_access (account_id, company_id, permissions, granted_by) VALUES ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000004', '{USE}', $1)", [user.abebe]); });
    await committed((c) => c.query("UPDATE users SET failed_logins = 4 WHERE id = $1", [user.lidya]).then(() => c.query("UPDATE users SET failed_logins = 5, locked_until = now() + interval '15 minutes' WHERE id = $1", [user.lidya])));
    await fanOut();
    expect(await forRequest(id)).not.toContain(expect.stringMatching(/REQUEST_AUTHORIZED/));
    expect((await forRequest(id)).filter((x) => x.startsWith("REQUEST_AUTHORIZED"))).toEqual([]);
    expect(await rows(owner, "SELECT 1 FROM user_notifications WHERE event_type IN ('REQUEST_AUTHORIZED','ACCOUNT_ACCESS_GRANTED','USER_LOCKED')")).toHaveLength(0);
    expect(await rows(owner, "SELECT 1 FROM notification_outbox WHERE in_app_at IS NULL")).toHaveLength(0);   // all handled, so never looked at again
    expect(await fanOut()).toBe(0);
  });
});

describe("each person sees and changes only their own", () => {
  it("reading, counting and marking read are limited to the signed-in person", async () => {
    const id = await committed(async (c) => { await actAs(c, user.meron); const r = await mk(c, user.meron, { amounts: [300] }); await fn(c, "wf_submit", r); return r; });
    await fanOut();
    const dawits = (await mine(user.dawit)).filter((n) => n.request_id === id);
    expect(dawits).toHaveLength(1);
    expect((await mine(user.meron)).some((n) => n.request_id === id)).toBe(false);
    expect((await mine(user.selam)).length).toBe(0);
    const before = await bell(user.dawit);
    expect(before.unread).toBeGreaterThan(0);
    expect(before.items[0]).toMatchObject({ title: expect.stringMatching(/is waiting for verification$/), link: `/requests/${id}`, read: false });
    // Someone else cannot mark Dawit's notification read, or read or change the table directly.
    expect(await as(user.yared, (c) => fn(c, "mark_notification_read", dawits[0].id))).toBe(0);
    await as(user.yared, async (c) => {
      expect(await rows(c, "SELECT 1 FROM user_notifications WHERE id = $1", [dawits[0].id])).toHaveLength(0);
      expect(await fails(c, "UPDATE user_notifications SET read_at = now()")).toMatch(/permission denied/);
      expect(await fails(c, "DELETE FROM user_notifications")).toMatch(/permission denied/);
      expect(await fails(c, "INSERT INTO user_notifications (user_id, event_type) VALUES ($1, 'X')", [user.yared])).toMatch(/permission denied/);
      expect(await fails(c, "SELECT fan_out_notifications(10)")).toMatch(/permission denied/);
    });
    expect((await rows(owner, "SELECT read_at FROM user_notifications WHERE id = $1", [dawits[0].id]))[0].read_at).toBeNull();
    await as(null, async (c) => { expect(await fails(c, "SELECT mark_all_notifications_read()")).toMatch(/not authenticated/); });
    // Dawit marks his own: one, then all. Committed calls, as the bell's actions make them.
    const app = async (who: string, sql: string, p: unknown[] = []) => { const c = new Client({ connectionString: workerUrl.replace("abig_worker:w", "abig_app:app") }); await c.connect(); try { await c.query("SELECT set_config('app.user_id',$1,false)", [who]); return (await c.query(sql, p)).rows[0]; } finally { await c.end(); } };
    expect((await app(user.dawit, "SELECT mark_notification_read($1) n", [dawits[0].id])).n).toBe(1);
    expect((await app(user.dawit, "SELECT mark_notification_read($1) n", [dawits[0].id])).n).toBe(0);   // already read
    expect((await bell(user.dawit)).unread).toBe(before.unread - 1);
    await app(user.dawit, "SELECT mark_all_notifications_read() n");
    expect((await bell(user.dawit)).unread).toBe(0);
    expect((await bell(user.yared)).unread).toBeGreaterThan(0);   // Yared's own are untouched
    expect((await bell(user.dawit)).items.every((n) => n.read)).toBe(true);   // read ones stay in the history
  });
});

describe("no duplicates, and email is untouched", () => {
  it("overlapping and repeated runs add each notification once", async () => {
    const ids = await committed(async (c) => { await actAs(c, user.meron); const out: string[] = []; for (let i = 0; i < 5; i++) { const r = await mk(c, user.meron, { amounts: [100 + i] }); await fn(c, "wf_submit", r); out.push(r); } return out; });
    const [a, b] = await Promise.all([fanOut(), fanOut()]);
    expect(a + b).toBe(10);   // five submissions, two verifiers each
    expect(await fanOut()).toBe(0);
    const counts = await rows(owner, "SELECT event_id, user_id, count(*)::int n FROM user_notifications WHERE request_id = ANY($1::uuid[]) GROUP BY 1, 2", [ids]);
    expect(counts).toHaveLength(10); expect(counts.every((r) => r.n === 1)).toBe(true);
    // Even a second pass over the same events cannot add a copy.
    await owner.query("UPDATE notification_outbox SET in_app_at = NULL WHERE request_id = ANY($1::uuid[])", [ids]);
    expect(await fanOut()).toBe(0);
  });
  it("adding notifications changes nothing about email delivery, and emails still go out", async () => {
    const id = await committed(async (c) => { await actAs(c, user.meron); const r = await mk(c, user.meron, { amounts: [55] }); await fn(c, "wf_submit", r); return r; });
    const before = await rows(owner, "SELECT id, attempts, outcome, lease_token, available_at, delivered_at, last_error FROM notification_outbox WHERE request_id = $1", [id]);
    await fanOut();
    expect(await rows(owner, "SELECT id, attempts, outcome, lease_token, available_at, delivered_at, last_error FROM notification_outbox WHERE request_id = $1", [id])).toEqual(before);
    expect(await rows(owner, "SELECT 1 FROM notification_deliveries d JOIN notification_outbox o ON o.id = d.event_id WHERE o.request_id = $1", [id])).toHaveLength(0);
    const pool = new Pool({ connectionString: workerUrl }); const sent: string[] = [];
    try { await tick(pool, async (m) => { sent.push(m.to); }, "https://x.test"); } finally { await pool.end(); }
    expect(sent).toEqual(expect.arrayContaining(["dawit@abig.test", "yared@abig.test"]));
    expect((await rows(owner, "SELECT outcome FROM notification_outbox WHERE request_id = $1", [id]))[0].outcome).toBe("DELIVERED");
    expect((await forRequest(id)).filter((x) => x.startsWith("REQUEST_SUBMITTED"))).toEqual(["REQUEST_SUBMITTED:dawit", "REQUEST_SUBMITTED:yared"]);
  });
  it("history stays when the outbox row is removed", async () => {
    const id = await committed(async (c) => { await actAs(c, user.meron); const r = await mk(c, user.meron, { amounts: [66] }); await fn(c, "wf_submit", r); return r; });
    await fanOut();
    await owner.query("DELETE FROM notification_outbox WHERE request_id = $1", [id]);
    const left = await rows(owner, "SELECT event_id, event_type FROM user_notifications WHERE request_id = $1", [id]);
    expect(left).toEqual([{ event_id: null, event_type: "REQUEST_SUBMITTED" }, { event_id: null, event_type: "REQUEST_SUBMITTED" }]);
    expect((await bell(user.dawit)).items.some((n) => n.link === `/requests/${id}`)).toBe(true);
  });
  it("the worker reads no table directly", async () => {
    const w = new Client({ connectionString: workerUrl }); await w.connect();
    try { await w.query("BEGIN"); expect(await fails(w, "SELECT * FROM user_notifications")).toMatch(/permission denied/); await w.query("ROLLBACK"); } finally { await w.end(); }
  });
});
