import { notFound, redirect } from "next/navigation";
import { Flash } from "@/components";
import { saveAndSubmitDraft, saveDraft } from "../../../actions";
import { dstr, etb, PAYMENT_METHODS, accountPlace } from "@/lib/format";
import { withUser } from "@/lib/db";
import { requireAccess } from "@/lib/rbac";
import { requireMe } from "@/lib/session";

export default async function EditRequest({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params; const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await requireMe();
  requireAccess(me, "/requests/new");
  const d = await withUser(me.id, async (tx) => {
    const r = (await tx.q<any>("SELECT r.*, r.payee_type::text AS payee_kind, p.full_name AS person_name, c.legal_name AS company FROM payment_requests r JOIN companies c ON c.id = r.debtor_company_id LEFT JOIN person_payees p ON p.id = r.person_payee_id WHERE r.id = $1", [id]))[0];
    if (!r) return null;
    return {
      r,
      inst: await tx.q<any>("SELECT seq, due_date, amount FROM payment_installments WHERE request_id = $1 ORDER BY seq", [id]),
      accounts: await tx.q<any>(`SELECT a.id, a.account_label, a.account_kind::text AS account_kind, a.wallet_phone, b.name AS bank_name, a.account_last4, a.available_balance
        FROM company_bank_accounts a LEFT JOIN banks b ON b.id = a.bank_id
        WHERE a.is_active AND (SELECT debtor_company_id FROM payment_requests WHERE id = $1) IN (SELECT app_granted_companies(a.id, 'USE')) ORDER BY a.account_label`, [id]),
      file: (await tx.q<any>("SELECT id, filename FROM attachments a WHERE request_id = $1 AND kind = 'INVOICE' AND NOT EXISTS (SELECT 1 FROM attachments b WHERE b.supersedes_id = a.id) ORDER BY uploaded_at DESC LIMIT 1", [id]))[0],
      suppliers: await tx.q<any>(`SELECT s.id, s.legal_name, EXISTS (SELECT 1 FROM supplier_bank_details b WHERE b.supplier_id = s.id AND b.status = 'VERIFIED') AS bank_ok
        FROM company_suppliers cs JOIN suppliers s ON s.id = cs.supplier_id WHERE cs.company_id = $1 AND cs.status = 'ACTIVE' AND s.is_active ORDER BY s.legal_name`, [(await tx.q<any>("SELECT debtor_company_id FROM payment_requests WHERE id = $1", [id]))[0]?.debtor_company_id]),
    };
  });
  if (!d) notFound();
  const { r } = d;
  if (r.created_by !== me.id || r.workflow_state !== "DRAFT") redirect(`/requests/${id}`);
  const rows = Array.from({ length: Math.max(4, d.inst.length + 1) }, (_, i) => d.inst[i]);
  return (
    <>
      <h1>Edit {r.request_no}</h1><p className="sub">{r.company} · draft</p><Flash sp={sp} />
      <form action={saveDraft} className="card">
        <input type="hidden" name="id" value={id} />
        <div className="form">
          {r.payee_kind === "PERSON" ? <div><span className="mute">Person</span><br />{r.person_name}</div> : <label className="f">Supplier<select name="supplier" defaultValue={r.supplier_id}>{d.suppliers.map((s: any) => <option key={s.id} value={s.id} disabled={!s.bank_ok}>{s.legal_name}{s.bank_ok ? "" : " (bank details not verified)"}</option>)}</select></label>}
          <label className="f">Pay from (debit account)<select name="account" required defaultValue={r.debit_account_id ?? ""}><option value="" disabled>Choose an account</option>{d.accounts.map((a: any) => <option key={a.id} value={a.id}>{a.account_label} · {accountPlace(a)} — available {etb(a.available_balance)}</option>)}</select></label>
          <label className="f">Invoice reference (optional)<input name="invoice_ref" defaultValue={r.invoice_ref ?? ""} /></label>
          <label className="f">Invoice date (optional)<input name="invoice_date" type="date" defaultValue={dstr(r.invoice_date)} /></label>
          <label className="f">Payment method<select name="payment_method" defaultValue={r.payment_method}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="f">Priority<select name="priority" defaultValue={r.priority}><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></label>
        </div>
        <h2>Installments</h2><p className="mute">Leave a row empty to leave it out. The total is the sum of the rows.</p>
        {rows.map((x: any, i: number) => (
          <div className="inline" key={i} style={{ marginBottom: 8 }}>
            <label className="f">Due date {i + 1}<input name="due" type="date" defaultValue={x ? dstr(x.due_date) : ""} /></label>
            <label className="f">Amount (ETB) {i + 1}<input name="amt" type="number" min="0.01" step="0.01" defaultValue={x ? Number(x.amount) : ""} /></label>
          </div>))}
        <div className="form" style={{ marginTop: 12 }}>
          <label className="f">Replace the invoice file (leave empty to keep {d.file?.filename ?? "none"})<input name="invoice" type="file" accept="application/pdf,image/png,image/jpeg" /></label>
          <label className="f">Notes<textarea name="description" rows={2} defaultValue={r.description ?? ""} /></label>
        </div>
        <div className="inline" style={{ marginTop: 14 }}><button formAction={saveAndSubmitDraft}>Save and submit (reserve funds)</button><button className="sec">Save changes</button></div>
      </form>
    </>
  );
}
