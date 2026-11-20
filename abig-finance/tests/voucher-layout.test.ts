import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { Voucher } from "../src/lib/voucher";
import { voucherPdf } from "../src/lib/voucher-pdf";
import { voucherXlsx } from "../src/lib/voucher-xlsx";

// The voucher's page layout in the PDF and the workbook, from a voucher built in the test (no database): pagination of long installment
// lists, a long company name in the header, and the workbook's print setup. Amounts and access are covered in voucher-export.test.ts.

const PAGE_H = 841.89;   // A4 in points
const voucher = (o: Partial<Voucher> = {}): Voucher => ({
  requestNo: "PR-2026-0001", createdOn: "2026-11-19", company: "ASKU PLC", companyTin: "0011223344", status: "Authenticated, not yet paid", restricted: false,
  companyId: "c0000000-0000-4000-8000-000000000001", companyCode: "ASKU", logo: null,
  payee: "Hawassa Packaging PLC", payeeTin: "0012345678", method: "Transfer", destination: "CBE ••••2210", description: "Cement for the warehouse", invoice: "INV-1, 2026-11-01",
  tax: { mode: "Amount entered before VAT", amountBeforeVat: "100000.0000", vatName: "Standard VAT", vatPercent: "15.00", vatAmount: "15000.0000", gross: "115000.0000", withholdingApplied: true, withholdingPercent: "3.00", withholdingAmount: "3000.0000" },
  net: "112000.0000", installments: [{ seq: 1, due: "2026-12-31", amount: "112000.0000" }],
  signatories: [{ role: "Prepared by", name: "Meron", when: "2026-11-19 09:00" }, { role: "Checked by", name: "Dawit", when: "2026-11-19 10:00" }, { role: "Approved by", name: "Kebede", when: "2026-11-19 11:00" }],
  ...o,
});
const sixty = Array.from({ length: 60 }, (_, i) => ({ seq: i + 1, due: `2027-${String((i % 12) + 1).padStart(2, "0")}-15`, amount: (i === 59 ? "1866.8100" : "1866.6100") }));

interface Frag { text: string; x: number; base: number }
/** Each page of an uncompressed pdfkit PDF: its text fragments (top-down baseline) and its horizontal lines (top-down y). */
function pages(pdf: Buffer) {
  const s = pdf.toString("latin1");
  return s.split("endstream").filter((c) => c.includes(" Tm")).map((st) => {
    const frags: Frag[] = []; const lines: { x1: number; x2: number; y: number }[] = [];
    let tm = { x: 0, y: 0 }, move: { x: number; y: number } | null = null;
    for (const line of st.split("\n")) {
      let m;
      if ((m = line.match(/^1 0 0 1 ([\d.-]+) ([\d.-]+) Tm$/))) tm = { x: +m[1], y: +m[2] };
      else if ((m = line.match(/^\[((?:<[0-9a-fA-F]*>|[\s\d.-])*)\]\s*TJ$/))) frags.push({ text: [...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], "hex").toString("latin1")).join(""), x: tm.x, base: PAGE_H - tm.y });
      else if ((m = line.match(/^([\d.-]+) ([\d.-]+) m$/))) move = { x: +m[1], y: +m[2] };
      else if ((m = line.match(/^([\d.-]+) ([\d.-]+) l$/)) && move && Math.abs(+m[2] - move.y) < 0.01) lines.push({ x1: move.x, x2: +m[1], y: move.y });
    }
    return { frags, lines, texts: frags.map((f) => f.text) };
  });
}
const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\n/g) ?? []).length;

describe("the PDF's pagination", () => {
  it("runs 60 installments over two full pages, each installment and signature exactly once, with the heading repeated", async () => {
    const pdf = await voucherPdf(voucher({ installments: sixty }), { compress: false });
    const ps = pages(pdf);
    expect(pageCount(pdf)).toBe(2); expect(ps).toHaveLength(2);
    const all = ps.flatMap((p) => p.texts);
    for (let i = 1; i <= 60; i++) expect(all.filter((t) => t.startsWith(`${i}. Due `)), `installment ${i}`).toHaveLength(1);
    for (const role of ["Prepared by", "Checked by", "Approved by"]) expect(all.filter((t) => t === role), role).toHaveLength(1);
    expect(all.filter((t) => t === "Signature")).toHaveLength(3);
    expect(ps[0].texts).toContain("Installments"); expect(ps[1].texts[0]).toBe("Installments (continued)");
    // No near-empty page: each page holds a good share of the installments, and the signatures follow the last rows on the same page.
    for (const p of ps) expect(p.texts.filter((t) => / Due /.test(t)).length).toBeGreaterThan(15);
    expect(ps[1].texts.indexOf("60. Due 2027-12-15")).toBeLessThan(ps[1].texts.indexOf("Prepared by"));
    expect(ps.map((p) => p.texts.at(-1))).toEqual(["Payment voucher No. PR-2026-0001  |  Page 1 of 2", "Payment voucher No. PR-2026-0001  |  Page 2 of 2"]);
  });
  it("keeps every text and line inside the page margins, rows in order down the page", async () => {
    for (const p of pages(await voucherPdf(voucher({ installments: sixty }), { compress: false }))) {
      const body = p.frags.filter((f) => !f.text.startsWith("Payment voucher No."));
      for (const f of body) { expect(f.base, f.text).toBeGreaterThan(48); expect(f.base, f.text).toBeLessThan(PAGE_H - 48); }
      for (const l of p.lines) { expect(l.y).toBeGreaterThanOrEqual(48); expect(l.y).toBeLessThanOrEqual(PAGE_H - 48); }
      const dues = body.filter((f) => / Due /.test(f.text)).map((f) => f.base);
      expect(dues).toEqual([...dues].sort((a, b) => a - b));
    }
  });
  it("keeps a short voucher on one page, signatures included", async () => {
    const pdf = await voucherPdf(voucher(), { compress: false });
    expect(pageCount(pdf)).toBe(1);
    expect(pages(pdf)[0].texts).toEqual(expect.arrayContaining(["Prepared by", "Checked by", "Approved by", "Payment voucher No. PR-2026-0001  |  Page 1 of 1"]));
  });
  it("never leaves the signatures alone on a page, whatever the number of installments", async () => {
    for (let n = 2; n <= 80; n++) {
      const ps = pages(await voucherPdf(voucher({ installments: sixty.concat(sixty).slice(0, n).map((x, i) => ({ ...x, seq: i + 1 })) }), { compress: false }));
      const last = ps.at(-1)!;
      expect(last.texts.filter((t) => / Due /.test(t)).length, `${n} installments`).toBeGreaterThanOrEqual(ps.length > 1 ? 2 : 0);
      expect(ps.flatMap((p) => p.texts).filter((t) => t === "Approved by"), `${n} installments`).toHaveLength(1);
    }
  }, 60_000);
});

describe("the PDF's header", () => {
  it("fits a long, wrapping company name above the TIN, and the TIN above the divider", async () => {
    const name = "The Very Long Company Name Industrial and Manufacturing Share Company of Ethiopia PLC";
    const [p] = pages(await voucherPdf(voucher({ company: name }), { compress: false }));
    const tinI = p.texts.indexOf("TIN: 0011223344");
    const nameLines = p.frags.slice(0, tinI).filter((f) => f.x > 100 && f.text !== "ASKU");
    expect(nameLines.length).toBeGreaterThanOrEqual(3);   // it wraps
    expect(nameLines.map((f) => f.text.trim()).join(" ")).toBe(name);
    const tin = p.frags[tinI];
    const divider = p.lines.find((l) => l.x1 === 48 && l.x2 > 500)!;
    expect(Math.max(...nameLines.map((f) => f.base)) + 4).toBeLessThan(tin.base - 6);   // name ends above the TIN's top
    expect(tin.base + 3).toBeLessThan(divider.y);                                       // the TIN ends above the divider
    // The title column never runs into the name column.
    const title = p.frags.find((f) => f.text === "PAYMENT VOUCHER")!;
    expect(title.x).toBeGreaterThan(330);
    for (const f of nameLines) expect(f.x).toBeLessThan(330);
    // The first fact sits below the divider.
    expect(p.frags.find((f) => f.text === "PAY TO")!.base).toBeGreaterThan(divider.y);
  });
});

describe("the workbook's print setup", () => {
  it("is A4, fitted to the page width, as many pages tall as it needs, with margins and repeated titles", async () => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await voucherXlsx(voucher({ installments: sixty })));
    const ps = wb.worksheets[0].pageSetup;
    expect(ps.paperSize).toBe(9); expect(ps.orientation).toBe("portrait");
    expect(ps.fitToPage).toBe(true); expect(ps.fitToWidth).toBe(1); expect(ps.fitToHeight).toBe(0);
    expect(ps.margins).toMatchObject({ left: 0.67, right: 0.67, top: 0.67, bottom: 0.67 });
    expect(ps.printTitlesRow).toBe("1:2");
    let n = 0; wb.worksheets[0].eachRow((r) => { if (/^Installment \d+$/.test(String(r.getCell(1).value))) n++; });
    expect(n).toBe(60);
  });
});
