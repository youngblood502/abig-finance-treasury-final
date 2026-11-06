import Link from "next/link";
import { Flash } from "@/components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { companyScope } from "@/lib/company-scope";
import { withUser } from "@/lib/db";
import { addisDate, dstr, etb, etbOrBlank } from "@/lib/format";
import { requireAccess } from "@/lib/rbac";
import { byOwner, isZero, mondayOf, overviewWeeks, partialFigures, reconStage, STAGE_LABEL, weekOverview, type WeekOverviewRow } from "@/lib/reconciliation";
import { currentUserId, requireMe } from "@/lib/session";

const COLUMNS: DataColumn[] = [
  { key: "account", header: "Account", primary: true, sortable: true }, { key: "opening", header: "Opening", align: "right" }, { key: "payments", header: "Payments", align: "right" },
  { key: "implied", header: "Implied deposits", align: "right" }, { key: "balance", header: "Current balance (today)", align: "right", sortable: true }, { key: "status", header: "Reconciliation" },
];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A figure that may be incomplete says so beside the figure, so it cannot be read as the whole week. */
const Partial = ({ children }: { children: React.ReactNode }) => <><Badge variant="warning" className="mr-2">Partial</Badge>{children}</>;

function cells(r: WeekOverviewRow) {
  const stage = reconStage({ status: r.status, prepared_at: r.prepared_at, return_reason: r.return_reason }, r.access), partial = partialFigures(r);
  return {
    account: <><Link href={`/treasury/${r.account_id}`}>{r.account_label}</Link>{r.shared && <Badge variant="outline" className="ml-2">Shared</Badge>}</>,
    opening: partial.opening ? <Partial>Not available</Partial> : r.opening === null ? <Badge variant="warning">Not recorded</Badge> : etb(r.opening),
    payments: <>{partial.payments ? <Partial>{etb(r.payments)}</Partial> : etb(r.payments)}<span className="block text-xs text-muted-foreground">{partial.payments ? "At least " : ""}{r.payment_count} payment{r.payment_count === 1 ? "" : "s"}{r.access === "NONE" ? ", your company" : ""}</span></>,
    implied: r.access === "NONE" ? <span className="text-muted-foreground">Not shown</span> : partial.implied ? <Partial>{etbOrBlank(r.implied)}</Partial> : etbOrBlank(r.implied),
    balance: etb(r.current_balance),
    status: <>{r.week_id && stage !== "open" ? <Link href={`/treasury/week/${r.week_id}`}>{STAGE_LABEL[stage]}</Link> : STAGE_LABEL[stage]}{stage !== "open" && r.access === "FULL" && !isZero(r.balance_difference) && <Badge variant="warning" className="ml-2">Out by {etb(r.balance_difference)}</Badge>}</>,
  };
}

export default async function WeekOverview({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/treasury");
  const company = await companyScope(uid), thisWeek = mondayOf(addisDate());
  const week = sp.week && DAY.test(sp.week) && !Number.isNaN(Date.parse(sp.week)) ? mondayOf(sp.week) : thisWeek;
  const d = await withUser(uid, async (tx) => ({ rows: await weekOverview(tx, company, week), weeks: await overviewWeeks(tx, company) }));
  const choices = [...new Set([thisWeek, week, ...d.weeks])].sort().reverse();
  const anyLimited = d.rows.some((r) => r.access === "NONE"), anyPartial = d.rows.some((r) => r.truncated);
  return (
    <>
      <p className="mute mb-2"><Link href="/treasury">Weekly treasury</Link> / Week overview</p>
      <PageHeader title="Week overview" description={`Week of ${dstr(week)}, by the company that owns each account.`} />
      <Flash sp={sp} />
      <form method="get" className="mb-3 flex flex-wrap items-end gap-2" aria-label="Choose a week">
        <label className="f">Week of<select name="week" defaultValue={week}>{choices.map((w) => <option key={w} value={w}>{dstr(w)}</option>)}</select></label>
        <Button type="submit" variant="outline">Show week</Button>
      </form>
      {anyPartial && <p role="note" className="mb-3 rounded-md border bg-card p-3 text-sm"><Badge variant="warning" className="mr-2">Partial</Badge>This page reads only the latest 100 balance log entries for each account. Figures marked Partial may leave out earlier entries from this week, so they are not the week&apos;s totals.</p>}
      {d.rows.length === 0 && <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">No accounts are available to you.</p>}
      {byOwner(d.rows).map((g) => (
        <section key={g.owner} className="mb-3"><h2>{g.owner}</h2>
          <div className="rounded-xl border bg-card p-4"><DataTable caption={`${g.owner}: accounts this week`} columns={COLUMNS} rows={g.accounts.map((r): DataRow => ({ id: r.account_id, sort: { account: r.account_label, balance: Number(r.current_balance) }, cells: cells(r) }))} pageSize={25} /></div>
        </section>
      ))}
      {anyLimited && <p className="mute">On an account your company shares, you see the balance, your own company&apos;s payments and the reconciliation&apos;s status.</p>}
    </>
  );
}
