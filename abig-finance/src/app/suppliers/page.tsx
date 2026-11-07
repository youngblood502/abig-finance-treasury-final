import { addBankDetail, addSupplier, linkSupplier, rejectBankDetail, updateSupplier, verifyBankDetail } from "../actions";
import { Flash } from "@/components";
import { PaymentHistory, PayeeTabs, Section, VersionList } from "@/components/payees/payee-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { SidePanel } from "@/components/ui/side-panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { companyScope } from "@/lib/company-scope";
import { withUser } from "@/lib/db";
import { canChangeSupplierStatus, LIST_FILTERS, listFilters, supplierList, verifiedVersion, type SupplierRow } from "@/lib/payee-screens";
import { can, canAccess, requireAccess } from "@/lib/rbac";
import { currentUserId, requireMe } from "@/lib/session";

const COLUMNS: DataColumn[] = [{ key: "name", header: "Supplier", primary: true, sortable: true }, { key: "tin", header: "TIN", sortable: true }, { key: "companies", header: "Your companies" }, { key: "bank", header: "Verified bank details" }, { key: "open", header: "" }];
const NameField = ({ value }: { value?: string }) => <label className="f">Legal name<input name="name" defaultValue={value} required /></label>;
const TinField = ({ value }: { value?: string | null }) => <label className="f">TIN (optional)<input name="tin" defaultValue={value ?? ""} pattern="[0-9A-Za-z\-]{6,20}" title="6 to 20 letters, digits or hyphens" /></label>;
interface Company { id: string; name: string }

function SupplierPanel({ s, userId, canVerify, canEdit, canSetStatus, entering }: { s: SupplierRow; userId: string; canVerify: boolean; canEdit: boolean; canSetStatus: boolean; entering: Company[] }) {
  const linkable = entering.filter((c) => !s.links.some((l) => l.company_id === c.id));
  return (
    <SidePanel title={s.legal_name} description={s.tin ? `TIN ${s.tin}` : "No TIN recorded"} trigger={<Button variant="outline" size="sm">Details</Button>}>
      <Section title="Bank details">
        <VersionList userId={userId} canVerify={canVerify} verify={verifyBankDetail} reject={rejectBankDetail} versions={s.versions.map((v) => ({ ...v, label: `${v.bank_name} ••••${v.account_last4}` }))} />
        {canEdit && (
          <form action={addBankDetail} className="mt-3 flex flex-col gap-3 border-t pt-3"><input type="hidden" name="supplier" value={s.id} />
            <label className="f">Bank<input name="bank" required /></label><label className="f">Last 4 digits of the account<input name="last4" required pattern="[0-9]{4}" maxLength={4} inputMode="numeric" /></label>
            <div><SubmitButton variant="outline">Enter for verification</SubmitButton></div></form>
        )}
      </Section>
      <Section title="Your companies that use this supplier">
        {s.links.length === 0 ? <p className="m-0 text-sm text-muted-foreground">None of your companies use this supplier yet.</p> : <ul className="m-0 flex list-none flex-wrap gap-1 p-0">{s.links.map((l) => <li key={l.company_id}><Badge variant="outline">{l.company}{l.status === "ACTIVE" ? "" : ` (${l.status.toLowerCase()})`}</Badge></li>)}</ul>}
        {canEdit && linkable.length > 0 && (
          <form action={linkSupplier} className="mt-3 flex flex-wrap items-end gap-2"><input type="hidden" name="supplier" value={s.id} />
            <label className="f">Use for company<select name="company">{linkable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><SubmitButton variant="outline" size="sm">Link</SubmitButton></form>
        )}
      </Section>
      <Section title="Latest payments"><PaymentHistory lines={s.history} /></Section>
      {canEdit && (
        <Section title={canSetStatus ? "Correct name, TIN or status" : "Correct name or TIN"}>
          <form action={updateSupplier} className="flex flex-col gap-3"><input type="hidden" name="id" value={s.id} /><NameField value={s.legal_name} /><TinField value={s.tin} />
            {canSetStatus && <><input type="hidden" name="status_shown" value="1" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={s.is_active} />Active</label></>}
            <p className="m-0 text-sm text-muted-foreground">Not allowed while this supplier has requests in progress.</p><div><SubmitButton variant="outline">Save</SubmitButton></div></form>
        </Section>
      )}
    </SidePanel>
  );
}

export default async function Suppliers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/suppliers");
  const company = await companyScope(uid);
  const d = await withUser(uid, async (tx) => ({ suppliers: await supplierList(tx, company), mayChangeStatus: await canChangeSupplierStatus(tx), companies: await tx.q<Company>("SELECT id, legal_name AS name FROM company_directory() WHERE is_active") }));
  // Entering suppliers needs supplier:manage; verifying a supplier's bank details needs payment_request:verify (Finance Managers).
  const entering: Company[] = me.isAdmin ? d.companies : me.memberships.filter((m) => m.permissions.includes("supplier:manage")).map((m) => ({ id: m.company_id, name: m.company }));
  const canVerify = can(me, "payment_request:verify"), canEdit = can(me, "supplier:manage"), canSetStatus = canEdit && d.mayChangeStatus;
  const rows: DataRow[] = d.suppliers.map((s) => {
    const verified = verifiedVersion(s.versions), waiting = s.versions.some((v) => v.status === "PENDING");
    return {
      id: s.id, search: `${s.legal_name} ${s.tin ?? ""}`, filters: listFilters(s.is_active, s.versions), sort: { name: s.legal_name, tin: s.tin ?? "" },
      cells: {
        name: <><b>{s.legal_name}</b>{!s.is_active && <Badge variant="destructive" className="ml-2">Inactive</Badge>}</>, tin: s.tin ?? <span className="text-muted-foreground">None</span>, companies: s.links.length > 0 ? s.links.map((l) => l.company).join(", ") : "None",
        bank: <>{verified ? `${verified.bank_name} ••••${verified.account_last4}` : "None"}{waiting && <Badge variant="warning" className="ml-2">To verify</Badge>}</>, open: <SupplierPanel s={s} userId={me.id} canVerify={canVerify} canEdit={canEdit} canSetStatus={canSetStatus} entering={entering} />,
      },
    };
  });
  return (
    <>
      <PageHeader title="Suppliers" description="One list for the whole group. Bank details are masked, and every change must be verified by someone other than the person who entered it."
        action={canEdit ? (
          <SidePanel title="Add a supplier" description="Add bank details next. Someone else must verify them before any payment." trigger={<Button>Add a supplier</Button>}>
            <form action={addSupplier} className="mt-3 flex flex-col gap-3"><NameField /><TinField />
              <label className="f">Use for company<select name="company">{entering.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><div><SubmitButton>Add supplier</SubmitButton></div></form>
          </SidePanel>
        ) : undefined} />
      <PayeeTabs active="suppliers" suppliers people={canAccess(me, "/payees")} />
      <Flash sp={sp} />
      <div className="rounded-xl border bg-card p-4"><DataTable caption="Suppliers" columns={COLUMNS} rows={rows} filters={LIST_FILTERS} searchable pageSize={25} emptyMessage="No suppliers yet." /></div>
    </>
  );
}
