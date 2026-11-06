import { lockWeek, returnReconciliation, startReconciliation, submitReconciliation } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AmountInput } from "@/components/ui/amount-input";
import { SidePanel } from "@/components/ui/side-panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { dstr, etb } from "@/lib/format";
import { isZero, type ReconPayment, type ReconSummary } from "@/lib/reconciliation";

/** While preparing, the statement's two figures can still be corrected. */
export function CorrectStatement({ s }: { s: ReconSummary }) {
  return (
    <SidePanel title="Correct the statement figures" description={`${s.account_label}, week of ${dstr(s.week_start)}.`} trigger={<Button variant="outline" size="sm">Correct the statement figures</Button>}>
      <form action={startReconciliation} className="flex flex-col gap-3">
        <input type="hidden" name="account" value={s.account_id} /><input type="hidden" name="week" value={dstr(s.week_start)} /><input type="hidden" name="return_week" value={s.week_id} />
        <AmountInput name="closing" label="Statement closing balance" defaultValue={Number(s.closing)} required />
        <AmountInput name="deposits" label="Statement deposits" defaultValue={Number(s.deposits)} required />
        <div><SubmitButton>Save statement figures</SubmitButton></div>
      </form>
    </SidePanel>
  );
}

/** The Accountant hands over. Every outstanding payment needs its reason, and a deposit difference needs an explanation. */
export function SendForReview({ s, matched, outstanding, outstandingTotal }: { s: ReconSummary; matched: ReconPayment[]; outstanding: ReconPayment[]; outstandingTotal: number }) {
  const balanced = isZero(s.balance_difference), depositsAgree = isZero(s.deposit_difference);
  return (
    <section className="mb-3 rounded-xl border bg-card p-4">
      <h2 className="mt-0">Send for review</h2>
      {!balanced && <p className="mt-0 text-sm">The balance is out by {etb(s.balance_difference)}. Match the payments or add a line that explains the difference before sending.</p>}
      {balanced && <p className="mt-0 text-sm text-muted-foreground">The balance agrees. The Finance Manager reviews it next.</p>}
      <ConfirmDialog title="Send to the Finance Manager?" description="This reconciliation cannot change after this unless the Finance Manager returns it." confirmLabel="Send for review" cancelLabel="Keep preparing"
        effect={[{ label: "Matched payments", value: matched.length }, { label: "Carrying into next week", value: `${outstanding.length} (${etb(outstandingTotal)})` }, { label: "Deposit difference", value: etb(s.deposit_difference) }]}
        action={submitReconciliation} fields={{ week: s.week_id, revision: String(s.revision) }} trigger={<Button disabled={!balanced}>Send for review</Button>}>
        {outstanding.map((p) => (
          <label className="f" key={p.id}><input type="hidden" name="carry" value={p.id} />Why is {p.request_no} ({p.company}, {etb(p.amount)}) carrying over?<input name={`reason_${p.id}`} required minLength={3} /></label>
        ))}
        {!depositsAgree && <label className="f">Explain the deposit difference<input name="explanation" required /></label>}
      </ConfirmDialog>
    </section>
  );
}

/** The Finance Manager's decision. Locking cannot be undone: it says exactly what will happen. */
export function ReviewDecision({ s, canLock, matched, matchedTotal, outstanding, outstandingTotal }: { s: ReconSummary; canLock: boolean; matched: ReconPayment[]; matchedTotal: number; outstanding: ReconPayment[]; outstandingTotal: number }) {
  return (
    <section className="mb-3 rounded-xl border bg-card p-4">
      <h2 className="mt-0">Review</h2>
      <p className="mt-0 text-sm text-muted-foreground">Sent for review by {s.prepared_by_name}.</p>
      {!canLock && <p className="text-sm">You worked on this reconciliation, so someone else must lock it. You can still return it.</p>}
      <div className="flex flex-wrap gap-2">
        {canLock && (
          <ConfirmDialog title={`Lock the week of ${dstr(s.week_start)}?`} description="A locked week cannot be changed. A correction becomes a new line in the next week." confirmLabel="Lock this week" cancelLabel="Keep reviewing" destructive
            effect={[{ label: "Payments that become Paid", value: `${matched.length} (${etb(matchedTotal)})` }, { label: "Carrying into next week", value: `${outstanding.length} (${etb(outstandingTotal)})` }, { label: "Items that adjust the balance", value: etb(s.adjust_total) }, { label: "Balance difference", value: etb(s.balance_difference) }]}
            action={lockWeek} fields={{ week: s.week_id, revision: String(s.revision) }} trigger={<Button>Lock this week</Button>} />
        )}
        <ConfirmDialog title="Return to the Accountant?" description="The Accountant can change it again. Carry-over reasons are cleared and must be given again." confirmLabel="Return it" cancelLabel="Keep reviewing" action={returnReconciliation} fields={{ week: s.week_id }} trigger={<Button variant="outline">Return to the Accountant</Button>}>
          <label className="f">What needs changing<textarea name="reason" rows={3} required minLength={3} /></label>
        </ConfirmDialog>
      </div>
    </section>
  );
}
