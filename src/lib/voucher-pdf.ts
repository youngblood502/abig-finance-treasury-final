import PDFDocument from "pdfkit";
import { moneyText, type Voucher } from "./voucher";
import { percentLabel } from "./tax";

// The printable payment voucher as a PDF (A4). Built from the stored values only (see loadVoucher). Uses the PDF standard fonts, which cover
// Latin text; names written in Ethiopic script would need an embedded Ethiopic font.
//
// Layout is placed by hand, so every block first asks for the room it needs (`room`): when it does not fit, a new page starts and the
// position resets to the top margin. pdfkit never breaks a page on its own here, which would leave the hand-placed lines and shading behind.

const GREEN = "#2f7a33", INK = "#1f2a22", MUTED = "#5b675e", LINE = "#d5dcd6", SOFT = "#eef5ee";
const M = 48, LOGO = 56, ROW = 18, INST_ROW = 14, SIGN_H = 96;
/** The standard PDF fonts use WinAnsi: keep to characters it has. */
const pdfText = (s: string) => s.replace(/−/g, "-").replace(/[^\x20-\x7e -ÿ•–—‘’“”]/g, "?");

export interface PdfOptions {
  compress?: boolean;
  /** The paying company's own logo (PNG or JPEG bytes from private storage). Without it, the company code is shown in a box. */
  logo?: Buffer | null;
}

export async function voucherPdf(v: Voucher, { compress = true, logo = null }: PdfOptions = {}): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: M, compress, bufferPages: true, info: { Title: `Payment voucher ${v.requestNo}`, Author: v.company, Subject: "Payment voucher" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((ok, fail) => { doc.on("end", () => ok(Buffer.concat(chunks))); doc.on("error", fail); });
  const L = M, R = doc.page.width - M, W = R - L, TOP = M, BOTTOM = doc.page.height - M;
  const t = (s: string) => pdfText(s);
  let y = TOP;
  /** Makes sure `h` points fit below the current position; otherwise starts a new page (and runs `again`, e.g. to repeat a heading). */
  const room = (h: number, again?: () => void) => { if (y + h > BOTTOM) { doc.addPage(); y = TOP; again?.(); } };

  // ---- Header: the logo (or the company code) with the company and its TIN on the left; title, number, date and status on the right.
  const rightW = 200, leftX = L + LOGO + 10, leftW = W - rightW - 16 - LOGO - 10;
  const top = y;
  if (!drawLogo(doc, logo, L, top)) drawCode(doc, v.companyCode, L, top);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(14).text(t(v.company), leftX, top + 2, { width: leftW });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(t(`TIN: ${v.companyTin ?? "Not recorded"}`), leftX, doc.y + 2, { width: leftW });
  const leftBottom = doc.y;
  doc.font("Helvetica-Bold").fontSize(18).fillColor(GREEN).text("PAYMENT VOUCHER", R - rightW, top, { width: rightW, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor(INK)
    .text(t(`No. ${v.requestNo}`), R - rightW, top + 26, { width: rightW, align: "right" })
    .text(t(`Date: ${v.createdOn}`), { width: rightW, align: "right" })
    .text(t(`Status: ${v.status}`), { width: rightW, align: "right" });
  const rightBottom = doc.y;
  y = Math.max(leftBottom, rightBottom, top + LOGO) + 10;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(1.5).strokeColor(GREEN).stroke();
  y += 14;

  // ---- Facts in two columns; each pair of facts stays on one page.
  const facts: [string, string][] = [
    ["Pay to", v.payee ?? "Not shown"], ["Payee TIN", v.payeeTin ?? (v.restricted ? "Not shown" : "Not recorded")],
    ["Payment method", v.method], ["Destination", v.destination ?? (v.restricted ? "Not shown" : "Not needed for this method")],
    ["Invoice", v.invoice ?? (v.restricted ? "Not shown" : "None")], ["Reason", v.description ?? (v.restricted ? "Not shown" : "None")],
  ];
  const colW = (W - 16) / 2;
  const factH = ([label, value]: [string, string]) =>
    doc.font("Helvetica").fontSize(8).heightOfString(t(label.toUpperCase()), { width: colW }) + 1 + doc.font("Helvetica").fontSize(10).heightOfString(t(value), { width: colW });
  for (let i = 0; i < facts.length; i += 2) {
    const pair = [facts[i], facts[i + 1]].filter(Boolean);
    room(Math.max(...pair.map(factH)) + 8);
    const rowTop = y; let bottom = y;
    for (const [k, [label, value]] of pair.entries()) {
      const x = L + k * (colW + 16);
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(t(label.toUpperCase()), x, rowTop, { width: colW });
      doc.font("Helvetica").fontSize(10).fillColor(INK).text(t(value), x, doc.y + 1, { width: colW });
      bottom = Math.max(bottom, doc.y);
    }
    y = bottom + 8;
  }

  // ---- Amounts: the heading, the rows and the note stay together.
  const rows: [string, string, boolean][] = v.tax ? [
    ["Amount before VAT", moneyText(v.tax.amountBeforeVat), false],
    [`VAT: ${v.tax.vatName} (${percentLabel(v.tax.vatPercent)})`, moneyText(v.tax.vatAmount), false],
    ["Total amount (including VAT)", moneyText(v.tax.gross), true],
    [v.tax.withholdingApplied ? `Withholding tax (${percentLabel(v.tax.withholdingPercent)})` : "Withholding tax", v.tax.withholdingApplied ? `- ${moneyText(v.tax.withholdingAmount)}` : "Not applied", false],
    ["Net payment", moneyText(v.net), true],
  ] : [["Net payment (no tax breakdown recorded)", moneyText(v.net), true]];
  y += 4;
  room(20 + rows.length * ROW + (v.tax ? 20 : 0));
  doc.font("Helvetica-Bold").fontSize(11).fillColor(GREEN).text("Amount", L, y); y = doc.y + 4;
  for (const [label, value, strong] of rows) {
    if (strong) doc.rect(L, y - 2, W, ROW).fill(SOFT);
    doc.font(strong ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(INK).text(t(label), L + 6, y + 2, { width: W * 0.65 });
    doc.text(t(value), L, y + 2, { width: W - 6, align: "right" });
    y += ROW; doc.moveTo(L, y - 2).lineTo(R, y - 2).lineWidth(0.5).strokeColor(LINE).stroke();
  }
  if (v.tax) { doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(t(`${v.tax.mode}. The net payment is the amount paid from the bank.`), L, y + 2, { width: W }); y = doc.y + 6; }

  // ---- Installments: the heading repeats on every page they continue onto; the last two rows stay with the signatures.
  const sigBlock = 24 + SIGN_H;
  if (v.installments.length > 1) {
    const heading = (continued: boolean) => {
      doc.font("Helvetica-Bold").fontSize(11).fillColor(GREEN).text(continued ? "Installments (continued)" : "Installments", L, y + 6); y = doc.y + 4;
    };
    const n = v.installments.length;
    room(26 + INST_ROW * Math.min(n, 2));
    heading(false);
    v.installments.forEach((i, k) => {
      // From the second-to-last row on, ask for the rest of the rows and the signatures together, so they never sit alone on a page.
      room(k >= n - 2 ? INST_ROW * (n - k) + sigBlock : INST_ROW, () => heading(true));
      doc.font("Helvetica").fontSize(9).fillColor(INK).text(t(`${i.seq}. Due ${i.due}`), L + 6, y, { width: W / 2 });
      doc.text(t(moneyText(i.amount)), L, y, { width: W - 6, align: "right" }); y += INST_ROW;
    });
  }

  // ---- Signatures: kept together, at the foot of the page when there is space.
  room(sigBlock);
  y = Math.max(y + 24, BOTTOM - SIGN_H);
  const boxW = (W - 24) / 3;
  v.signatories.forEach((s, k) => {
    const x = L + k * (boxW + 12);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(t(s.role), x, y, { width: boxW, lineBreak: false, ellipsis: true });
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(t(s.name ?? (v.restricted ? "Not shown" : "")), x, y + 14, { width: boxW, height: 12, ellipsis: true });
    doc.fontSize(8).fillColor(MUTED).text(t(s.when ?? ""), x, y + 27, { width: boxW, lineBreak: false });
    doc.moveTo(x, y + 70).lineTo(x + boxW, y + 70).lineWidth(0.75).strokeColor(INK).stroke();
    doc.fontSize(8).fillColor(MUTED).text("Signature", x, y + 74, { width: boxW, lineBreak: false });
  });

  // ---- Footer on every page, in the bottom margin.
  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    const bottomMargin = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(t(`Payment voucher No. ${v.requestNo}  |  Page ${p - range.start + 1} of ${range.count}`), L, doc.page.height - M + 14, { width: W, align: "right", lineBreak: false });
    doc.page.margins.bottom = bottomMargin;
  }
  doc.end();
  return done;
}

/** The company's own logo, fitted into the logo box. False when there is none or it cannot be read (then the code box is drawn). */
function drawLogo(doc: PDFKit.PDFDocument, logo: Buffer | null, x: number, y: number): boolean {
  if (!logo) return false;
  try { doc.image(logo, x, y, { fit: [LOGO, LOGO], align: "center", valign: "center" }); return true; } catch { return false; }
}

/** The fallback when a company has no logo: its code in a box. Never another company's or the group's logo. */
function drawCode(doc: PDFKit.PDFDocument, code: string, x: number, y: number) {
  const text = pdfText(code.toUpperCase());
  doc.save().roundedRect(x + 0.75, y + 0.75, LOGO - 1.5, LOGO - 1.5, 6).lineWidth(1.5).strokeColor(GREEN).stroke().restore();
  doc.font("Helvetica-Bold");
  let size = 16; doc.fontSize(size);
  while (size > 6 && doc.widthOfString(text) > LOGO - 10) { size -= 0.5; doc.fontSize(size); }
  doc.fillColor(GREEN).text(text, x, y + (LOGO - doc.currentLineHeight()) / 2, { width: LOGO, align: "center", lineBreak: false });
}
