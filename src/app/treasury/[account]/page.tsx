import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, ShortfallChip } from "@/components";
import { startReconciliation, undoTick } from "../../actions";
import { BalanceCheckForm } from "@/components/treasury/balance-check-form";
import { BalanceLog } from "@/components/treasury/balance-log";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { SubmitButton } from "@/components/ui/submit-button";
import { RESERVED_LABEL, SHARED_RESERVED_HINT } from "@/lib/dashboard";
import { withUser } from "@/lib/db";
import { dstr, etb, PAYMENT_METHODS, WEEK_STATUS } from "@/lib/format";
import { requireAccess } from "@/lib/rbac";
import { currentUserId, requireMe } from "@/lib/session";
import { ACCESS_NOTE, accountDetail, outstandingScope, startsTicked, type OutstandingRow } from "@/lib/treasury-screens";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Card = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="mb-3 rounded-xl border bg-card p-4"><h2 className="mt-0">{title}</h2>{children}</section>;
const PaymentLine = ({ p, action }: { p: OutstandingRow; action?: React.ReactNode }) => (
  <li className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm first:border-t-0">
    <span className="min-w-0"><b>{p.request_no}</b> <span className="text-muted-foreground">{p.company}</span>{p.overdue && <Badge variant="destructive" className="ml-2">{p.age_days} days</Badge>}
      <span className="block text-xs text-muted-foreground">{p.payee ?? "Payee not shown"} · {PAYMENT_METHODS[p.method]}</span></span>
    <span className="flex items-center gap-2"><span className="font-semibold tabular-nums">{etb(p.amount)}</span>{action}</span>
  </li>
);

export default async function TreasuryAccount({ params, searchParams }: { params: Promise<{ account: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { account } = await params; const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/treasury");
  if (!UUID.test(account)) notFound();
  // An account this person cannot see does not exist for them. What they get on one they can see comes from the database.
  const d = await withUser(uid, (tx) => accountDetail(tx, account));
  if (!d) notFound();
  const { status: s, facts: a, access } = d, shared = a.companies.length > 1, opening = !s.has_opening;
  const waiting = d.payments.filter((p) => !p.processed_at), ticked = d.payments.filter((p) => p.processed_at && p.method !== "CASH");
  const place = a.account_kind === "CASH" ? "Cash counted" : a.account_kind === "WALLET" ? "Amount in the wallet" : "Amount the bank shows";
  return (
    <>
      <p className="mute mb-2"><Link href="/treasury">Weekly treasury</Link> / {s.account_label}</p>
      <PageHeader title={s.account_label} description={`Week of ${dstr(s.week_start)}, ${WEEK_STATUS[s.status].toLowerCase()}. Legal owner: ${a.owner ?? "none"}.`} action={shared ? <Badge variant="outline">Shared with {a.companies.length - 1} other{a.companies.length === 2 ? "" : "s"}</Badge> : undefined} />
      <Flash sp={sp} />
      <ShortfallChip amount={a.shortfall_amount} />
      <StatGrid>
        <StatTile label="System balance" value={etb(a.current_balance)} hint={shared ? "One balance for every company on this account" : undefined} />
        <StatTile label={RESERVED_LABEL.replace("these accounts", "this account")} value={etb(a.reserved_balance)} hint={shared ? SHARED_RESERVED_HINT.replace("them", "it").replace("Account totals", "The account's total") : undefined} />
        <StatTile label="Available" value={etb(a.available_balance)} hint={`After the minimum buffer of ${etb(a.min_buffer)}`} />
        <StatTile label="Outstanding you can see" value={etb(d.payments.reduce((t, p) => t + Number(p.amount), 0))} hint={`${d.payments.length} payment${d.payments.length === 1 ? "" : "s"}. ${outstandingScope(access, shared)}`} />
      </StatGrid>
      {shared && ACCESS_NOTE[access] && <p className="mute">{ACCESS_NOTE[access]}</p>}

      {s.can_check && (
        // The key starts the form again when the list changes, so ticks always begin from each payment's default.
        <BalanceCheckForm key={waiting.map((p) => p.id).join()} accountId={account} opening={opening} hadOpening={d.hadOpening} fieldLabel={`${place} (ETB)`} previous={Number(a.current_balance)} reserved={Number(a.reserved_balance)} threshold={Number(a.large_deposit_threshold)}
          payments={waiting.map((p) => ({ id: p.id, requestNo: p.request_no, company: p.company, payee: p.payee, method: p.method, amount: Number(p.amount), chequeNo: p.cheque_no, carried: p.carried, overdue: p.overdue, ageDays: p.age_days, startsTicked: startsTicked(p), tickUndone: p.tick_undone }))} />
      )}
      {!s.can_check && waiting.length > 0 && <Card title="Outstanding payments"><ul className="m-0 list-none p-0">{waiting.map((p) => <PaymentLine key={p.id} p={p} />)}</ul></Card>}
      {ticked.length > 0 && (
        <Card title="Ticked as processed, not yet on a statement">
          <ul className="m-0 list-none p-0">{ticked.map((p) => (
            <PaymentLine key={p.id} p={p} action={s.can_check && (
              <ConfirmDialog title={`Undo the tick on ${p.request_no}?`} description="This payment stays unticked on later balance checks until someone ticks it again. The balance does not change until the next check." confirmLabel="Undo tick" cancelLabel="Keep it"
                action={undoTick} fields={{ id: p.id, account }} trigger={<Button variant="outline" size="sm">Undo tick</Button>}>
                <label className="f">Reason<textarea name="reason" rows={2} required minLength={3} /></label>
              </ConfirmDialog>)} />
          ))}</ul>
        </Card>
      )}

      <Card title="Weeks">
        {d.weeks.length === 0 ? <p className="m-0 text-sm text-muted-foreground">No weeks yet.</p> : (
          <ul className="m-0 list-none p-0">{d.weeks.map((w) => (
            <li key={w.id} className="flex flex-wrap items-end justify-between gap-3 border-t py-2 text-sm first:border-t-0">
              <span>{dstr(w.week_start)}, {w.status === "OPEN" ? WEEK_STATUS.OPEN.toLowerCase() : <Link href={`/treasury/week/${w.id}`}>{WEEK_STATUS[w.status].toLowerCase()}</Link>}</span>
              {w.status === "OPEN" && w.opening_entry_id && s.can_prepare && (
                <form action={startReconciliation} className="flex flex-wrap items-end gap-2"><input type="hidden" name="account" value={account} /><input type="hidden" name="week" value={dstr(w.week_start)} />
                  <label className="f">Statement closing balance<input name="closing" type="number" step="0.01" min="0" required /></label><label className="f">Statement deposits<input name="deposits" type="number" step="0.01" min="0" required /></label>
                  <SubmitButton variant="outline">Start reconciliation</SubmitButton></form>
              )}
            </li>
          ))}</ul>
        )}
      </Card>
      <Card title="Balance log"><BalanceLog entries={d.log} access={access} limit={100} /></Card>
    </>
  );
}
