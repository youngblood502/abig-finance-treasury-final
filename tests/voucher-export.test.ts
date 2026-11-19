import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import ExcelJS from "exceljs";
import type { Tx } from "../src/lib/db";
import { loadVoucher } from "../src/lib/voucher";
import { voucherPdf } from "../src/lib/voucher-pdf";
import { voucherXlsx } from "../src/lib/voucher-xlsx";
import { actAs, ASKU, AWASH, BD_HAWASSA, fn, key, rows, setupDb, S_HAWASSA, user } from "./helpers";

// The payment voucher (print, PDF, Excel) and the request form's server actions, as the application runs them: the real route handler and
// actions, the real session lookup (the development "acting as" cookie) and the database as abig_app. Only Next.js's request helpers are replaced.
const DB = "abig_test_voucher_export";
const env = vi.hoisted(() => ({ appUrl: "", actingAs: "" }));
class Redirected extends Error { constructor(public url: string) { super("redirect " + url); } }
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n === "abig_dev_user" && env.actingAs ? { value: env.actingAs } : undefined), set: () => {}, delete: () => {} }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Redirected(url); }, notFound: () => { throw new Redirected("/404"); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/db")>();
  const { Client: PgClient } = await import("pg");
  return { ...real, withUser: async <T,>(userId: string, run: (tx: Tx) => Promise<T>): Promise<T> => {
    const c = new PgClient({ connectionString: env.appUrl }); await c.connect();
    try { await c.query("BEGIN"); await c.query("SELECT set_config('app.user_id', $1, true)", [userId]); const out = await run({ q: async (sql, params) => (await c.query(sql, params as unknown[])).rows }); await c.query("COMMIT"); return out; }
    catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { await c.end(); }
  } };
});
const route = await import("../src/app/requests/[id]/voucher/[format]/route");
const actions = await import("../src/app/actions");

let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"]; let id: string; let requestNo: string; let last4: string;
const tx = (c: Client): Tx => ({ q: async (sql, p) => (await c.query(sql, p as unknown[])).rows });
const std = async () => (await rows(owner, "SELECT id FROM tax_vat_rates WHERE name = 'Standard VAT'"))[0].id as string;

/** The text of an uncompressed pdfkit PDF: its standard-font strings are hex in TJ arrays, one line per text operation. */
function pdfText(pdf: Buffer): string {
  const s = pdf.toString("latin1"), out: string[] = [];
  for (const m of s.matchAll(/\[((?:<[0-9a-fA-F]*>|[\s\d.-])*)\]\s*TJ/g)) out.push([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], "hex").toString("latin1").replace(/\x95/g, "•")).join(""));   // WinAnsi 0x95 is the bullet
  return out.join("\n");
}
/** An Excel sheet as label -> row values. */
async function sheet(buf: Buffer) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const ws = wb.worksheets[0]; const m = new Map<string, ExcelJS.Row>();
  ws.eachRow((r) => { const k = r.getCell(1).value; if (typeof k === "string" && !m.has(k)) m.set(k, r); });
  return { ws, row: (label: string) => m.get(label)! };
}
async function call(who: string, action: (f: FormData) => Promise<unknown>, fields: Record<string, string | string[]>) {
  env.actingAs = who; const f = new FormData(); for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
  try { await action(f); } catch (e) { if (e instanceof Redirected) { const u = new URL(e.url, "http://x"); return { path: u.pathname, msg: u.searchParams.get("msg"), err: u.searchParams.get("err") }; } throw e; }
  throw new Error("the action did not redirect");
}
const get = async (who: string, rid: string, format: string) => { env.actingAs = who; return route.GET(new Request(`http://x/requests/${rid}/voucher/${format}`), { params: Promise.resolve({ id: rid, format }) }); };

beforeAll(async () => {
  const d = await setupDb(DB); owner = d.owner; as = d.as; env.appUrl = d.appUrl;
  last4 = (await rows(owner, "SELECT account_last4 FROM supplier_bank_details WHERE id = $1", [BD_HAWASSA]))[0].account_last4;
  // An authenticated request: 100,000 before VAT, 15% VAT, 3% withholding, verified by Dawit and authorized by Kebede.
  await owner.query("BEGIN");
  await actAs(owner, user.admin); await owner.query("SELECT admin_withholding_update(3, 10000)");
  await actAs(owner, user.meron);
  id = (await rows(owner, `INSERT INTO payment_requests (debtor_company_id, supplier_id, supplier_bank_detail_id, debit_account_id, created_by, invoice_ref, invoice_date, description, total_amount, amount_input_mode, entered_amount, vat_rate_id, withholding_applied)
    VALUES ($1,$2,$3,$4,$5,'INV-VOUCHER-1','2026-11-01','Cement for the warehouse',1,'BEFORE_VAT',100000,$6,true) RETURNING id`, [ASKU, S_HAWASSA, BD_HAWASSA, AWASH, user.meron, await std()]))[0].id;
  await owner.query("INSERT INTO payment_installments (request_id, seq, due_date, amount) VALUES ($1,1,'2026-12-31',112000)", [id]);
  await owner.query(`INSERT INTO attachments (request_id, kind, object_key, filename, mime_type, size_bytes, sha256, uploaded_by) VALUES ($1,'INVOICE',$2,'inv.pdf','application/pdf',1000,$3,$4)`, [id, key(), key(), user.meron]);
  const v1 = await fn(owner, "wf_submit", id);
  await actAs(owner, user.dawit); const v2 = await fn(owner, "wf_verify", id, v1);
  await actAs(owner, user.kebede); await fn(owner, "wf_authorize", id, v2);
  await owner.query("COMMIT");
  requestNo = (await rows(owner, "SELECT request_no FROM payment_requests WHERE id = $1", [id]))[0].request_no;
}, 120_000);
afterAll(async () => { await owner?.end(); });

describe("the voucher's values", () => {
  it("are the stored figures, names and masked destination, for a member of the company", async () => {
    const v = (await as(user.meron, (c) => loadVoucher(tx(c), id)))!;
    expect(v).toMatchObject({ requestNo, company: "ASKU PLC", companyTin: "0011223344", status: "Authenticated, not yet paid", restricted: false, method: "Transfer", invoice: "INV-VOUCHER-1, 2026-11-01", description: "Cement for the warehouse",
      tax: { amountBeforeVat: "100000.0000", vatName: "Standard VAT", vatPercent: "15.00", vatAmount: "15000.0000", gross: "115000.0000", withholdingApplied: true, withholdingPercent: "3.00", withholdingAmount: "3000.0000" }, net: "112000.0000" });
    expect(v.destination).toMatch(new RegExp(`••••${last4}$`));
    expect(v.signatories.map((s) => [s.role, s.name])).toEqual([["Prepared by", expect.stringMatching(/Meron/)], ["Checked by", expect.stringMatching(/Dawit/i)], ["Approved by", expect.stringMatching(/Kebede/i)]]);
  });
  it("hide the payee, destination, invoice and people from group reporting, and do not exist for another company", async () => {
    const v = (await as(user.selam, (c) => loadVoucher(tx(c), id)))!;
    expect(v).toMatchObject({ restricted: true, payee: null, payeeTin: null, destination: null, invoice: null, description: null, net: "112000.0000" });
    expect(v.signatories.every((s) => s.name === null)).toBe(true);
    expect(await as(user.nardos, (c) => loadVoucher(tx(c), id))).toBeNull();
    expect(await as(user.bereket, (c) => loadVoucher(tx(c), id))).toBeNull();
  });
});

describe("the PDF", () => {
  it("is a PDF with the company, number, tax breakdown, net payment, status and signature sections", async () => {
    const v = (await as(user.meron, (c) => loadVoucher(tx(c), id)))!;
    const pdf = await voucherPdf(v, { compress: false });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const text = pdfText(pdf);
    for (const s of ["PAYMENT VOUCHER", `No. ${requestNo}`, "ASKU PLC", "TIN: 0011223344", "Status: Authenticated", "Amount before VAT", "ETB 100,000.00", "VAT: Standard VAT (15%)", "ETB 15,000.00",
      "Total amount (including VAT)", "ETB 115,000.00", "Withholding tax (3%)", "- ETB 3,000.00", "Net payment", "ETB 112,000.00", "Prepared by", "Checked by", "Approved by", "INV-VOUCHER-1", "Cement for the warehouse", `••••${last4}`])
      expect(text, s).toContain(s);
    expect(text).not.toMatch(/v1:/);
  });
  it("for group reporting shows amounts and status but no payee or names", async () => {
    const v = (await as(user.selam, (c) => loadVoucher(tx(c), id)))!;
    const text = pdfText(await voucherPdf(v, { compress: false }));
    expect(text).toContain("ETB 112,000.00"); expect(text).toContain("Not shown");
    const payee = (await rows(owner, "SELECT legal_name FROM suppliers WHERE id = $1", [S_HAWASSA]))[0].legal_name;
    expect(text).not.toContain(payee); expect(text).not.toMatch(/Meron|Dawit|Kebede|INV-VOUCHER|••••/);
  });
});

describe("the Excel workbook", () => {
  it("is a genuine .xlsx with the stored figures as numbers, number formats and headings", async () => {
    const v = (await as(user.meron, (c) => loadVoucher(tx(c), id)))!;
    const buf = await voucherXlsx(v);
    expect(buf.subarray(0, 2).toString()).toBe("PK");   // a zip container, not CSV
    const { ws, row } = await sheet(buf);
    expect(ws.getCell("A1").value).toBe("PAYMENT VOUCHER");
    expect(row("Request number").getCell(2).value).toBe(requestNo);
    expect(row("Company TIN").getCell(2).value).toBe("0011223344");
    expect(row("Amount before VAT").getCell(3).value).toBe(100000);
    expect(row("VAT: Standard VAT").getCell(2).value).toBe(15); expect(row("VAT: Standard VAT").getCell(2).numFmt).toBe('0.00"%"');
    expect(row("VAT: Standard VAT").getCell(3).value).toBe(15000);
    expect(row("Total amount (including VAT)").getCell(3).value).toBe(115000);
    expect(row("Withholding tax").getCell(2).value).toBe(3); expect(row("Withholding tax").getCell(3).value).toBe(3000);
    expect(row("Net payment").getCell(3).value).toBe(112000); expect(row("Net payment").getCell(3).numFmt).toBe("#,##0.00");
    expect(row("Total of installments (net payment)").getCell(3).value).toBe(112000);
    expect(row("Prepared by").getCell(2).value).toMatch(/Meron/); expect(row("Approved by").getCell(2).value).toMatch(/Kebede/i);
    expect(ws.getColumn(1).width).toBeGreaterThan(20);
  });
  it("records when it was exported, not 1970", async () => {
    const v = (await as(user.meron, (c) => loadVoucher(tx(c), id)))!;
    const before = Date.now() - 1000;
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await voucherXlsx(v));
    expect(wb.created.getUTCFullYear()).toBeGreaterThan(1970);
    expect(wb.created.getTime()).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(wb.created.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
  it("keeps cents exact", async () => {
    const v = (await as(user.meron, (c) => loadVoucher(tx(c), id)))!;
    const { row } = await sheet(await voucherXlsx({ ...v, tax: { ...v.tax!, amountBeforeVat: "86.9600", vatAmount: "13.0400", gross: "100.0000", withholdingAmount: "2.6100" }, net: "97.3900" }));
    expect([row("Amount before VAT").getCell(3).value, row("VAT: Standard VAT").getCell(3).value, row("Net payment").getCell(3).value]).toEqual([86.96, 13.04, 97.39]);
  });
});

describe("the export route", () => {
  it("serves the PDF and the workbook with the detail page's access, and changes nothing", async () => {
    const before = await rows(owner, "SELECT version, updated_at, workflow_state::text s, (SELECT count(*) FROM audit_events) a, (SELECT count(*) FROM approval_events WHERE request_id = $1) e, (SELECT count(*) FROM notification_outbox) n FROM payment_requests WHERE id = $1", [id]);
    const pdf = await get(user.meron, id, "pdf");
    expect(pdf.status).toBe(200); expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
    expect(pdf.headers.get("Content-Disposition")).toBe(`attachment; filename="payment-voucher-${requestNo}.pdf"`); expect(pdf.headers.get("Cache-Control")).toBe("private, no-store");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    const xlsx = await get(user.dawit, id, "xlsx");
    expect(xlsx.status).toBe(200); expect(xlsx.headers.get("Content-Type")).toMatch(/spreadsheetml/);
    expect((await get(user.selam, id, "pdf")).status).toBe(200);   // group reporting reads it, masked as on the page
    expect(await rows(owner, "SELECT version, updated_at, workflow_state::text s, (SELECT count(*) FROM audit_events) a, (SELECT count(*) FROM approval_events WHERE request_id = $1) e, (SELECT count(*) FROM notification_outbox) n FROM payment_requests WHERE id = $1", [id])).toEqual(before);
  }, 60_000);
  it("reads as not found for another company, an unknown request, a malformed id or an unknown format", async () => {
    expect((await get(user.nardos, id, "pdf")).status).toBe(404);
    expect((await get(user.bereket, id, "xlsx")).status).toBe(404);
    expect((await get(user.meron, "a0000000-0000-4000-8000-00000000ffff", "pdf")).status).toBe(404);
    expect((await get(user.meron, "not-a-uuid", "pdf")).status).toBe(404);
    expect((await get(user.meron, id, "csv")).status).toBe(404);
  }, 60_000);
});

describe("the request form's server actions", () => {
  const form = (o: Record<string, string | string[]> = {}) => ({ target: `${ASKU}|SUPPLIER|${S_HAWASSA}`, payment_method: "TRANSFER", account: AWASH, invoice_ref: "INV-" + key().slice(0, 6), priority: "NORMAL", amount_input_mode: "TOTAL", entered_amount: "11500", vat_rate_id: "", due: "2026-12-31", amt: "", ...o });
  it("save a draft from the amount entered: the database calculates the figures, and one installment takes the net", async () => {
    const r = await call(user.meron, actions.createRequest, form({ vat_rate_id: await std(), entered_amount: "11,500.00" }));
    expect(r).toMatchObject({ msg: "Draft saved.", err: null });
    const rid = r.path.split("/").pop()!;
    expect((await rows(owner, "SELECT amount_input_mode m, amount_before_vat::text b, vat_amount::text v, gross_amount::text g, total_amount::text n, (SELECT amount::text FROM payment_installments WHERE request_id = r.id) i FROM payment_requests r WHERE id = $1", [rid]))[0])
      .toEqual({ m: "TOTAL", b: "10000.0000", v: "1500.0000", g: "11500.0000", n: "11500.0000", i: "11500.0000" });
  }, 60_000);
  it("refuse withholding below the threshold with the database's reason, and a missing or invalid amount", async () => {
    expect(await call(user.meron, actions.createRequest, form({ vat_rate_id: await std(), entered_amount: "11000", withholding_applied: "on" }))).toMatchObject({ err: expect.stringMatching(/at least ETB 10,000.00; this amount before VAT is ETB 9,565.22/i) });
    expect(await call(user.meron, actions.createRequest, form({ vat_rate_id: await std(), entered_amount: "" }))).toMatchObject({ err: "Enter the amount." });
    expect(await call(user.meron, actions.createRequest, form({ vat_rate_id: await std(), entered_amount: "10.555" }))).toMatchObject({ err: expect.stringMatching(/two decimal places/) });
    expect(await call(user.meron, actions.createRequest, form({ vat_rate_id: "" }))).toMatchObject({ err: "Choose a VAT rate." });
    expect(await call(user.dawit, actions.createRequest, form({ vat_rate_id: await std() }))).toMatchObject({ err: "You do not have permission to do that." });
  }, 60_000);
  it("let a reviewer adjust the amount; the history records every recalculated figure", async () => {
    const r = await call(user.meron, actions.createAndSubmitRequest, form({ vat_rate_id: await std(), amount_input_mode: "BEFORE_VAT", entered_amount: "20000", withholding_applied: "on" }));
    expect(r.err).toBeNull();
    const rid = r.path.split("/").pop()!;
    const q = (await rows(owner, "SELECT version, entered_amount::text e, vat_rate_id, total_amount::text n FROM payment_requests WHERE id = $1", [rid]))[0];
    expect(q.n).toBe("22400.0000");   // 20,000 + 3,000 VAT - 600 withholding
    const inst = (await rows(owner, "SELECT seq, due_date::text d, amount::text a FROM payment_installments WHERE request_id = $1", [rid]))[0];
    const adjusted = await call(user.dawit, actions.adjustRequest, { id: rid, version: String(q.version), reason: "Quantity corrected", priority: "NORMAL", orig_priority: "NORMAL", invoice_ref: "", orig_invoice_ref: "", description: "", orig_description: "",
      taxed: "1", entered_amount: "30000", orig_entered_amount: q.e, vat_rate_id: q.vat_rate_id, orig_vat_rate_id: q.vat_rate_id, withholding_applied: "on", orig_withholding_applied: "true",
      seq: String(inst.seq), i_amount: inst.a, o_amount: inst.a, i_due: inst.d, o_due: inst.d });
    expect(adjusted.err).toBeNull();
    expect((await rows(owner, "SELECT total_amount::text n FROM payment_requests WHERE id = $1", [rid]))[0].n).toBe("33600.0000");
    expect((await rows(owner, "SELECT field FROM adjustment_history WHERE request_id = $1 ORDER BY field", [rid])).map((x) => x.field)).toEqual(["amount", "amount_before_vat", "entered_amount_before_vat", "gross_amount", "total_amount", "vat_amount", "withholding_amount"]);
  }, 60_000);
});
