import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { centsToPlain, computeTax, etbCents, parseCents, type TaxInput } from "../src/lib/tax";
import { setupDb } from "./helpers";

// The calculation, in the browser's preview (whole cents) and in the database (numeric). The database is the authority; the two must agree to the cent.
const calc = (i: Partial<TaxInput>) => computeTax({ mode: "BEFORE_VAT", entered: "", vatPercent: "15", withholding: false, whtPercent: "3", whtThreshold: null, ...i });
const figures = (i: Partial<TaxInput>) => { const r = calc(i); if (!r.ok) throw new Error(r.error); return Object.fromEntries(Object.entries(r.figures).map(([k, v]) => [k, centsToPlain(v)])); };

describe("the calculation (whole cents, no floating point)", () => {
  it("15% VAT on an amount before VAT: the example of 100,000 with 3% withholding", () => {
    expect(figures({ entered: "100000", withholding: true, whtThreshold: "10000" })).toEqual({ amountBeforeVat: "100000.00", vatAmount: "15000.00", grossAmount: "115000.00", withholdingAmount: "3000.00", netAmount: "112000.00" });
  });
  it("a total including VAT: the amount before VAT is the total divided by 1.15, and the parts add up to the total exactly", () => {
    expect(figures({ mode: "TOTAL", entered: "115000" })).toEqual({ amountBeforeVat: "100000.00", vatAmount: "15000.00", grossAmount: "115000.00", withholdingAmount: "0.00", netAmount: "115000.00" });
    // 100 / 1.15 = 86.9565...: rounded to 86.96, VAT is what is left (13.04), never a separately rounded 13.04347...
    expect(figures({ mode: "TOTAL", entered: "100" })).toEqual({ amountBeforeVat: "86.96", vatAmount: "13.04", grossAmount: "100.00", withholdingAmount: "0.00", netAmount: "100.00" });
  });
  it("the total entered includes VAT and excludes withholding: withholding comes off it, calculated on the amount before VAT", () => {
    const f = figures({ mode: "TOTAL", entered: "115000", withholding: true, whtThreshold: "0" });
    expect(f.grossAmount).toBe("115000.00"); expect(f.withholdingAmount).toBe("3000.00"); expect(f.netAmount).toBe("112000.00");
    expect(f.withholdingAmount).not.toBe("3450.00");   // 3% of the VAT-inclusive total would be 3,450
  });
  it("non-taxable (0%): the amount before VAT is the total and VAT is zero, in both modes", () => {
    expect(figures({ entered: "5000.50", vatPercent: "0" })).toMatchObject({ amountBeforeVat: "5000.50", vatAmount: "0.00", grossAmount: "5000.50" });
    expect(figures({ mode: "TOTAL", entered: "5000.50", vatPercent: "0" })).toMatchObject({ amountBeforeVat: "5000.50", vatAmount: "0.00", grossAmount: "5000.50" });
  });
  it("a custom rate with decimals", () => {
    expect(figures({ entered: "1000", vatPercent: "7.5" })).toMatchObject({ vatAmount: "75.00", grossAmount: "1075.00" });
    expect(figures({ entered: "333.33", vatPercent: "2.25" })).toMatchObject({ vatAmount: "7.50", grossAmount: "340.83" });   // 7.4999... -> 7.50
  });
  it("rounds half away from zero to the cent", () => {
    expect(figures({ entered: "0.10", vatPercent: "15" }).vatAmount).toBe("0.02");    // 0.015 -> 0.02
    expect(figures({ entered: "0.30", vatPercent: "15" }).vatAmount).toBe("0.05");    // 0.045 -> 0.05
    expect(figures({ entered: "0.03", vatPercent: "15" }).vatAmount).toBe("0.00");    // 0.0045 -> 0.00
    expect(figures({ entered: "50", withholding: true, whtPercent: "3", whtThreshold: "0", vatPercent: "0" }).withholdingAmount).toBe("1.50");
    expect(figures({ entered: "0.50", withholding: true, whtPercent: "3", whtThreshold: "0", vatPercent: "0" }).withholdingAmount).toBe("0.02");   // 0.015 -> 0.02
  });
  it("withholding is optional: without it, nothing is withheld and the net is the total", () => {
    expect(figures({ entered: "100000", whtThreshold: "10000" })).toMatchObject({ withholdingAmount: "0.00", netAmount: "115000.00" });
  });
  it("the threshold is checked on the amount before VAT, inclusive, and is never applied silently", () => {
    expect(figures({ entered: "10000", withholding: true, whtThreshold: "10000" }).withholdingAmount).toBe("300.00");    // exactly at the threshold
    const below = calc({ entered: "9999.99", withholding: true, whtThreshold: "10000" });
    expect(below).toEqual({ ok: false, error: "Withholding tax applies only when the amount before VAT is at least ETB 10,000.00; this amount before VAT is ETB 9,999.99." });
    // The VAT-inclusive total is above the threshold, the amount before VAT is not: refused.
    expect(calc({ mode: "TOTAL", entered: "11499.99", withholding: true, whtThreshold: "10000" }).ok).toBe(false);
    expect(calc({ mode: "TOTAL", entered: "11500", withholding: true, whtThreshold: "10000" }).ok).toBe(true);
    expect(calc({ entered: "100000", withholding: true, whtThreshold: null })).toMatchObject({ ok: false, error: expect.stringMatching(/threshold/) });
  });
  it("zero, negative, empty and invalid amounts are refused", () => {
    for (const entered of ["", "0", "0.00", "-5", "abc", "1.234", "1e5"]) expect(calc({ entered }).ok).toBe(false);
    expect(calc({ entered: "0.01", mode: "TOTAL" })).toMatchObject({ ok: true });
    expect(parseCents("1,234.50")).toBe(123450n); expect(parseCents("1234.5000")).toBe(123450n); expect(parseCents("1234.501")).toBeNull();
    expect(etbCents(112000n * 100n)).toBe("ETB 112,000.00");
  });
});

describe("the database makes the same calculation", () => {
  let owner: Client;
  beforeAll(async () => { owner = (await setupDb("abig_test_tax_calc")).owner; }, 120_000);
  afterAll(async () => { await owner?.end(); });
  const db = async (i: TaxInput) => (await owner.query("SELECT amount_before_vat::text b, vat_amount::text v, gross_amount::text g, withholding_amount::text w, net_amount::text n FROM tax_figures($1,$2::numeric,$3::numeric,$4,$5::numeric,$6::numeric)",
    [i.mode, i.entered, String(i.vatPercent), i.withholding, String(i.whtPercent), i.whtThreshold])).rows[0];
  const fmt = (s: string) => centsToPlain(parseCents(s)!);

  it("agrees to the cent with the preview over a spread of amounts, rates and both modes", async () => {
    const amounts = ["0.01", "0.07", "0.10", "0.33", "1", "9.99", "86.96", "99.99", "100", "333.33", "1234.56", "9999.99", "10000", "11499.99", "115000", "987654.32", "12345678.91"];
    const rates = ["0", "2.25", "7.5", "15", "15.5", "33.33"];
    let checked = 0;
    for (const mode of ["BEFORE_VAT", "TOTAL"] as const) for (const entered of amounts) for (const vatPercent of rates) for (const withholding of [false, true]) {
      const i: TaxInput = { mode, entered, vatPercent, withholding, whtPercent: "3", whtThreshold: "0" };
      const r = computeTax(i); if (!r.ok) continue;
      const d = await db(i);
      expect([fmt(d.b), fmt(d.v), fmt(d.g), fmt(d.w), fmt(d.n)], `${mode} ${entered} at ${vatPercent}% ${withholding ? "with" : "without"} withholding`)
        .toEqual([r.figures.amountBeforeVat, r.figures.vatAmount, r.figures.grossAmount, r.figures.withholdingAmount, r.figures.netAmount].map(centsToPlain));
      checked++;
    }
    expect(checked).toBeGreaterThan(300);
  });
  it("every figure has exactly two decimals", async () => {
    const d = await db({ mode: "TOTAL", entered: "100", vatPercent: "15", withholding: true, whtPercent: "3", whtThreshold: "0" });
    for (const v of Object.values(d)) expect(String(v)).toMatch(/^\d+\.\d{2}$/);
  });
  it("refuses what the preview refuses, with the same reasons", async () => {
    const err = async (i: TaxInput) => { try { await db(i); return null; } catch (e) { return (e as Error).message; } };
    expect(await err({ mode: "BEFORE_VAT", entered: "9999.99", vatPercent: "15", withholding: true, whtPercent: "3", whtThreshold: "10000" })).toBe("withholding tax applies only when the amount before VAT is at least ETB 10,000.00; this amount before VAT is ETB 9,999.99");
    expect(await err({ mode: "BEFORE_VAT", entered: "100", vatPercent: "15", withholding: true, whtPercent: "3", whtThreshold: null })).toMatch(/until a system administrator sets the withholding threshold/);
    expect(await err({ mode: "BEFORE_VAT", entered: "0", vatPercent: "15", withholding: false, whtPercent: "3", whtThreshold: null })).toMatch(/more than zero/);
    expect(await err({ mode: "BEFORE_VAT", entered: "1.005", vatPercent: "15", withholding: false, whtPercent: "3", whtThreshold: null })).toMatch(/two decimal places/);
  });
});
