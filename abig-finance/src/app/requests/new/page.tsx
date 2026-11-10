import { Flash } from "@/components";
import { AddPersonForm } from "@/components/payees/person-forms";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SidePanel } from "@/components/ui/side-panel";
import { companyScope } from "@/lib/company-scope";
import { withUser } from "@/lib/db";
import { can, requireAccess } from "@/lib/rbac";
import { requestFormOptions } from "@/lib/requests";
import { currentUserId, requireMe } from "@/lib/session";
import NewRequestForm from "./form";

export default async function NewRequest({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe(); requireAccess(me, "/requests/new");
  const company = await companyScope(uid);
  const d = await withUser(uid, requestFormOptions);
  const entering = me.memberships.filter((m) => m.permissions.includes("payee:manage")).map((m) => ({ id: m.company_id, name: m.company }));
  return (
    <>
      <PageHeader title="New payment request" description="The request belongs to the company that makes the payment. Submitting reserves the amount on the account you choose."
        action={entering.length > 0 ? <SidePanel title="Add a person" description="A one-time payee needs no supplier registration. Add them before filling in the request: this page reloads." trigger={<Button variant="outline">Add a person</Button>}><div className="mt-3"><AddPersonForm companies={entering} back="request" /></div></SidePanel> : undefined} />
      <Flash sp={sp} />
      {d.payees.length === 0 ? <div className="rounded-xl border bg-card p-4">You can only create requests for suppliers and people that are active for a company where you are an Accountant. Add one first.</div>
        : <NewRequestForm payees={d.payees} accounts={d.accounts} startCompany={company} canSchedule={can(me, "payment_request:schedule")} />}
    </>
  );
}
