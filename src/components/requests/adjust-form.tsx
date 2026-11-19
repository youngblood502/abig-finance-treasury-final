"use client";
import { useState } from "react";
import { adjustRequest } from "@/app/actions";
import { AmountInput } from "@/components/ui/amount-input";
import { SubmitButton } from "@/components/ui/submit-button";
import { etb } from "@/lib/format";
import { centsToPlain, computeTax, etbCents, parseCents, percentLabel, sumCents, type AmountInputMode, type TaxOption } from "@/lib/tax";
import { TaxBreakdown } from "./amount-entry";

/** A request's recorded tax snapshot: the reviewer changes its inputs; the withholding rate and threshold stay those the request recorded. */
export interface AdjustTax { mode: AmountInputMode; entered: string; vatRateId: string; vatRateName: string; vatPercent: string; withholding: boolean; whtPercent: string; whtThreshold: string | null }
export interface AdjustFormProps {
  id: string; version: number; priority: string; invoiceRef: string; description: string; totalAmount: number;
  installments: { seq: number; dueDate: string; amount: string }[];
  /** Null for a request from before tax configuration: its total is the sum of its installments, as before. */
  tax: AdjustTax | null; vatRates: TaxOption[];
}

/** The review's corrections. It posts what adjustRequest reads; the database recalculates the tax figures and audits every change. */
export function AdjustForm({ id, version, priority, invoiceRef, description, totalAmount, installments, tax, vatRates }: AdjustFormProps) {
  const [amounts, setAmounts] = useState(installments.map((i) => centsToPlain(parseCents(i.amount) ?? 0n)));
  const [entered, setEntered] = useState(tax ? centsToPlain(parseCents(tax.entered) ?? 0n) : "");
  const [rateId, setRateId] = useState(tax?.vatRateId ?? "");
  const [withholding, setWithholding] = useState(tax?.withholding ?? false);
  // The request's own rate stays selectable even if it was deactivated since; another rate brings its current percentage.
  const rates = tax && !vatRates.some((v) => v.id === tax.vatRateId) ? [{ kind: "VAT" as const, id: tax.vatRateId, name: tax.vatRateName, rate_percent: tax.vatPercent, is_default: false, threshold_amount: null }, ...vatRates] : vatRates;
  const pct = rateId === tax?.vatRateId ? tax.vatPercent : rates.find((v) => v.id === rateId)?.rate_percent ?? "";
  const result = tax ? computeTax({ mode: tax.mode, entered, vatPercent: pct, withholding, whtPercent: tax.whtPercent, whtThreshold: tax.whtThreshold }) : null;
  const single = installments.length === 1;
  const split = sumCents(amounts);
  const legacyTotal = split;
  return (
    <form action={adjustRequest} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="version" value={version} />
      <input type="hidden" name="orig_priority" value={priority} /><input type="hidden" name="orig_invoice_ref" value={invoiceRef} /><input type="hidden" name="orig_description" value={description} />
      <p className="m-0 text-sm text-muted-foreground">Changing an amount, the VAT rate or withholding sends the request back to verification. Every change is recorded with your reason.</p>
      <label className="f">Priority<select name="priority" defaultValue={priority}><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></label>
      <label className="f">Invoice reference<input name="invoice_ref" defaultValue={invoiceRef} /></label>
      <label className="f">Notes<textarea name="description" rows={2} defaultValue={description} /></label>
      {tax ? (<>
        <input type="hidden" name="taxed" value="1" /><input type="hidden" name="orig_entered_amount" value={tax.entered} /><input type="hidden" name="orig_vat_rate_id" value={tax.vatRateId} /><input type="hidden" name="orig_withholding_applied" value={String(tax.withholding)} />
        <AmountInput name="entered_amount" label={tax.mode === "BEFORE_VAT" ? "Amount before VAT" : "Total amount, including VAT (before withholding)"} value={entered} onChange={setEntered} required />
        <label className="f">VAT rate<select name="vat_rate_id" value={rateId} onChange={(e) => setRateId(e.target.value)}>{rates.map((v) => <option key={v.id} value={v.id!}>{v.name} ({percentLabel(v.id === tax.vatRateId ? tax.vatPercent : v.rate_percent)})</option>)}</select></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="withholding_applied" checked={withholding} disabled={tax.whtThreshold === null && !tax.withholding} onChange={(e) => setWithholding(e.target.checked)} className="mt-1" />
          <span>Withholding tax ({percentLabel(tax.whtPercent)} of the amount before VAT, as recorded on this request)</span></label>
        <div role="status" aria-live="polite" className="rounded-md border bg-card p-3">
          {result?.ok ? <TaxBreakdown lines={[["Amount before VAT", etbCents(result.figures.amountBeforeVat)], [`VAT (${percentLabel(pct)})`, etbCents(result.figures.vatAmount)], ["Total amount (including VAT)", etbCents(result.figures.grossAmount), true],
            ["Withholding tax", withholding ? `− ${etbCents(result.figures.withholdingAmount)}` : "Not applied"], ["New net payment", etbCents(result.figures.netAmount), true], ["Net payment before", etb(totalAmount)]]} />
            : <p role="alert" className="m-0 text-sm text-destructive">{result?.error}</p>}
        </div>
      </>) : (<>
        <input type="hidden" name="orig_total_amount" value={totalAmount} /><input type="hidden" name="total_amount" value={centsToPlain(legacyTotal)} />
        <p className="m-0 text-xs text-muted-foreground">This request was created before tax configuration and has no tax breakdown. Its total is the sum of its installments.</p>
      </>)}
      {installments.map((inst, i) => (
        <div key={inst.seq} className="grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="seq" value={inst.seq} /><input type="hidden" name="o_amount" value={inst.amount} /><input type="hidden" name="o_due" value={inst.dueDate} />
          {tax && single ? <><input type="hidden" name="i_amount" value={inst.amount} /><div className="f"><span>Installment {inst.seq} amount</span><span className="py-2 text-sm">Follows the net payment</span></div></>
            : <AmountInput name="i_amount" label={`Installment ${inst.seq} amount`} value={amounts[i]} onChange={(v) => setAmounts((p) => p.map((x, j) => (j === i ? v : x)))} required />}
          <label className="f">Installment {inst.seq} due date<input name="i_due" type="date" defaultValue={inst.dueDate} required /></label>
        </div>
      ))}
      {tax && !single && result?.ok && split !== result.figures.netAmount && <p role="alert" className="note bad m-0">The installments add up to {etbCents(split)}; they must add up to the new net payment, {etbCents(result.figures.netAmount)}.</p>}
      {!tax && <div className="rounded-md border bg-card p-3 text-sm">New total: <b>{etbCents(legacyTotal)}</b> (was {etb(totalAmount)})</div>}
      <label className="f">Reason (required)<textarea name="reason" rows={2} required minLength={3} /></label>
      <div><SubmitButton>Save adjustment</SubmitButton></div>
    </form>
  );
}
