import { Flash, ShortfallChip } from "@/components";
import { AccountPanel } from "@/components/accounts/account-panel";
import { RegisterAccountForm } from "@/components/accounts/register-account-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { AccountPlaceNumber } from "@/components/ui/reveal-number";
import { SidePanel } from "@/components/ui/side-panel";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { companyScope } from "@/lib/company-scope";
import { RESERVED_LABEL, SHARED_RESERVED_HINT } from "@/lib/dashboard";
import { withUser } from "@/lib/db";
import { ACCOUNT_KINDS, accountPlace, dtime, etb } from "@/lib/format";
import { canAccess, requireAccess } from "@/lib/rbac";
import { currentUserId, hasPermission, requireMe } from "@/lib/session";
import { ACCESS_LABEL, accountList } from "@/lib/treasury-screens";

const COLUMNS: DataColumn[] = [
  { key: "account", header: "Account", primary: true, sortable: true }, { key: "kind", header: "Kind", sortable: true }, { key: "owner", header: "Legal owner", sortable: true }, { key: "access", header: "Your access" },
  { key: "current", header: "Current", align: "right", sortable: true }, { key: "reserved", header: "Reserved", align: "right", sortable: true }, { key: "available", header: "Available", align: "right", sortable: true }, { key: "checked", header: "Last updated", sortable: true }, { key: "open", header: "" },
];
const FILTERS = [
  { key: "kind", label: "Kind", options: Object.entries(ACCOUNT_KINDS).map(([value, label]) => ({ value, label })) },
  { key: "sharing", label: "Sharing", options: [{ value: "shared", label: "Shared" }, { value: "single", label: "One company" }] },
  { key: "status", label: "Status", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] },
];

export default async function Accounts({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/accounts");
  const company = await companyScope(uid);
  const d = await withUser(uid, async (tx) => ({
    // Who may update or manage an account is decided in the database (app_can_snapshot / app_can_manage_access).
    accounts: await accountList(tx, company),
    companies: await tx.q<{ id: string; legal_name: string }>("SELECT id, legal_name FROM company_directory() WHERE is_active"),
  }));
  const registrars = me.memberships.filter((m) => hasPermission(me, "bank_account:manage", m.company_id)).map((m) => ({ id: m.company_id, name: m.company }));
  const active = d.accounts.filter((a) => a.is_active), anyShared = active.some((a) => a.users.length > 1), openWeek = canAccess(me, "/treasury");
  const sum = (k: "current_balance" | "reserved_balance" | "available_balance") => active.reduce((s, a) => s + Number(a[k]), 0);
  const rows: DataRow[] = d.accounts.map((a) => {
    const shared = a.users.length > 1;
    return {
      id: a.id, search: `${a.account_label} ${accountPlace(a)} ${a.owner ?? ""}`, filters: { kind: a.account_kind, sharing: shared ? "shared" : "single", status: a.is_active ? "active" : "inactive" },
      sort: { account: a.account_label, kind: ACCOUNT_KINDS[a.account_kind], owner: a.owner ?? "", current: Number(a.current_balance), reserved: Number(a.reserved_balance), available: Number(a.available_balance), checked: a.balance_updated_at?.getTime() ?? "" },
      cells: {
        account: <><b>{a.account_label}</b>{shared && <Badge variant="outline" className="ml-2">Shared</Badge>}{!a.is_active && <Badge variant="destructive" className="ml-2">Inactive</Badge>}<ShortfallChip amount={a.shortfall_amount} /><span className="block text-xs text-muted-foreground"><AccountPlaceNumber a={a} /></span></>,
        kind: ACCOUNT_KINDS[a.account_kind], owner: a.owner ?? "None", access: ACCESS_LABEL[a.access], current: etb(a.current_balance), reserved: etb(a.reserved_balance), available: etb(a.available_balance),
        checked: a.balance_updated_at ? dtime(a.balance_updated_at) : "Never", open: <AccountPanel a={a} openWeek={openWeek} companies={d.companies} />,
      },
    };
  });
  return (
    <>
      <PageHeader title="Accounts" description="One balance per account, however many companies share it."
        action={registrars.length > 0 ? <SidePanel title="Register an account" description="The company that owns it can share it with others afterwards." trigger={<Button>Register an account</Button>}><div className="mt-3"><RegisterAccountForm owners={registrars} /></div></SidePanel> : undefined} />
      <Flash sp={sp} />
      {active.length > 0 && (
        <StatGrid>
          <StatTile label="Current balance" value={etb(sum("current_balance"))} hint={`${active.length} active account${active.length === 1 ? "" : "s"}. Each shared account is counted once`} />
          <StatTile label={RESERVED_LABEL} value={etb(sum("reserved_balance"))} hint={anyShared ? SHARED_RESERVED_HINT : undefined} />
          <StatTile label="Available" value={etb(sum("available_balance"))} hint="After minimum buffers" />
        </StatGrid>
      )}
      <div className="rounded-xl border bg-card p-4"><DataTable caption="Accounts" columns={COLUMNS} rows={rows} filters={FILTERS} searchable pageSize={25} emptyMessage="No bank accounts are available to you." /></div>
    </>
  );
}
