import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, StateChip } from "@/components";
import { adjustRequest, recordExecution, workflowAction } from "../../actions";
import { dstr, dtime, etb, PAYMENT_METHODS } from "@/lib/format";
import { withUser } from "@/lib/db";
import { requireAccess } from "@/lib/rbac";
import { currentUserId, hasPermission, requireMe } from "@/lib/session";

const ACTION_LABEL: Record<string, string> = { SUBMIT: "Submitted", VERIFY: "Verified", AUTHORIZE: "Authenticated (account debited)", RETURN: "Returned", REJECT: "Rejected", CANCEL: "Cancelled", ADJUST: "Adjusted", INVALIDATE: "Earlier approvals cancelled" };

function Do({ id, version, action, label, ask, danger }: { id: string; version: number; action: string; label: string; ask?: boolean; danger?: boolean }) {
  return (
    <form action={workflowAction} className="inline">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="version" value={version} /><input type="hidden" name="action" value={action} />
      {ask && <label className="f">Reason<input name="reason" required minLength={3} placeholder="Why?" /></label>}
      <button className={danger ? "dng" : ask ? "sec" : ""}>{label}</button>
    </form>
  );
}

export default async function RequestDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params; const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/requests");
  const d = await withUser(uid, async (tx) => {
    const r = (await tx.q<any>(
      `SELECT r.*, c.legal_name AS company, s.legal_name AS supplier, s.tin, b.bank_name, b.account_last4, b.status AS bank_status, u.full_name AS creator_name,
              da.account_label AS debit_label, dk.name AS debit_bank, da.account_last4 AS debit_last4, da.available_balance AS debit_available
       FROM payment_requests r JOIN companies c ON c.id = r.debtor_company_id JOIN suppliers s ON s.id = r.supplier_id
       LEFT JOIN supplier_bank_details b ON b.id = r.supplier_bank_detail_id LEFT JOIN users u ON u.id = r.created_by
       LEFT JOIN company_bank_accounts da ON da.id = r.debit_account_id LEFT JOIN banks dk ON dk.id = da.bank_id WHERE r.id = $1`, [id]))[0];
    if (!r) return null;
    return {
      r,
      inst: await tx.q<any>("SELECT seq, due_date, amount FROM payment_installments WHERE request_id = $1 ORDER BY seq", [id]),
      approvals: await tx.q<any>("SELECT a.*, u.full_name FROM approval_events a LEFT JOIN users u ON u.id = a.actor_id WHERE a.request_id = $1 ORDER BY a.occurred_at", [id]),
      adjustments: await tx.q<any>("SELECT h.*, u.full_name FROM adjustment_history h LEFT JOIN users u ON u.id = h.actor_id WHERE h.request_id = $1 ORDER BY h.occurred_at", [id]),
      files: await tx.q<any>("SELECT id, kind, filename, uploaded_at, supersedes_id, (SELECT 1 FROM attachments x WHERE x.supersedes_id = attachments.id) AS replaced FROM attachments WHERE request_id = $1 ORDER BY uploaded_at", [id]),
      actionable: (await tx.q<any>("SELECT stage FROM app_actionable_requests() WHERE request_id = $1", [id]))[0]?.stage as string | undefined,
    };
  });
  if (!d) notFound();
  const { r } = d; const mine = r.created_by === me.id;
  const editable = mine && r.workflow_state === "DRAFT";
  const holds = r.workflow_state === "RESERVED" || r.workflow_state === "VERIFIED";
  const cancellable = mine && ["DRAFT", "SCHEDULED", "RESERVED", "VERIFIED"].includes(r.workflow_state);
  const canAdjust = Boolean(d.actionable);
  const canRecord = r.workflow_state === "AUTHENTICATED" && hasPermission(me, "payment_request:create", r.debtor_company_id);
  const who = (u: any) => u.full_name ?? "Someone at the company";
  return (
    <>
      <p className="mute"><Link href="/requests">Payment requests</Link> / {r.request_no}</p>
      <div className="row"><h1>{r.request_no} — {r.supplier}</h1><div><StateChip state={r.workflow_state} /></div></div>
      <p className="sub">{r.company} · entered by {r.creator_name ?? "—"} · version {r.version}</p>
      <Flash sp={sp} />

      <div className="card">
        <div className="form">
          <div><span className="mute">Total</span><br /><b>{etb(r.total_amount)}</b></div>
          <div><span className="mute">Invoice</span><br />{r.invoice_ref ?? "—"} · {dstr(r.invoice_date) || "—"}</div>
          <div><span className="mute">Supplier</span><br />{r.supplier} <span className="mute">TIN {r.tin}</span></div>
          <div><span className="mute">Debit account</span><br />{r.debit_label ? `${r.debit_label} · ${r.debit_bank} ••••${r.debit_last4}` : "—"} {holds && <span className="chip">funds reserved</span>}</div>
          <div><span className="mute">Pays to</span><br />{r.bank_name ? `${r.bank_name} ••••${r.account_last4}` : "—"} {r.bank_status && r.bank_status !== "VERIFIED" && <span className="chip b">not verified</span>}</div>
          <div><span className="mute">Payment method</span><br />{PAYMENT_METHODS[r.payment_method] ?? r.payment_method}</div>
          {r.cheque_no && <div><span className="mute">Cheque number</span><br />{r.cheque_no}</div>}
          {r.bank_reference && <div><span className="mute">Bank reference</span><br />{r.bank_reference}</div>}
          {r.paid_at && <div><span className="mute">Paid</span><br />{dtime(r.paid_at)}</div>}
          <div><span className="mute">Priority</span><br />{r.priority}</div>
          {r.description && <div><span className="mute">Notes</span><br />{r.description}</div>}
        </div>
      </div>

      <h2>Installments</h2>
      <div className="card scroll"><table><thead><tr><th>#</th><th>Due</th><th className="n">Amount</th></tr></thead>
        <tbody>{d.inst.map((i: any) => <tr key={i.seq}><td>{i.seq}</td><td>{dstr(i.due_date)}</td><td className="n">{etb(i.amount)}</td></tr>)}</tbody></table></div>

      <h2>What you can do</h2>
      <div className="card">
        {editable && <><p className="mute">Only you can change this request while it is a draft. Submitting reserves {etb(r.total_amount)} on the debit account so the money cannot be used twice.</p><div className="inline"><Link className="btn sec" href={`/requests/${id}/edit`}>Edit request</Link><Do id={id} version={r.version} action="submit" label="Submit and reserve funds" /></div></>}
        {d.actionable === "VERIFICATION" && <div style={{ display: "grid", gap: 10 }}><Do id={id} version={r.version} action="verify" label="Verify" /><Do id={id} version={r.version} action="return" label="Return for correction" ask /></div>}
        {d.actionable === "AUTHORIZATION" && <div style={{ display: "grid", gap: 10 }}><Do id={id} version={r.version} action="authorize" label="Authenticate (debit the account)" /><Do id={id} version={r.version} action="return" label="Return for correction" ask /><Do id={id} version={r.version} action="reject" label="Reject" ask danger /></div>}
        {cancellable && <div style={{ marginTop: 10 }}><Do id={id} version={r.version} action="cancel" label="Cancel my request" ask danger /></div>}
        {!editable && !d.actionable && !cancellable && !canRecord && <p className="mute">Nothing for you to do on this request right now.</p>}
        {canRecord && <form action={recordExecution} className="form"><input type="hidden" name="id" value={id} />
          {r.payment_method === "CHEQUE" && <label className="f">Cheque number (optional)<input name="cheque_no" maxLength={64} defaultValue={r.cheque_no ?? ""} /></label>}
          <label className="f">Bank reference (optional)<input name="bank_reference" maxLength={128} defaultValue={r.bank_reference ?? ""} /></label>
          <button className="sec">Save payment details</button></form>}
        {r.workflow_state === "AUTHENTICATED" && <p className="mute">The account has been debited. This payment stays Authenticated until reconciliation finds it on the bank statement. It can no longer be cancelled.</p>}
        {mine && r.workflow_state === "RESERVED" && <p className="mute">The funds are reserved. It is waiting for a Finance Manager to verify. You cannot approve your own request. Cancelling releases the funds.</p>}
      </div>

      {canAdjust && (
        <details className="card"><summary>Adjust this request</summary>
          <p className="mute">Changing an amount or the supplier or bank details sends the request back to verification. Changing a due date asks Treasury to reconfirm funding. Every change is recorded with your reason.</p>
          <form action={adjustRequest}>
            <input type="hidden" name="id" value={id} /><input type="hidden" name="version" value={r.version} />
            {(["priority", "invoice_ref", "description"] as const).map((k) => <input key={k} type="hidden" name={"orig_" + k} value={r[k] ?? ""} />)}
            <input type="hidden" name="orig_total_amount" value={r.total_amount} />
            <div className="form">
              <label className="f">Priority<select name="priority" defaultValue={r.priority}><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></label>
              <label className="f">Invoice reference<input name="invoice_ref" defaultValue={r.invoice_ref ?? ""} /></label>
              <label className="f">Notes<input name="description" defaultValue={r.description ?? ""} /></label>
              <label className="f">Total (ETB)<input name="total_amount" type="number" step="0.01" defaultValue={Number(r.total_amount)} /></label>
            </div>
            {d.inst.map((i: any) => (
              <div className="inline" key={i.seq} style={{ marginTop: 8 }}>
                <input type="hidden" name="seq" value={i.seq} /><input type="hidden" name="o_amount" value={Number(i.amount)} /><input type="hidden" name="o_due" value={dstr(i.due_date)} />
                <label className="f">Installment {i.seq} amount<input name="i_amount" type="number" step="0.01" defaultValue={Number(i.amount)} /></label>
                <label className="f">Installment {i.seq} due date<input name="i_due" type="date" defaultValue={dstr(i.due_date)} /></label>
              </div>))}
            <div className="inline" style={{ marginTop: 12 }}><label className="f">Reason (required)<input name="reason" required minLength={3} /></label><button>Save adjustment</button></div>
          </form>
        </details>)}

      <h2>History</h2>
      <div className="card scroll"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Reason</th></tr></thead>
        <tbody>{d.approvals.map((a: any) => <tr key={a.id}><td>{dtime(a.occurred_at)}</td><td>{who(a)} <span className="mute">({a.actor_role.toLowerCase()})</span></td><td>{ACTION_LABEL[a.action] ?? a.action}</td><td>{a.reason ?? ""}</td></tr>)}</tbody></table></div>
      {d.adjustments.length > 0 && (<>
        <h2>Changes made during review</h2>
        <div className="card scroll"><table><thead><tr><th>When</th><th>Who</th><th>Field</th><th>Was</th><th>Now</th><th>Reason</th></tr></thead>
          <tbody>{d.adjustments.map((a: any) => <tr key={a.id}><td>{dtime(a.occurred_at)}</td><td>{who(a)}</td><td>{a.field.replace(/_/g, " ")}</td><td>{a.old_value}</td><td>{a.new_value}</td><td>{a.reason}</td></tr>)}</tbody></table></div></>)}
      <h2>Files</h2>
      <div className="card">{d.files.length === 0 ? <span className="mute">No files.</span> : d.files.map((f: any) => <div key={f.id}><a href={`/api/attachments/${f.id}`}>{f.filename}</a> <span className="mute">{f.kind.toLowerCase()} · {dtime(f.uploaded_at)}{f.replaced ? " · replaced" : ""}</span></div>)}</div>
    </>
  );
}
