import Link from "next/link";
import { deactivateAccount, reactivateAccount } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DEACTIVATION_REASONS, dstr, dtime, etb, STATUS_SHORT, WEEK_STATUS } from "@/lib/format";
import type { AccountCommitment, AccountRow } from "@/lib/treasury-screens";

const sumOf = (list: AccountCommitment[]) => list.reduce((s, x) => s + Math.round(Number(x.amount ?? 0) * 100), 0) / 100;

/** The counts a person needs before deciding: what holds, used or will use the account. */
export function commitmentSummary(list: AccountCommitment[]) {
  const req = list.filter((x) => x.kind === "REQUEST");
  const reserved = req.filter((x) => x.state === "RESERVED" || x.state === "VERIFIED"), unpaid = req.filter((x) => x.state === "AUTHENTICATED"), scheduled = req.filter((x) => x.state === "SCHEDULED");
  return {
    reserved, unpaid, scheduled, recurring: list.filter((x) => x.kind === "RECURRING"), reconciling: list.filter((x) => x.kind === "RECONCILIATION"),
    reservedTotal: sumOf(reserved), unpaidTotal: sumOf(unpaid), any: list.length > 0,
  };
}

const itemLink = (x: AccountCommitment) => (x.kind === "REQUEST" ? `/requests/${x.item_id}` : x.kind === "RECURRING" ? "/recurring" : `/treasury/week/${x.item_id}`);
const dateText = (x: AccountCommitment) => (!x.on_date ? "" : x.kind === "RECURRING" ? ` · next ${dstr(x.on_date)}` : x.kind === "REQUEST" ? ` · scheduled for ${dstr(x.on_date)}` : "");
const itemState = (x: AccountCommitment) => (x.kind === "REQUEST" ? STATUS_SHORT[x.state] ?? x.state : x.kind === "RECURRING" ? "Recurring, on" : WEEK_STATUS[x.state] ?? x.state);

/** Everything outstanding on the account, each linked to where it is dealt with. */
export function CommitmentList({ items }: { items: AccountCommitment[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((x) => (
        <li key={`${x.kind}-${x.item_id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-3 text-sm">
          <span className="min-w-0"><Link href={itemLink(x)}><b>{x.label}</b></Link>{x.company && <span className="text-muted-foreground"> · {x.company}</span>}
            <span className="block text-xs text-muted-foreground">{itemState(x)}{dateText(x)}</span></span>
          {x.amount !== null && <span className="font-semibold tabular-nums">{etb(x.amount)}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Status, the reason it is inactive, what needs attention, its history, and for the owner's managers the action that changes it. */
export function AccountStatus({ a }: { a: AccountRow }) {
  const s = commitmentSummary(a.commitments);
  const effect = [
    { label: "Reserved, waiting for approval", value: `${s.reserved.length} (${etb(s.reservedTotal)})` },
    { label: "Authenticated, not yet paid", value: `${s.unpaid.length} (${etb(s.unpaidTotal)})` },
    { label: "Scheduled", value: s.scheduled.length },
    { label: "Recurring payments on", value: s.recurring.length },
    { label: "Reconciliations in progress", value: s.reconciling.length },
  ];
  return (
    <section className="mt-4" aria-label="Account status">
      <h3 className="m-0 mb-2 text-base">Status</h3>
      <p className="m-0 text-sm">{a.is_active ? <Badge variant="outline">Active</Badge> : <Badge variant="destructive">Inactive</Badge>}
        {!a.is_active && <span className="ml-2">{a.deactivated_at ? `since ${dtime(a.deactivated_at)}` : "since before reasons were recorded"}</span>}</p>
      {!a.is_active && (
        <div className="mt-2 rounded-md border bg-card p-3 text-sm">
          <div><span className="text-muted-foreground">Reason: </span>{a.deactivation_reason ? DEACTIVATION_REASONS[a.deactivation_reason] ?? a.deactivation_reason : "Not recorded"}</div>
          {a.deactivation_note && <div className="mt-1"><span className="text-muted-foreground">Explanation: </span>{a.deactivation_note}</div>}
          <p className="m-0 mt-2 text-muted-foreground">No new payment request, reservation, approval, scheduled submission or balance check can use this account. Its balance and reserved funds are shown as they were last recorded.</p>
        </div>
      )}
      {!a.is_active && s.any && (
        <div role="alert" className="note bad mt-2">
          <b>{a.commitments.length} item{a.commitments.length === 1 ? "" : "s"} on this account need{a.commitments.length === 1 ? "s" : ""} attention.</b> They were left exactly as they were: nothing was cancelled or released.
          {s.reserved.length > 0 && <div className="mt-1">{s.reserved.length} request{s.reserved.length === 1 ? " holds" : "s hold"} {etb(s.reservedTotal)} in reserved funds. Return or cancel them to release the funds, or wait for the account to be reactivated.</div>}
          {s.unpaid.length > 0 && <div className="mt-1">{s.unpaid.length} authenticated payment{s.unpaid.length === 1 ? "" : "s"} ({etb(s.unpaidTotal)}) {s.unpaid.length === 1 ? "is" : "are"} not paid yet. Do not send {s.unpaid.length === 1 ? "it" : "them"} from this account.</div>}
          {s.scheduled.length > 0 && <div className="mt-1">Scheduled requests will not be submitted; they must be scheduled again after the account is back in use.</div>}
        </div>
      )}
      {!a.is_active && s.any && <div className="mt-2"><CommitmentList items={a.commitments} /></div>}

      {a.can_manage && a.is_active && (
        <div className="mt-3">
          <ConfirmDialog title={`Deactivate ${a.account_label}?`} destructive confirmLabel="Deactivate account" cancelLabel="Keep it active"
            description={s.any
              ? "This takes effect at once. The items below stay as they are: nothing is cancelled, reversed or released, and Finance Managers are told to review them. Nothing new can use the account until it is reactivated."
              : "This takes effect at once. Nothing new can use the account until it is reactivated. Its history stays as it is."}
            effect={s.any ? effect : undefined} action={deactivateAccount} fields={{ account: a.id }} trigger={<Button variant="outline" size="sm">Deactivate account</Button>}>
            <label className="f">Why is it being deactivated?
              <select name="reason" required defaultValue=""><option value="" disabled>Choose a reason</option>{Object.entries(DEACTIVATION_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <label className="f">Explanation <span className="text-xs font-normal text-muted-foreground">(required for Other)</span><textarea name="note" rows={2} maxLength={1000} /></label>
          </ConfirmDialog>
        </div>
      )}
      {a.can_manage && !a.is_active && (
        <div className="mt-3">
          <ConfirmDialog title={`Reactivate ${a.account_label}?`} confirmLabel="Reactivate account" cancelLabel="Keep it inactive"
            description="New requests, reservations and approvals can use the account again. Nothing waiting on it is submitted, approved, released or rescheduled automatically."
            action={reactivateAccount} fields={{ account: a.id }} trigger={<Button variant="outline" size="sm">Reactivate account</Button>}>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="restored" required className="mt-1" />The bank or provider has restored this account and it can be used for payments again.</label>
            <label className="f">Note (optional)<textarea name="note" rows={2} maxLength={1000} /></label>
          </ConfirmDialog>
        </div>
      )}

      {a.statusHistory.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Status history ({a.statusHistory.length})</summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
            {a.statusHistory.map((h) => (
              <li key={h.id}><b>{h.action === "DEACTIVATED" ? "Deactivated" : "Reactivated"}</b> by {h.actor_name} on {dtime(h.occurred_at)}
                {h.reason && <span className="text-muted-foreground"> · {DEACTIVATION_REASONS[h.reason] ?? h.reason}</span>}{h.note && <span className="text-muted-foreground"> · {h.note}</span>}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
