import type { Tx } from "./db";
import { dstr, dtime, PAYMENT_METHODS, STATE_LABEL } from "./format";
import { loadRequest, type RequestRow } from "./requests";
import { centsToPlain, etbCents, parseCents, percentLabel } from "./tax";

// The payment voucher: one set of values for the detail page, the print page, the PDF and the Excel workbook, read through the same row-level
// security as the detail page (loadRequest). Amounts are the stored database values, never recalculated and never from the current settings.
// Destinations show the bank and the last 4 digits only: no full account number is ever loaded or exported. Reading it changes nothing.

type TaxRow = Pick<RequestRow, "amount_input_mode" | "amount_before_vat" | "vat_rate_name" | "vat_rate_percent" | "vat_amount" | "gross_amount" | "withholding_applied" | "withholding_rate_percent" | "withholding_amount" | "total_amount">;
const money = (v: string | null) => etbCents(parseCents(v) ?? 0n);

/** The tax breakdown as label/value rows, from the stored snapshot. */
export function taxLines(r: TaxRow): [string, string, boolean?][] {
  return [
    ["Amount before VAT", money(r.amount_before_vat)],
    [`VAT: ${r.vat_rate_name} (${percentLabel(r.vat_rate_percent ?? "0")})`, money(r.vat_amount)],
    ["Total amount (including VAT)", money(r.gross_amount), true],
    [r.withholding_applied ? `Withholding tax (${percentLabel(r.withholding_rate_percent ?? "0")})` : "Withholding tax", r.withholding_applied ? `− ${money(r.withholding_amount)}` : "Not applied"],
    ["Net payment", money(r.total_amount), true],
  ];
}

export interface Signatory { role: string; name: string | null; when: string | null }
export interface Voucher {
  requestNo: string; createdOn: string; company: string; companyTin: string | null; status: string; restricted: boolean;
  /** The paying company (payment_requests.debtor_company_id), never the owner of the bank account it is paid from. */
  companyId: string; companyCode: string;
  /** That company's current logo in private storage, or null (the voucher then shows the company code, never another logo). */
  logo: { objectKey: string; mime: "image/png" | "image/jpeg"; sha256: string } | null;
  payee: string | null; payeeTin: string | null; method: string; destination: string | null; description: string | null; invoice: string | null;
  /** Null when the request has no tax breakdown (created before tax configuration). */
  tax: null | { mode: string; amountBeforeVat: string; vatName: string; vatPercent: string; vatAmount: string; gross: string; withholdingApplied: boolean; withholdingPercent: string; withholdingAmount: string };
  net: string;
  installments: { seq: number; due: string; amount: string }[];
  signatories: Signatory[];
}

/** Where the money goes, masked. Null for a group reporter, who never sees the payee or its details. */
function destination(r: RequestRow): string | null {
  const masked = (bank: string | null, last4: string | null) => (bank ? `${bank} ••••${last4 ?? ""}`.trim() : null);
  if (r.payee_type === "ONE_TIME") return r.payment_method === "TELEBIRR" ? (r.ot_phone ? `Telebirr ${r.ot_phone}` : null) : masked(r.ot_bank, r.ot_last4);
  if (r.person_kind === "TELEBIRR") return r.telebirr_phone ? `Telebirr ${r.telebirr_phone}` : null;
  if (r.person_kind === "BANK") return masked(r.person_bank, r.person_last4);
  return masked(r.bank_name, r.account_last4);
}

/** The voucher for a request this person can see, or null (not found, or another company's request: row-level security). */
export async function loadVoucher(tx: Tx, id: string): Promise<Voucher | null> {
  const d = await loadRequest(tx, id);
  if (!d) return null;
  const r = d.r;
  // The company is the request's paying company (debtor_company_id); its logo is that company's current one, read through row-level security.
  const x = (await tx.q<{ created_at: Date; company_id: string; code: string; tin_number: string | null; verifier: string | null; verified_at: Date | null; authenticator: string | null; authenticated_at: Date | null;
                          logo_key: string | null; logo_mime: "image/png" | "image/jpeg" | null; logo_sha256: string | null }>(
    `SELECT r.created_at, c.id AS company_id, c.code, c.tin_number, vu.full_name AS verifier, r.verified_at, au.full_name AS authenticator, r.authenticated_at,
            l.object_key AS logo_key, l.mime_type AS logo_mime, l.sha256 AS logo_sha256
       FROM payment_requests r JOIN companies c ON c.id = r.debtor_company_id LEFT JOIN company_logos l ON l.company_id = r.debtor_company_id AND l.ended_at IS NULL
       LEFT JOIN users vu ON vu.id = r.verified_by LEFT JOIN users au ON au.id = r.authenticated_by WHERE r.id = $1`, [id]))[0];
  const hide = d.restricted;   // a group reporter sees amounts and status, never who handled it
  return {
    requestNo: r.request_no, createdOn: dstr(x.created_at), company: r.company, companyTin: x.tin_number, status: STATE_LABEL[r.workflow_state] ?? r.workflow_state, restricted: hide,
    companyId: x.company_id, companyCode: x.code, logo: x.logo_key && x.logo_mime && x.logo_sha256 ? { objectKey: x.logo_key, mime: x.logo_mime, sha256: x.logo_sha256 } : null,
    payee: r.payee, payeeTin: r.tin, method: PAYMENT_METHODS[r.payment_method] ?? r.payment_method, destination: hide ? null : destination(r),
    description: r.description, invoice: r.invoice_ref ? `${r.invoice_ref}${r.invoice_date ? `, ${dstr(r.invoice_date)}` : ""}` : null,
    tax: r.amount_input_mode ? {
      mode: r.amount_input_mode === "BEFORE_VAT" ? "Amount entered before VAT" : "Total entered including VAT", amountBeforeVat: r.amount_before_vat!, vatName: r.vat_rate_name!, vatPercent: r.vat_rate_percent!,
      vatAmount: r.vat_amount!, gross: r.gross_amount!, withholdingApplied: !!r.withholding_applied, withholdingPercent: r.withholding_rate_percent!, withholdingAmount: r.withholding_amount!,
    } : null,
    net: String(r.total_amount),
    installments: d.installments.map((i) => ({ seq: i.seq, due: dstr(i.due_date), amount: String(i.amount) })),
    signatories: [
      { role: "Prepared by", name: hide ? null : r.creator_name, when: dtime(x.created_at) },
      { role: "Checked by", name: hide ? null : x.verifier, when: x.verified_at ? dtime(x.verified_at) : null },
      { role: "Approved by", name: hide ? null : x.authenticator, when: x.authenticated_at ? dtime(x.authenticated_at) : null },
    ],
  };
}

/** The stored amount as a number of cents and as the exact value an Excel cell holds (two decimals). */
export const cents = (v: string) => parseCents(v) ?? 0n;
/** The nearest double to the exact two-decimal value: what Excel stores for a number typed with two decimals, shown with a #,##0.00 format. */
export const cellAmount = (v: string) => Number(centsToPlain(cents(v)));
export const voucherFilename = (v: Voucher, ext: string) => `payment-voucher-${v.requestNo.replace(/[^A-Za-z0-9-]/g, "_")}.${ext}`;
export const moneyText = money;
