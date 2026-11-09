import Link from "next/link";
import { Flash } from "@/components";
import { createCompany, createRole, createUser } from "../admin-actions";
import { CompanyPanel, RolePanel, SecretNotice } from "@/components/admin/admin-parts";
import { TabLinks } from "@/components/layout/tab-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { SidePanel } from "@/components/ui/side-panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { activity, companyList, notificationFilters, notificationList, notificationSummary, peopleList, permissionList, roleLimit, roleList, signedInLocked, systemSettings } from "@/lib/admin";
import { NotificationMonitor } from "@/components/admin/notifications";
import { withUser } from "@/lib/db";
import { dtime } from "@/lib/format";
import { requireAccess } from "@/lib/rbac";
import { requireMe } from "@/lib/session";

const TABS: [string, string][] = [["users", "People and access"], ["companies", "Companies"], ["roles", "Roles and permissions"], ["activity", "Activity"], ["system", "System"]];
/** A person's access can be a long line: on a phone it wraps inside its card. */
const WRAP = "h-auto max-w-full shrink whitespace-normal";
const Panel = ({ children }: { children: React.ReactNode }) => <div className="mb-3 rounded-xl border bg-card p-4">{children}</div>;
const Field = ({ label, ...p }: { label: string } & React.ComponentProps<"input">) => <label className="f">{label}<input {...p} /></label>;

async function People({ uid }: { uid: string }) {
  const d = await withUser(uid, peopleList);
  const columns: DataColumn[] = [{ key: "person", header: "Person", primary: true, sortable: true }, { key: "access", header: "Access" }, { key: "status", header: "Status" }, { key: "open", header: "" }];
  const rows: DataRow[] = d.users.map((u) => {
    const members = d.members.filter((m) => m.user_id === u.id), grants = d.grants.filter((g) => g.user_id === u.id);
    return {
      id: u.id, search: `${u.full_name} ${u.email} ${members.map((m) => m.company).join(" ")}`, sort: { person: u.full_name }, filters: { status: u.is_active ? "active" : "inactive", kind: u.is_system_admin ? "admin" : grants.length > 0 ? "group" : members.length > 0 ? "member" : "none" },
      cells: {
        person: <><b>{u.full_name}</b><span className="block text-xs text-muted-foreground">{u.email}</span></>,
        access: <span className="flex flex-wrap gap-1">{members.map((m) => <Badge key={m.id} variant="outline" className={WRAP}>{m.company}: {m.roles.join(", ") || "no role"}</Badge>)}{grants.map((g) => <Badge key={g.id} variant="outline" className={WRAP}>Group reports: {g.company}</Badge>)}{u.is_system_admin && <Badge variant="warning">System administrator</Badge>}</span>,
        status: <span className="flex flex-wrap gap-1"><Badge variant={u.is_active ? "default" : "destructive"}>{u.is_active ? "Active" : "Deactivated"}</Badge>{u.must_change_password && <Badge variant="warning">Temporary password</Badge>}{signedInLocked(u) && <Badge variant="destructive">Locked</Badge>}{!u.totp_enabled && <Badge variant="outline">Two-step off</Badge>}</span>,
        open: <Button asChild variant="outline" size="sm"><Link href={`/admin/people/${u.id}`}>Open</Link></Button>,
      },
    };
  });
  return <Panel><DataTable caption="People" columns={columns} rows={rows} searchable pageSize={25} emptyMessage="No people yet." filters={[{ key: "status", label: "Status", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Deactivated" }] }, { key: "kind", label: "Access", options: [{ value: "admin", label: "Administrators" }, { value: "member", label: "Company members" }, { value: "group", label: "Group reporting" }, { value: "none", label: "No access" }] }]} /></Panel>;
}

async function Companies({ uid }: { uid: string }) {
  const companies = await withUser(uid, companyList);
  const columns: DataColumn[] = [{ key: "name", header: "Company", primary: true, sortable: true }, { key: "code", header: "Code", sortable: true }, { key: "tin", header: "TIN" }, { key: "phone", header: "Phone" }, { key: "status", header: "Status" }, { key: "open", header: "" }];
  const rows: DataRow[] = companies.map((c) => ({ id: c.id, search: `${c.legal_name} ${c.code} ${c.tin_number ?? ""}`, sort: { name: c.legal_name, code: c.code }, filters: { status: c.is_active ? "active" : "inactive" },
    cells: { name: <b>{c.legal_name}</b>, code: c.code, tin: c.tin_number ?? "", phone: c.phone ?? "", status: <Badge variant={c.is_active ? "default" : "destructive"}>{c.is_active ? "Active" : "Inactive"}</Badge>, open: <CompanyPanel c={c} /> } }));
  return <Panel><DataTable caption="Companies" columns={columns} rows={rows} searchable filters={[{ key: "status", label: "Status", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] }]} emptyMessage="No companies yet." /></Panel>;
}

async function Roles({ uid }: { uid: string }) {
  const d = await withUser(uid, async (tx) => ({ roles: await roleList(tx), ...(await permissionList(tx)) }));
  const columns: DataColumn[] = [{ key: "name", header: "Role", primary: true, sortable: true }, { key: "code", header: "Code" }, { key: "people", header: "People", align: "right", sortable: true }, { key: "limit", header: "Company limit" }, { key: "perms", header: "Permissions", align: "right" }, { key: "open", header: "" }];
  const rows: DataRow[] = d.roles.map((r) => {
    const held = new Set(d.held.filter((x) => x.role_id === r.id).map((x) => x.permission_id));
    return { id: r.id, search: `${r.name} ${r.code}`, sort: { name: r.name, people: r.people }, cells: { name: <><b>{r.name}</b>{r.is_system && <Badge variant="outline" className="ml-2">Built in</Badge>}{!r.is_active && <Badge variant="destructive" className="ml-2">Off</Badge>}</>, code: r.code, people: r.people, limit: roleLimit(r.max_companies), perms: held.size, open: <RolePanel r={r} permissions={d.permissions} held={held} /> } };
  });
  return (<>
    <p className="mute">Accountants are fixed at one company. Nobody can be given user or company administration through a role: those belong to system administrators.</p>
    <Panel><DataTable caption="Roles" columns={columns} rows={rows} searchable emptyMessage="No roles yet." /></Panel>
  </>);
}

async function Activity({ uid }: { uid: string }) {
  const d = await withUser(uid, activity);
  const changes: DataRow[] = d.changes.map((e, i) => ({ id: String(i), cells: { when: dtime(e.occurred_at), who: e.actor ?? "", what: e.action.replace(/_/g, " ").toLowerCase(), details: e.metadata ? <span className="text-xs break-all text-muted-foreground">{JSON.stringify(e.metadata)}</span> : "" } }));
  const signIns: DataRow[] = d.signIns.map((e, i) => ({ id: String(i), cells: { when: dtime(e.occurred_at), who: e.email ?? "", what: e.event.replace(/_/g, " ").toLowerCase(), from: e.ip ?? "", details: e.detail ?? "" } }));
  return (<>
    <h2>Recent administration changes</h2>
    <Panel><DataTable caption="Administration changes" columns={[{ key: "when", header: "When", primary: true }, { key: "who", header: "By" }, { key: "what", header: "What" }, { key: "details", header: "Details" }]} rows={changes} emptyMessage="No changes yet." /></Panel>
    <h2>Recent sign-in activity</h2>
    <Panel><DataTable caption="Sign-in activity" columns={[{ key: "when", header: "When", primary: true }, { key: "who", header: "Person" }, { key: "what", header: "Event" }, { key: "from", header: "From" }, { key: "details", header: "Details" }]} rows={signIns} emptyMessage="No sign-ins yet." /></Panel>
  </>);
}

async function System({ uid, sp }: { uid: string; sp: Record<string, string | undefined> }) {
  const filters = notificationFilters((k) => sp[k]);
  const d = await withUser(uid, async (tx) => ({ summary: await notificationSummary(tx), rows: await notificationList(tx, filters) }));
  return (<>
    <Panel><dl className="m-0">{systemSettings().map((s) => <div key={s.label} className="flex justify-between gap-3 border-t py-2 text-sm first:border-t-0"><dt className="text-muted-foreground">{s.label}</dt><dd className="m-0 text-right font-semibold">{s.value}</dd></div>)}</dl></Panel>
    <p className="mute">These are set where the system is deployed, so they are shown here and not changed here.</p>
    <NotificationMonitor summary={d.summary} rows={d.rows} filters={filters} />
  </>);
}

function AddAction({ tab }: { tab: string }) {
  if (tab === "users") return (
    <SidePanel title="Add a person" description="They get a temporary password, and must change it at first sign-in." trigger={<Button>Add a person</Button>}>
      <form action={createUser} className="mt-3 flex flex-col gap-3"><Field label="Full name" name="name" required /><Field label="Work email" name="email" type="email" required /><div><SubmitButton>Create with a temporary password</SubmitButton></div></form>
    </SidePanel>);
  if (tab === "companies") return (
    <SidePanel title="Add a company" description="The code cannot be changed afterwards." trigger={<Button>Add a company</Button>}>
      <form action={createCompany} className="mt-3 flex flex-col gap-3"><Field label="Code (capitals)" name="code" required pattern="[A-Z0-9_]{2,20}" /><Field label="Company name" name="name" required /><Field label="TIN number" name="tin" required pattern="[0-9A-Za-z\-]{6,20}" /><Field label="Phone" name="phone" required /><div><SubmitButton>Add company</SubmitButton></div></form>
    </SidePanel>);
  if (tab === "roles") return (
    <SidePanel title="Add a role" description="Choose its permissions once it exists." trigger={<Button>Add a role</Button>}>
      <form action={createRole} className="mt-3 flex flex-col gap-3"><Field label="Code (capitals)" name="code" required pattern="[A-Za-z][A-Za-z0-9_ ]{1,40}" /><Field label="Name" name="name" required /><Field label="Description" name="description" /><Field label="Most companies per person (empty = no limit)" name="max" type="number" min={1} /><div><SubmitButton>Add role</SubmitButton></div></form>
    </SidePanel>);
  return undefined;
}

export default async function Admin({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const me = await requireMe(); requireAccess(me, "/admin");
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "users";
  return (
    <>
      <PageHeader title="Administration" description="People, companies, roles and permissions. Administrators have full access to the system, and the same separation-of-duties rules apply to them as to everyone." action={AddAction({ tab })} />
      <Flash sp={sp} />
      <SecretNotice />
      <TabLinks label="Administration" active={tab} tabs={TABS.map(([key, title]) => ({ key, title, href: `/admin?tab=${key}` }))} />
      {tab === "users" && <People uid={me.id} />}
      {tab === "companies" && <Companies uid={me.id} />}
      {tab === "roles" && <Roles uid={me.id} />}
      {tab === "activity" && <Activity uid={me.id} />}
      {tab === "system" && <System uid={me.id} sp={sp} />}
    </>
  );
}
