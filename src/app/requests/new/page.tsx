import { Flash } from "@/components";
import { PageHeader } from "@/components/ui/page-header";
import { companyScope } from "@/lib/company-scope";
import { withUser } from "@/lib/db";
import { requireAccess } from "@/lib/rbac";
import { requestFormOptions } from "@/lib/requests";
import { currentUserId, requireMe } from "@/lib/session";
import NewRequestForm from "./form";

export default async function NewRequest({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId(); requireAccess(await requireMe(), "/requests/new");
  const company = await companyScope(uid);
  const d = await withUser(uid, requestFormOptions);
  return (
    <>
      <PageHeader title="New payment request" description="The request belongs to the company that makes the payment. Submitting reserves the amount on the account you choose." />
      <Flash sp={sp} />
      {d.payees.length === 0 ? <div className="rounded-xl border bg-card p-4">You can only create requests for suppliers and people that are active for a company where you are an Accountant. Add one first.</div>
        : <NewRequestForm payees={d.payees} accounts={d.accounts} startCompany={company} />}
    </>
  );
}
