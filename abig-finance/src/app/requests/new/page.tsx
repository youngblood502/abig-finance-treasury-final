import { Flash } from "@/components";
import { withUser } from "@/lib/db";
import { currentUserId, requireMe } from "@/lib/session";
import { requireAccess } from "@/lib/rbac";
import NewRequestForm from "./form";

export default async function NewRequest({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId(); requireAccess(await requireMe(), "/requests/new");
  const d = await withUser(uid, async (tx) => ({
    targets: await tx.q<any>(
      `SELECT cs.company_id, 'SUPPLIER' AS payee_type, cs.supplier_id AS payee_id, c.legal_name AS company, s.legal_name AS payee,
              EXISTS (SELECT 1 FROM supplier_bank_details b WHERE b.supplier_id = s.id AND b.status = 'VERIFIED') AS bank_ok
       FROM company_suppliers cs JOIN companies c ON c.id = cs.company_id JOIN suppliers s ON s.id = cs.supplier_id
       WHERE cs.status = 'ACTIVE' AND s.is_active AND cs.company_id IN (SELECT app_permitted_companies('payment_request:create')) UNION ALL
       SELECT p.company_id, 'PERSON', p.id, c.legal_name, p.full_name, true
       FROM person_payees p JOIN companies c ON c.id = p.company_id
       WHERE p.is_active AND p.company_id IN (SELECT app_permitted_companies('payment_request:create')) ORDER BY 4, 5`),
    // The accounts each company may pay from (linked with the USE right), with the balance that is free to be reserved.
    accounts: await tx.q<any>(
      `SELECT gc.company_id, a.id, a.account_label, a.account_kind::text AS account_kind, a.wallet_phone, b.name AS bank_name, a.account_last4, a.available_balance, a.shortfall_amount
       FROM company_bank_accounts a LEFT JOIN banks b ON b.id = a.bank_id
       CROSS JOIN LATERAL app_granted_companies(a.id, 'USE') AS gc(company_id)
       WHERE a.is_active AND gc.company_id IN (SELECT app_permitted_companies('payment_request:create')) ORDER BY a.account_label`),
  }));
  return (
    <>
      <h1>New payment request</h1>
      <p className="sub">The request belongs to the company that makes the payment. Choose the account it will be paid from: submitting reserves the amount on that account.</p><Flash sp={sp} />
      {d.targets.length === 0 ? <div className="card">You can only create requests for suppliers and people that are active for a company where you are an Accountant. Add one first.</div> : (
        <NewRequestForm targets={d.targets} accounts={d.accounts.map((a: any) => ({ ...a, available_balance: Number(a.available_balance), shortfall_amount: Number(a.shortfall_amount) }))} />)}
    </>
  );
}
