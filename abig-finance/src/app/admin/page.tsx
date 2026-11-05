import Link from "next/link";
import { cookies } from "next/headers";
import { Flash } from "@/components";
import { addGroupGrant, createCompany, createRole, createUser, resetMfa, resetPassword, revokeGroupGrant, revokeMembership, saveRole, saveRolePermissions, setAdmin, setMembershipRoles, setUserActive, unlockUser, updateCompany } from "../admin-actions";
import { dtime } from "@/lib/format";
import { withUser } from "@/lib/db";
import { requireAccess, roleCannotHold } from "@/lib/rbac";
import { requireMe } from "@/lib/session";

const TABS: [string, string][] = [["users", "People and access"], ["companies", "Companies"], ["roles", "Roles and permissions"], ["activity", "Activity"]];

export default async function Admin({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const me = await requireMe(); requireAccess(me, "/admin");
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "users";
  const secret = (await cookies()).get("abig_flash_secret")?.value;
  const d = await withUser(me.id, async (tx) => ({
    companies: await tx.q<any>("SELECT * FROM company_directory()"),
    roles: await tx.q<any>("SELECT r.*, (SELECT count(*) FROM membership_roles mr JOIN company_memberships m ON m.id = mr.membership_id AND m.revoked_at IS NULL WHERE mr.role_id = r.id)::int AS people FROM roles r ORDER BY r.is_system DESC, r.name"),
    users: tab === "users" ? await tx.q<any>("SELECT id, email, full_name, is_system_admin, is_active, must_change_password, totp_enabled, locked_until FROM users ORDER BY full_name") : [],
    members: tab === "users" ? await tx.q<any>(`SELECT m.id, m.user_id, c.legal_name AS company, COALESCE((SELECT array_agg(r.name ORDER BY r.name) FROM membership_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.membership_id = m.id), '{}') AS roles
                                                 FROM company_memberships m JOIN companies c ON c.id = m.company_id WHERE m.revoked_at IS NULL ORDER BY c.legal_name`) : [],
    grants: tab === "users" ? await tx.q<any>("SELECT g.id, g.user_id, c.legal_name AS company FROM group_permission_grants g JOIN companies c ON c.id = g.company_id WHERE g.revoked_at IS NULL ORDER BY c.legal_name") : [],
    perms: tab === "roles" ? await tx.q<any>("SELECT id, code, resource, action, description FROM permissions ORDER BY resource, action") : [],
    rolePerms: tab === "roles" ? await tx.q<any>("SELECT role_id, permission_id FROM role_permissions") : [],
    events: tab === "activity" ? await tx.q<any>("SELECT occurred_at, email, event, ip, detail FROM auth_events ORDER BY occurred_at DESC LIMIT 25") : [],
    changes: tab === "activity" ? await tx.q<any>("SELECT e.occurred_at, u.full_name AS actor, e.action, e.metadata FROM audit_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.action ~ '^(ROLE_|MEMBERSHIP_|ADMIN_|COMPANY_|USER_|GROUP_)' ORDER BY e.occurred_at DESC LIMIT 25") : [],
  }));
  const activeRoles = d.roles.filter((r: any) => r.is_active);
  const companyOpts = d.companies.map((c: any) => <option key={c.id} value={c.id}>{c.legal_name}</option>);
  const userOpts = d.users.filter((u: any) => u.is_active).map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>);
  const limit = (r: any) => (r.max_companies ? `${r.max_companies} company${r.max_companies === 1 ? "" : "ies"} at most`.replace("companys", "companies") : "any number of companies");
  return (
    <>
      <h1>Administration</h1>
      <p className="sub">People, companies, roles and permissions. Administrators have full access to the system; the same separation-of-duties rules apply to them as to everyone.</p><Flash sp={sp} />
      {secret && <div className="note ok" role="status"><b>{secret}</b><div className="mute">Shown once. Give it to the person privately; they must change it at first sign-in.</div></div>}
      <div className="inline" style={{ marginBottom: 12 }}>{TABS.map(([k, l]) => <Link key={k} className={k === tab ? "btn" : "btn sec"} href={`/admin?tab=${k}`}>{l}</Link>)}</div>

      {tab === "users" && (<>
        <h2>People</h2>
        <div className="card scroll"><table><thead><tr><th>Person</th><th>Access</th><th>Status</th><th></th></tr></thead><tbody>
          {d.users.map((u: any) => (
            <tr key={u.id}>
              <td><b>{u.full_name}</b><div className="mute">{u.email}</div></td>
              <td>{d.members.filter((m: any) => m.user_id === u.id).map((m: any) => (
                <div key={m.id} className="inline"><span className="chip">{m.company}: {m.roles.join(", ")}</span>
                  <form action={revokeMembership}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="user" value={u.id} /><button className="sec" aria-label={`Remove ${m.company} access`}>Remove</button></form></div>))}
                {d.grants.filter((g: any) => g.user_id === u.id).map((g: any) => (
                  <div key={g.id} className="inline"><span className="chip o">Group reports: {g.company}</span>
                    <form action={revokeGroupGrant}><input type="hidden" name="id" value={g.id} /><input type="hidden" name="user" value={u.id} /><button className="sec">Remove</button></form></div>))}
                {u.is_system_admin && <span className="chip w">System administrator</span>}</td>
              <td>{u.is_active ? <span className="chip">Active</span> : <span className="chip b">Deactivated</span>}{u.must_change_password && <span className="chip w">Temporary password</span>}{u.totp_enabled ? <span className="chip">Two-step on</span> : <span className="chip o">Two-step off</span>}{u.locked_until && new Date(u.locked_until) > new Date() && <span className="chip b">Locked</span>}</td>
              <td><div className="inline">
                <form action={resetPassword}><input type="hidden" name="user" value={u.id} /><input type="hidden" name="label" value={u.full_name} /><button className="sec">Reset password</button></form>
                {u.locked_until && new Date(u.locked_until) > new Date() && <form action={unlockUser}><input type="hidden" name="user" value={u.id} /><button className="sec">Unlock</button></form>}
                {u.totp_enabled && <form action={resetMfa}><input type="hidden" name="user" value={u.id} /><button className="sec">Reset two-step</button></form>}
                <form action={setUserActive}><input type="hidden" name="user" value={u.id} /><input type="hidden" name="active" value={u.is_active ? "0" : "1"} /><button className="sec">{u.is_active ? "Deactivate" : "Reactivate"}</button></form>
                <form action={setAdmin}><input type="hidden" name="user" value={u.id} /><input type="hidden" name="on" value={u.is_system_admin ? "0" : "1"} /><button className="sec">{u.is_system_admin ? "Remove admin" : "Make admin"}</button></form>
              </div></td>
            </tr>))}</tbody></table></div>

        <h2>Add a person</h2>
        <form action={createUser} className="card form"><label className="f">Full name<input name="name" required /></label><label className="f">Work email<input name="email" type="email" required /></label><button>Create with a temporary password</button></form>

        <h2>Give roles in a company</h2>
        <form action={setMembershipRoles} className="card">
          <div className="form"><label className="f">Person<select name="user">{userOpts}</select></label><label className="f">Company<select name="company">{companyOpts}</select></label></div>
          <div className="inline" style={{ margin: "12px 0" }}>{activeRoles.map((r: any) => <label key={r.id} className="inline" style={{ gap: 4 }}><input type="checkbox" name="roles" value={r.id} />{r.name} <span className="mute">({limit(r)})</span></label>)}</div>
          <p className="mute">Saving replaces the person&apos;s roles in that company. A role limited to some number of companies is refused once the person holds it in that many; an Accountant belongs to one company only.</p><button>Save roles</button>
        </form>

        <h2>Allow group reporting for a company</h2>
        <form action={addGroupGrant} className="card form"><label className="f">Person<select name="user">{userOpts}</select></label><label className="f">Company<select name="company">{companyOpts}</select></label><button>Allow read-only reporting</button></form>
      </>)}

      {tab === "companies" && (<>
        <h2>Companies</h2>
        {d.companies.map((c: any) => (
          <div className="card" key={c.id}>
            <div className="row"><div><b>{c.legal_name}</b> <span className="mute">{c.code}</span>{!c.is_active && <span className="chip b">Inactive</span>}</div><div className="mute">TIN {c.tin_number} · {c.phone}</div></div>
            <details style={{ marginTop: 8 }}><summary className="mute">Edit</summary>
              <form action={updateCompany} className="form" style={{ marginTop: 8 }}><input type="hidden" name="id" value={c.id} />
                <label className="f">Company name<input name="name" defaultValue={c.legal_name} required /></label>
                <label className="f">TIN number<input name="tin" defaultValue={c.tin_number} required pattern="[0-9A-Za-z\-]{6,20}" /></label>
                <label className="f">Phone<input name="phone" defaultValue={c.phone} required /></label>
                <label className="f">Status<span className="inline"><input type="checkbox" name="active" defaultChecked={c.is_active} />Active</span></label><button>Save</button></form>
              <p className="mute">The code ({c.code}) never changes. A company cannot be deactivated while it has payment requests waiting for approval.</p></details>
          </div>))}
        <h2>Add a company</h2>
        <form action={createCompany} className="card form"><label className="f">Code (capitals)<input name="code" required pattern="[A-Z0-9_]{2,20}" /></label><label className="f">Company name<input name="name" required /></label>
          <label className="f">TIN number<input name="tin" required pattern="[0-9A-Za-z\-]{6,20}" /></label><label className="f">Phone<input name="phone" required /></label><button>Add company</button></form>
      </>)}

      {tab === "roles" && (<>
        <h2>Roles</h2>
        <p className="mute">A role&apos;s company limit says in how many companies one person may hold it. Accountants are fixed at one company. Finance Managers and Owners can be set to one, several or no limit.</p>
        {d.roles.map((r: any) => {
          const have = new Set(d.rolePerms.filter((x: any) => x.role_id === r.id).map((x: any) => x.permission_id));
          return (
            <div className="card" key={r.id}>
              <div className="row"><div><b>{r.name}</b> <span className="mute">{r.code} · {r.people} {r.people === 1 ? "person" : "people"} · {limit(r)}</span>{r.is_system && <span className="chip o">Built in</span>}{!r.is_active && <span className="chip b">Off</span>}</div></div>
              <form action={saveRole} className="form" style={{ marginTop: 8 }}><input type="hidden" name="id" value={r.id} />
                <label className="f">Name<input name="name" defaultValue={r.name} required /></label>
                <label className="f">Description<input name="description" defaultValue={r.description ?? ""} /></label>
                <label className="f">Most companies per person (empty = no limit)<input name="max" type="number" min={1} defaultValue={r.max_companies ?? ""} readOnly={r.code === "ACCOUNTANT"} /></label>
                <label className="f">Status<span className="inline"><input type="checkbox" name="active" defaultChecked={r.is_active} />In use</span></label><button>Save role</button></form>
              <details style={{ marginTop: 8 }}><summary className="mute">Permissions ({have.size})</summary>
                <form action={saveRolePermissions} style={{ marginTop: 8 }}><input type="hidden" name="role" value={r.id} />
                  <div className="scroll"><table><tbody>{d.perms.map((p: any) => { const why = roleCannotHold(r.code, p.code); return (
                    <tr key={p.id}><td style={{ width: 28 }}><input type="checkbox" name="perm" value={p.id} defaultChecked={have.has(p.id)} disabled={!!why} aria-label={p.code} /></td>
                      <td><b>{p.code}</b><div className="mute">{p.description}</div></td><td className="mute">{why ?? ""}</td></tr>); })}</tbody></table></div>
                  <button style={{ marginTop: 8 }}>Save permissions</button></form></details>
            </div>);
        })}
        <h2>Add a role</h2>
        <form action={createRole} className="card form"><label className="f">Code (capitals)<input name="code" required pattern="[A-Za-z][A-Za-z0-9_ ]{1,40}" /></label><label className="f">Name<input name="name" required /></label><label className="f">Description<input name="description" /></label>
          <label className="f">Most companies per person (empty = no limit)<input name="max" type="number" min={1} /></label><button>Add role</button></form>
        <p className="mute">Nobody can be given user or company administration through a role: those belong to system administrators.</p>
      </>)}

      {tab === "activity" && (<>
        <h2>Recent administration changes</h2>
        <div className="card scroll"><table><thead><tr><th>When</th><th>By</th><th>What</th><th></th></tr></thead>
          <tbody>{d.changes.map((e: any, i: number) => <tr key={i}><td>{dtime(e.occurred_at)}</td><td>{e.actor ?? ""}</td><td>{e.action.replace(/_/g, " ").toLowerCase()}</td><td className="mute">{e.metadata ? JSON.stringify(e.metadata) : ""}</td></tr>)}</tbody></table></div>
        <h2>Recent sign-in activity</h2>
        <div className="card scroll"><table><thead><tr><th>When</th><th>Person</th><th>Event</th><th>From</th><th></th></tr></thead>
          <tbody>{d.events.map((e: any, i: number) => <tr key={i}><td>{dtime(e.occurred_at)}</td><td>{e.email ?? ""}</td><td>{e.event.replace(/_/g, " ").toLowerCase()}</td><td>{e.ip ?? ""}</td><td className="mute">{e.detail ?? ""}</td></tr>)}</tbody></table></div>
      </>)}
    </>
  );
}
