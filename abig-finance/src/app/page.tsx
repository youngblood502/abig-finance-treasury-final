import Link from "next/link";
import { Flash, ShortfallChip } from "@/components";
import { dtime, etb } from "@/lib/format";
import { withUser } from "@/lib/db";
import { canAccess } from "@/lib/rbac";
import { currentUserId, requireMe } from "@/lib/session";

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  const showRequests = canAccess(me, "/requests"), showAccounts = canAccess(me, "/accounts"), showApprovals = canAccess(me, "/approvals");
  // Everything below is read through row-level security, so each person sees only the companies and accounts they belong to
  // (administrators see all of them).
  const d = await withUser(uid, async (tx) => {
    const actionable = showApprovals ? (await tx.q<{ n: number }>("SELECT count(*)::int AS n FROM app_actionable_requests()"))[0].n : 0;
    const byState = showRequests ? await tx.q<{ s: string; n: number; amt: string }>("SELECT workflow_state::text AS s, count(*)::int AS n, COALESCE(sum(total_amount), 0) AS amt FROM payment_requests GROUP BY 1") : [];
    const accounts = showAccounts ? await tx.q<any>(
      `SELECT a.id, a.account_label, b.name AS bank_name, a.account_last4, a.is_active, a.current_balance, a.reserved_balance, a.available_balance, a.shortfall_amount, a.balance_updated_at,
              COALESCE((SELECT array_agg(c.legal_name ORDER BY g.is_owner DESC, c.legal_name) FROM company_bank_account_access g JOIN companies c ON c.id = g.company_id WHERE g.account_id = a.id AND g.revoked_at IS NULL), '{}') AS companies
         FROM company_bank_accounts a JOIN banks b ON b.id = a.bank_id ORDER BY a.account_label`) : [];
    return { actionable, byState, accounts };
  });
  const st = (s: string) => d.byState.find((x) => x.s === s);
  const active = d.accounts.filter((a: any) => a.is_active);
  const sum = (k: string) => active.reduce((t: number, a: any) => t + Number(a[k]), 0);
  const current = sum("current_balance"), reserved = sum("reserved_balance"), available = sum("available_balance");
  return (
    <>
      <h1>Dashboard</h1><p className="sub">What needs attention, and where the cash is.</p><Flash sp={sp} />
      {showAccounts && (<>
        <h2>Cash across your accounts</h2>
        <div className="figs">
          <div className="card"><b>{etb(current)}</b><span>Current balance (what is in the banks)</span></div>
          <div className="card"><b>{etb(reserved)}</b><span>Reserved for payment requests in review</span></div>
          <div className="card"><b>{etb(available)}</b><span>Available to reserve</span></div>
        </div>
        <p className="mute">{active.length} active account{active.length === 1 ? "" : "s"}; a shared account is counted once. Available = current minus reserved minus the minimum buffer.</p>
      </>)}
      {showRequests && (<>
        <h2>Payment requests</h2>
        <div className="figs">
          {showApprovals && <Link href="/approvals" className="card" style={{ textDecoration: "none", color: "inherit" }}><b>{d.actionable}</b><span>Waiting for your approval</span></Link>}
          <div className="card"><b>{st("DRAFT")?.n ?? 0}</b><span>Drafts</span></div>
          <div className="card"><b>{(st("RESERVED")?.n ?? 0) + (st("VERIFIED")?.n ?? 0)}</b><span>In review, funds reserved ({etb(Number(st("RESERVED")?.amt ?? 0) + Number(st("VERIFIED")?.amt ?? 0))})</span></div>
          <div className="card"><b>{st("AUTHENTICATED")?.n ?? 0}</b><span>Authenticated, not yet paid ({etb(st("AUTHENTICATED")?.amt ?? 0)})</span></div>
          <div className="card"><b>{st("PAID")?.n ?? 0}</b><span>Paid ({etb(st("PAID")?.amt ?? 0)})</span></div>
        </div>
      </>)}
      {showAccounts && (<>
        <h2>Bank accounts</h2>
        {d.accounts.length === 0 && <div className="card">No bank accounts are available to you.</div>}
        {d.accounts.length > 0 && (
          <div className="card scroll"><table><thead><tr><th>Account</th><th>Companies</th><th className="n">Current</th><th className="n">Reserved</th><th className="n">Available</th><th>Updated</th></tr></thead>
            <tbody>{d.accounts.map((a: any) => (
              <tr key={a.id}><td><b>{a.account_label}</b><div className="mute">{a.bank_name} ••••{a.account_last4}{!a.is_active && " · inactive"}</div><ShortfallChip amount={a.shortfall_amount} /></td>
                <td>{a.companies.map((c: string) => <span className="chip o" key={c}>{c}</span>)}</td>
                <td className="n">{etb(a.current_balance)}</td><td className="n">{etb(a.reserved_balance)}</td><td className="n"><b>{etb(a.available_balance)}</b></td>
                <td>{a.balance_updated_at ? dtime(a.balance_updated_at) : <span className="chip w">No balance entered</span>}</td></tr>))}
              <tr><td colSpan={2}><b>Total</b></td><td className="n"><b>{etb(current)}</b></td><td className="n"><b>{etb(reserved)}</b></td><td className="n"><b>{etb(available)}</b></td><td></td></tr></tbody></table></div>)}
      </>)}
      {!showRequests && !showAccounts && <div className="card">Your role has no dashboard content. Ask an administrator to give you access.</div>}
    </>
  );
}
