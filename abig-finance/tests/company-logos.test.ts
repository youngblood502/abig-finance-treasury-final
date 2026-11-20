import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Client } from "pg";
import ExcelJS from "exceljs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Tx } from "../src/lib/db";
import { inspectImage, validateLogo } from "../src/lib/company-logo";
import { loadVoucher } from "../src/lib/voucher";
import { voucherPdf } from "../src/lib/voucher-pdf";
import { voucherXlsx } from "../src/lib/voucher-xlsx";
import { actAs, ASKU, authorized, BERBERO, fails, key, rows, setupDb, user } from "./helpers";
import { fileOf, makeBadDataPng, makeJpeg, makePng, pngSize } from "./images";

// Company logos: the table and its functions (admin only, audited, history, one current logo), row-level security, the upload validation,
// the administration actions with private storage (including a storage failure), the logo route, and the logo on each voucher format, chosen
// by the request's paying company and never by the owner of the bank account it is paid from. The ABIG logo is never used in its place.
const DB = "abig_test_company_logos";
vi.setConfig({ testTimeout: 60_000 });   // many checks open their own database connection
const BEES = "c0000000-0000-4000-8000-000000000003", DAILYMART = "c0000000-0000-4000-8000-000000000004";
const env = vi.hoisted(() => {
  const dir = `${process.env.TEMP || process.env.TMPDIR || "/tmp"}/abig-logo-test-${process.pid}-${Date.now()}`;
  process.env.STORAGE_DIR = dir;
  // script: what the next database connections do, one entry each ("ok", "lose-reply": commit, then the reply is lost, "down": cannot connect).
  return { appUrl: "", actingAs: "", dir, script: [] as string[] };
});
class Redirected extends Error { constructor(public url: string) { super("redirect " + url); } }
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n === "abig_dev_user" && env.actingAs ? { value: env.actingAs } : undefined), set: () => {}, delete: () => {} }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Redirected(url); }, notFound: () => { throw new Redirected("/404"); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/link", async () => { const { createElement: h } = await import("react"); return { default: ({ href, children, ...p }: { href: string; children: unknown }) => h("a", { href, ...p }, children as never) }; });
vi.mock("@/lib/storage", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/storage")>();
  return { ...real, putObject: vi.fn(real.putObject) };
});
vi.mock("@/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/db")>();
  const { Client: PgClient } = await import("pg");
  return { ...real, withUser: async <T,>(userId: string, run: (tx: Tx) => Promise<T>): Promise<T> => {
    const step = env.script.shift() ?? "ok";
    if (step === "down") throw new Error("connect ECONNREFUSED 127.0.0.1:55432");
    const c = new PgClient({ connectionString: env.appUrl }); await c.connect();
    try {
      await c.query("BEGIN"); await c.query("SELECT set_config('app.user_id', $1, true)", [userId]); const out = await run({ q: async (sql, params) => (await c.query(sql, params as unknown[])).rows }); await c.query("COMMIT");
      if (step === "lose-reply") throw new Error("Connection terminated unexpectedly");   // committed on the server; the client never hears back
      return out;
    }
    catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { await c.end(); }
  } };
});
const storage = await import("../src/lib/storage");
const actions = await import("../src/app/admin-actions");
const logoRoute = await import("../src/app/companies/[id]/logo/route");
const voucherRoute = await import("../src/app/requests/[id]/voucher/[format]/route");
const PrintVoucher = (await import("../src/app/requests/[id]/print/page")).default;

let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
const tx = (c: Client): Tx => ({ q: async (sql, p) => (await c.query(sql, p as unknown[])).rows });
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const stored = () => (existsSync(env.dir) ? readdirSync(env.dir).sort() : []);
const ABIG = readFileSync(join(process.cwd(), "public", "abig-logo.png"));
// Distinct sizes, so an embedded image says whose logo it is.
const LOGO = { asku: makePng(96, 96, { rgb: [10, 20, 30] }), bees: makePng(100, 80, { rgb: [200, 30, 30] }), berbero: makePng(120, 90, { rgb: [30, 30, 200] }) };

async function call(who: string, action: (f: FormData) => Promise<unknown>, fields: Record<string, string | File>) {
  env.actingAs = who; const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v);
  try { await action(f); } catch (e) { if (e instanceof Redirected) { const u = new URL(e.url, "http://x"); return { msg: u.searchParams.get("msg"), err: u.searchParams.get("err") }; } throw e; }
  throw new Error("the action did not redirect");
}
const upload = (who: string, company: string, data: Buffer, type = "image/png") => call(who, actions.setCompanyLogo, { company, logo: fileOf(data, type, "logo.png") });
const getLogo = async (who: string, company: string, v?: string) => {
  env.actingAs = who;
  return logoRoute.GET(new Request(`http://x/companies/${company}/logo${v ? `?v=${v}` : ""}`), { params: Promise.resolve({ id: company }) });
};
const current = async (company: string) => (await rows(owner, "SELECT * FROM company_logos WHERE company_id = $1 AND ended_at IS NULL", [company]))[0];

beforeAll(async () => {
  const d = await setupDb(DB); owner = d.owner; as = d.as; env.appUrl = d.appUrl;
}, 120_000);
afterAll(async () => { await owner?.end(); rmSync(env.dir, { recursive: true, force: true }); });

describe("upload validation", () => {
  it("accepts genuine PNG and JPEG files and reports their size", async () => {
    expect(await validateLogo(fileOf(LOGO.asku, "image/png"))).toMatchObject({ mime: "image/png", width: 96, height: 96, size: LOGO.asku.length, sha256: sha(LOGO.asku) });
    expect(await validateLogo(fileOf(makePng(64, 2000, { alpha: true }), "image/png"))).toMatchObject({ width: 64, height: 2000 });
    expect(await validateLogo(fileOf(makePng(70, 65, { interlace: 1 }), "image/png"))).toMatchObject({ width: 70, height: 65 });
    expect(await validateLogo(fileOf(makeJpeg(128, 72), "image/jpeg"))).toMatchObject({ mime: "image/jpeg", width: 128, height: 72 });
  });
  it("rejects SVG, other formats and files whose contents do not match their declared type", async () => {
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(1)</script></svg>');
    await expect(validateLogo(fileOf(svg, "image/svg+xml"))).rejects.toThrow(/SVG files are not accepted/);
    await expect(validateLogo(fileOf(svg, "image/png"))).rejects.toThrow(/SVG files are not accepted/);
    await expect(validateLogo(fileOf(Buffer.from("GIF89a" + "\0".repeat(100)), "image/gif"))).rejects.toThrow(/Only PNG or JPEG/);
    await expect(validateLogo(fileOf(Buffer.from("%PDF-1.4 ..."), "image/png"))).rejects.toThrow(/Only PNG or JPEG/);
    await expect(validateLogo(fileOf(LOGO.asku, "image/jpeg"))).rejects.toThrow(/contents are a PNG image, but it was sent as image\/jpeg/);
    await expect(validateLogo(fileOf(makeJpeg(100, 100), "image/png"))).rejects.toThrow(/contents are a JPEG image/);
  });
  it("rejects files over 1 MB and images outside 64 to 2,000 pixels a side", async () => {
    await expect(validateLogo(fileOf(Buffer.concat([LOGO.asku, Buffer.alloc(1024 * 1024)]), "image/png"))).rejects.toThrow(/at most 1 MB/);
    await expect(validateLogo(fileOf(makePng(63, 100), "image/png"))).rejects.toThrow(/63 × 100 pixels; it must be at least 64/);
    await expect(validateLogo(fileOf(makePng(2001, 64), "image/png"))).rejects.toThrow(/at most 2000 pixels/);
    await expect(validateLogo(fileOf(makeJpeg(32, 32), "image/jpeg"))).rejects.toThrow(/at least 64/);
    await expect(validateLogo(fileOf(Buffer.alloc(0), "image/png"))).rejects.toThrow(/Choose a PNG or JPEG file/);
  });
  it("rejects malformed and corrupt images", () => {
    const flip = (b: Buffer, at: number) => { const c = Buffer.from(b); c[at] ^= 0xff; return c; };
    const png = LOGO.asku;
    const corrupt = /damaged or is not a valid/;
    expect(() => inspectImage(flip(png, 40))).toThrow(corrupt);                          // a checksum no longer matches
    expect(() => inspectImage(png.subarray(0, png.length - 20))).toThrow(corrupt);       // truncated
    expect(() => inspectImage(makeBadDataPng(100, 100))).toThrow(corrupt);               // valid chunks, pixel data not decodable
    expect(() => inspectImage(Buffer.concat([png, Buffer.from("<script>alert(1)</script>")]))).toThrow(corrupt);   // data hidden after the end
    expect(() => inspectImage(makeJpeg(100, 100, { end: false }))).toThrow(corrupt);     // no end marker
    expect(() => inspectImage(makeJpeg(100, 100, { sof: 0xc9 }))).toThrow(/arithmetic-coded/);
    expect(() => inspectImage(Buffer.concat([makeJpeg(100, 100).subarray(0, 30), Buffer.from([0x12, 0x34])]))).toThrow(corrupt);
  });
});

describe("the database", () => {
  it("lets only a system administrator set or remove a logo", async () => {
    for (const who of [user.meron, user.dawit, user.kebede, user.selam, user.hana]) {
      expect(await as(who, (c) => c.query("SELECT admin_company_logo_set($1,$2,'image/png',100,$3,100,100)", [ASKU, key(), key()]).then(() => "ok", (e) => e.message))).toMatch(/only a system administrator/);
      expect(await as(who, (c) => c.query("SELECT admin_company_logo_remove($1)", [ASKU]).then(() => "ok", (e) => e.message))).toMatch(/only a system administrator/);
    }
  });
  it("gives the app role no direct writes, even for a system administrator", async () => {
    await as(user.admin, async (c) => {
      expect(await fails(c, "INSERT INTO company_logos (company_id, object_key, mime_type, size_bytes, sha256, width, height, uploaded_by) VALUES ($1,$2,'image/png',100,$3,100,100,$4)", [ASKU, key(), key(), user.admin])).toMatch(/permission denied/);
      expect(await fails(c, "UPDATE company_logos SET width = 100")).toMatch(/permission denied/);
      expect(await fails(c, "DELETE FROM company_logos")).toMatch(/permission denied/);
      expect(await fails(c, "TRUNCATE company_logos")).toMatch(/permission denied/);
    });
    expect((await rows(owner, "SELECT has_table_privilege('abig_app','company_logos','INSERT,UPDATE,DELETE,TRUNCATE') w, has_table_privilege('abig_app','company_logos','SELECT') r"))[0]).toEqual({ w: false, r: true });
  });
  it("keeps replacement and removal history, audits old and new hashes, and refuses bad descriptions", async () => {
    const [k1, k2, h1, h2] = [key(), key(), key(), key()];
    await owner.query("BEGIN"); await actAs(owner, user.admin);
    const id1 = (await rows(owner, "SELECT admin_company_logo_set($1,$2,'image/png',1000,$3,200,100) AS v", [DAILYMART, k1, h1]))[0].v;
    const id2 = (await rows(owner, "SELECT admin_company_logo_set($1,$2,'image/jpeg',2000,$3,300,300) AS v", [DAILYMART, k2, h2.toUpperCase()]))[0].v;
    await owner.query("SELECT admin_company_logo_remove($1)", [DAILYMART]);
    await owner.query("COMMIT");
    const hist = await rows(owner, "SELECT id, object_key, sha256, end_reason, ended_by FROM company_logos WHERE company_id = $1 ORDER BY uploaded_at, end_reason DESC", [DAILYMART]);
    expect(hist).toEqual([{ id: id1, object_key: k1, sha256: h1, end_reason: "REPLACED", ended_by: user.admin }, { id: id2, object_key: k2, sha256: h2, end_reason: "REMOVED", ended_by: user.admin }]);
    const audit = await rows(owner, "SELECT action, entity_type, entity_id, company_id, actor_id, metadata FROM audit_events WHERE entity_type = 'COMPANY_LOGO' AND company_id = $1 ORDER BY occurred_at, action DESC", [DAILYMART]);
    expect(audit.map((a) => a.action).sort()).toEqual(["COMPANY_LOGO_REMOVED", "COMPANY_LOGO_REPLACED", "COMPANY_LOGO_UPLOADED"]);
    const by = (a: string) => audit.find((x) => x.action === a)!;
    expect(by("COMPANY_LOGO_UPLOADED")).toMatchObject({ entity_id: id1, actor_id: user.admin, metadata: { previous_sha256: null, new_sha256: h1, mime_type: "image/png", size_bytes: 1000, width: 200, height: 100 } });
    expect(by("COMPANY_LOGO_REPLACED")).toMatchObject({ entity_id: id2, metadata: { previous_sha256: h1, new_sha256: h2, previous_logo_id: id1 } });
    expect(by("COMPANY_LOGO_REMOVED")).toMatchObject({ entity_id: id2, metadata: { previous_sha256: h2 } });
    expect(JSON.stringify(audit)).not.toMatch(new RegExp(`${k1}|${k2}`));   // no object keys, and no image contents, in the audit
    // History is fixed, even for the table owner: no deletes, no edits, an ended row stays ended.
    await owner.query("BEGIN");
    expect(await fails(owner, "DELETE FROM company_logos WHERE id = $1", [id1])).toMatch(/cannot be deleted/);
    expect(await fails(owner, "UPDATE company_logos SET sha256 = $2 WHERE id = $1", [id2, key()])).toMatch(/cannot be changed/);
    expect(await fails(owner, "UPDATE company_logos SET ended_at = NULL, ended_by = NULL, end_reason = NULL WHERE id = $1", [id1])).toMatch(/cannot be changed/);
    await owner.query("ROLLBACK");
    // Removing when there is nothing to remove, and descriptions the table refuses.
    await owner.query("BEGIN"); await actAs(owner, user.admin);
    expect(await fails(owner, "SELECT admin_company_logo_remove($1)", [DAILYMART])).toMatch(/no logo to remove/);
    expect(await fails(owner, "SELECT admin_company_logo_set($1,$2,'image/png',100,$3,100,100)", ["c0000000-0000-4000-8000-0000000000ff", key(), key()])).toMatch(/company not found/);
    expect(await fails(owner, "SELECT admin_company_logo_set($1,'../../etc/passwd','image/png',100,$2,100,100)", [DAILYMART, key()])).toMatch(/object_key/);
    expect(await fails(owner, "SELECT admin_company_logo_set($1,$2,'image/svg+xml',100,$3,100,100)", [DAILYMART, key(), key()])).toMatch(/mime_type/);
    expect(await fails(owner, "SELECT admin_company_logo_set($1,$2,'image/png',2000000,$3,100,100)", [DAILYMART, key(), key()])).toMatch(/size_bytes/);
    expect(await fails(owner, "SELECT admin_company_logo_set($1,$2,'image/png',100,$3,10,100)", [DAILYMART, key(), key()])).toMatch(/width/);
    await owner.query("ROLLBACK");
  });
  it("allows at most one current logo per company", async () => {
    await owner.query("BEGIN"); await actAs(owner, user.admin);
    await owner.query("SELECT admin_company_logo_set($1,$2,'image/png',100,$3,100,100)", [DAILYMART, key(), key()]);
    expect(await fails(owner, "INSERT INTO company_logos (company_id, object_key, mime_type, size_bytes, sha256, width, height, uploaded_by) VALUES ($1,$2,'image/png',100,$3,100,100,$4)", [DAILYMART, key(), key(), user.admin])).toMatch(/company_logos_one_current/);
    await owner.query("ROLLBACK");
  });
});

describe("the administration actions and private storage", () => {
  it("store an administrator's upload under a random key, and replace it", async () => {
    const before = stored();
    expect(await upload(user.admin, ASKU, LOGO.asku)).toEqual({ msg: "Logo saved. Vouchers for this company now show it.", err: null });
    const row = await current(ASKU);
    expect(row).toMatchObject({ mime_type: "image/png", width: 96, height: 96, size_bytes: LOGO.asku.length, sha256: sha(LOGO.asku), uploaded_by: user.admin });
    expect(row.object_key).toMatch(/^[0-9a-f]{64}$/);
    expect(stored()).toEqual([...before, row.object_key].sort());
    expect(readFileSync(join(env.dir, row.object_key)).equals(LOGO.asku)).toBe(true);
    // Replace: a new row and file; the old ones are kept as history.
    const jpeg = makeJpeg(160, 160);
    expect((await upload(user.admin, ASKU, jpeg, "image/jpeg")).err).toBeNull();
    const now = await current(ASKU);
    expect(now).toMatchObject({ mime_type: "image/jpeg", sha256: sha(jpeg) });
    expect(now.object_key).not.toBe(row.object_key);
    expect(existsSync(join(env.dir, row.object_key))).toBe(true);
    expect((await rows(owner, "SELECT end_reason FROM company_logos WHERE id = $1", [row.id]))[0].end_reason).toBe("REPLACED");
    expect((await upload(user.admin, ASKU, LOGO.asku)).err).toBeNull();   // back to the PNG for the voucher tests
  });
  it("refuse anyone but a system administrator, and write nothing", async () => {
    const before = stored(), was = await current(ASKU);
    for (const who of [user.meron, user.dawit, user.kebede, user.selam]) {
      expect(await upload(who, ASKU, LOGO.bees)).toMatchObject({ err: "Only a system administrator can do that." });
      expect(await call(who, actions.removeCompanyLogo, { company: ASKU })).toMatchObject({ err: "Only a system administrator can do that." });
    }
    expect(stored()).toEqual(before); expect(await current(ASKU)).toEqual(was);
  });
  it("show validation errors and store nothing for a bad file", async () => {
    const before = stored(), was = await current(ASKU);
    expect(await upload(user.admin, ASKU, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/svg+xml")).toMatchObject({ err: "SVG files are not accepted. Upload a PNG or JPEG." });
    expect(await upload(user.admin, ASKU, makePng(30, 30))).toMatchObject({ err: expect.stringMatching(/at least 64 pixels/) });
    expect(await upload(user.admin, ASKU, makeBadDataPng(100, 100))).toMatchObject({ err: "The file is damaged or is not a valid PNG or JPEG image." });
    expect(await call(user.admin, actions.setCompanyLogo, { company: ASKU })).toMatchObject({ err: "Choose a PNG or JPEG file." });
    expect(await upload(user.admin, "not-a-company", LOGO.asku)).toMatchObject({ err: "Choose a company." });
    expect(await upload(user.admin, "c0000000-0000-4000-8000-0000000000ff", LOGO.asku)).toMatchObject({ err: "company not found" });
    expect(stored()).toEqual(before); expect(await current(ASKU)).toEqual(was);
  });
  it("roll back the database row and delete a partly written file when storage fails", async () => {
    const before = stored(), was = await current(BEES);
    const real = (await vi.importActual<typeof import("../src/lib/storage")>("../src/lib/storage")).putObject;
    vi.mocked(storage.putObject).mockImplementationOnce(async (k: string, data: Buffer) => { await real(k, data.subarray(0, 20)); throw new Error("ENOSPC: no space left on device"); });
    expect(await upload(user.admin, BEES, LOGO.bees)).toMatchObject({ err: "The logo could not be stored. Nothing was changed; try again." });
    expect(stored()).toEqual(before);                 // the partial file was removed
    expect(await current(BEES)).toEqual(was);          // no row
    expect((await rows(owner, "SELECT count(*)::int n FROM audit_events WHERE entity_type = 'COMPANY_LOGO' AND company_id = $1", [BEES]))[0].n).toBe(0);
  });
  it("keep the file when the commit went through but its reply was lost, and report success", async () => {
    env.script = ["ok", "lose-reply"];   // the admin check, then the upload's transaction
    expect(await upload(user.admin, BEES, LOGO.bees)).toEqual({ msg: "Logo saved. Vouchers for this company now show it.", err: null });
    expect(env.script).toEqual([]);
    const row = await current(BEES);
    expect(row).toMatchObject({ sha256: sha(LOGO.bees) });
    expect(readFileSync(join(env.dir, row.object_key)).equals(LOGO.bees)).toBe(true);   // the current logo's file is there
  });
  it("keep the file when the outcome cannot be found out, and say something went wrong", async () => {
    const was = await current(BEES), before = stored();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    env.script = ["ok", "lose-reply", "down"];   // the admin check, the upload's transaction, then the database cannot be asked
    expect(await upload(user.admin, BEES, LOGO.berbero)).toMatchObject({ err: "Something went wrong." });
    expect(env.script).toEqual([]);
    const row = await current(BEES);
    expect(row.id).not.toBe(was.id); expect(row.sha256).toBe(sha(LOGO.berbero));          // it did commit
    expect(stored()).toEqual([...before, row.object_key].sort());                          // and its file was kept
    expect(readFileSync(join(env.dir, row.object_key)).equals(LOGO.berbero)).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`company logo upload for ${BEES}: the outcome is unknown, so its new file was kept`)));
    log.mockRestore();
    expect((await upload(user.admin, BEES, LOGO.bees)).err).toBeNull();   // back to BEES's own logo
  });
  it("remove a logo, keeping its history and file", async () => {
    expect((await upload(user.admin, DAILYMART, LOGO.bees)).err).toBeNull();
    const row = await current(DAILYMART);
    expect(await call(user.admin, actions.removeCompanyLogo, { company: DAILYMART })).toEqual({ msg: "Logo removed. Vouchers for this company now show its code.", err: null });
    expect(await current(DAILYMART)).toBeUndefined();
    expect(existsSync(join(env.dir, row.object_key))).toBe(true);
    expect(await call(user.admin, actions.removeCompanyLogo, { company: DAILYMART })).toMatchObject({ err: "this company has no logo to remove" });
  });
});

describe("who can see which logo", () => {
  it("row-level security shows a company's logo only to people who can see that company", async () => {
    expect((await upload(user.admin, BEES, LOGO.bees)).err).toBeNull();
    expect((await upload(user.admin, BERBERO, LOGO.berbero)).err).toBeNull();
    expect((await upload(user.admin, DAILYMART, makePng(64, 64))).err).toBeNull();
    const seen = async (who: string) => (await as(who, (c) => rows(c, "SELECT company_id FROM company_logos WHERE ended_at IS NULL"))).map((r) => r.company_id).sort();
    // Daily Mart shares nothing with the others: its people see only its logo, and nobody else sees it.
    expect(await seen(user.bereket)).toEqual([DAILYMART]);
    for (const who of [user.meron, user.dawit, user.selam, user.hana, user.nardos, user.samuel, user.abebe]) expect(await seen(who), who).not.toContain(DAILYMART);
    expect(await seen(user.meron)).toContain(ASKU);
    expect(await seen(user.selam)).toEqual(expect.arrayContaining([ASKU, BEES]));
    expect(await seen(user.admin)).toEqual([ASKU, BERBERO, BEES, DAILYMART].sort());
    expect(await seen(null as unknown as string)).toEqual([]);   // nobody signed in
    // Exactly the companies the person can read (companies_read, which includes companies sharing a bank account with theirs).
    for (const who of [user.meron, user.bereket, user.selam, user.hana, user.nardos, user.samuel]) {
      const companies = (await as(who, (c) => rows(c, "SELECT id FROM companies"))).map((r) => r.id).sort();
      expect(await seen(who), who).toEqual(companies);
    }
  });
  it("the logo route serves it inline from private storage, with safe headers and the hash for caching", async () => {
    const row = await current(ASKU);
    const res = await getLogo(user.meron, ASKU, row.sha256.slice(0, 16));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(LOGO.asku)).toBe(true);
    expect(Object.fromEntries(res.headers)).toMatchObject({ "content-type": "image/png", "x-content-type-options": "nosniff", "content-disposition": 'inline; filename="company-logo.png"',
      "content-security-policy": "default-src 'none'; sandbox", "cache-control": "private, max-age=86400, immutable", etag: `"${row.sha256}"` });
    expect((await getLogo(user.meron, ASKU)).headers.get("cache-control")).toBe("private, no-cache");                 // no hash: always checked again
    expect((await getLogo(user.meron, ASKU, "0".repeat(16))).headers.get("cache-control")).toBe("private, no-cache");   // an old hash
  });
  it("the logo route reads as not found for another company's logo, a company without one, or a bad id", async () => {
    for (const c of [ASKU, BEES, BERBERO]) expect((await getLogo(user.bereket, c)).status, c).toBe(404);
    for (const who of [user.meron, user.nardos, user.selam, user.samuel]) expect((await getLogo(who, DAILYMART)).status, who).toBe(404);
    expect((await getLogo(user.bereket, DAILYMART)).status).toBe(200);
    expect(await call(user.admin, actions.removeCompanyLogo, { company: DAILYMART })).toMatchObject({ err: null });
    expect((await getLogo(user.bereket, DAILYMART)).status).toBe(404);   // no logo any more
    expect((await getLogo(user.admin, DAILYMART)).status).toBe(404);
    expect((await getLogo(user.meron, "not-a-uuid")).status).toBe(404);
    expect((await getLogo(user.meron, "../../etc")).status).toBe(404);
    expect((await getLogo(user.selam, ASKU)).status).toBe(200);   // group reporting sees the company, so its logo
    expect((await getLogo(user.admin, BERBERO)).status).toBe(200);
  });
  it("the logo route sends someone who is not signed in to sign in", async () => {
    env.actingAs = "";
    await expect(logoRoute.GET(new Request(`http://x/companies/${ASKU}/logo`), { params: Promise.resolve({ id: ASKU }) })).rejects.toThrow(/redirect \/login/);
  });
});

describe("the logo on payment vouchers", () => {
  let berberoReq: string, askuReq: string, beesReq: string;
  const pdfImages = (pdf: Buffer) => [...pdf.toString("latin1").matchAll(/\/Subtype \/Image[\s\S]*?\/Width (\d+)[\s\S]*?\/Height (\d+)|\/Width (\d+)[\s\S]{0,200}?\/Height (\d+)[\s\S]{0,200}?\/Subtype \/Image/g)]
    .map((m) => `${m[1] ?? m[3]}x${m[2] ?? m[4]}`);
  const abig = pngSize(ABIG);
  beforeAll(async () => {
    await owner.query("BEGIN");
    // Berbero pays from the CBE account, which BEES owns and shares with it. ASKU pays from its own account.
    berberoReq = (await authorized(owner, { company: BERBERO, amounts: [500, 500] })).id;
    askuReq = (await authorized(owner, { amounts: [700] })).id;
    await owner.query("COMMIT");
    // A company with no logo: remove BEES's later in its own test. DAILYMART has none (removed above).
  }, 60_000);

  it("uses the paying company's logo, not the bank account owner's", async () => {
    const acc = (await rows(owner, "SELECT r.debtor_company_id, g.company_id AS account_owner FROM payment_requests r JOIN company_bank_account_access g ON g.account_id = r.debit_account_id AND g.is_owner WHERE r.id = $1", [berberoReq]))[0];
    expect(acc).toEqual({ debtor_company_id: BERBERO, account_owner: BEES });   // the scenario: a shared account owned by another company
    const v = (await as(user.hana, (c) => loadVoucher(tx(c), berberoReq)))!;
    expect(v).toMatchObject({ companyId: BERBERO, companyCode: "BERBERO", company: "Berbero Petrochemical PLC", logo: { mime: "image/png", sha256: sha(LOGO.berbero) } });
    // The PDF embeds Berbero's 120x90 logo: not BEES's 100x80, not ABIG's.
    const pdf = await voucherPdf(v, { compress: false, logo: readFileSync(join(env.dir, v.logo!.objectKey)) });
    expect(pdfImages(pdf)).toEqual(["120x90"]);
    // The export route does the same from private storage.
    env.actingAs = user.hana;
    const viaRoute = Buffer.from(await (await voucherRoute.GET(new Request(`http://x/requests/${berberoReq}/voucher/pdf`), { params: Promise.resolve({ id: berberoReq, format: "pdf" }) })).arrayBuffer());
    expect(viaRoute.subarray(0, 5).toString()).toBe("%PDF-");
    expect(viaRoute.includes(Buffer.from("/Width 120"))).toBe(true);
    expect(viaRoute.includes(Buffer.from("/Width 100"))).toBe(false);
  });
  it("embeds the logo in the workbook from private storage, and nothing when there is none", async () => {
    env.actingAs = user.hana;
    const res = await voucherRoute.GET(new Request(`http://x/requests/${berberoReq}/voucher/xlsx`), { params: Promise.resolve({ id: berberoReq, format: "xlsx" }) });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
    const imgs = wb.worksheets[0].getImages();
    expect(imgs).toHaveLength(1);
    const media = wb.getImage(Number(imgs[0].imageId));
    expect(Buffer.from(media.buffer as ArrayBuffer).equals(LOGO.berbero)).toBe(true);
    const v = (await as(user.hana, (c) => loadVoucher(tx(c), berberoReq)))!;
    const plain = new ExcelJS.Workbook(); await plain.xlsx.load(await voucherXlsx({ ...v, logo: null }));
    expect(plain.worksheets[0].getImages()).toHaveLength(0);
  });
  it("shows the logo on the print page through the authorized route, and both tables keep their rows", async () => {
    env.actingAs = user.hana;
    const html = renderToStaticMarkup(await PrintVoucher({ params: Promise.resolve({ id: berberoReq }) }));
    const row = await current(BERBERO);
    expect(html).toContain(`src="/companies/${BERBERO}/logo?v=${row.sha256.slice(0, 16)}"`);
    expect(html).not.toContain("abig-logo");
    expect(html).not.toContain(row.object_key);   // the storage key never reaches the browser
    const tables = [...html.matchAll(/<table class="([^"]*)"/g)].map((m) => m[1]);
    expect(tables).toHaveLength(2);
    for (const t of tables) expect(t.split(" ")).toContain("no-stack");
    expect(html).toContain("voucher-signatures");
  });
  it("falls back to the company code, never the ABIG logo, when the company has no logo", async () => {
    expect(await call(user.admin, actions.removeCompanyLogo, { company: ASKU })).toMatchObject({ err: null });
    const v = (await as(user.meron, (c) => loadVoucher(tx(c), askuReq)))!;
    expect(v.logo).toBeNull();
    // PDF: no image at all, the code drawn in the logo box.
    const pdf = await voucherPdf(v, { compress: false });
    expect(pdfImages(pdf)).toEqual([]);
    expect(pdf.includes(Buffer.from(`/Width ${abig.width}`))).toBe(false);
    expect(pdf.includes(ABIG.subarray(ABIG.indexOf("IDAT") + 4, ABIG.indexOf("IDAT") + 64))).toBe(false);
    expect(pdf.toString("latin1")).toContain(`<${Buffer.from("ASKU").toString("hex")}>`);
    // Through the route too (the stored files are still there, but the current logo is gone).
    env.actingAs = user.meron;
    const viaRoute = Buffer.from(await (await voucherRoute.GET(new Request(`http://x/requests/${askuReq}/voucher/pdf`), { params: Promise.resolve({ id: askuReq, format: "pdf" }) })).arrayBuffer());
    expect(viaRoute.includes(Buffer.from("/Subtype /Image"))).toBe(false);
    const xlsx = await voucherRoute.GET(new Request(`http://x/requests/${askuReq}/voucher/xlsx`), { params: Promise.resolve({ id: askuReq, format: "xlsx" }) });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
    expect(wb.worksheets[0].getImages()).toHaveLength(0);
    // Print page: the code box, no image.
    const html = renderToStaticMarkup(await PrintVoucher({ params: Promise.resolve({ id: askuReq }) }));
    expect(html).toMatch(/data-fallback="company-code"[^>]*>ASKU<\/span>/);
    expect(html).not.toMatch(/<img/);
    expect(html).not.toContain("abig-logo");
  });
  it("keeps group reporting's restrictions and another company's request hidden", async () => {
    expect((await upload(user.admin, ASKU, LOGO.asku)).err).toBeNull();
    const v = (await as(user.selam, (c) => loadVoucher(tx(c), askuReq)))!;
    expect(v).toMatchObject({ restricted: true, payee: null, destination: null, companyId: ASKU, logo: { sha256: sha(LOGO.asku) } });
    expect(v.signatories.every((s) => s.name === null)).toBe(true);
    expect(await as(user.bereket, (c) => loadVoucher(tx(c), berberoReq))).toBeNull();
    expect(await as(user.meron, (c) => loadVoucher(tx(c), berberoReq))).toBeNull();
    beesReq = berberoReq;
    // BEES owns the shared account; its people still do not get Berbero's voucher with BEES's logo.
    const bees = await as(user.abebe, (c) => loadVoucher(tx(c), beesReq));
    if (bees) expect(bees).toMatchObject({ companyId: BERBERO, logo: { sha256: sha(LOGO.berbero) } });
  });
});
