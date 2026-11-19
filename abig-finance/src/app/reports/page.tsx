import Link from "next/link";
import { ExportButton } from "@/components/ui/export-button";
import { Flash, ShortfallChip } from "@/components";
import { TabLinks } from "@/components/layout/tab-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { StatusBadge } from "@/components/ui/status-badge";
import { companyScope } from "@/lib/company-scope";
import { withUser } from "@/lib/db";
import { accountPlace, dstr, dtime, etb, etbOrBlank, PAYMENT_METHODS, STATE_LABEL, WEEK_STATUS } from "@/lib/format";
import { canAccess, requireAccess } from "@/lib/rbac";
import { AGE_BUCKETS, ageBucket, AUDIT_LIMIT, auditRows, BUCKETS, cashRows, filterQuery, outstandingRows, paymentRows, pendingRows, REPORT_TABS, reportFilters, sumText, taxRows, totalOf, totalsBy, weekRows, type AuditRow, type CashRow, type OutstandingRow, type PaymentRow, type PendingRow, type ReportFilters, type TaxRow, type WeekRow } from "@/lib/reports";
import { percentLabel } from "@/lib/tax";
import { requireMe } from "@/lib/session";

const hidden = <span className="text-muted-foreground">Not shown</span>;
const Totals = ({ title, rows }: { title: string; rows: { label: string; total: number }[] }) => (
  <section className="rounded-xl border bg-card p-4"><h3 className="m-0 mb-2 text-base">{title}</h3>
    {rows.length === 0 ? <p className="m-0 text-sm text-muted-foreground">Nothing yet.</p> : <dl className="m-0">{rows.slice(0, 10).map((r) => <div key={r.label} className="flex justify-between gap-3 py-0.5 text-sm"><dt className="min-w-0 text-muted-foreground">{r.label}</dt><dd className="m-0 tabular-nums">{etb(r.total)}</dd></div>)}</dl>}
  </section>
);
const Panel = ({ children }: { children: React.ReactNode }) => <div className="mb-3 rounded-xl border bg-card p-4">{children}</div>;
/** The export route checks access as before; the button shows "Preparing…" and any error while the file is fetched. */
const Download = ({ kind, query }: { kind: string; query?: string }) => <ExportButton href={`/reports/export/${kind}${query ? `?${query}` : ""}`} />;
function FilterBar({ tab, f, kind, search, payments }: { tab: string; f: ReportFilters; kind: string; search?: string; payments?: boolean }) {
  return (
    <form method="get" action="/reports" className="mb-3 grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter this report">
      <input type="hidden" name="r" value={tab} />
      <label className="f">From<input type="date" name="from" defaultValue={f.from} /></label>
      <label className="f">To<input type="date" name="to" defaultValue={f.to} /></label>
      {search && <label className="f">{search}<input type="search" name="q" defaultValue={f.q ?? ""} /></label>}
      {payments && <label className="f">Method<select name="method" defaultValue={f.method ?? ""}><option value="">All</option>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
      {payments && <label className="f">Status<select name="state" defaultValue={f.state ?? ""}><option value="">All</option><option value="AUTHENTICATED">{STATE_LABEL.AUTHENTICATED}</option><option value="PAID">{STATE_LABEL.PAID}</option></select></label>}
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4"><Button type="submit">Apply filters</Button><Download kind={kind} query={filterQuery(f)} /></div>
    </form>
  );
}

function Pending({ rows }: { rows: PendingRow[] }) {
  const columns: DataColumn[] = [{ key: "request", header: "Request", primary: true, sortable: true }, { key: "company", header: "Company", sortable: true }, { key: "payee", header: "Payee" }, { key: "status", header: "Status" }, { key: "due", header: "Due", sortable: true }, { key: "amount", header: "Amount", align: "right", sortable: true }, { key: "account", header: "Debit account" }];
  const table: DataRow[] = rows.map((r) => ({ id: `${r.request_no}-${r.seq}`, search: `${r.request_no} ${r.company_name} ${r.payee_name ?? ""}`, filters: { bucket: r.bucket }, sort: { request: r.request_no, company: r.company_name, due: r.due_date, amount: Number(r.amount) },
    cells: { request: <>{r.request_no} <span className="text-muted-foreground">#{r.seq}</span></>, company: r.company_name, payee: r.payee_name ?? hidden, status: <StatusBadge state={r.workflow_state} />, due: dstr(r.due_date), amount: etb(r.amount), account: r.account_label ?? "None" } }));
  return (<>
    <StatGrid>{BUCKETS.map((b) => { const inBucket = rows.filter((x) => x.bucket === b); return <StatTile key={b} label={b} value={etb(totalOf(inBucket, (x) => x.amount))} hint={`${inBucket.length} installment${inBucket.length === 1 ? "" : "s"}`} tone={b !== BUCKETS[0] && inBucket.length > 0 ? "warning" : "default"} />; })}</StatGrid>
    <div className="mb-3 grid gap-3 md:grid-cols-2"><Totals title="By company" rows={totalsBy(rows, (r) => r.company_name, (r) => r.amount)} /><Totals title="By payee" rows={totalsBy(rows, (r) => r.payee_name, (r) => r.amount)} /></div>
    <Panel><div className="mb-2 flex justify-end"><Download kind="pending" /></div>
      <DataTable caption="Waiting for payment" columns={columns} rows={table} searchable filters={[{ key: "bucket", label: "When", options: BUCKETS.map((b) => ({ value: b, label: b })) }]} totals={{ request: "Total" }} sumColumns={["amount"]} emptyMessage="Nothing is waiting." /></Panel>
  </>);
}

function Payments({ rows, f }: { rows: PaymentRow[]; f: ReportFilters }) {
  const columns: DataColumn[] = [{ key: "when", header: "Authenticated", primary: true, sortable: true }, { key: "status", header: "Status" }, { key: "method", header: "Method" }, { key: "request", header: "Request", sortable: true }, { key: "company", header: "Company", sortable: true }, { key: "payee", header: "Payee" }, { key: "account", header: "Debit account" }, { key: "amount", header: "Amount", align: "right", sortable: true }, { key: "verified", header: "Verified by" }, { key: "authenticated", header: "Authenticated by" }];
  const table: DataRow[] = rows.map((r) => ({ id: r.request_no, sort: { when: r.authenticated_at.getTime(), request: r.request_no, company: r.company_name, amount: Number(r.amount) },
    cells: { when: dtime(r.authenticated_at), status: <StatusBadge state={r.workflow_state} />, method: PAYMENT_METHODS[r.payment_method], request: r.request_no, company: r.company_name, payee: r.payee_name ?? hidden, account: r.account_label ?? "None", amount: etb(r.amount), verified: r.verified_by ?? hidden, authenticated: r.authenticated_by ?? hidden } }));
  return (<>
    <FilterBar tab="payments" kind="payments" f={f} search="Request, company or payee" payments />
    <StatGrid><StatTile label="Debited in this period" value={etb(totalOf(rows, (r) => r.amount))} hint={`${rows.length} payment${rows.length === 1 ? "" : "s"}`} /><StatTile label="Confirmed Paid" value={etb(totalOf(rows.filter((r) => r.workflow_state === "PAID"), (r) => r.amount))} /><StatTile label="Not yet Paid" value={etb(totalOf(rows.filter((r) => r.workflow_state !== "PAID"), (r) => r.amount))} /></StatGrid>
    <div className="mb-3 grid gap-3 md:grid-cols-2"><Totals title="By company" rows={totalsBy(rows, (r) => r.company_name, (r) => r.amount)} /><Totals title="By method" rows={totalsBy(rows, (r) => PAYMENT_METHODS[r.payment_method], (r) => r.amount)} /></div>
    <Panel><DataTable caption="Payments" columns={columns} rows={table} totals={{ when: "Total" }} sumColumns={["amount"]} emptyMessage="No payments in this period." /></Panel>
  </>);
}

function Tax({ rows, f }: { rows: TaxRow[]; f: ReportFilters }) {
  const columns: DataColumn[] = [{ key: "when", header: "Authenticated", primary: true, sortable: true }, { key: "request", header: "Request", sortable: true }, { key: "company", header: "Company", sortable: true }, { key: "payee", header: "Payee" },
    { key: "rate", header: "VAT rate" }, { key: "before", header: "Before VAT", align: "right" }, { key: "vat", header: "VAT", align: "right" }, { key: "gross", header: "Total incl. VAT", align: "right" }, { key: "wht", header: "Withholding", align: "right" }, { key: "net", header: "Net payment", align: "right" }];
  const notRecorded = <span className="text-muted-foreground">Not recorded</span>;
  const table: DataRow[] = rows.map((r) => ({ id: r.request_no, sort: { when: r.authenticated_at.getTime(), request: r.request_no, company: r.company_name },
    cells: { when: dtime(r.authenticated_at), request: r.request_no, company: r.company_name, payee: r.payee_name ?? hidden,
      rate: r.recorded ? `${r.vat_rate_name} (${percentLabel(r.vat_rate_percent!)})` : notRecorded, before: r.recorded ? etb(r.amount_before_vat) : notRecorded, vat: r.recorded ? etb(r.vat_amount) : notRecorded,
      gross: r.recorded ? etb(r.gross_amount) : notRecorded, wht: r.recorded ? (r.withholding_rate_percent ? `${etb(r.withholding_amount)} (${percentLabel(r.withholding_rate_percent)})` : etb(0)) : notRecorded, net: etb(r.net_amount) } }));
  const rec = rows.filter((r) => r.recorded);
  const byCompany = [...new Set(rec.map((r) => r.company_name))].map((c) => { const x = rec.filter((r) => r.company_name === c); return { c, vat: sumText(x.map((r) => r.vat_amount)), wht: sumText(x.map((r) => r.withholding_amount)) }; });
  return (<>
    <FilterBar tab="tax" kind="tax" f={f} search="Request, company or payee" />
    <StatGrid>
      <StatTile label="Amount before VAT" value={etb(sumText(rec.map((r) => r.amount_before_vat)))} hint={`${rec.length} payment${rec.length === 1 ? "" : "s"} with a tax breakdown`} />
      <StatTile label="VAT" value={etb(sumText(rec.map((r) => r.vat_amount)))} />
      <StatTile label="Total including VAT" value={etb(sumText(rec.map((r) => r.gross_amount)))} />
      <StatTile label="Withholding tax" value={etb(sumText(rec.map((r) => r.withholding_amount)))} />
      <StatTile label="Net payments" value={etb(sumText(rows.map((r) => r.net_amount)))} hint={rows.length > rec.length ? `Includes ${rows.length - rec.length} without a tax breakdown` : undefined} />
    </StatGrid>
    <p className="mute">Each request&apos;s recorded rates and figures, never today&apos;s settings. Withholding is recorded for reporting; the net payment is what was debited. Requests created before tax configuration show &quot;Not recorded&quot;.</p>
    {byCompany.length > 1 && <Panel><h3 className="m-0 mb-2 text-base">By company</h3><dl className="m-0">{byCompany.map((b) => <div key={b.c} className="flex justify-between gap-3 py-0.5 text-sm"><dt className="text-muted-foreground">{b.c}</dt><dd className="m-0 tabular-nums">VAT {etb(b.vat)} · Withholding {etb(b.wht)}</dd></div>)}</dl></Panel>}
    <Panel><DataTable caption="VAT and withholding" columns={columns} rows={table} emptyMessage="No payments in this period." /></Panel>
  </>);
}

function Outstanding({ rows }: { rows: OutstandingRow[] }) {
  const columns: DataColumn[] = [{ key: "request", header: "Request", primary: true, sortable: true }, { key: "company", header: "Company", sortable: true }, { key: "payee", header: "Payee" }, { key: "account", header: "Account", sortable: true }, { key: "method", header: "Method" }, { key: "age", header: "Age", sortable: true }, { key: "amount", header: "Amount", align: "right", sortable: true }];
  const table: DataRow[] = rows.map((r) => ({ id: r.id, search: `${r.request_no} ${r.company_name} ${r.account_label}`, filters: { age: ageBucket(r.age_days) }, sort: { request: r.request_no, company: r.company_name, account: r.account_label, age: r.age_days, amount: Number(r.amount) },
    cells: { request: <>{r.request_no}{r.ticked && <Badge variant="outline" className="ml-2">Ticked</Badge>}</>, company: r.company_name, payee: r.payee_name ?? hidden, account: r.account_label, method: PAYMENT_METHODS[r.payment_method], age: <>{r.age_days} days{r.overdue && <Badge variant="destructive" className="ml-2">Overdue</Badge>}</>, amount: etb(r.amount) } }));
  return (<>
    <StatGrid>{AGE_BUCKETS.map((b, i) => { const inBucket = rows.filter((r) => ageBucket(r.age_days) === b); return <StatTile key={b} label={b} value={etb(totalOf(inBucket, (r) => r.amount))} hint={`${inBucket.length} payment${inBucket.length === 1 ? "" : "s"}`} tone={i >= 2 && inBucket.length > 0 ? "destructive" : "default"} />; })}</StatGrid>
    <p className="mute">The payments you may see. On a shared account that can be fewer than the account holds.</p>
    <Panel><div className="mb-2 flex justify-end"><Download kind="outstanding" /></div>
      <DataTable caption="Outstanding by age" columns={columns} rows={table} searchable filters={[{ key: "age", label: "Age", options: AGE_BUCKETS.map((b) => ({ value: b, label: b })) }]} totals={{ request: "Total" }} sumColumns={["amount"]} emptyMessage="No payments are outstanding." /></Panel>
  </>);
}

function Weeks({ rows, f, openWeek }: { rows: WeekRow[]; f: ReportFilters; openWeek: boolean }) {
  const columns: DataColumn[] = [{ key: "week", header: "Week of", primary: true, sortable: true }, { key: "account", header: "Account", sortable: true }, { key: "status", header: "Status" }, { key: "deposits", header: "Statement deposits", align: "right" }, { key: "implied", header: "Implied deposits", align: "right" }, { key: "difference", header: "Deposit difference", align: "right" }, { key: "adjust", header: "Adjustments", align: "right" }, { key: "locked", header: "Locked by" }];
  const table: DataRow[] = rows.map((r) => ({ id: r.week_id, sort: { week: r.week_start, account: r.account_label }, filters: { status: r.status },
    cells: { week: openWeek ? <Link href={`/treasury/week/${r.week_id}`}>{dstr(r.week_start)}</Link> : dstr(r.week_start), account: r.account_label, status: WEEK_STATUS[r.status], deposits: r.access === "FULL" ? etbOrBlank(r.deposits) : hidden, implied: r.access === "FULL" ? etbOrBlank(r.implied_total) : hidden, difference: r.access === "FULL" ? etbOrBlank(r.deposit_difference) : hidden, adjust: r.access === "FULL" ? etbOrBlank(r.adjust_total) : hidden, locked: r.access === "FULL" ? r.locked_by_name ?? "" : hidden } }));
  return (<>
    <FilterBar tab="weeks" kind="weeks" f={f} />
    <p className="mute">Statement figures are for the company that owns each account. Others see each week&apos;s status.</p>
    <Panel><DataTable caption="Reconciliation and deposits" columns={columns} rows={table} filters={[{ key: "status", label: "Status", options: Object.entries(WEEK_STATUS).map(([value, label]) => ({ value, label })) }]} emptyMessage="No weeks in this period." /></Panel>
  </>);
}

function Cash({ rows }: { rows: CashRow[] }) {
  const columns: DataColumn[] = [{ key: "account", header: "Account", primary: true, sortable: true }, { key: "current", header: "Current", align: "right", sortable: true }, { key: "reserved", header: "Reserved", align: "right", sortable: true }, { key: "available", header: "Available", align: "right", sortable: true }, { key: "due", header: "Due in 30 days, your companies", align: "right", sortable: true }, { key: "updated", header: "Balance updated" }];
  const table: DataRow[] = rows.map((a) => ({ id: a.account_label, sort: { account: a.account_label, current: Number(a.current_balance), reserved: Number(a.reserved_balance), available: Number(a.available_balance), due: Number(a.due_30_days) },
    cells: { account: <><b>{a.account_label}</b>{a.shared && <Badge variant="outline" className="ml-2">Shared</Badge>}<ShortfallChip amount={a.shortfall_amount} /><span className="block text-xs text-muted-foreground">{accountPlace(a)}</span></>, current: etb(a.current_balance), reserved: etb(a.reserved_balance), available: etb(a.available_balance), due: etb(a.due_30_days), updated: a.balance_updated_at ? dtime(a.balance_updated_at) : "Never" } }));
  return (<>
    <StatGrid><StatTile label="Current balance" value={etb(totalOf(rows, (r) => r.current_balance))} hint="Each shared account is counted once" /><StatTile label="Reserved on these accounts" value={etb(totalOf(rows, (r) => r.reserved_balance))} hint={rows.some((r) => r.shared) ? "Account totals, including other companies that share them" : undefined} /><StatTile label="Available" value={etb(totalOf(rows, (r) => r.available_balance))} hint="After minimum buffers" /></StatGrid>
    <Panel><div className="mb-2 flex justify-end"><Download kind="cash" /></div><DataTable caption="Cash and commitments" columns={columns} rows={table} totals={{ account: "Total" }} sumColumns={["current", "reserved", "available", "due"]} emptyMessage="No accounts are available to you." /></Panel>
  </>);
}

function Audit({ rows, f }: { rows: AuditRow[]; f: ReportFilters }) {
  const columns: DataColumn[] = [{ key: "when", header: "When", primary: true }, { key: "who", header: "Who" }, { key: "company", header: "Company" }, { key: "what", header: "What" }, { key: "details", header: "Details" }];
  const table: DataRow[] = rows.map((e, i) => ({ id: String(i), cells: { when: dtime(e.occurred_at), who: e.actor ?? hidden, company: e.company ?? "", what: e.action.replace(/_/g, " ").toLowerCase(), details: e.metadata === null ? hidden : <span className="text-xs break-all text-muted-foreground">{JSON.stringify(e.metadata)}</span> } }));
  return (<>
    <FilterBar tab="audit" kind="audit" f={f} search="Action contains" />
    <Panel><DataTable caption="Audit trail" columns={columns} rows={table} pageSize={25} emptyMessage="No entries match." />{rows.length >= AUDIT_LIMIT && <p className="mute mt-2 mb-0">Showing the latest {AUDIT_LIMIT} entries. The download goes further.</p>}</Panel>
  </>);
}

export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const me = await requireMe(); requireAccess(me, "/reports");
  const tab = REPORT_TABS.some(([k]) => k === sp.r) ? sp.r! : "pending";
  const f = reportFilters((k) => sp[k]);
  const company = await companyScope(me.id);
  const body = await withUser(me.id, async (tx) => {
    if (tab === "payments") return <Payments rows={await paymentRows(tx, f, company)} f={f} />;
    if (tab === "tax") return <Tax rows={await taxRows(tx, f, company)} f={f} />;
    if (tab === "outstanding") return <Outstanding rows={await outstandingRows(tx, company)} />;
    if (tab === "weeks") return <Weeks rows={await weekRows(tx, f, company)} f={f} openWeek={canAccess(me, "/treasury")} />;
    if (tab === "cash") return <Cash rows={await cashRows(tx, company)} />;
    if (tab === "audit") return <Audit rows={await auditRows(tx, f, AUDIT_LIMIT, company)} f={f} />;
    return <Pending rows={await pendingRows(tx, company)} />;
  });
  return (
    <>
      <PageHeader title="Reports" description="Everything here follows the same visibility rules as the rest of the app. Amounts are in ETB." />
      <Flash sp={sp} />
      <TabLinks label="Reports" active={tab} tabs={REPORT_TABS.map(([key, title]) => ({ key, title, href: `/reports?r=${key}` }))} />
      {me.groupReport && <p className="mute">With group reporting you see amounts, dates and status. Payees, approvers and audit details show only to members of each company.</p>}
      {body}
    </>
  );
}
