import ExcelJS from "exceljs";
import { cellAmount, type Voucher } from "./voucher";

// The payment voucher as a genuine .xlsx workbook. Values are the stored database values (two decimals), written as numbers with a #,##0.00
// format; totals are the stored figures, not spreadsheet formulas, so the file shows exactly what the database holds. Text that could start a
// formula is written as plain text (ExcelJS writes strings as strings, never as formulas).
//
// Printing: A4 portrait with 17mm margins, fitted to the page width but running onto as many pages as it needs (fitToHeight 0), so a long
// installment list is never shrunk to unreadable text; the title and company rows repeat at the top of every page. The paying company's own
// logo, when it has one, sits at the top right; without one the workbook simply has no image (never another company's or the group's logo).

const MONEY = '#,##0.00', PCT = '0.00"%"', GREEN = "FF2F7A33", SOFT = "FFEEF5EE";

export interface XlsxOptions { logo?: Buffer | null; logoMime?: "image/png" | "image/jpeg" }
/** 17mm in inches, the PDF's 48pt margin. */
const MARGIN = 0.67;

export async function voucherXlsx(v: Voucher, { logo = null, logoMime }: XlsxOptions = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = v.company; wb.title = `Payment voucher ${v.requestNo}`; wb.created = new Date();   // when the workbook was exported
  const ws = wb.addWorksheet("Payment voucher", { pageSetup: {
    paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
    margins: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN, header: 0.3, footer: 0.3 }, printTitlesRow: "1:2",
  } });
  ws.headerFooter.oddFooter = `&L&8Payment voucher No. ${v.requestNo.replace(/&/g, "&&")}&R&8Page &P of &N`;
  ws.columns = [{ width: 38 }, { width: 26 }, { width: 22 }];
  const title = ws.addRow(["PAYMENT VOUCHER"]); title.font = { bold: true, size: 16, color: { argb: GREEN } };
  ws.addRow([v.company]).font = { bold: true, size: 12 };
  if (logo && logoMime) {
    try {
      const image = wb.addImage({ buffer: logo as unknown as ExcelJS.Buffer, extension: logoMime === "image/png" ? "png" : "jpeg" });
      ws.addImage(image, { tl: { col: 2.55, row: 0.1 }, ext: { width: 56, height: 56 }, editAs: "oneCell" });
    } catch { /* an unreadable logo leaves the space empty */ }
  }
  ws.addRow(["Company TIN", v.companyTin ?? "Not recorded"]);
  ws.addRow([]);
  const section = (name: string) => { const r = ws.addRow([name]); r.font = { bold: true, color: { argb: "FFFFFFFF" } }; r.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } }; }); ws.mergeCells(r.number, 1, r.number, 3); };
  const fact = (k: string, val: string | null) => ws.addRow([k, val ?? ""]);

  section("Payment request");
  fact("Request number", v.requestNo); fact("Date", v.createdOn); fact("Status", v.status);
  fact("Pay to", v.payee ?? "Not shown"); fact("Payee TIN", v.payeeTin ?? (v.restricted ? "Not shown" : "Not recorded"));
  fact("Payment method", v.method); fact("Destination", v.destination ?? (v.restricted ? "Not shown" : "Not needed for this method"));
  fact("Invoice", v.invoice ?? (v.restricted ? "Not shown" : "None")); fact("Reason", v.description ?? (v.restricted ? "Not shown" : "None"));
  ws.addRow([]);

  section("Tax calculation");
  const head = ws.addRow(["Item", "Rate", "Amount (ETB)"]); head.font = { bold: true };
  const amountRow = (label: string, rate: number | null, amount: string | null, strong = false) => {
    const r = ws.addRow([label, rate, amount === null ? "Not applied" : cellAmount(amount)]);
    if (rate !== null) r.getCell(2).numFmt = PCT;
    if (amount !== null) r.getCell(3).numFmt = MONEY;
    r.getCell(3).alignment = { horizontal: "right" };
    if (strong) { r.font = { bold: true }; r.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } }; }); }
    return r;
  };
  if (v.tax) {
    fact("How the amount was entered", v.tax.mode);
    amountRow("Amount before VAT", null, v.tax.amountBeforeVat);
    amountRow(`VAT: ${v.tax.vatName}`, Number(v.tax.vatPercent), v.tax.vatAmount);
    amountRow("Total amount (including VAT)", null, v.tax.gross, true);
    amountRow("Withholding tax", v.tax.withholdingApplied ? Number(v.tax.withholdingPercent) : null, v.tax.withholdingApplied ? v.tax.withholdingAmount : null);
    amountRow("Net payment", null, v.net, true);
  } else {
    amountRow("Net payment (no tax breakdown recorded)", null, v.net, true);
  }
  ws.addRow([]);

  section("Installments");
  ws.addRow(["Installment", "Due date", "Amount (ETB)"]).font = { bold: true };
  for (const i of v.installments) { const r = ws.addRow([`Installment ${i.seq}`, i.due, cellAmount(i.amount)]); r.getCell(3).numFmt = MONEY; }
  const tot = ws.addRow(["Total of installments (net payment)", null, cellAmount(v.net)]); tot.font = { bold: true }; tot.getCell(3).numFmt = MONEY;
  ws.addRow([]);

  section("Approval");
  ws.addRow(["Role", "Name", "Date"]).font = { bold: true };
  for (const s of v.signatories) ws.addRow([s.role, s.name ?? (v.restricted ? "Not shown" : ""), s.when ?? ""]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
