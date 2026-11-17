"use client";
import { useState } from "react";
import { recordFigure } from "@/app/actions";
import { AmountInput } from "@/components/ui/amount-input";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { ANOMALIES, etb, PAYMENT_METHODS } from "@/lib/format";
import { previewFigure } from "@/lib/treasury-screens";

export interface CheckPayment { id: string; requestNo: string; company: string; payee: string | null; method: string; amount: number; chequeNo: string | null; carried: boolean; overdue: boolean; ageDays: number; startsTicked: boolean; tickUndone: boolean }
export interface BalanceCheckFormProps { accountId: string; opening: boolean; hadOpening: boolean; fieldLabel: string; previous: number; reserved: number; threshold: number; payments: CheckPayment[] }

const Line = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => <div className="flex justify-between gap-3 py-0.5 text-sm"><span className="text-muted-foreground">{label}</span><span className={strong ? "font-semibold" : undefined}>{value}</span></div>;

/** One figure, the outstanding payments with their default ticks, and what saving will record. `shown` lets the database refuse the entry if the list has changed since. */
export function BalanceCheckForm({ accountId, opening, hadOpening, fieldLabel, previous, reserved, threshold, payments }: BalanceCheckFormProps) {
  const [figure, setFigure] = useState("");
  const [ticked, setTicked] = useState(() => new Set(payments.filter((p) => p.startsTicked).map((p) => p.id)));
  const toggle = (id: string, on: boolean) => setTicked((s) => { const next = new Set(s); if (on) next.add(id); else next.delete(id); return next; });
  const p = previewFigure({ figure: Number(figure) || 0, previous, reserved, threshold, opening, hadOpening }, payments.filter((x) => !ticked.has(x.id)).map((x) => x.amount));
  return (
    <form action={recordFigure} className="mb-3 flex flex-col gap-3 rounded-xl border bg-card p-4">
      <h2 className="m-0">{opening ? "Opening balance for this week" : "Balance check"}</h2>
      <input type="hidden" name="account" value={accountId} /><input type="hidden" name="opening" value={opening ? "1" : "0"} />
      <div className="max-w-sm"><AmountInput name="figure" label={fieldLabel} value={figure} onChange={setFigure} required /></div>
      {payments.length > 0 && (
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 p-0 text-sm text-muted-foreground">Tick the payments the bank has processed. The rest are subtracted from the figure.</legend>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {payments.map((x) => (
              <li key={x.id}>
                <input type="hidden" name="shown" value={x.id} />
                <label className="flex cursor-pointer items-start gap-3 rounded-md border bg-background p-3">
                  <input type="checkbox" name="processed" value={x.id} checked={ticked.has(x.id)} onChange={(e) => toggle(x.id, e.target.checked)} className="mt-1" />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-semibold">{x.requestNo}</span> <span className="text-muted-foreground">{x.company}</span>
                    {x.carried && <Badge variant="outline" className="ml-2">Carried over</Badge>}{x.tickUndone && <Badge variant="warning" className="ml-2">Tick undone</Badge>}{x.overdue && <Badge variant="destructive" className="ml-2">{x.ageDays} days</Badge>}
                    <span className="block text-xs text-muted-foreground">{x.payee ?? "Payee not shown"} · {PAYMENT_METHODS[x.method]}{x.chequeNo ? ` ${x.chequeNo}` : ""}</span>
                  </span>
                  <span className="text-sm font-semibold whitespace-nowrap tabular-nums">{etb(x.amount)}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <div role="status" className="rounded-md border bg-background p-3">
        <div className="mb-1 text-sm font-semibold">What saving will record</div>
        <Line label="Figure entered" value={etb(Number(figure) || 0)} />
        <Line label="Not yet processed" value={etb(p.outstanding)} />
        <Line label="New system balance" value={etb(p.balance)} strong />
        {!opening && <Line label="Previous system balance" value={etb(previous)} />}
        {p.implied !== null && figure !== "" && <Line label="Implied deposit" value={etb(p.implied)} strong />}
        {figure !== "" && p.negativeDeposit && <Badge variant="warning" className="mt-1">{ANOMALIES.NEGATIVE_DEPOSIT}</Badge>}
        {figure !== "" && p.largeDeposit && <Badge variant="warning" className="mt-1">{ANOMALIES.LARGE_DEPOSIT}</Badge>}
        {figure !== "" && p.openingChanged && <Badge variant="warning" className="mt-1">{ANOMALIES.OPENING_CHANGED}</Badge>}
        {figure !== "" && p.shortfall > 0 && <Badge variant="destructive" className="mt-1">Shortfall of {etb(p.shortfall)}: new submissions blocked</Badge>}
      </div>
      <div><SubmitButton disabled={figure === ""}>{opening ? "Record opening balance" : "Save balance check"}</SubmitButton></div>
    </form>
  );
}
