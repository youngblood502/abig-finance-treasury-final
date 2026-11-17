import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components";
import { CorrectStatement, ReviewDecision, SendForReview } from "@/components/treasury/recon-actions";
import { DifferenceCard, OtherLines, PaymentColumns } from "@/components/treasury/recon-parts";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { withUser } from "@/lib/db";
import { addisDate, dstr, dtime } from "@/lib/format";
import { requireAccess } from "@/lib/rbac";
import { defaultStatementDate, paymentColumns, reconciliationWeek, reconOffers, STAGE_LABEL } from "@/lib/reconciliation";
import { currentUserId, requireMe } from "@/lib/session";
import type { AccessLevel } from "@/lib/treasury-screens";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITED: Record<AccessLevel, string | null> = {
  FULL: null,
  TICK: "The company that owns this account reconciles it. You see the week's status and every payment, but not other companies' payees or references, or the statement's figures.",
  NONE: "The company that owns this account reconciles it. You see the week's status and your own company's payments.",
};

export default async function Reconciliation({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params; const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/treasury");
  if (!UUID.test(id)) notFound();
  // A week this person cannot see does not exist for them. What they get on one they can see comes from the database.
  const d = await withUser(uid, (tx) => reconciliationWeek(tx, id, me.id));
  if (!d) notFound();
  const { summary: s, access } = d, full = access === "FULL", offers = reconOffers(s, access, me.id, d.workedOn), locked = offers.stage === "locked", started = offers.stage !== "open";
  const columns = paymentColumns(d.payments);
  return (
    <>
      <p className="mute mb-2"><Link href="/treasury">Weekly treasury</Link> / <Link href={`/treasury/${s.account_id}`}>{s.account_label}</Link> / Week of {dstr(s.week_start)}</p>
      <PageHeader title={`Reconciliation: ${s.account_label}`} description={`Week of ${dstr(s.week_start)}.`} action={<Badge variant={locked ? "outline" : offers.stage === "returned" ? "warning" : "default"}>{STAGE_LABEL[offers.stage]}</Badge>} />
      <Flash sp={sp} />
      {LIMITED[access] && <p className="mute">{LIMITED[access]}</p>}
      {s.return_reason && <p className="mb-3 rounded-md border bg-card p-3 text-sm"><Badge variant="warning" className="mr-2">Returned</Badge>{s.return_reason}</p>}
      {full && locked && <p className="mb-3 rounded-md border bg-card p-3 text-sm">Locked by {s.locked_by_name} on {dtime(s.locked_at)}, after {s.prepared_by_name} prepared it. This week cannot be changed. A correction is a new line in the next week.</p>}
      {full && offers.stage === "review" && !offers.review && <p className="mb-3 rounded-md border bg-card p-3 text-sm">Sent for review by {s.prepared_by_name} on {dtime(s.prepared_at)}. It cannot change unless the Finance Manager returns it.</p>}
      {!started && <p className="mb-3 rounded-md border bg-card p-3 text-sm">This reconciliation has not started. {full ? <>Enter the statement figures on <Link href={`/treasury/${s.account_id}`}>the account page</Link>.</> : null}</p>}

      {full && started && (
        <div className="mb-3 grid gap-3 lg:grid-cols-2">
          <DifferenceCard title="Balance difference" value={s.balance_difference} zeroText="The balance agrees with the statement." otherText="This must be zero before the week can be sent."
            lines={[{ label: "Statement closing balance", value: s.closing }, { label: "Less payments not on the statement", value: s.unmatched_total }, { label: "Less system balance", value: s.system_balance }, { label: "Less items that adjust the balance", value: s.adjust_total }]} />
          <DifferenceCard title="Deposit difference" value={s.deposit_difference} zeroText="Deposits agree with the balance checks." otherText="This can stay if it is explained." note={s.deposit_explanation}
            lines={[{ label: "Statement deposits", value: s.deposits }, { label: "Less implied deposits this week", value: s.implied_total }, { label: "Plus items a check already picked up", value: s.known_total }]} />
        </div>
      )}
      {offers.prepare && <div className="mb-3"><CorrectStatement s={s} /></div>}

      <h2>Payments</h2>
      <PaymentColumns week={id} weekStart={s.week_start} {...columns} prepare={offers.prepare} statementDate={defaultStatementDate(addisDate(), s.week_start)} locked={locked} />
      {full && started && <OtherLines week={id} lines={d.lines} prepare={offers.prepare} />}

      {offers.prepare && <SendForReview s={s} matched={columns.matched} outstanding={columns.outstanding} outstandingTotal={columns.outstandingTotal} />}
      {offers.review && <ReviewDecision s={s} canLock={offers.lock} matched={columns.matched} matchedTotal={columns.matchedTotal} outstanding={columns.outstanding} outstandingTotal={columns.outstandingTotal} />}
    </>
  );
}
