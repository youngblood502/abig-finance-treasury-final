import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components";
import { addGroupGrant, updateUserIdentity, resetMfa, resetPassword, revokeGroupGrant, revokeMembership, setAdmin, setMembershipRoles, setUserActive, unlockUser } from "../../../admin-actions";
import { SecretNotice } from "@/components/admin/admin-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { companyList, isUuid, personDetail, roleLimit, roleList, signedInLocked, type AdminRole } from "@/lib/admin";
import { withUser } from "@/lib/db";
import { requireAccess } from "@/lib/rbac";
import { requireMe } from "@/lib/session";

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="mb-3 rounded-xl border bg-card p-4"><h2 className="mt-0">{title}</h2>{children}</section>;
const RoleChoices = ({ roles, chosen }: { roles: AdminRole[]; chosen: string[] }) => (
  <ul className="m-0 flex list-none flex-col gap-2 p-0">{roles.map((r) => <li key={r.id}><label className="flex items-start gap-2 text-sm"><input type="checkbox" name="roles" value={r.id} defaultChecked={chosen.includes(r.id)} className="mt-1" /><span>{r.name}<span className="block text-xs text-muted-foreground">{roleLimit(r.max_companies)}</span></span></label></li>)}</ul>
);

export default async function Person({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params; const sp = await searchParams; const me = await requireMe(); requireAccess(me, "/admin");
  if (!isUuid(id)) notFound();
  const d = await withUser(me.id, async (tx) => ({ person: await personDetail(tx, id), roles: await roleList(tx), companies: await companyList(tx) }));
  if (!d.person) notFound();
  const { user: u, members, grants } = d.person, self = u.id === me.id, active = d.roles.filter((r) => r.is_active), locked = signedInLocked(u);
  const open = d.companies.filter((c) => c.is_active && !members.some((m) => m.company_id === c.id));
  return (
    <>
      <p className="mute mb-2"><Link href="/admin?tab=users">Administration</Link> / {u.full_name}</p>
      <PageHeader title={u.full_name} description={u.email} />
      <Flash sp={sp} />
      <SecretNotice />
      <div className="mb-3 flex flex-wrap gap-1">
        <Badge variant={u.is_active ? "default" : "destructive"}>{u.is_active ? "Active" : "Deactivated"}</Badge>
        {u.is_system_admin && <Badge variant="warning">System administrator</Badge>}{u.must_change_password && <Badge variant="warning">Temporary password</Badge>}{locked && <Badge variant="destructive">Locked</Badge>}
        <Badge variant="outline">{u.totp_enabled ? "Two-step on" : "Two-step off"}</Badge>
      </div>

      <Card title="Name and email">
        <p className="mt-0 text-sm text-muted-foreground">{self ? "Changing your email address changes what you sign in with and signs out your other sessions." : `Changing the email address changes what ${u.full_name} signs in with and signs them out everywhere.`} The password, two-step sign-in, roles and company access stay as they are. Each change is recorded with the previous and new value.</p>
        <form action={updateUserIdentity} className="grid gap-3 sm:grid-cols-2"><input type="hidden" name="user" value={u.id} />
          <label className="f">Full name<input name="name" defaultValue={u.full_name} required maxLength={120} autoComplete="off" /></label>
          <label className="f">Email address (used to sign in)<input name="email" type="email" defaultValue={u.email} required maxLength={254} autoComplete="off" /></label>
          <div className="sm:col-span-2"><SubmitButton variant="outline">Save name and email</SubmitButton></div></form>
      </Card>

      <Card title="Company access">
        {members.length === 0 ? <p className="mt-0 text-sm text-muted-foreground">No company access.</p> : (
          <ul className="m-0 mb-3 flex list-none flex-col gap-2 p-0">{members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-3 text-sm">
              <span><b>{m.company}</b><span className="block text-xs text-muted-foreground">{m.roles.join(", ") || "No role"}</span></span>
              <span className="flex flex-wrap gap-2">
                <ConfirmDialog title={`Roles in ${m.company}`} description={`Saving replaces ${u.full_name}'s roles in this company. A role limited to fewer companies is refused.`} confirmLabel="Save roles" cancelLabel="Leave them" action={setMembershipRoles} fields={{ user: u.id, company: m.company_id }} trigger={<Button variant="outline" size="sm">Change roles</Button>}><RoleChoices roles={active} chosen={m.role_ids} /></ConfirmDialog>
                <ConfirmDialog title={`Remove ${m.company} access?`} description={`${u.full_name} will lose this company and everything in it. Their past actions stay on the record.`} confirmLabel="Remove access" cancelLabel="Keep access" destructive action={revokeMembership} fields={{ id: m.id, user: u.id }} trigger={<Button variant="outline" size="sm">Remove</Button>} />
              </span>
            </li>
          ))}</ul>
        )}
        {open.length > 0 && active.length > 0 && (
          <form action={setMembershipRoles} className="flex flex-col gap-3 border-t pt-3"><input type="hidden" name="user" value={u.id} />
            <label className="f">Add to company<select name="company">{open.map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}</select></label>
            <RoleChoices roles={active} chosen={[]} /><div><SubmitButton variant="outline">Add to company</SubmitButton></div></form>
        )}
      </Card>

      <Card title="Group reporting">
        <p className="mt-0 text-sm text-muted-foreground">Read-only reports for a company, without being a member of it. Payees, approvers and audit details stay hidden in reports.</p>
        {grants.length > 0 && <ul className="m-0 mb-3 flex list-none flex-col gap-2 p-0">{grants.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-3 text-sm"><b>{g.company}</b>
            <ConfirmDialog title={`Remove group reporting for ${g.company}?`} description={`${u.full_name} will no longer see this company in reports.`} confirmLabel="Remove" cancelLabel="Keep it" destructive action={revokeGroupGrant} fields={{ id: g.id, user: u.id }} trigger={<Button variant="outline" size="sm">Remove</Button>} /></li>
        ))}</ul>}
        <form action={addGroupGrant} className="flex flex-wrap items-end gap-2"><input type="hidden" name="user" value={u.id} />
          <label className="f">Allow reporting for<select name="company">{d.companies.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}</select></label><SubmitButton variant="outline" size="sm">Allow read-only reporting</SubmitButton></form>
      </Card>

      <Card title="Sign-in and status">
        <div className="flex flex-wrap gap-2">
          <ConfirmDialog title={`Reset ${u.full_name}'s password?`} description="Their current password stops working. You get a temporary one to give them privately." confirmLabel="Reset password" cancelLabel="Keep it" action={resetPassword} fields={{ user: u.id, label: u.full_name }} trigger={<Button variant="outline" size="sm">Reset password</Button>} />
          {locked && <ConfirmDialog title={`Unlock ${u.full_name}?`} description="They can try to sign in again straight away." confirmLabel="Unlock" cancelLabel="Leave locked" action={unlockUser} fields={{ user: u.id }} trigger={<Button variant="outline" size="sm">Unlock</Button>} />}
          {u.totp_enabled && <ConfirmDialog title={`Reset ${u.full_name}'s two-step sign-in?`} description="Their current device stops working. They set it up again at next sign-in." confirmLabel="Reset two-step" cancelLabel="Keep it" destructive action={resetMfa} fields={{ user: u.id }} trigger={<Button variant="outline" size="sm">Reset two-step</Button>} />}
          {!self && (u.is_active
            ? <ConfirmDialog title={`Deactivate ${u.full_name}?`} description="They are signed out everywhere and cannot sign in. Their past actions stay on the record." confirmLabel="Deactivate" cancelLabel="Keep active" destructive action={setUserActive} fields={{ user: u.id, active: "0" }} trigger={<Button variant="outline" size="sm">Deactivate</Button>} />
            : <ConfirmDialog title={`Reactivate ${u.full_name}?`} description="They can sign in again with the access they had." confirmLabel="Reactivate" cancelLabel="Leave deactivated" action={setUserActive} fields={{ user: u.id, active: "1" }} trigger={<Button variant="outline" size="sm">Reactivate</Button>} />)}
          {!self && (u.is_system_admin
            ? <ConfirmDialog title={`Remove ${u.full_name}'s administrator rights?`} description="They keep any company access they hold." confirmLabel="Remove admin" cancelLabel="Keep admin" destructive action={setAdmin} fields={{ user: u.id, on: "0" }} trigger={<Button variant="outline" size="sm">Remove admin</Button>} />
            : <ConfirmDialog title={`Make ${u.full_name} an administrator?`} description="They get full access to the system, including every company, person and role." confirmLabel="Make admin" cancelLabel="Not now" destructive action={setAdmin} fields={{ user: u.id, on: "1" }} trigger={<Button variant="outline" size="sm">Make admin</Button>} />)}
        </div>
        {self && <p className="mb-0 text-sm text-muted-foreground">You cannot deactivate yourself or remove your own administrator rights.</p>}
      </Card>
    </>
  );
}
