import Link from "next/link";
import { Flash } from "@/components";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { companyScope } from "@/lib/company-scope";
import { withUser } from "@/lib/db";
import { dstr, etb, PAYMENT_METHODS, STATUS_SHORT } from "@/lib/format";
import { canAccess, requireAccess } from "@/lib/rbac";
import { filterAccounts, listRequests, parseRequestFilters, REQUEST_LIST_LIMIT } from "@/lib/requests";
import { currentUserId, requireMe } from "@/lib/session";

const COLUMNS: DataColumn[] = [
  { key: "no", header: "No.", primary: true, sortable: true }, { key: "company", header: "Company", sortable: true }, { key: "payee", header: "Payee", sortable: true }, { key: "amount", header: "Amount", align: "right", sortable: true },
  { key: "account", header: "Debit account", sortable: true }, { key: "method", header: "Method" }, { key: "due", header: "First due", sortable: true }, { key: "status", header: "Status", sortable: true },
];

export default async function Requests({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/requests");
  // The filters come from the URL, are checked, and run on the server. Row-level security decides what can be found at all.
  const f = parseRequestFilters(sp), company = await companyScope(uid);
  const d = await withUser(uid, async (tx) => ({ list: await listRequests(tx, f, company), accounts: await filterAccounts(tx) }));
  const rows: DataRow[] = d.list.map((r) => ({
    id: r.id, sort: { no: r.request_no, company: r.company, payee: r.payee ?? "", amount: Number(r.total_amount), account: r.account ?? "", due: r.due ?? "", status: r.workflow_state },
    cells: {
      no: <Link href={`/requests/${r.id}`}>{r.request_no}</Link>, company: r.company, payee: r.payee, amount: etb(r.total_amount), account: r.account ?? "None yet", method: PAYMENT_METHODS[r.method], due: dstr(r.due),
      status: <span className="inline-flex flex-wrap gap-1"><StatusBadge state={r.workflow_state} />{r.priority !== "NORMAL" && <span className="text-xs text-muted-foreground">{r.priority.toLowerCase()}</span>}</span>,
    },
  }));
  const filtered = Boolean(f.q || f.state || f.method || f.account || f.from || f.to);
  const total = d.list.reduce((s, r) => s + Number(r.total_amount), 0);
  return (
    <>
      <PageHeader title="Payment requests" description="Requests from the companies you can see." action={canAccess(me, "/requests/new") ? <Button asChild><Link href="/requests/new">New request</Link></Button> : undefined} />
      <Flash sp={sp} />
      <form method="get" className="mb-3 grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Find requests">
        <label className="f">Search<input type="search" name="q" defaultValue={f.q} placeholder="Number, payee or invoice" /></label>
        <label className="f">Status<select name="state" defaultValue={f.state ?? ""}><option value="">All</option>{Object.entries(STATUS_SHORT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="f">Method<select name="method" defaultValue={f.method ?? ""}><option value="">All</option>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="f">Debit account<select name="account" defaultValue={f.account ?? ""}><option value="">All</option>{d.accounts.map((a) => <option key={a.id} value={a.id}>{a.account_label}</option>)}</select></label>
        <label className="f">Created from<input type="date" name="from" defaultValue={f.from ?? ""} /></label>
        <label className="f">Created to<input type="date" name="to" defaultValue={f.to ?? ""} /></label>
        <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
          <Button type="submit">Apply filters</Button>
          {filtered && <Button asChild variant="outline"><Link href="/requests">Clear</Link></Button>}
        </div>
      </form>
      <div className="rounded-xl border bg-card p-4">
        <DataTable caption="Payment requests" columns={COLUMNS} rows={rows} pageSize={25} emptyMessage={filtered ? "No requests match these filters." : "Nothing here yet."}
          totals={{ no: "Total", amount: etb(total) }} />
        {d.list.length === REQUEST_LIST_LIMIT && <p className="mute mt-2 mb-0">Showing the latest {REQUEST_LIST_LIMIT}. Narrow the filters to see older requests.</p>}
      </div>
    </>
  );
}
