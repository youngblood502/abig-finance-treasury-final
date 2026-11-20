import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { Client } from "pg";
import type { Tx } from "../src/lib/db";
import { actAs, key, mk, setupDb, user } from "./helpers";

// The attachment download route, as the application runs it: the real route handler, session lookup (the development "acting as" cookie),
// row-level security and private storage (a scratch folder). A file recorded in the database but missing from storage reads as not found.
const DB = "abig_test_attachment_download";
vi.setConfig({ testTimeout: 60_000 });
const env = vi.hoisted(() => {
  const dir = `${process.env.TEMP || process.env.TMPDIR || "/tmp"}/abig-attachment-test-${process.pid}-${Date.now()}`;
  process.env.STORAGE_DIR = dir;
  return { appUrl: "", actingAs: "", dir };
});
class Redirected extends Error { constructor(public url: string) { super("redirect " + url); } }
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n === "abig_dev_user" && env.actingAs ? { value: env.actingAs } : undefined), set: () => {}, delete: () => {} }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Redirected(url); }, notFound: () => { throw new Redirected("/404"); } }));
vi.mock("@/lib/storage", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/storage")>();
  return { ...real, getObject: vi.fn(real.getObject) };
});
vi.mock("@/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/db")>();
  const { Client: PgClient } = await import("pg");
  return { ...real, withUser: async <T,>(userId: string, run: (tx: Tx) => Promise<T>): Promise<T> => {
    const c = new PgClient({ connectionString: env.appUrl }); await c.connect();
    try { await c.query("BEGIN"); await c.query("SELECT set_config('app.user_id', $1, true)", [userId]); const out = await run({ q: async (sql, params) => (await c.query(sql, params as unknown[])).rows }); await c.query("COMMIT"); return out; }
    catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { await c.end(); }
  } };
});
const storage = await import("../src/lib/storage");
const route = await import("../src/app/api/attachments/[id]/route");

let owner: Client; let stored: string; let missing: string; const PDF = Buffer.from("%PDF-1.4\n% a small test invoice\n%%EOF\n");
const get = (who: string, id: string) => { env.actingAs = who; return route.GET(new Request(`http://x/api/attachments/${id}`), { params: Promise.resolve({ id }) }); };

beforeAll(async () => {
  const d = await setupDb(DB); owner = d.owner; env.appUrl = d.appUrl;
  await owner.query("BEGIN"); await actAs(owner, user.meron);
  const req = await mk(owner, user.meron, { noDocument: true });
  const k = key();
  stored = (await owner.query(`INSERT INTO attachments (request_id, kind, object_key, filename, mime_type, size_bytes, sha256, uploaded_by) VALUES ($1,'INVOICE',$2,'INV-STORED.pdf','application/pdf',$3,$4,$5) RETURNING id`, [req, k, PDF.length, key(), user.meron])).rows[0].id;
  // Like the demo data: recorded, but never written to storage.
  missing = (await owner.query(`INSERT INTO attachments (request_id, kind, object_key, filename, mime_type, size_bytes, sha256, uploaded_by) VALUES ($1,'SUPPORTING',$2,'EC-7781.pdf','application/pdf',1000,$3,$4) RETURNING id`, [req, key(), key(), user.meron])).rows[0].id;
  await owner.query("COMMIT");
  await storage.putObject(k, PDF);
}, 120_000);
afterAll(async () => { await owner?.end(); rmSync(env.dir, { recursive: true, force: true }); });

describe("downloading an attachment", () => {
  it("serves a stored file to someone who can see the request", async () => {
    const res = await get(user.meron, stored);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
    expect(Object.fromEntries(res.headers)).toMatchObject({ "content-type": "application/pdf", "content-disposition": 'attachment; filename="INV-STORED.pdf"', "x-content-type-options": "nosniff", "cache-control": "private, no-store" });
  });
  it("reads as not found, not a server error, when the recorded file is missing from storage", async () => {
    const res = await get(user.meron, missing);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
    expect(Object.fromEntries(res.headers)).toMatchObject({ "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
  });
  it("reads as not found for another company, an unknown id or a malformed id", async () => {
    expect((await get(user.bereket, stored)).status).toBe(404);
    expect((await get(user.meron, "a0000000-0000-4000-8000-00000000ffff")).status).toBe(404);
    expect((await get(user.meron, "not-a-uuid")).status).toBe(404);
  });
  it("still fails loudly for any other storage error", async () => {
    vi.mocked(storage.getObject).mockRejectedValueOnce(Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }));
    await expect(get(user.meron, stored)).rejects.toThrow(/EACCES/);
  });
});
