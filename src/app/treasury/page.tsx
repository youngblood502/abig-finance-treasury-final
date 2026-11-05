import Link from "next/link";
import { Flash } from "@/components";
import { dstr, dtime, WEEK_STATUS } from "@/lib/format";
import { withUser } from "@/lib/db";
import { requireAccess } from "@/lib/rbac";
import { currentUserId, requireMe } from "@/lib/session";

export default async function Treasury({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/treasury");
  const weeks = await withUser(uid, (tx) => tx.q<any>("SELECT * FROM account_week_status()"));
  return (
    <>
      <h1>Weekly treasury</h1><p className="sub">Each account&apos;s week: opening balance, balance checks and reconciliation. Weeks run Monday to Sunday.</p><Flash sp={sp} />
      {weeks.length === 0 && <div className="card">No accounts are available to you.</div>}
      {weeks.length > 0 && <div className="card scroll"><table><thead><tr><th>Account</th><th>Week of</th><th>Opening</th><th>Last figure</th><th className="n">Outstanding</th><th>Status</th></tr></thead>
        <tbody>{weeks.map((w: any) => (
          <tr key={w.account_id}><td><Link href={`/treasury/${w.account_id}`}><b>{w.account_label}</b></Link></td><td>{dstr(w.week_start)}</td>
            <td>{w.has_opening ? "Recorded" : <span className="chip w">Not recorded</span>}</td><td>{w.last_figure_at ? dtime(w.last_figure_at) : "None"}</td>
            <td className="n">{w.outstanding_count}{w.overdue_count > 0 && <span className="chip b">{w.overdue_count} over 14 days</span>}</td><td>{WEEK_STATUS[w.status]}</td></tr>))}</tbody></table></div>}
    </>
  );
}
