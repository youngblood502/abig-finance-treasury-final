import { Flash } from "@/components";
import { grantAccess, registerAccount, revokeAccess, setAccountPolicy, updateBalance } from "../actions";
import { dtime, etb } from "@/lib/format";
import { withUser } from "@/lib/db";
import { requireAccess } from "@/lib/rbac";
import { currentUserId, requireMe, hasPermission } from "@/lib/session";

export default async function Accounts({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/accounts");
  const d = await withUser(uid, async (tx) => {
    // Who may update or manage an account is decided in the database (app_can_snapshot / app_can_manage_access).
    const accounts = await tx.q<any>(
      `SELECT a.id, a.account_label, b.name AS bank_name, a.account_last4, a.owner_approval_required, a.min_buffer, a.is_active,
              a.current_balance, a.reserved_balance, a.available_balance, a.balance_updated_at,
              o.id AS owner_company_id, o.legal_name AS owner,
              app_can_snapshot(a.id) AS can_update, app_can_manage_access(a.id) AS can_manage
         FROM company_bank_accounts a JOIN banks b ON b.id = a.bank_id LEFT JOIN companies o ON o.id = account_owner_company(a.id)
        ORDER BY a.account_label`);
    for (const a of accounts) {
      a.users = await tx.q<any>("SELECT g.id, c.legal_name AS name, g.is_owner, g.permissions FROM company_bank_account_access g JOIN companies c ON c.id = g.company_id WHERE g.account_id = $1 AND g.revoked_at IS NULL ORDER BY g.is_owner DESC, c.legal_name", [a.id]);
      a.history = await tx.q<any>("SELECT * FROM account_balance_history($1, 10)", [a.id]);
    }
    const companies = await tx.q<any>("SELECT * FROM company_directory() WHERE is_active");
    return { accounts, companies };
  });
  const registrars = me.memberships.filter((m) => hasPermission(me, "bank_account:manage", m.company_id));
  const active = d.accounts.filter((a: any) => a.is_active);
  const totalCurrent = active.reduce((s: number, a: any) => s + Number(a.current_balance), 0);
  const totalReserved = active.reduce((s: number, a: any) => s + Number(a.reserved_balance), 0);
  return (
    <>
      <h1>Bank accounts</h1><p className="sub">One balance per account, however many companies share it.</p><Flash sp={sp} />
      {d.accounts.length === 0 && <div className="card">No bank accounts are available to you.</div>}
      {d.accounts.length > 0 && (<>
        <h2>Account Cash Summary</h2>
        <div className="figs">
          <div className="card"><b>{etb(totalCurrent)}</b><span>Total current balance</span></div>
          <div className="card"><b>{etb(totalReserved)}</b><span>Total reserved balance (held for active payment requests)</span></div>
          <div className="card"><b>{etb(totalCurrent - totalReserved)}</b><span>Net available cash</span></div>
        </div>
        <p className="mute">Across {active.length} active account{active.length === 1 ? "" : "s"}. Each shared account is counted once.</p>
      </>)}
      {d.accounts.map((a: any) => (
        <div className="card" key={a.id}>
          <div className="row"><div><b>{a.account_label}</b> <span className="mute">{a.bank_name} ••••{a.account_last4}</span><div className="mute">Legal owner: {a.owner ?? "none"}{a.owner_approval_required ? " · owner approval required for other companies" : ""}</div></div>
            <div style={{ textAlign: "right" }}><b>{etb(a.available_balance)}</b><div className="mute">available</div></div></div>
          <div className="figs" style={{ marginTop: 10 }}>
            <div className="card"><b>{etb(a.current_balance)}</b><span>Current balance</span></div>
            <div className="card"><b>{etb(a.reserved_balance)}</b><span>Reserved</span></div>
            <div className="card"><b>{etb(a.available_balance)}</b><span>Available (current minus reserved)</span></div>
          </div>
          <div className="mute">{a.balance_updated_at ? `Balance last updated ${dtime(a.balance_updated_at)}` : "No balance has been entered yet"}</div>
          <div style={{ marginTop: 6 }}>{a.users.map((u: any) => <span className="chip" key={u.id}>{u.name}{u.is_owner ? " (owner)" : ""} can use{u.permissions.includes("RECORD_SNAPSHOT") ? " and update the balance" : ""}</span>)}
            {Number(a.available_balance) < 0 && <span className="chip b">Reserved funds exceed the balance</span>}{!a.is_active && <span className="chip b">Inactive</span>}</div>
          {a.can_update && (
            <form action={updateBalance} className="form" style={{ marginTop: 10 }}><input type="hidden" name="account" value={a.id} />
              <label className="f">Total amount now in the bank (ETB)<input name="balance" type="number" step="0.01" min="0" required placeholder={String(Number(a.current_balance))} /></label>
              <button>Update balance</button></form>)}
          {a.can_update && <p className="mute">Enter the overall amount in the bank account, not a single transaction. It cannot be lower than the reserved {etb(a.reserved_balance)}.</p>}
          <details style={{ marginTop: 10 }}><summary>Balance history</summary>
            {a.history.length === 0 ? <p className="mute">No balance updates yet.</p> : (
              <div className="scroll"><table><thead><tr><th>When</th><th className="n">Previous</th><th className="n">New</th><th>Reason</th><th>By</th></tr></thead>
                <tbody>{a.history.map((h: any) => <tr key={h.id}><td>{dtime(h.updated_at)}</td><td className="n">{etb(h.previous_balance)}</td><td className="n">{etb(h.new_balance)}</td><td>{h.request_no ? `Payment ${h.request_no}` : "Bank balance entered"}</td><td>{h.updated_by_name}</td></tr>)}</tbody></table></div>)}
            {a.history.length === 10 && <p className="mute">The 10 most recent updates are shown.</p>}
          </details>
          {a.can_manage && (
            <details style={{ marginTop: 10 }}><summary>Manage this account</summary>
              <form action={setAccountPolicy} className="form" style={{ marginTop: 8 }}><input type="hidden" name="account" value={a.id} />
                <label className="f">Minimum buffer to keep (ETB)<input name="buffer" type="number" min="0" step="0.01" defaultValue={Number(a.min_buffer)} /></label>
                <label className="f">Other companies<span className="inline"><input type="checkbox" name="approval" defaultChecked={a.owner_approval_required} />Need my approval for each payment</span></label><button>Save policy</button></form>
              <h3 style={{ fontSize: 14 }}>Companies that share it</h3>
              {a.users.filter((u: any) => !u.is_owner).map((u: any) => <div key={u.id} className="inline"><span className="chip">{u.name}{u.permissions.includes("RECORD_SNAPSHOT") ? " (can also update the balance)" : ""}</span><form action={revokeAccess}><input type="hidden" name="id" value={u.id} /><button className="sec">Withdraw</button></form></div>)}
              <form action={grantAccess} className="form" style={{ marginTop: 8 }}><input type="hidden" name="account" value={a.id} />
                <label className="f">Allow company<select name="company">{d.companies.filter((c: any) => !a.users.some((u: any) => u.name === c.legal_name)).map((c: any) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}</select></label>
                <label className="f">Also<span className="inline"><input type="checkbox" name="snapshot" />May update the balance</span></label><button>Grant access</button></form>
            </details>)}
        </div>))}
      {registrars.length > 0 && (<>
        <h2>Register a bank account</h2>
        <form action={registerAccount} className="card form"><label className="f">Owned by<select name="owner">{registrars.map((m) => <option key={m.company_id} value={m.company_id}>{m.company}</option>)}</select></label>
          <label className="f">Bank<input name="bank" required /></label><label className="f">Account name<input name="label" required /></label><label className="f">Last 4 digits<input name="last4" required pattern="[0-9]{4}" maxLength={4} /></label>
          <label className="f">Minimum buffer (ETB)<input name="buffer" type="number" min="0" step="0.01" defaultValue={0} /></label><label className="f">Other companies<span className="inline"><input type="checkbox" name="approval" />Need my approval</span></label><button>Register</button></form></>)}
    </>
  );
}
