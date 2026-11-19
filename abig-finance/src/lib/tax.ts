// The tax calculation for the request form's live preview, in whole cents (BigInt): never floating point.
// The database's tax_figures() is the authority and makes the same calculation in numeric; tests check that the two agree.
//
//   amount entered before VAT:  before = entered;                        VAT = round(before x rate, 2);  gross = before + VAT
//   total entered (incl. VAT):  before = round(gross / (1 + rate), 2);   VAT = gross - before;           gross = entered
//   withholding (optional):     round(before x withholding rate, 2), only when before >= threshold
//   net payment:                gross - withholding
// Rounding is to the cent, half away from zero, like PostgreSQL's round(numeric, 2). Percentages have at most two decimals.

export type AmountInputMode = "BEFORE_VAT" | "TOTAL";
export const INPUT_MODES: Record<AmountInputMode, string> = { BEFORE_VAT: "Enter the amount before VAT", TOTAL: "Enter the total amount (including VAT)" };

/**
 * "1,234.5" -> 123450n. Null for anything that is not a plain non-negative amount with at most two decimals. Trailing zeros after those two are
 * accepted, so the database's numeric(19,4) text ("1234.5000") reads exactly.
 */
export function parseCents(typed: string | number | null | undefined): bigint | null {
  const s = String(typed ?? "").replace(/,/g, "").trim();
  const m = /^(\d+)(?:\.(\d{0,2})0*)?$/.exec(s);
  if (!m) return null;
  return BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
}
/** A percentage such as "15" or "2.5" in hundredths of a percent (1500n, 250n). Null if it has more than two decimals. */
export const parseBasis = (p: string | number | null | undefined): bigint | null => parseCents(p);
/** 123450n -> "1234.50": the exact string the server and database receive. */
export const centsToPlain = (c: bigint) => `${c < 0n ? "-" : ""}${(c < 0n ? -c : c) / 100n}.${String((c < 0n ? -c : c) % 100n).padStart(2, "0")}`;
/** 123450n -> "ETB 1,234.50". */
export const etbCents = (c: bigint) => { const [w, d] = centsToPlain(c).split("."); return `ETB ${w.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${d}`; };
/** A percentage for display: "15%", "2.5%". */
export const percentLabel = (p: string | number) => `${Number(p).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/** n / d rounded half away from zero, for n >= 0 and d > 0. */
const div = (n: bigint, d: bigint) => (2n * n + d) / (2n * d);

export interface TaxInput { mode: AmountInputMode; entered: string; vatPercent: string | number; withholding: boolean; whtPercent: string | number; whtThreshold: string | number | null }
export interface TaxFigures { amountBeforeVat: bigint; vatAmount: bigint; grossAmount: bigint; withholdingAmount: bigint; netAmount: bigint }
export type TaxResult = { ok: true; figures: TaxFigures } | { ok: false; error: string };

export function computeTax(i: TaxInput): TaxResult {
  const entered = parseCents(i.entered);
  if (String(i.entered ?? "").trim() === "") return { ok: false, error: "Enter the amount." };
  if (entered === null) return { ok: false, error: "Enter an amount with at most two decimal places." };
  if (entered <= 0n) return { ok: false, error: "The amount must be more than zero." };
  const rate = parseBasis(i.vatPercent);
  if (rate === null || rate >= 10000n) return { ok: false, error: "Choose a VAT rate." };
  let before: bigint, vat: bigint, gross: bigint;
  if (i.mode === "BEFORE_VAT") { before = entered; vat = div(before * rate, 10000n); gross = before + vat; }
  else { gross = entered; before = div(gross * 10000n, 10000n + rate); vat = gross - before; }
  if (before <= 0n) return { ok: false, error: "The amount is too small to split into an amount before VAT and VAT." };
  let wht = 0n;
  if (i.withholding) {
    const threshold = i.whtThreshold === null || i.whtThreshold === "" ? null : parseCents(i.whtThreshold);
    if (threshold === null) return { ok: false, error: "Withholding tax cannot be applied until a system administrator sets the withholding threshold." };
    if (before < threshold) return { ok: false, error: `Withholding tax applies only when the amount before VAT is at least ${etbCents(threshold)}; this amount before VAT is ${etbCents(before)}.` };
    const w = parseBasis(i.whtPercent);
    if (w === null) return { ok: false, error: "The withholding rate is not set." };
    wht = div(before * w, 10000n);
  }
  return { ok: true, figures: { amountBeforeVat: before, vatAmount: vat, grossAmount: gross, withholdingAmount: wht, netAmount: gross - wht } };
}

/** Adds typed amounts exactly. Rows that are not valid amounts count as zero (the form shows them as errors separately). */
export const sumCents = (typed: string[]) => typed.reduce((s, t) => s + (parseCents(t) ?? 0n), 0n);

// ---------- What the request screens read ----------
export interface TaxOption { kind: "VAT" | "WITHHOLDING"; id: string | null; name: string; rate_percent: string; is_default: boolean; threshold_amount: string | null }
export interface TaxOptions { vat: TaxOption[]; withholding: { rate_percent: string; threshold_amount: string | null } }
export const loadTaxOptions = async (tx: import("./db").Tx): Promise<TaxOptions> => {
  const rows = await tx.q<TaxOption>("SELECT kind, id, name, rate_percent::text AS rate_percent, is_default, threshold_amount::text AS threshold_amount FROM tax_options()");
  const w = rows.find((r) => r.kind === "WITHHOLDING");
  return { vat: rows.filter((r) => r.kind === "VAT"), withholding: { rate_percent: w?.rate_percent ?? "0", threshold_amount: w?.threshold_amount ?? null } };
};
/** The tax fields every request form posts, read on the server. The database recalculates everything from these. */
export function taxFields(f: FormData) {
  const s = (k: string) => String(f.get(k) ?? "").trim();
  const mode = s("amount_input_mode") === "TOTAL" ? "TOTAL" : "BEFORE_VAT";
  const cents = parseCents(s("entered_amount"));
  return { mode, entered: cents === null ? null : centsToPlain(cents), enteredRaw: s("entered_amount"), vatRateId: s("vat_rate_id") || null, withholding: f.get("withholding_applied") === "on" };
}
