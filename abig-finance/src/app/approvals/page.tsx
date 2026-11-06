import Link from "next/link";
import { Flash } from "@/components";
import { workflowAction } from "../actions";
import { accountPlace, dstr, dtime, etb } from "@/lib/format";
import { companyScope } from "@/lib/company-scope";
import { withUser } from "@/lib/db";
import { requireAccess } from "@/lib/rbac";
import { currentUserId, requireMe, hasPermission } from "@/lib/session";
import { APPROVAL_STAGES, type ApprovalStage } from "@/lib/workflow";

export default async function Approvals({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const me = await requireMe();
  requireAccess(me, "/approvals");
  // The database decides what is waiting for this person (app_actionable_requests): Finance Managers get RESERVED requests,
  // Owners get VERIFIED ones, never their own and never one they already handled at the other stage.
  const uid = await currentUserId(), company = await companyScope(uid);
  const rows = await withUser(uid, (tx) => tx.q<any>(
    `SELECT a.*, c.legal_name AS company, COALESCE(s.legal_name, p.full_name) AS payee, u.full_name AS creator, vu.full_name AS verifier, r.verified_at,
            da.account_label, da.account_kind::text AS account_kind, da.wallet_phone, da.account_last4, dk.name AS bank_name, da.available_balance,
            EXISTS (SELECT 1 FROM attachments f WHERE f.request_id = a.request_id) AS has_document,
            (SELECT min(due_date) FROM payment_installments WHERE request_id = a.request_id) AS due
     FROM app_actionable_requests() a JOIN payment_requests r ON r.id = a.request_id JOIN companies c ON c.id = a.debtor_company_id
     LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN person_payees p ON p.id = r.person_payee_id LEFT JOIN users u ON u.id = r.created_by LEFT JOIN users vu ON vu.id = r.verified_by
     LEFT JOIN company_bank_accounts da ON da.id = r.debit_account_id LEFT JOIN banks dk ON dk.id = da.bank_id
     WHERE ($1::uuid IS NULL OR a.debtor_company_id = $1) ORDER BY a.waiting_since`, [company]));
  const stages = (Object.keys(APPROVAL_STAGES) as ApprovalStage[]).filter((s) => hasPermission(me, APPROVAL_STAGES[s].permission));
  return (
    <>
      <h1>Approvals</h1>
      <p className="sub">Requests waiting for you. Open a request to inspect it, its documents and its history before you act.</p><Flash sp={sp} />
      {stages.length === 0 && <div className="card">Approvals are done by Finance Managers (verification) and Owners (authentication). Your role has no approval step.</div>}
      {stages.map((stage) => {
        const st = APPROVAL_STAGES[stage]; const list = rows.filter((r) => r.stage === stage);
        return (
          <div key={stage}>
            <h2>{st.title} <span className="mute">({st.role})</span></h2>
            <div className="card scroll"><table><thead><tr><th>No.</th><th>Company</th><th>Payee</th><th>Debit account</th><th className="n">Amount</th><th>First due</th><th>Entered by</th>{stage === "AUTHORIZATION" && <th>Verified by</th>}<th>Waiting since</th><th></th></tr></thead>
              <tbody>{list.map((r) => (
                <tr key={r.request_id}>
                  <td><Link href={`/requests/${r.request_id}`}>{r.request_no}</Link><div className="mute"><Link href={`/requests/${r.request_id}`}>Inspect</Link></div></td>
                  <td>{r.company}</td><td>{r.payee}{!r.has_document && <div><span className="chip w">No document</span></div>}</td><td>{r.account_label ? `${r.account_label} · ${accountPlace(r)}` : "—"}</td>
                  <td className="n">{etb(r.total_amount)}</td><td>{dstr(r.due)}</td><td>{r.creator}</td>
                  {stage === "AUTHORIZATION" && <td>{r.verifier}<div className="mute">{dtime(r.verified_at)}</div></td>}
                  <td>{dtime(r.waiting_since)}</td>
                  <td>
                    <form action={workflowAction}><input type="hidden" name="id" value={r.request_id} /><input type="hidden" name="version" value={r.request_version} />
                      <input type="hidden" name="action" value={st.action} /><input type="hidden" name="back" value="approvals" /><button>{st.label}</button></form>
                    {stage === "AUTHORIZATION" && <div className="mute" style={{ maxWidth: 220 }}>Debits {etb(r.total_amount)} from the account and releases the reserved funds.</div>}
                  </td>
                </tr>))}
                {list.length === 0 && <tr><td colSpan={stage === "AUTHORIZATION" ? 10 : 9} className="mute">Nothing is waiting for you.</td></tr>}</tbody></table></div>
          </div>);
      })}
    </>
  );
}
