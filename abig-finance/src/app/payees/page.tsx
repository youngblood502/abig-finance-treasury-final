import { rejectPersonDetail, updatePerson, verifyPersonDetail } from "../actions";
import { Flash } from "@/components";
import { MethodList, PaymentHistory, PayeeTabs, Section, VersionList } from "@/components/payees/payee-parts";
import { AddPersonForm, PersonDetailForm } from "@/components/payees/person-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { SidePanel } from "@/components/ui/side-panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { companyScope } from "@/lib/company-scope";
import { withUser } from "@/lib/db";
import { PAYMENT_METHODS } from "@/lib/format";
import { LIST_FILTERS, listFilters, personList, readyMethods, type PersonRow } from "@/lib/payee-screens";
import { maskId } from "@/lib/payees";
import { canAccess, requireAccess } from "@/lib/rbac";
import { currentUserId, hasPermission, requireMe } from "@/lib/session";

const COLUMNS: DataColumn[] = [{ key: "name", header: "Person", primary: true, sortable: true }, { key: "company", header: "Company", sortable: true }, { key: "phone", header: "Phone" }, { key: "ready", header: "Can be paid by" }, { key: "open", header: "" }];
const Line = ({ label, value }: { label: string; value: React.ReactNode }) => <div className="flex justify-between gap-3 py-0.5 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="m-0 text-right">{value}</dd></div>;
const versionLabel = (v: PersonRow["versions"][number]) => (v.kind === "TELEBIRR" ? `Telebirr ${v.telebirr_phone}` : `${v.bank_name} ••••${v.account_last4}`);

function PersonPanel({ p, userId, canManage, canVerify }: { p: PersonRow; userId: string; canManage: boolean; canVerify: boolean }) {
  return (
    <SidePanel title={p.full_name} description={p.company} trigger={<Button variant="outline" size="sm">Details</Button>}>
      <dl className="m-0 mt-3">
        <Line label="Phone" value={p.phone} /><Line label="ID number" value={maskId(p.id_last4)} /><Line label="Usually paid by" value={PAYMENT_METHODS[p.preferred_method]} /><Line label="Can be paid by" value={<MethodList methods={readyMethods(p.versions)} />} />
      </dl>
      <Section title="Bank and Telebirr details">
        <VersionList userId={userId} canVerify={canVerify} verify={verifyPersonDetail} reject={rejectPersonDetail} versions={p.versions.map((v) => ({ ...v, label: versionLabel(v) }))} />
        {canManage && <div className="mt-3"><PersonDetailForm person={p.id} /></div>}
      </Section>
      <Section title="Latest payments"><PaymentHistory lines={p.history} /></Section>
      {canManage && (
        <Section title="Correct name, phone, ID number or status">
          <form action={updatePerson} className="flex flex-col gap-3"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="company" value={p.company_id} />
            <label className="f">Full name<input name="name" defaultValue={p.full_name} required /></label><label className="f">Phone<input name="phone" type="tel" defaultValue={p.phone} required /></label>
            <label className="f">New ID number (leave empty to keep it)<input name="id_number" autoComplete="off" /></label>
            <label className="f">Usually paid by<select name="preferred" defaultValue={p.preferred_method}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={p.is_active} />Active</label>
            <p className="m-0 text-sm text-muted-foreground">Name, phone, ID and status cannot change while this person has requests in progress.</p><div><SubmitButton variant="outline">Save</SubmitButton></div></form>
        </Section>
      )}
    </SidePanel>
  );
}

export default async function Payees({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/payees");
  const company = await companyScope(uid);
  const people = await withUser(uid, (tx) => personList(tx, company));
  const entering = me.memberships.filter((m) => m.permissions.includes("payee:manage")).map((m) => ({ id: m.company_id, name: m.company }));
  const rows: DataRow[] = people.map((p) => ({
    id: p.id, search: `${p.full_name} ${p.phone} ${p.company}`, filters: listFilters(p.is_active, p.versions.filter((v) => v.status !== "REJECTED")), sort: { name: p.full_name, company: p.company },
    cells: {
      name: <><b>{p.full_name}</b>{!p.is_active && <Badge variant="destructive" className="ml-2">Inactive</Badge>}<span className="block text-xs text-muted-foreground">ID {maskId(p.id_last4)}</span></>, company: p.company, phone: p.phone,
      ready: <><MethodList methods={readyMethods(p.versions)} />{p.versions.some((v) => v.status === "PENDING") && <Badge variant="warning" className="ml-2">To verify</Badge>}</>,
      open: <PersonPanel p={p} userId={me.id} canManage={hasPermission(me, "payee:manage", p.company_id)} canVerify={hasPermission(me, "payment_request:verify", p.company_id)} />,
    },
  }));
  return (
    <>
      <PageHeader title="People" description="People a company pays, including one-time payees. They need no supplier registration. ID numbers are encrypted and masked here, and every change to how someone is paid must be verified by a second person."
        action={entering.length > 0 ? <SidePanel title="Add a person" description="For a one-off payment or a regular one." trigger={<Button>Add a person</Button>}><div className="mt-3"><AddPersonForm companies={entering} /></div></SidePanel> : undefined} />
      <PayeeTabs active="people" suppliers={canAccess(me, "/suppliers")} people />
      <Flash sp={sp} />
      <div className="rounded-xl border bg-card p-4"><DataTable caption="People" columns={COLUMNS} rows={rows} filters={LIST_FILTERS} searchable pageSize={25} emptyMessage="No people yet." /></div>
    </>
  );
}
