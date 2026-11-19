import { existsSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { moneyText, type Voucher } from "./voucher";
import { percentLabel } from "./tax";

// The printable payment voucher as a PDF (A4). Built from the stored values only (see loadVoucher). Uses the PDF standard fonts, which cover
// Latin text; names written in Ethiopic script would need an embedded Ethiopic font.

const GREEN = "#2f7a33", INK = "#1f2a22", MUTED = "#5b675e", LINE = "#d5dcd6";
/** The standard PDF fonts use WinAnsi: keep to characters it has. */
const pdfText = (s: string) => s.replace(/−/g, "-").replace(/[^\x20-\x7e -ÿ•–—‘’“”]/g, "?");

export async function voucherPdf(v: Voucher, { compress = true }: { compress?: boolean } = {}): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, compress, info: { Title: `Payment voucher ${v.requestNo}`, Author: v.company, Subject: "Payment voucher" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((ok, fail) => { doc.on("end", () => ok(Buffer.concat(chunks))); doc.on("error", fail); });
  const L = 48, R = doc.page.width - 48, W = R - L;
  const t = (s: string) => pdfText(s);

  // Header: logo, company and TIN on the left; title, number, date and status on the right.
  const logo = join(process.cwd(), "public", "abig-logo.png");
  let y = 48;
  if (existsSync(logo)) { try { doc.image(logo, L, y, { fit: [56, 56] }); } catch { /* a missing or unreadable logo leaves the space empty */ } }
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(14).text(t(v.company), L + 66, y + 4, { width: W / 2 - 40 });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(t(`TIN: ${v.companyTin ?? "Not recorded"}`), L + 66, doc.y + 2, { width: W / 2 - 40 });
  doc.font("Helvetica-Bold").fontSize(18).fillColor(GREEN).text("PAYMENT VOUCHER", L, y, { width: W, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor(INK)
    .text(t(`No. ${v.requestNo}`), L, y + 26, { width: W, align: "right" })
    .text(t(`Date: ${v.createdOn}`), { width: W, align: "right" })
    .text(t(`Status: ${v.status}`), { width: W, align: "right" });
  y = Math.max(doc.y, y + 64) + 10;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(1.5).strokeColor(GREEN).stroke();
  y += 14;

  // Facts in two columns.
  const facts: [string, string][] = [
    ["Pay to", v.payee ?? "Not shown"], ["Payee TIN", v.payeeTin ?? (v.restricted ? "Not shown" : "Not recorded")],
    ["Payment method", v.method], ["Destination", v.destination ?? (v.restricted ? "Not shown" : "Not needed for this method")],
    ["Invoice", v.invoice ?? (v.restricted ? "Not shown" : "None")], ["Reason", v.description ?? (v.restricted ? "Not shown" : "None")],
  ];
  const colW = (W - 16) / 2;
  for (let i = 0; i < facts.length; i += 2) {
    const rowTop = y; let bottom = y;
    for (const [k, [label, value]] of [facts[i], facts[i + 1]].filter(Boolean).entries()) {
      const x = L + k * (colW + 16);
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(t(label.toUpperCase()), x, rowTop, { width: colW });
      doc.font("Helvetica").fontSize(10).fillColor(INK).text(t(value), x, doc.y + 1, { width: colW });
      bottom = Math.max(bottom, doc.y);
    }
    y = bottom + 8;
  }

  // Amounts.
  y += 4;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(GREEN).text("Amount", L, y); y = doc.y + 4;
  const rows: [string, string, boolean][] = v.tax ? [
    ["Amount before VAT", moneyText(v.tax.amountBeforeVat), false],
    [`VAT: ${v.tax.vatName} (${percentLabel(v.tax.vatPercent)})`, moneyText(v.tax.vatAmount), false],
    ["Total amount (including VAT)", moneyText(v.tax.gross), true],
    [v.tax.withholdingApplied ? `Withholding tax (${percentLabel(v.tax.withholdingPercent)})` : "Withholding tax", v.tax.withholdingApplied ? `- ${moneyText(v.tax.withholdingAmount)}` : "Not applied", false],
    ["Net payment", moneyText(v.net), true],
  ] : [["Net payment (no tax breakdown recorded)", moneyText(v.net), true]];
  for (const [label, value, strong] of rows) {
    if (strong) doc.rect(L, y - 2, W, 18).fill("#eef5ee");
    doc.font(strong ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(INK).text(t(label), L + 6, y + 2, { width: W * 0.65 });
    doc.text(t(value), L, y + 2, { width: W - 6, align: "right" });
    y += 18; doc.moveTo(L, y - 2).lineTo(R, y - 2).lineWidth(0.5).strokeColor(LINE).stroke();
  }
  if (v.tax) { doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(t(`${v.tax.mode}. The net payment is the amount paid from the bank.`), L, y + 2, { width: W }); y = doc.y + 6; }

  // Installments.
  if (v.installments.length > 1) {
    doc.font("Helvetica-Bold").fontSize(11).fillColor(GREEN).text("Installments", L, y + 6); y = doc.y + 4;
    for (const i of v.installments) {
      doc.font("Helvetica").fontSize(9).fillColor(INK).text(t(`${i.seq}. Due ${i.due}`), L + 6, y, { width: W / 2 });
      doc.text(t(moneyText(i.amount)), L, y, { width: W - 6, align: "right" }); y += 14;
    }
  }

  // Signatures.
  y = Math.max(y + 24, doc.page.height - 48 - 110);
  const boxW = (W - 24) / 3;
  v.signatories.forEach((s, k) => {
    const x = L + k * (boxW + 12);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(t(s.role), x, y, { width: boxW });
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(t(s.name ?? (v.restricted ? "Not shown" : "")), x, y + 14, { width: boxW });
    doc.fontSize(8).fillColor(MUTED).text(t(s.when ?? ""), x, y + 27, { width: boxW });
    doc.moveTo(x, y + 70).lineTo(x + boxW, y + 70).lineWidth(0.75).strokeColor(INK).stroke();
    doc.fontSize(8).fillColor(MUTED).text("Signature", x, y + 74, { width: boxW });
  });
  doc.end();
  return done;
}
