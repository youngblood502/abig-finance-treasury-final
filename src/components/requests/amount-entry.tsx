"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { centsToPlain, computeTax, etbCents, INPUT_MODES, parseCents, percentLabel, sumCents, type AmountInputMode, type TaxOptions } from "@/lib/tax";

export interface AmountEntryInitial { mode: AmountInputMode; entered: string; vatRateId: string | null; withholding: boolean }
export interface InstallmentInitial { due: string; amount: string }

let nextRow = 1;
const row = (i?: InstallmentInitial) => ({ key: nextRow++, due: i?.due ?? "", amount: i?.amount ?? "" });

/** The calculation as a short list, shown before anything is saved. The database makes the same calculation and is the record. */
export function TaxBreakdown({ lines }: { lines: [string, string, boolean?][] }) {
  return <dl className="m-0 grid gap-1 text-sm">{lines.map(([k, v, strong]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className={`m-0 text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{v}</dd></div>)}</dl>;
}

/**
 * How the amount is entered (before VAT, or the total including VAT and excluding withholding), the VAT rate, optional withholding, the live
 * calculation, and the installments that divide the net payment. Posts amount_input_mode, entered_amount, vat_rate_id, withholding_applied, and
 * due/amt per installment. With one installment its amount is the net payment.
 */
export function AmountEntry({ options, initial, installments, onNet, onFirstDue }: { options: TaxOptions; initial: AmountEntryInitial; installments: InstallmentInitial[]; onNet?: (net: bigint | null) => void; onFirstDue?: (due: string | undefined) => void }) {
  const defaultRate = options.vat.find((v) => v.is_default) ?? options.vat[0];
  const [mode, setMode] = useState<AmountInputMode>(initial.mode);
  const [entered, setEntered] = useState(initial.entered);
  const [rateId, setRateId] = useState(options.vat.some((v) => v.id === initial.vatRateId) ? initial.vatRateId! : defaultRate?.id ?? "");
  const [withholding, setWithholding] = useState(initial.withholding);
  const [rows, setRows] = useState(() => (installments.length ? installments : [{ due: "", amount: "" }]).map(row));
  const rate = options.vat.find((v) => v.id === rateId);
  const w = options.withholding, noThreshold = w.threshold_amount === null;
  const result = useMemo(() => computeTax({ mode, entered, vatPercent: rate?.rate_percent ?? "", withholding, whtPercent: w.rate_percent, whtThreshold: w.threshold_amount }), [mode, entered, rate, withholding, w]);
  const net = result.ok ? result.figures.netAmount : null;
  useEffect(() => { onNet?.(net); }, [net, onNet]);
  const firstDue = rows.map((r) => r.due).filter(Boolean).sort()[0];
  useEffect(() => { onFirstDue?.(firstDue); }, [firstDue, onFirstDue]);
  const single = rows.length === 1;
  const split = sumCents(rows.map((r) => r.amount));
  const update = (key: number, change: Partial<{ due: string; amount: string }>) => setRows((p) => p.map((r) => (r.key === key ? { ...r, ...change } : r)));

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="amount_input_mode" value={mode} />
      <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">How you enter the amount</legend>
        {(Object.keys(INPUT_MODES) as AmountInputMode[]).map((m) => <label key={m} className="flex items-center gap-2 text-sm"><input type="radio" checked={mode === m} onChange={() => setMode(m)} />{INPUT_MODES[m]}</label>)}
      </fieldset>
      <div className="grid gap-3 md:grid-cols-2">
        <AmountInput name="entered_amount" label={mode === "BEFORE_VAT" ? "Amount before VAT" : "Total amount, including VAT (before withholding)"} value={entered} onChange={setEntered} required />
        <label className="f">VAT rate
          <select name="vat_rate_id" required value={rateId} onChange={(e) => setRateId(e.target.value)}>
            {options.vat.map((v) => <option key={v.id} value={v.id!}>{v.name} ({percentLabel(v.rate_percent)})</option>)}
          </select></label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="withholding_applied" checked={withholding && !noThreshold} disabled={noThreshold} onChange={(e) => setWithholding(e.target.checked)} className="mt-1" />
        <span>Apply withholding tax ({percentLabel(w.rate_percent)} of the amount before VAT)
          <span className="block text-xs text-muted-foreground">{noThreshold ? "Not available: a system administrator has not set the withholding threshold yet." : `Only when the amount before VAT is at least ${etbCents(parseCents(w.threshold_amount) ?? 0n)}. Optional; never applied automatically.`}</span></span>
      </label>
      <div role="status" aria-live="polite" className="rounded-md border bg-background p-3">
        {result.ok ? <TaxBreakdown lines={[
          ["Amount before VAT", etbCents(result.figures.amountBeforeVat)],
          [`VAT (${rate ? percentLabel(rate.rate_percent) : ""})`, etbCents(result.figures.vatAmount)],
          ["Total amount (including VAT)", etbCents(result.figures.grossAmount), true],
          [withholding ? `Withholding tax (${percentLabel(w.rate_percent)})` : "Withholding tax", withholding ? `− ${etbCents(result.figures.withholdingAmount)}` : "Not applied"],
          ["Net payment (reserved and paid)", etbCents(result.figures.netAmount), true],
        ]} /> : <p role="alert" className="m-0 text-sm text-destructive">{result.error}</p>}
      </div>

      <div>
        <h3 className="mb-2 mt-1 text-sm font-semibold">Installments</h3>
        <div className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <div key={r.key} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <label className="f">Due date {i + 1}<input name="due" type="date" required value={r.due} onChange={(e) => update(r.key, { due: e.target.value })} /></label>
              {single ? <><input type="hidden" name="amt" value={net === null ? "" : centsToPlain(net)} /><div className="f"><span>Amount 1</span><span className="py-2 text-sm tabular-nums">{net === null ? "The net payment" : etbCents(net)}</span></div></>
                : <AmountInput name="amt" label={`Amount ${i + 1}`} required value={r.amount} onChange={(amount) => update(r.key, { amount })} />}
              <Button type="button" variant="outline" size="icon" aria-label={`Remove installment ${i + 1}`} disabled={single} onClick={() => setRows((p) => p.filter((x) => x.key !== r.key))}><Trash2 /></Button>
            </div>
          ))}
          <div><Button type="button" variant="outline" size="sm" onClick={() => setRows((p) => [...p.map((x) => (p.length === 1 && net !== null ? { ...x, amount: centsToPlain(net) } : x)), row()])}><Plus />Add installment</Button></div>
        </div>
        {!single && net !== null && split !== net && <p role="alert" className="note bad mt-2 mb-0">The installments add up to {etbCents(split)}; they must add up to the net payment, {etbCents(net)}. You can save a draft, but it cannot be submitted until they do.</p>}
      </div>
    </div>
  );
}
