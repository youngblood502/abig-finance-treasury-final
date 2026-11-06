import { Flash, ShortfallChip } from "@/components";
import Link from "next/link";
import { grantAccess, registerAccount, revokeAccess, setAccountPolicy, setDepositAlert } from "../actions";
import { companyScope } from "@/lib/company-scope";
import { BalanceLog } from "@/components/treasury/balance-log";
import { Button } from "@/components/ui/button";
import { SidePanel } from "@/components/ui/side-panel";
import { RESERVED_LABEL, SHARED_RESERVED_HINT } from "@/lib/dashboard";
import { ACCOUNT_KINDS, accountPlace, dtime, etb } from "@/lib/format";
import { withUser } from "@/lib/db";
import { canAccess, requireAccess } from "@/lib/rbac";
import { currentUserId, requireMe, hasPermission } from "@/lib/session";
import { accountList } from "@/lib/treasury-screens";

export default async function Accounts({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/accounts");
  const company = await companyScope(uid);
  const d = await withUser(uid, async (tx) => {
    // Who may update or manage an account is decided in the database (app_can_snapshot / app_can_manage_access).
    const accounts = await accountList(tx, company);
    const companies = await tx.q<{ id: string; legal_name: string }>("SELECT id, legal_name FROM company_directory() WHERE is_active");
    return { accounts, companies };
  });
  const registrars = me.memberships.filter((m) => hasPermission(me, "bank_account:manage", m.company_id));
  const active = d.accounts.filter((a) => a.is_active);
  const anyShared = active.some((a) => a.users.length > 1);
  const totalCurrent = active.reduce((s, a) => s + Number(a.current_balance), 0);
  const totalReserved = active.reduce((s, a) => s + Number(a.reserved_balance), 0);
  const totalAvailable = active.reduce((s, a) => s + Number(a.available_balance), 0);
  return (
    <>
      <h1>Accounts</h1><p className="sub">One balance per account, however many companies share it.</p><Flash sp={sp} />
      {d.accounts.length === 0 && <div className="card">No bank accounts are available to you.</div>}
      {d.accounts.length > 0 && (<>
        <h2>Account Cash Summary</h2>
        <div className="figs">
          <div className="card"><b>{etb(totalCurrent)}</b><span>Total current balance</span></div>
          <div className="card"><b>{etb(totalReserved)}</b><span>{RESERVED_LABEL}{anyShared ? `. ${SHARED_RESERVED_HINT}` : ""}</span></div>
          <div className="card"><b>{etb(totalAvailable)}</b><span>Net available cash (after minimum buffers)</span></div>
        </div>
        <p className="mute">Across {active.length} active account{active.length === 1 ? "" : "s"}. Each shared account is counted once.</p>
      </>)}
      {d.accounts.map((a) => (
        <div className="card" key={a.id}>
          <div className="row"><div><b>{a.account_label}</b> <span className="mute">{accountPlace(a)}</span><div className="mute">Legal owner: {a.owner ?? "none"}</div></div>
            <div style={{ textAlign: "right" }}><b>{etb(a.available_balance)}</b><div className="mute">available</div></div></div>
          <div className="figs" style={{ marginTop: 10 }}>
            <div className="card"><b>{etb(a.current_balance)}</b><span>Current balance</span></div>
            <div className="card"><b>{etb(a.reserved_balance)}</b><span>Reserved on this account{a.users.length > 1 ? ", all companies" : ""}</span></div>
            <div className="card"><b>{etb(a.available_balance)}</b><span>Available (current minus reserved minus {etb(a.min_buffer)} buffer)</span></div>
          </div>
          <div className="mute">{a.balance_updated_at ? `Balance last updated ${dtime(a.balance_updated_at)}` : "No balance has been entered yet"}</div>
          <div style={{ marginTop: 6 }}>{a.users.map((u) => <span className="chip" key={u.id}>{u.name}{u.is_owner ? " (owner)" : ""} can use{u.permissions.includes("RECORD_SNAPSHOT") ? " and update the balance" : ""}</span>)}
            <ShortfallChip amount={a.shortfall_amount} />{!a.is_active && <span className="chip b">Inactive</span>}</div>
          {a.is_active && (a.can_update || canAccess(me, "/treasury")) && <p style={{ marginTop: 10 }}><Link href={`/treasury/${a.id}`}>{a.can_update ? "Enter a balance check" : "Open this account's week"}</Link></p>}
          <div style={{ marginTop: 10 }}><SidePanel title={`${a.account_label}: balance log`} description="The latest 25 entries." trigger={<Button variant="outline" size="sm">Balance log</Button>}><BalanceLog entries={a.history} access={a.access} pageSize={10} /></SidePanel></div>
          {a.can_manage && (
            <details style={{ marginTop: 10 }}><summary>Manage this account</summary>
              <form action={setAccountPolicy} className="form" style={{ marginTop: 8 }}><input type="hidden" name="account" value={a.id} />
                <label className="f">Minimum buffer to keep (ETB)<input name="buffer" type="number" min="0" step="0.01" defaultValue={Number(a.min_buffer)} /></label>
                <button>Save policy</button></form>
              <form action={setDepositAlert} className="form" style={{ marginTop: 8 }}><input type="hidden" name="account" value={a.id} />
                <label className="f">Flag an implied deposit above (ETB)<input name="threshold" type="number" min="0.01" step="0.01" defaultValue={Number(a.large_deposit_threshold)} /></label>
                <button>Save</button></form>
              <h3 style={{ fontSize: 14 }}>Companies that share it</h3>
              {a.users.filter((u) => !u.is_owner).map((u) => <div key={u.id} className="inline"><span className="chip">{u.name}{u.permissions.includes("RECORD_SNAPSHOT") ? " (can also update the balance)" : ""}</span><form action={revokeAccess}><input type="hidden" name="id" value={u.id} /><button className="sec">Withdraw</button></form></div>)}
              <form action={grantAccess} className="form" style={{ marginTop: 8 }}><input type="hidden" name="account" value={a.id} />
                <label className="f">Allow company<select name="company">{d.companies.filter((c) => !a.users.some((u) => u.name === c.legal_name)).map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}</select></label>
                <label className="f">Also<span className="inline"><input type="checkbox" name="snapshot" />May update the balance</span></label><button>Grant access</button></form>
            </details>)}
        </div>))}
      {registrars.length > 0 && (<>
        <h2>Register an account</h2>
        <p className="mute">A bank account needs its bank and last 4 digits, a Telebirr wallet its phone number, and a cash account only a name.</p>
        <form action={registerAccount} className="card form"><label className="f">Owned by<select name="owner">{registrars.map((m) => <option key={m.company_id} value={m.company_id}>{m.company}</option>)}</select></label>
          <label className="f">Type<select name="kind" defaultValue="BANK">{Object.entries(ACCOUNT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="f">Account name<input name="label" required /></label><label className="f">Bank<input name="bank" /></label><label className="f">Last 4 digits<input name="last4" pattern="[0-9]{4}" maxLength={4} /></label>
          <label className="f">Telebirr phone<input name="phone" type="tel" placeholder="0911 234 567" /></label>
          <label className="f">Minimum buffer (ETB)<input name="buffer" type="number" min="0" step="0.01" defaultValue={0} /></label><button>Register</button></form></>)}
    </>
  );
}
