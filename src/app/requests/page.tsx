import Link from "next/link";
import { Flash, StateChip } from "@/components";
import { dstr, etb, STATE_LABEL } from "@/lib/format";
import { withUser } from "@/lib/db";
import { requireAccess } from "@/lib/rbac";
import { currentUserId, requireMe, hasPermission } from "@/lib/session";

export default async function Requests({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/requests");
  const state = sp.state && STATE_LABEL[sp.state] ? sp.state : null;
  const rows = await withUser(uid, (tx) => tx.q<any>(
    `SELECT r.id, r.request_no, c.legal_name AS company, s.legal_name AS supplier, r.total_amount, r.workflow_state, r.priority, a.account_label AS account,
            (SELECT min(due_date) FROM payment_installments WHERE request_id = r.id) AS due
     FROM payment_requests r JOIN companies c ON c.id = r.debtor_company_id JOIN suppliers s ON s.id = r.supplier_id
     LEFT JOIN company_bank_accounts a ON a.id = r.debit_account_id
     WHERE ($1::text IS NULL OR r.workflow_state::text = $1) ORDER BY r.created_at DESC LIMIT 200`, [state]));
  return (
    <>
      <div className="row"><div><h1>Payment requests</h1><p className="sub">Requests from the companies you can see.</p></div>
        {hasPermission(me, "payment_request:create") && <Link className="btn" href="/requests/new">New request</Link>}</div>
      <Flash sp={sp} />
      <div className="inline" style={{ marginBottom: 12 }}>
        <Link className={`btn ${state ? "sec" : ""}`} href="/requests">All</Link>
        {Object.keys(STATE_LABEL).map((s) => <Link key={s} className={`btn ${state === s ? "" : "sec"}`} href={`/requests?state=${s}`}>{STATE_LABEL[s]}</Link>)}
      </div>
      <div className="card scroll"><table><thead><tr><th>No.</th><th>Company</th><th>Supplier</th><th className="n">Amount</th><th>Debit account</th><th>First due</th><th>Priority</th><th>Status</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}><td><Link href={`/requests/${r.id}`}>{r.request_no}</Link></td><td>{r.company}</td><td>{r.supplier}</td><td className="n">{etb(r.total_amount)}</td><td>{r.account ?? "—"}</td><td>{dstr(r.due)}</td>
            <td>{r.priority === "NORMAL" ? "" : r.priority}</td><td><StateChip state={r.workflow_state} /></td></tr>))}
          {rows.length === 0 && <tr><td colSpan={8} className="mute">Nothing here yet.</td></tr>}</tbody></table></div>
    </>
  );
}
