import Link from "next/link";
import { Flash } from "@/components";
import { ReviewActions } from "@/components/requests/review-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { SidePanel } from "@/components/ui/side-panel";
import { companyScope } from "@/lib/company-scope";
import { withUser } from "@/lib/db";
import { ageSince, dstr, dtime, etb, PAYMENT_METHODS } from "@/lib/format";
import { requireAccess } from "@/lib/rbac";
import { AGE_OPTIONS, ageBucket, reviewQueue, type ReviewRow } from "@/lib/requests";
import { currentUserId, hasPermission, requireMe } from "@/lib/session";
import { APPROVAL_STAGES, type ApprovalStage } from "@/lib/workflow";

const COLUMNS: DataColumn[] = [
  { key: "no", header: "Request", primary: true, sortable: true }, { key: "company", header: "Company", sortable: true }, { key: "payee", header: "Payee", sortable: true },
  { key: "amount", header: "Amount", align: "right", sortable: true }, { key: "waiting", header: "Waiting", sortable: true }, { key: "review", header: "Review" },
];
const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => <div className="flex justify-between gap-3 py-0.5 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="m-0 text-right">{children}</dd></div>;

/** Everything needed to decide, beside the queue. */
function ReviewPanel({ r, stage }: { r: ReviewRow; stage: ApprovalStage }) {
  return (
    <SidePanel title={`${r.request_no}: ${r.payee ?? "No payee"}`} description={r.company} trigger={<Button size="sm">Review</Button>}>
      <dl className="m-0 rounded-md border bg-card p-3">
        <Fact label="Amount"><b>{etb(r.total_amount)}</b></Fact>
        <Fact label="Payee">{r.payee ?? "No payee"}{r.payee_type === "ONE_TIME" && <Badge variant="outline" className="ml-2">One-time payee</Badge>}</Fact>
        <Fact label="Method">{PAYMENT_METHODS[r.method]}</Fact>
        <Fact label="Pays to">{r.pays_to ?? (r.method === "CASH" || r.method === "CHEQUE" ? "Not needed for this method" : "Not set")}</Fact>
        <Fact label="Debit account">{r.account_label ?? "Not chosen"}</Fact>
        <Fact label="First due">{dstr(r.due)}</Fact>
        <Fact label="Entered by">{r.creator ?? "Someone at the company"}</Fact>
        {r.verifier && <Fact label="Verified by">{r.verifier}{r.verified_at ? `, ${dtime(r.verified_at)}` : ""}</Fact>}
        <Fact label="Document">{r.document ? <a href={`/api/attachments/${r.document}`}>{r.document_name}</a> : <Badge variant="warning">No document</Badge>}</Fact>
      </dl>
      <ReviewActions stage={stage} back="approvals" target={{ id: r.request_id, requestNo: r.request_no, version: r.request_version, amount: r.total_amount, current: r.current_balance, reserved: r.reserved_balance }} />
      <p className="m-0 text-sm"><Link href={`/requests/${r.request_id}`}>Open the full request</Link> to see its history or adjust it.</p>
    </SidePanel>
  );
}

export default async function Approvals({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const me = await requireMe();
  requireAccess(me, "/approvals");
  // The database decides what is waiting: Finance Managers get reserved requests, Owners get verified ones, never their own and never one they handled at the other stage.
  const uid = await currentUserId(), company = await companyScope(uid), now = new Date();
  const queue = await withUser(uid, (tx) => reviewQueue(tx, company));
  const stages = (Object.keys(APPROVAL_STAGES) as ApprovalStage[]).filter((s) => hasPermission(me, APPROVAL_STAGES[s].permission));
  const rowsFor = (stage: ApprovalStage): DataRow[] => queue.filter((r) => r.stage === stage).map((r) => ({
    id: r.request_id, search: `${r.request_no} ${r.company} ${r.payee ?? ""}`, filters: { age: ageBucket(r.waiting_since, now) },
    sort: { no: r.request_no, company: r.company, payee: r.payee ?? "", amount: Number(r.total_amount), waiting: r.waiting_since.getTime() },
    cells: {
      no: <Link href={`/requests/${r.request_id}`}>{r.request_no}</Link>, company: r.company,
      payee: <>{r.payee}{r.payee_type === "ONE_TIME" && <Badge variant="outline" className="ml-2">One-time</Badge>}{!r.document && <Badge variant="warning" className="ml-2">No document</Badge>}</>,
      amount: etb(r.total_amount), waiting: ageSince(r.waiting_since, now), review: <ReviewPanel r={r} stage={stage} />,
    },
  }));
  return (
    <>
      <PageHeader title="Approvals" description="Requests waiting for you. Review each one before you act." />
      <Flash sp={sp} />
      {stages.length === 0 && <div className="rounded-xl border bg-card p-4">Approvals are done by Finance Managers (verification) and Owners (authentication). Your role has no approval step.</div>}
      {stages.map((stage) => (
        <section key={stage}>
          <h2>{APPROVAL_STAGES[stage].title} <span className="mute">({APPROVAL_STAGES[stage].role})</span></h2>
          <div className="rounded-xl border bg-card p-4">
            <DataTable caption={APPROVAL_STAGES[stage].title} columns={COLUMNS} rows={rowsFor(stage)} searchable pageSize={15} filters={[{ key: "age", label: "Waiting", options: AGE_OPTIONS }]} emptyMessage="Nothing is waiting for you." />
          </div>
        </section>
      ))}
    </>
  );
}
