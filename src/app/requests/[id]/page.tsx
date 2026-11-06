import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components";
import { recordExecution, workflowAction } from "../../actions";
import { AdjustForm } from "@/components/requests/adjust-form";
import { ReviewActions } from "@/components/requests/review-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { SidePanel } from "@/components/ui/side-panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatusTracker } from "@/components/ui/status-tracker";
import { SubmitButton } from "@/components/ui/submit-button";
import { Timeline } from "@/components/ui/timeline";
import { withUser } from "@/lib/db";
import { accountPlace, dstr, dtime, etb, PAYMENT_METHODS } from "@/lib/format";
import { maskId, revealIdNumber } from "@/lib/payees";
import { requireAccess } from "@/lib/rbac";
import { loadRequest, requestActions, requestHistory, stopReason } from "@/lib/requests";
import { currentUserId, hasPermission, requireMe } from "@/lib/session";

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="mb-3 rounded-xl border bg-card p-4"><h2 className="mt-0">{title}</h2>{children}</section>;
const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => <div className="min-w-0"><dt className="text-xs font-semibold text-muted-foreground">{label}</dt><dd className="m-0 text-sm break-words">{children}</dd></div>;
const INSTALLMENTS: DataColumn[] = [{ key: "seq", header: "Installment", primary: true }, { key: "due", header: "Due" }, { key: "amount", header: "Amount", align: "right" }];

export default async function RequestDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params; const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/requests");
  // Row-level security decides whether this request can be read. Another company's request is simply not found.
  const d = await withUser(uid, async (tx) => {
    const found = await loadRequest(tx, id);
    if (!found) return null;
    const enc = found.r.person_payee_id ? (await tx.q<{ v: string | null }>("SELECT reveal_person_id($1) AS v", [id]))[0].v : null;   // logged; empty if this person may not see it
    return { ...found, fullId: enc ? revealIdNumber(enc) : null };
  });
  if (!d) notFound();
  const { r } = d, mine = r.created_by === me.id;
  const can = requestActions(r.workflow_state, mine, d.stage, hasPermission(me, "payment_request:create", r.debtor_company_id));
  const holds = r.workflow_state === "RESERVED" || r.workflow_state === "VERIFIED";
  const stopped = stopReason(r.workflow_state, d.approvals);
  const field = (action: string) => ({ id, version: String(r.version), action });
  const canDoSomething = Object.values(can).some(Boolean);
  const instRows: DataRow[] = d.installments.map((i) => ({ id: String(i.seq), cells: { seq: i.seq, due: dstr(i.due_date), amount: etb(i.amount) } }));
  const payTo = r.person_kind === "TELEBIRR" ? `Telebirr ${r.telebirr_phone}` : r.person_kind === "BANK" ? `${r.person_bank} ••••${r.person_last4}` : r.bank_name ? `${r.bank_name} ••••${r.account_last4}` : "Not set";
  return (
    <>
      <p className="mute mb-2"><Link href={d.stage ? "/approvals" : "/requests"}>{d.stage ? "Approvals" : "Payment requests"}</Link> / {r.request_no}</p>
      <PageHeader title={`${r.request_no}: ${r.payee ?? "No payee"}`} description={`${r.company}, entered by ${r.creator_name ?? "someone at the company"}`} action={<StatusBadge state={r.workflow_state} />} />
      <Flash sp={sp} />
      {stopped && (
        <div role="status" className="mb-3 rounded-xl border border-warning bg-warning-soft p-4 text-sm text-foreground">
          <b>{stopped.title}</b><div>{stopped.reason}</div><div className="text-xs text-muted-foreground">{stopped.who}, {dtime(stopped.when)}</div>
        </div>
      )}
      <section className="mb-3 rounded-xl border bg-card p-4"><StatusTracker state={r.workflow_state} /></section>

      {canDoSomething && (
        <Card title="What you can do">
          {d.stage && <ReviewActions stage={d.stage} target={{ id, requestNo: r.request_no, version: r.version, amount: r.total_amount, current: r.debit_current, reserved: r.debit_reserved }} />}
          {can.adjust && (
            <div className="mt-2">
              <SidePanel title={`Adjust ${r.request_no}`} description="Corrections made during review." trigger={<Button variant="outline">Adjust this request</Button>}>
                <AdjustForm id={id} version={r.version} priority={r.priority} invoiceRef={r.invoice_ref ?? ""} description={r.description ?? ""} totalAmount={Number(r.total_amount)}
                  installments={d.installments.map((i) => ({ seq: i.seq, dueDate: dstr(i.due_date), amount: Number(i.amount) }))} />
              </SidePanel>
            </div>
          )}
          {(can.edit || can.cancel) && (
            <div className="flex flex-wrap gap-2">
              {can.edit && <Button asChild variant="outline"><Link href={`/requests/${id}/edit`}>Edit request</Link></Button>}
              {can.submit && <ConfirmDialog title={`Submit ${r.request_no}?`} description="This reserves the amount on the debit account, so it cannot be used twice. A Finance Manager verifies it next." confirmLabel="Submit and reserve funds"
                effect={[{ label: "To reserve", value: etb(r.total_amount) }, { label: "Available on the account", value: etb(r.debit_available) }]} action={workflowAction} fields={field("submit")} trigger={<Button>Submit and reserve funds</Button>} />}
              {can.cancel && <ConfirmDialog title={`Cancel ${r.request_no}?`} description="This is final. Any reserved funds are released." confirmLabel="Cancel my request" cancelLabel="Keep it" destructive action={workflowAction} fields={field("cancel")} trigger={<Button variant="destructive">Cancel my request</Button>}>
                <label className="f">Reason<textarea name="reason" rows={3} required minLength={3} /></label></ConfirmDialog>}
            </div>
          )}
          {can.record && (
            <form action={recordExecution} className="mt-2 grid items-end gap-3 md:grid-cols-3"><input type="hidden" name="id" value={id} />
              {r.payment_method === "CHEQUE" && <label className="f">Cheque number (optional)<input name="cheque_no" maxLength={64} defaultValue={r.cheque_no ?? ""} /></label>}
              <label className="f">Bank reference (optional)<input name="bank_reference" maxLength={128} defaultValue={r.bank_reference ?? ""} /></label>
              <div><SubmitButton variant="outline">Save payment details</SubmitButton></div></form>
          )}
        </Card>
      )}
      {r.workflow_state === "AUTHENTICATED" && <p className="mute">The account has been debited. This payment stays Authenticated until reconciliation finds it on the bank statement, and it can no longer be cancelled.</p>}
      {mine && r.workflow_state === "RESERVED" && <p className="mute">The funds are reserved and it is waiting for a Finance Manager. You cannot approve your own request.</p>}

      <Card title="Details">
        <dl className="m-0 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Total"><b>{etb(r.total_amount)}</b></Fact>
          {r.supplier_id ? <Fact label="Supplier">{r.payee}<div className="text-xs text-muted-foreground">TIN {r.tin}</div></Fact>
            : <Fact label="Person">{r.payee}<div className="text-xs text-muted-foreground">{r.person_phone}, ID {d.fullId ?? maskId(r.id_last4 ?? "")}</div></Fact>}
          <Fact label="Pays to">{payTo} {(r.bank_status ?? r.person_detail_status ?? "VERIFIED") !== "VERIFIED" && <Badge variant="destructive">Not verified</Badge>}</Fact>
          <Fact label="Debit account">{r.debit_label ? `${r.debit_label} · ${accountPlace({ account_kind: r.account_kind ?? undefined, bank_name: r.debit_bank, account_last4: r.debit_last4, wallet_phone: r.wallet_phone })}` : "Not chosen"} {holds && <Badge variant="secondary">Funds reserved</Badge>}</Fact>
          <Fact label="Payment method">{PAYMENT_METHODS[r.payment_method] ?? r.payment_method}</Fact>
          <Fact label="Priority">{r.priority.toLowerCase()}</Fact>
          <Fact label="Invoice">{r.invoice_ref ?? "None"}{r.invoice_date ? `, ${dstr(r.invoice_date)}` : ""} {d.files.length === 0 && <Badge variant="warning">No document</Badge>}</Fact>
          {r.cheque_no && <Fact label="Cheque number">{r.cheque_no}</Fact>}
          {r.bank_reference && <Fact label="Bank reference">{r.bank_reference}</Fact>}
          {r.paid_at && <Fact label="Paid">{dtime(r.paid_at)}</Fact>}
          {r.description && <Fact label="Notes">{r.description}</Fact>}
        </dl>
      </Card>

      <Card title="Installments"><DataTable caption="Installments" columns={INSTALLMENTS} rows={instRows} /></Card>
      <Card title="Documents">
        {d.files.length === 0 ? <p className="m-0 text-sm text-muted-foreground">No files.</p> : <ul className="m-0 list-none p-0">{d.files.map((f) => <li key={f.id} className="text-sm"><a href={`/api/attachments/${f.id}`}>{f.filename}</a> <span className="text-muted-foreground">{f.kind.toLowerCase()}, {dtime(f.uploaded_at)}{f.replaced ? ", replaced" : ""}</span></li>)}</ul>}
      </Card>
      <Card title="History"><Timeline entries={requestHistory(d.approvals, d.adjustments)} /></Card>
    </>
  );
}
