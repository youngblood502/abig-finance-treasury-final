import Link from "next/link";
import { Flash, ShortfallChip } from "@/components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { StatusBadge } from "@/components/ui/status-badge";
import { companyScope } from "@/lib/company-scope";
import { RESERVED_LABEL, SHARED_RESERVED_HINT } from "@/lib/dashboard";
import { withUser } from "@/lib/db";
import { addisDate, ageSince, dstr, etb, WEEK_STATUS } from "@/lib/format";
import { requireAccess } from "@/lib/rbac";
import { currentUserId, requireMe } from "@/lib/session";
import { DUE_OPTIONS, dueBucket, outstandingScope, paymentSchedule, treasuryOverview } from "@/lib/treasury-screens";

const ACCOUNTS: DataColumn[] = [
  { key: "account", header: "Account", primary: true, sortable: true }, { key: "opening", header: "Opening" }, { key: "last", header: "Last figure", sortable: true }, { key: "balance", header: "System balance", align: "right", sortable: true },
  { key: "reserved", header: "Reserved on account", align: "right", sortable: true }, { key: "available", header: "Available", align: "right", sortable: true }, { key: "outstanding", header: "Outstanding", sortable: true }, { key: "status", header: "Week" },
];
const SCHEDULE: DataColumn[] = [
  { key: "due", header: "Due", primary: true, sortable: true }, { key: "request", header: "Request", sortable: true }, { key: "company", header: "Company", sortable: true }, { key: "payee", header: "Payee", sortable: true },
  { key: "account", header: "Debit account", sortable: true }, { key: "amount", header: "Amount", align: "right", sortable: true }, { key: "status", header: "Status" },
];

export default async function Treasury({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/treasury");
  const company = await companyScope(uid), now = new Date(), today = addisDate(now);
  const d = await withUser(uid, async (tx) => ({ accounts: await treasuryOverview(tx, company), schedule: await paymentSchedule(tx, company) }));
  const noOpening = d.accounts.filter((a) => a.can_check && !a.has_opening), shortfall = d.accounts.filter((a) => Number(a.shortfall_amount) > 0);
  const sum = <T,>(list: T[], f: (x: T) => number) => list.reduce((s, x) => s + f(x), 0);
  const anyShared = d.accounts.some((a) => a.shared), overdue = sum(d.accounts, (a) => a.overdue_count);

  const accountRows: DataRow[] = d.accounts.map((a) => ({
    id: a.account_id, search: a.account_label, sort: { account: a.account_label, last: a.last_figure_at?.getTime() ?? "", balance: Number(a.current_balance), reserved: Number(a.reserved_balance), available: Number(a.available_balance), outstanding: Number(a.outstanding_amount) },
    cells: {
      account: <><Link href={`/treasury/${a.account_id}`}>{a.account_label}</Link>{a.shared && <Badge variant="outline" className="ml-2">Shared</Badge>}<ShortfallChip amount={a.shortfall_amount} /></>,
      opening: a.has_opening ? "Recorded" : <Badge variant="warning">Not recorded</Badge>, last: a.last_figure_at ? ageSince(a.last_figure_at, now) : "Never",
      balance: etb(a.current_balance), reserved: etb(a.reserved_balance), available: etb(a.available_balance),
      outstanding: <>{a.outstanding_count} ({etb(a.outstanding_amount)}){a.overdue_count > 0 && <Badge variant="destructive" className="ml-2">{a.overdue_count} over 14 days</Badge>}<span className="block text-xs text-muted-foreground">{outstandingScope(a.access, a.shared)}</span></>,
      status: a.week_id && a.status !== "OPEN" ? <Link href={`/treasury/week/${a.week_id}`}>{WEEK_STATUS[a.status]}</Link> : WEEK_STATUS[a.status],
    },
  }));
  const scheduleRows: DataRow[] = d.schedule.map((s) => ({
    id: `${s.request_id}-${s.seq}`, search: `${s.request_no} ${s.company} ${s.payee ?? ""}`, filters: { when: dueBucket(s.due_date, today) },
    sort: { due: s.due_date, request: s.request_no, company: s.company, payee: s.payee ?? "", account: s.account_label ?? "", amount: Number(s.amount) },
    cells: {
      due: <>{dstr(s.due_date)}{dueBucket(s.due_date, today) === "overdue" && <Badge variant="destructive" className="ml-2">Overdue</Badge>}</>, request: <Link href={`/requests/${s.request_id}`}>{s.request_no}</Link>, company: s.company, payee: s.payee,
      account: s.account_id ? <Link href={`/treasury/${s.account_id}`}>{s.account_label}</Link> : "None yet", amount: etb(s.amount), status: <StatusBadge state={s.workflow_state} />,
    },
  }));
  return (
    <>
      <PageHeader title="Weekly treasury" description="Each account's week, and what falls due. Weeks run Monday to Sunday." action={<Button asChild variant="outline"><Link href="/treasury/overview">Week overview</Link></Button>} />
      <Flash sp={sp} />
      <StatGrid>
        <StatTile label="Accounts with no opening" value={noOpening.length} tone={noOpening.length > 0 ? "warning" : "default"} />
        <StatTile label="Outstanding payments you can see" value={etb(sum(d.accounts, (a) => Number(a.outstanding_amount)))} hint={`${sum(d.accounts, (a) => a.outstanding_count)} authenticated, not yet Paid`} tone={overdue > 0 ? "destructive" : "default"} />
        <StatTile label={RESERVED_LABEL} value={etb(sum(d.accounts, (a) => Number(a.reserved_balance)))} hint={anyShared ? SHARED_RESERVED_HINT : undefined} />
        <StatTile label="Accounts in shortfall" value={shortfall.length} hint={shortfall.length > 0 ? `${etb(sum(shortfall, (a) => Number(a.shortfall_amount)))} in total` : undefined} tone={shortfall.length > 0 ? "destructive" : "default"} />
      </StatGrid>
      {anyShared && <p className="mute">Balances and reservations are each account&apos;s whole figure, shared by every company on it. Outstanding payments show only what you may see, as noted on each account.</p>}

      <section><h2>Accounts this week</h2>
        <div className="rounded-xl border bg-card p-4"><DataTable caption="Accounts this week" columns={ACCOUNTS} rows={accountRows} pageSize={20} searchable={d.accounts.length > 8} emptyMessage="No accounts are available to you." /></div>
      </section>
      <section><h2>Falling due</h2>
        <p className="mute">Installments on requests that hold funds, due within 30 days or overdue. These are the requests you can see, so a shared account may have others.</p>
        <div className="rounded-xl border bg-card p-4"><DataTable caption="Falling due" columns={SCHEDULE} rows={scheduleRows} pageSize={20} filters={[{ key: "when", label: "When", options: DUE_OPTIONS }]} emptyMessage="Nothing is falling due."
          totals={{ due: "Total" }} sumColumns={["amount"]} /></div>
      </section>
    </>
  );
}
