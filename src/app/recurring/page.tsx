import Link from "next/link";
import { saveRecurringTemplate, setRecurringActive } from "../actions";
import { Flash } from "@/components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { SidePanel } from "@/components/ui/side-panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { companyScope } from "@/lib/company-scope";
import { withUser } from "@/lib/db";
import { dstr, dtime, etb, PAYMENT_METHODS } from "@/lib/format";
import { can, requireAccess } from "@/lib/rbac";
import { FREQUENCIES, templateList, templateStatus, type RecurringTemplate } from "@/lib/recurring";
import { requestFormOptions, type FormAccount, type FormPayee } from "@/lib/requests";
import { currentUserId, hasPermission, requireMe } from "@/lib/session";

type Template = RecurringTemplate & { generated: Awaited<ReturnType<typeof templateList>>[number]["generated"] };
const COLUMNS: DataColumn[] = [
  { key: "name", header: "Recurring payment", primary: true, sortable: true }, { key: "payee", header: "Pays", sortable: true }, { key: "amount", header: "Amount", align: "right", sortable: true },
  { key: "frequency", header: "How often" }, { key: "next", header: "Next Draft", sortable: true }, { key: "status", header: "Status" }, { key: "open", header: "" },
];
const STATUS_VARIANT: Record<string, "default" | "destructive" | "warning" | "outline"> = { Active: "default", Inactive: "outline", Ended: "outline", "Needs attention": "destructive" };
const Line = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex justify-between gap-3 py-0.5 text-sm"><dt className="text-muted-foreground">{k}</dt><dd className="m-0 text-right">{v}</dd></div>;
const Amount = ({ t }: { t: Pick<Template, "amount" | "amount_is_estimate"> }) => <>{etb(t.amount)}{t.amount_is_estimate && <Badge variant="warning" className="ml-2">Estimate</Badge>}</>;

/** One form for adding and editing. The company and payee cannot change on an existing template, so they are fixed there. */
function TemplateForm({ t, payees, accounts }: { t?: Template; payees: FormPayee[]; accounts: FormAccount[] }) {
  const target = t ? `${t.company_id}|${t.payee_type}|${t.supplier_id ?? t.person_payee_id}` : "";
  return (
    <form action={saveRecurringTemplate} className="mt-3 flex flex-col gap-3">
      {t && <input type="hidden" name="id" value={t.id} />}
      <label className="f">Name<input name="name" required defaultValue={t?.name} placeholder="Office rent" /></label>
      {t ? <><input type="hidden" name="target" value={target} /><p className="m-0 text-sm">{t.company} · pays <b>{t.payee}</b></p></>
        : <label className="f">Company and payee<select name="target" required defaultValue=""><option value="" disabled>Choose who is paid</option>
            {payees.map((p) => <option key={`${p.company_id}|${p.payee_type}|${p.payee_id}`} value={`${p.company_id}|${p.payee_type}|${p.payee_id}`}>{p.company} · {p.payee}{p.payee_type === "PERSON" ? " (person)" : ""}</option>)}</select></label>}
      <label className="f">Pay from (debit account)<select name="account" required defaultValue={t?.debit_account_id ?? ""}><option value="" disabled>Choose an account</option>
        {accounts.filter((a) => !t || a.company_id === t.company_id).map((a) => <option key={`${a.company_id}|${a.id}`} value={a.id}>{t ? "" : `${payees.find((p) => p.company_id === a.company_id)?.company ?? ""} · `}{a.account_label}</option>)}</select></label>
      <label className="f">Payment method<select name="payment_method" defaultValue={t?.payment_method ?? "TRANSFER"}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="f">Amount (ETB)<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={t ? Number(t.amount) : undefined} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="estimate" defaultChecked={t?.amount_is_estimate} />This is an estimate: confirm the amount on each Draft before it can be submitted</label>
      <label className="f">How often<select name="frequency" defaultValue={t?.frequency ?? "MONTHLY"}>{Object.entries(FREQUENCIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="f">Next Draft on<input name="next_date" type="date" required defaultValue={t?.next_date ? dstr(t.next_date) : undefined} /></label>
      <label className="f">End date (optional)<input name="end_date" type="date" defaultValue={t?.end_date ? dstr(t.end_date) : undefined} /></label>
      <label className="f">Due this many days after each Draft<input name="due_days" type="number" min="0" max="90" step="1" defaultValue={t?.due_days ?? 0} /></label>
      <label className="f">Priority<select name="priority" defaultValue={t?.priority ?? "NORMAL"}><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></label>
      <label className="f">Notes (optional)<textarea name="description" rows={2} defaultValue={t?.description ?? ""} /></label>
      <p className="m-0 text-sm text-muted-foreground">On each date a Draft is created in {t?.creator ? `${t.creator}'s` : "your"} name. Nothing is submitted, scheduled or reserved automatically, and no email is sent.</p>
      <div><SubmitButton>{t ? "Save changes" : "Add recurring payment"}</SubmitButton></div>
    </form>
  );
}

function TemplatePanel({ t, canManage, payees, accounts }: { t: Template; canManage: boolean; payees: FormPayee[]; accounts: FormAccount[] }) {
  return (
    <SidePanel title={t.name} description={`${t.company} · ${t.payee ?? ""}`} trigger={<Button variant="outline" size="sm">Details</Button>}>
      <dl className="m-0 mt-3">
        <Line k="Amount" v={<Amount t={t} />} /><Line k="How often" v={FREQUENCIES[t.frequency]} /><Line k="Next Draft" v={dstr(t.next_date)} />
        <Line k="Ends" v={t.end_date ? dstr(t.end_date) : "No end date"} /><Line k="Due" v={t.due_days === 0 ? "On the Draft's date" : `${t.due_days} days after the Draft's date`} />
        <Line k="Pay from" v={`${t.account_label} · ${PAYMENT_METHODS[t.payment_method] ?? t.payment_method}`} /><Line k="Drafts are created for" v={t.creator ?? ""} />
        {t.last_generated_on && <Line k="Last Draft" v={dstr(t.last_generated_on)} />}
      </dl>
      {t.last_error && <p role="alert" className="note bad mt-2">No Draft was created{t.last_error_at ? ` (last tried ${dtime(t.last_error_at)})` : ""}: {t.last_error}. It is tried again automatically once this is fixed.</p>}
      <section className="mt-4"><h3 className="m-0 mb-2 text-base">Requests created from it</h3>
        {t.generated.length === 0 ? <p className="m-0 text-sm text-muted-foreground">None you can see yet. A Draft is visible only to the person it was created for.</p> : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">{t.generated.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-3 text-sm">
              <span><Link href={`/requests/${g.id}`}>{g.request_no}</Link> · for {dstr(g.recurring_occurrence)} · {etb(g.total_amount)}
                {g.amount_is_estimate && <Badge variant={g.amount_confirmed_at ? "outline" : "warning"} className="ml-2">{g.amount_confirmed_at ? "Estimate confirmed" : "Estimate to confirm"}</Badge>}</span>
              <StatusBadge state={g.workflow_state} />
            </li>))}
          </ul>)}
      </section>
      {canManage && (
        <section className="mt-4"><h3 className="m-0 mb-2 text-base">Change it</h3>
          <TemplateForm t={t} payees={payees} accounts={accounts} />
          <div className="mt-3 border-t pt-3">
            <ConfirmDialog title={t.is_active ? `Turn off ${t.name}?` : `Turn on ${t.name}?`} confirmLabel={t.is_active ? "Turn off" : "Turn on"} cancelLabel="Keep as it is" destructive={t.is_active}
              description={t.is_active ? "No more Drafts are created from it. Drafts already created stay as they are." : "Drafts are created again from its next date, which must be today or later."}
              action={setRecurringActive} fields={{ id: t.id, active: t.is_active ? "0" : "1" }} trigger={<Button variant="outline" size="sm">{t.is_active ? "Turn off" : "Turn on"}</Button>} />
          </div>
        </section>
      )}
    </SidePanel>
  );
}

export default async function Recurring({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/recurring");
  const company = await companyScope(uid);
  const d = await withUser(uid, async (tx) => ({ templates: await templateList(tx, company), options: await requestFormOptions(tx) }));
  const manages = can(me, "recurring_payment:manage");
  const rows: DataRow[] = d.templates.map((t) => {
    const status = templateStatus(t);
    return {
      id: t.id, search: `${t.name} ${t.payee ?? ""} ${t.company}`, sort: { name: t.name, payee: t.payee ?? "", amount: Number(t.amount), next: t.next_date },
      filters: { status: status === "Active" ? "active" : status === "Needs attention" ? "attention" : "off" },
      cells: {
        name: <><b>{t.name}</b><span className="block text-xs text-muted-foreground">{t.company}</span></>, payee: t.payee, amount: <Amount t={t} />, frequency: FREQUENCIES[t.frequency],
        next: t.is_active && !t.ended ? dstr(t.next_date) : "None", status: <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>,
        open: <TemplatePanel t={t} canManage={hasPermission(me, "recurring_payment:manage", t.company_id)} payees={d.options.payees} accounts={d.options.accounts} />,
      },
    };
  });
  return (
    <>
      <PageHeader title="Recurring payments" description="Rent, utilities, salaries and subscriptions. On each date a Draft is created for a person to check and submit; nothing is paid, scheduled or reserved automatically."
        action={manages ? <SidePanel title="Add a recurring payment" description="A Draft is created on each date, in your name." trigger={<Button>Add a recurring payment</Button>}><TemplateForm payees={d.options.payees} accounts={d.options.accounts} /></SidePanel> : undefined} />
      <Flash sp={sp} />
      <div className="rounded-xl border bg-card p-4">
        <DataTable caption="Recurring payments" columns={COLUMNS} rows={rows} searchable={rows.length > 8} pageSize={25} emptyMessage="No recurring payments yet."
          filters={[{ key: "status", label: "Status", options: [{ value: "active", label: "Active" }, { value: "attention", label: "Needs attention" }, { value: "off", label: "Inactive or ended" }] }]} />
      </div>
    </>
  );
}
