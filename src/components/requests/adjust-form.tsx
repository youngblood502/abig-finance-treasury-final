"use client";
import { useState } from "react";
import { adjustRequest } from "@/app/actions";
import { AmountInput } from "@/components/ui/amount-input";
import { SubmitButton } from "@/components/ui/submit-button";
import { etb } from "@/lib/format";

export interface AdjustFormProps {
  id: string; version: number; priority: string; invoiceRef: string; description: string; totalAmount: number;
  installments: { seq: number; dueDate: string; amount: number }[];
}

/** The review's corrections. It posts what adjustRequest has always read; the total is the sum of the rows, so the two cannot disagree. */
export function AdjustForm({ id, version, priority, invoiceRef, description, totalAmount, installments }: AdjustFormProps) {
  const [amounts, setAmounts] = useState(installments.map((i) => String(i.amount)));
  const total = amounts.reduce((s, a) => s + (Number(a) || 0), 0);
  return (
    <form action={adjustRequest} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="version" value={version} />
      <input type="hidden" name="orig_priority" value={priority} /><input type="hidden" name="orig_invoice_ref" value={invoiceRef} /><input type="hidden" name="orig_description" value={description} />
      <input type="hidden" name="orig_total_amount" value={totalAmount} /><input type="hidden" name="total_amount" value={total} />
      <p className="m-0 text-sm text-muted-foreground">Changing an amount sends the request back to verification. Every change is recorded with your reason.</p>
      <label className="f">Priority<select name="priority" defaultValue={priority}><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></label>
      <label className="f">Invoice reference<input name="invoice_ref" defaultValue={invoiceRef} /></label>
      <label className="f">Notes<textarea name="description" rows={2} defaultValue={description} /></label>
      {installments.map((inst, i) => (
        <div key={inst.seq} className="grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="seq" value={inst.seq} /><input type="hidden" name="o_amount" value={inst.amount} /><input type="hidden" name="o_due" value={inst.dueDate} />
          <AmountInput name="i_amount" label={`Installment ${inst.seq} amount`} value={amounts[i]} onChange={(v) => setAmounts((p) => p.map((x, j) => (j === i ? v : x)))} required />
          <label className="f">Installment {inst.seq} due date<input name="i_due" type="date" defaultValue={inst.dueDate} required /></label>
        </div>
      ))}
      <div className="rounded-md border bg-card p-3 text-sm">New total: <b>{etb(total)}</b> (was {etb(totalAmount)})</div>
      <label className="f">Reason (required)<textarea name="reason" rows={2} required minLength={3} /></label>
      <div><SubmitButton>Save adjustment</SubmitButton></div>
    </form>
  );
}
