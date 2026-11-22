import { cookies } from "next/headers";
import { removeCompanyLogo, saveRole, saveRolePermissions, setCompanyLogo, updateCompany } from "@/app/admin-actions";
import { CompanyMark } from "@/components/company-mark";
import type { CurrentLogo } from "@/lib/company-logo";
import { LOGO_MAX_PX, LOGO_MIN_PX } from "@/lib/logo-url";
import { dtime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SidePanel } from "@/components/ui/side-panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { roleLimit, type AdminCompany, type AdminPermission, type AdminRole } from "@/lib/admin";
import { roleCannotHold } from "@/lib/rbac";

/** A temporary password, which the server keeps for a moment after it is made so it can be handed over. */
export async function SecretNotice() {
  const secret = (await cookies()).get("abig_flash_secret")?.value;
  if (!secret) return null;
  return <div role="status" className="mb-3 rounded-md border bg-card p-3 text-sm"><b className="break-all">{secret}</b><p className="m-0 mt-1 text-muted-foreground">Shown once. Give it to the person privately. They must change it at first sign-in.</p></div>;
}

export function CompanyPanel({ c, logo = null }: { c: AdminCompany; logo?: CurrentLogo | null }) {
  const fields = { id: c.id, name: c.legal_name, tin: c.tin_number ?? "", phone: c.phone ?? "" };
  return (
    <SidePanel title={c.legal_name} description={`Code ${c.code}. The code never changes.`} trigger={<Button variant="outline" size="sm">Edit</Button>}>
      <form action={updateCompany} className="mt-3 flex flex-col gap-3"><input type="hidden" name="id" value={c.id} />{c.is_active && <input type="hidden" name="active" value="on" />}
        <label className="f">Company name<input name="name" defaultValue={c.legal_name} required /></label>
        <label className="f">TIN number<input name="tin" defaultValue={c.tin_number ?? ""} required pattern="[0-9A-Za-z\-]{6,20}" /></label>
        <label className="f">Phone<input name="phone" defaultValue={c.phone ?? ""} required /></label>
        <div><SubmitButton>Save</SubmitButton></div></form>
      <section className="mt-4 border-t pt-3" aria-labelledby={`logo-${c.id}`}><h3 id={`logo-${c.id}`} className="m-0 mb-2 text-base">Logo</h3>
        <div className="flex items-start gap-3">
          <CompanyMark companyId={c.id} code={c.code} logo={logo} size={72} />
          <p className="m-0 text-sm text-muted-foreground">{logo
            ? `Shown on this company's payment vouchers. ${logo.width} × ${logo.height} pixels, ${(logo.size_bytes / 1024).toFixed(0)} KB, uploaded ${dtime(logo.uploaded_at)}.`
            : "No logo yet. This company's payment vouchers show its code instead."}</p>
        </div>
        <form action={setCompanyLogo} className="mt-3 flex flex-col gap-2"><input type="hidden" name="company" value={c.id} />
          <label className="f">{logo ? "Replace the logo" : "Upload a logo"}<input type="file" name="logo" accept="image/png,image/jpeg" required /></label>
          <span className="text-xs text-muted-foreground">PNG or JPEG, at most 1 MB, {LOGO_MIN_PX} to {LOGO_MAX_PX} pixels on each side. A square image with a plain background prints best.</span>
          <div><SubmitButton>{logo ? "Replace logo" : "Upload logo"}</SubmitButton></div>
        </form>
        {logo && <div className="mt-2"><ConfirmDialog title={`Remove ${c.legal_name}'s logo?`} description="Its payment vouchers will show the company code instead. The logo's history is kept." confirmLabel="Remove logo" cancelLabel="Keep it" action={removeCompanyLogo} fields={{ company: c.id }} trigger={<Button variant="outline" size="sm">Remove logo</Button>} /></div>}
      </section>
      <section className="mt-4 border-t pt-3"><h3 className="m-0 mb-2 text-base">Status</h3>
        {c.is_active ? (
          <ConfirmDialog title={`Deactivate ${c.legal_name}?`} description="It is marked inactive. Its requests, payments, accounts, reconciliations and audit history are kept and stay readable. This is refused while it has requests waiting for approval, authenticated payments not yet paid, or a reconciliation in progress on an account it owns." confirmLabel="Deactivate" cancelLabel="Keep it active" destructive action={updateCompany} fields={fields} trigger={<Button variant="outline" size="sm">Deactivate</Button>} />
        ) : (
          <ConfirmDialog title={`Reactivate ${c.legal_name}?`} description="It can be used again." confirmLabel="Reactivate" cancelLabel="Keep it inactive" action={updateCompany} fields={{ ...fields, active: "on" }} trigger={<Button variant="outline" size="sm">Reactivate</Button>} />
        )}
      </section>
    </SidePanel>
  );
}

export function RolePanel({ r, permissions, held }: { r: AdminRole; permissions: AdminPermission[]; held: Set<string> }) {
  return (
    <SidePanel title={r.name} description={`${r.code}. ${r.people} ${r.people === 1 ? "person" : "people"}. ${roleLimit(r.max_companies)}.`} trigger={<Button variant="outline" size="sm">Details</Button>}>
      <div className="mt-3 flex flex-wrap gap-2">
        <ConfirmDialog title={`Change ${r.name}?`} description={`This applies at once to the ${r.people} ${r.people === 1 ? "person" : "people"} holding it. A limit is refused if someone already holds the role in more companies.`} confirmLabel="Save role" cancelLabel="Leave it" action={saveRole} fields={{ id: r.id }} trigger={<Button size="sm">Edit role</Button>}>
          <label className="f">Name<input name="name" defaultValue={r.name} required /></label>
          <label className="f">Description<input name="description" defaultValue={r.description ?? ""} /></label>
          <label className="f">Most companies per person (empty = no limit)<input name="max" type="number" min={1} defaultValue={r.max_companies ?? ""} readOnly={r.code === "ACCOUNTANT"} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={r.is_active} />In use</label>
        </ConfirmDialog>
        <ConfirmDialog title={`Permissions of ${r.name}`} description={`Saving replaces this role's permissions, at once, for the ${r.people} ${r.people === 1 ? "person" : "people"} holding it.`} confirmLabel="Save permissions" cancelLabel="Leave them" action={saveRolePermissions} fields={{ role: r.id }} trigger={<Button size="sm" variant="outline">Change permissions</Button>}>
          <ul className="m-0 flex max-h-80 list-none flex-col gap-2 overflow-y-auto p-0">
            {permissions.map((p) => { const why = roleCannotHold(r.code, p.code); return (
              <li key={p.id}><label className="flex items-start gap-2 text-sm"><input type="checkbox" name="perm" value={p.id} defaultChecked={held.has(p.id)} disabled={!!why} className="mt-1" /><span><b>{p.code}</b>{why && <span className="ml-2 text-xs text-muted-foreground">{why}</span>}<span className="block text-xs text-muted-foreground">{p.description}</span></span></label></li>
            ); })}
          </ul>
        </ConfirmDialog>
      </div>
      <section className="mt-4"><h3 className="m-0 mb-2 text-base">Permissions ({held.size})</h3>
        <ul className="m-0 flex list-none flex-wrap gap-1 p-0">{permissions.filter((p) => held.has(p.id)).map((p) => <li key={p.id}><Badge variant="outline">{p.code}</Badge></li>)}</ul>
      </section>
    </SidePanel>
  );
}
