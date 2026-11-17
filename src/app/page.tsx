import Link from "next/link";
import { Flash, ShortfallChip } from "@/components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { companyScope, myCompanies } from "@/lib/company-scope";
import { accountRows, approvalQueue, cashByCompany, dashboardSections, ownerCashHint, ownerCashLabel, OWNER_CASH_NOTE, requestCounts, requestsTitle, RESERVED_LABEL, returnedDrafts, scopeName, SHARED_REQUESTS_NOTE, SHARED_RESERVED_HINT, weekOutflow, weekRows, type QueueRow } from "@/lib/dashboard";
import { withUser } from "@/lib/db";
import { accountPlace, ageSince, dtime, etb } from "@/lib/format";
import { currentUserId, requireMe } from "@/lib/session";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => <section><h2>{title}</h2>{children}</section>;
const Panel = ({ children }: { children: React.ReactNode }) => <div className="mb-3 rounded-xl border bg-card p-4">{children}</div>;

const QUEUE_COLUMNS: DataColumn[] = [
  { key: "request", header: "Request", primary: true, sortable: true }, { key: "company", header: "Company", sortable: true }, { key: "payee", header: "Payee", sortable: true },
  { key: "amount", header: "Amount", align: "right", sortable: true }, { key: "waiting", header: "Waiting", sortable: true },
];
const queueTable = (list: QueueRow[], caption: string, now: Date) => {
  const rows: DataRow[] = list.map((r) => ({
    id: r.request_id, sort: { request: r.request_no, company: r.company, payee: r.payee ?? "", amount: Number(r.total_amount), waiting: r.waiting_since.getTime() },
    cells: { request: <Link href={`/requests/${r.request_id}`}>{r.request_no}</Link>, company: r.company, payee: r.payee, amount: etb(r.total_amount), waiting: ageSince(r.waiting_since, now) },
  }));
  return <DataTable caption={caption} columns={QUEUE_COLUMNS} rows={rows} pageSize={10} emptyMessage="Nothing is waiting for you." />;
};

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  const company = await companyScope(uid), show = dashboardSections(me), now = new Date(), companyName = scopeName(company, await myCompanies(uid));
  // Everything is read through row-level security, so each person sees only the companies and accounts they belong to.
  const d = await withUser(uid, async (tx) => ({
    accounts: show.cash ? await accountRows(tx, company) : [],
    weeks: show.prepare ? await weekRows(tx, company) : [],
    counts: show.requests ? await requestCounts(tx, company) : [],
    queue: show.verify || show.authenticate ? await approvalQueue(tx, company) : [],
    returned: show.prepare ? await returnedDrafts(tx, company) : [],
    cash: show.authenticate ? await cashByCompany(tx, company) : [],
    outflow: show.authenticate ? await weekOutflow(tx, company) : null,
  }));
  const count = (s: string) => d.counts.find((c) => c.state === s), n = (s: string) => count(s)?.n ?? 0, amount = (s: string) => Number(count(s)?.amount ?? 0);
  const active = d.accounts.filter((a) => a.is_active);
  const total = (k: "current_balance" | "reserved_balance" | "available_balance") => active.reduce((t, a) => t + Number(a[k]), 0);
  const shortfall = active.filter((a) => Number(a.shortfall_amount) > 0), hasShared = active.some((a) => a.companies.length > 1);
  const toCheck = d.weeks.filter((w) => w.can_check), noOpening = toCheck.filter((w) => !w.has_opening);
  const outstanding = d.weeks.reduce((t, w) => t + w.outstanding_count, 0), overdue = d.weeks.reduce((t, w) => t + w.overdue_count, 0);
  const verifying = d.queue.filter((q) => q.stage === "VERIFICATION"), authenticating = d.queue.filter((q) => q.stage === "AUTHORIZATION");

  const accountColumns: DataColumn[] = [
    { key: "account", header: "Account", primary: true, sortable: true }, { key: "companies", header: "Companies" }, { key: "current", header: "Current", align: "right", sortable: true },
    { key: "reserved", header: "Reserved", align: "right", sortable: true }, { key: "available", header: "Available", align: "right", sortable: true }, { key: "updated", header: "Updated", sortable: true },
  ];
  const accountTable: DataRow[] = d.accounts.map((a) => ({
    id: a.id, sort: { account: a.account_label, current: Number(a.current_balance), reserved: Number(a.reserved_balance), available: Number(a.available_balance), updated: a.balance_updated_at?.getTime() ?? "" },
    cells: {
      account: <><b>{a.account_label}</b><div className="text-xs font-normal text-muted-foreground">{accountPlace({ account_kind: a.account_kind, bank_name: a.bank_name, account_last4: a.account_last4, wallet_phone: a.wallet_phone })}{!a.is_active && " · inactive"}</div><ShortfallChip amount={a.shortfall_amount} /></>,
      companies: <span className="flex flex-wrap gap-1">{a.companies.map((c) => <Badge variant="outline" key={c}>{c}</Badge>)}</span>,
      current: etb(a.current_balance), reserved: etb(a.reserved_balance), available: <b>{etb(a.available_balance)}</b>,
      updated: a.balance_updated_at ? dtime(a.balance_updated_at) : <Badge variant="warning">No balance entered</Badge>,
    },
  }));
  const checkColumns: DataColumn[] = [
    { key: "account", header: "Account", primary: true, sortable: true }, { key: "opening", header: "This week's opening" }, { key: "last", header: "Last figure", sortable: true }, { key: "outstanding", header: "Outstanding", align: "right", sortable: true },
  ];
  const checkTable: DataRow[] = toCheck.map((w) => ({
    id: w.account_id, sort: { account: w.account_label, last: w.last_figure_at?.getTime() ?? "", outstanding: w.outstanding_count },
    cells: {
      account: <Link href={`/treasury/${w.account_id}`}>{w.account_label}</Link>,
      opening: w.has_opening ? "Recorded" : <Badge variant="warning">Not recorded</Badge>,
      last: w.last_figure_at ? ageSince(w.last_figure_at, now) : "Never",
      outstanding: <>{w.outstanding_count}{w.overdue_count > 0 && <Badge variant="destructive" className="ml-2">{w.overdue_count} over 14 days</Badge>}</>,
    },
  }));

  return (
    <>
      <PageHeader title="Dashboard" description="What needs attention, and where the cash is."
        action={show.newRequest ? <Button asChild><Link href="/requests/new">New payment request</Link></Button> : undefined} />
      <Flash sp={sp} />

      {show.prepare && (
        <Section title="Your week">
          <StatGrid>
            <StatTile label="Accounts with no opening" value={noOpening.length} tone={noOpening.length > 0 ? "warning" : "default"} href="/treasury" />
            <StatTile label="Outstanding payments" value={outstanding} hint="Authenticated, not yet Paid" tone={overdue > 0 ? "destructive" : "default"} href="/treasury" />
            <StatTile label="Outstanding 14 days or more" value={overdue} tone={overdue > 0 ? "destructive" : "default"} href="/treasury" />
            <StatTile label="Your drafts" value={n("DRAFT")} href="/requests?state=DRAFT" />
            <StatTile label="Returned to you" value={d.returned.length} tone={d.returned.length > 0 ? "warning" : "default"} href="/requests?state=DRAFT" />
          </StatGrid>
          {d.returned.length > 0 && <Panel><b>Returned requests</b>
            <ul className="m-0 mt-2 list-none p-0">{d.returned.map((r) => <li key={r.id} className="border-t py-2 text-sm first:border-t-0"><Link href={`/requests/${r.id}/edit`}>{r.request_no}</Link> <span className="text-muted-foreground">({etb(r.total_amount)}, {ageSince(r.returned_at, now)})</span><div>{r.reason}</div></li>)}</ul></Panel>}
          {toCheck.length > 0 && <Panel><DataTable caption="Accounts to check" columns={checkColumns} rows={checkTable} pageSize={10} /></Panel>}
        </Section>
      )}

      {show.verify && (
        <Section title="To verify">
          <Panel>{queueTable(verifying, "Requests waiting for verification", now)}</Panel>
          {shortfall.length > 0 && <Panel><b>Accounts in shortfall</b><div className="mt-2 flex flex-col gap-1">{shortfall.map((a) => <div key={a.id} className="text-sm"><Link href="/accounts">{a.account_label}</Link> <ShortfallChip amount={a.shortfall_amount} /></div>)}</div></Panel>}
        </Section>
      )}

      {show.authenticate && (
        <Section title="To authenticate">
          <Panel>{queueTable(authenticating, "Requests waiting for authentication", now)}</Panel>
          <StatGrid>
            <StatTile label="Outflow this week" value={etb(d.outflow?.total)} hint={`${d.outflow?.n ?? 0} authenticated since Monday`} />
            {d.cash.map((c) => <StatTile key={c.company} label={ownerCashLabel(c.company)} value={etb(c.current)} hint={ownerCashHint(c.available)} />)}
          </StatGrid>
          {d.cash.length > 0 && <p className="mute">{OWNER_CASH_NOTE}</p>}
        </Section>
      )}

      {show.cash && (
        <Section title="Cash across your accounts">
          <StatGrid>
            <StatTile label="Current balance" value={etb(total("current_balance"))} />
            <StatTile label={RESERVED_LABEL} value={etb(total("reserved_balance"))} hint={hasShared ? SHARED_RESERVED_HINT : undefined} />
            <StatTile label="Available to reserve" value={etb(total("available_balance"))} hint="After minimum buffers" />
          </StatGrid>
          <p className="mute">{active.length} active account{active.length === 1 ? "" : "s"}; a shared account is counted once.</p>
          <Panel><DataTable caption="Bank accounts" columns={accountColumns} rows={accountTable} pageSize={10} emptyMessage="No bank accounts are available to you."
            totals={{ account: "Total", current: etb(total("current_balance")), reserved: etb(total("reserved_balance")), available: etb(total("available_balance")) }} /></Panel>
        </Section>
      )}

      {show.requests && (
        <Section title={requestsTitle(companyName)}>
          <StatGrid>
            <StatTile label="Requests in review" value={n("RESERVED") + n("VERIFIED")} hint={etb(amount("RESERVED") + amount("VERIFIED"))} href="/requests?state=RESERVED" />
            <StatTile label="Authenticated, not yet Paid" value={n("AUTHENTICATED")} hint={etb(amount("AUTHENTICATED"))} href="/requests?state=AUTHENTICATED" />
            <StatTile label="Paid" value={n("PAID")} hint={etb(amount("PAID"))} href="/requests?state=PAID" />
          </StatGrid>
          {show.cash && hasShared && <p className="mute">{SHARED_REQUESTS_NOTE}</p>}
        </Section>
      )}

      {!show.requests && !show.cash && <Panel>Your role has no dashboard content. Ask an administrator to give you access.</Panel>}
    </>
  );
}
