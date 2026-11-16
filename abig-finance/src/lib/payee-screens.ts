import type { Tx } from "./db";
import type { NumberState } from "./account-numbers";
import { PAYMENT_METHODS } from "./format";
import { PERSON_DETAIL_FOR_METHOD } from "./payees";

// What the supplier and people screens read. Row-level security decides what comes back:
//   suppliers and their bank details are one list for the group, but which companies use a supplier shows only for companies the person belongs to.
//   people belong to one company and are never seen from another. Their encrypted ID number cannot be read here at all.
//   a payee's payment history comes from payment_requests, so it holds only the person's own companies' payments.
// `company` is the company switcher's choice and can only narrow a list.

export interface PaymentLine { payee_id: string; id: string; request_no: string; company: string; workflow_state: string; total_amount: string; created_at: Date }
export interface SupplierVersion { id: string; supplier_id: string; version: number; bank_name: string; account_last4: string; number_state: NumberState; status: string; created_by: string; rejection_reason: string | null }
export interface SupplierLink { supplier_id: string; company_id: string; company: string; status: string }
export interface SupplierRow { id: string; legal_name: string; tin: string | null; phone: string | null; is_active: boolean; links: SupplierLink[]; versions: SupplierVersion[]; history: PaymentLine[] }

const history = (tx: Tx, column: "supplier_id" | "person_payee_id", ids: string[], company: string | null) => tx.q<PaymentLine>(
  `SELECT payee_id, id, request_no, company, workflow_state, total_amount, created_at FROM (
     SELECT r.${column} AS payee_id, r.id, r.request_no, c.legal_name AS company, r.workflow_state::text AS workflow_state, r.total_amount, r.created_at,
            row_number() OVER (PARTITION BY r.${column} ORDER BY r.created_at DESC, r.id) AS n
       FROM payment_requests r JOIN companies c ON c.id = r.debtor_company_id WHERE r.${column} = ANY($1::uuid[]) AND ($2::uuid IS NULL OR r.debtor_company_id = $2)) x
    WHERE n <= 10 ORDER BY created_at DESC, id`, [ids, company]);

export const supplierList = async (tx: Tx, company: string | null) => {
  const suppliers = await tx.q<Pick<SupplierRow, "id" | "legal_name" | "tin" | "phone" | "is_active">>("SELECT id, legal_name, tin, phone, is_active FROM suppliers WHERE $1::uuid IS NULL OR id IN (SELECT supplier_id FROM company_suppliers WHERE company_id = $1) ORDER BY legal_name", [company]);
  const ids = suppliers.map((s) => s.id);
  const versions = await tx.q<SupplierVersion>("SELECT id, supplier_id, version, bank_name, account_last4, supplier_account_state(id) AS number_state, status, created_by, rejection_reason FROM supplier_bank_details WHERE supplier_id = ANY($1::uuid[]) ORDER BY supplier_id, version DESC", [ids]);
  const links = await tx.q<SupplierLink>("SELECT cs.supplier_id, cs.company_id, c.legal_name AS company, cs.status FROM company_suppliers cs JOIN companies c ON c.id = cs.company_id WHERE cs.supplier_id = ANY($1::uuid[]) ORDER BY c.legal_name", [ids]);
  const paid = await history(tx, "supplier_id", ids, company);
  return suppliers.map((s): SupplierRow => ({ ...s, links: links.filter((l) => l.supplier_id === s.id), versions: versions.filter((v) => v.supplier_id === s.id), history: paid.filter((p) => p.payee_id === s.id) }));
};

/** Whether this person may change a supplier's status: the same question supplier_update() asks, put to the database so the two cannot disagree. Name and TIN need supplier:manage. */
export const canChangeSupplierStatus = async (tx: Tx) => (await tx.q<{ yes: boolean }>("SELECT app_has_role_anywhere('VERIFIER') OR app_has_role_anywhere('FINANCE_MANAGER') AS yes"))[0].yes;

export interface PersonVersion { id: string; person_id: string; version: number; kind: string; bank_name: string | null; account_last4: string | null; number_state: NumberState; telebirr_phone: string | null; status: string; created_by: string; rejection_reason: string | null }
export interface PersonRow { id: string; company_id: string; company: string; full_name: string; phone: string | null; id_last4: string; preferred_method: string; is_active: boolean; versions: PersonVersion[]; history: PaymentLine[] }

export const personList = async (tx: Tx, company: string | null) => {
  const people = await tx.q<Omit<PersonRow, "versions" | "history">>(
    `SELECT p.id, p.company_id, c.legal_name AS company, p.full_name, p.phone, p.id_last4, p.preferred_method::text AS preferred_method, p.is_active
       FROM person_payees p JOIN companies c ON c.id = p.company_id WHERE $1::uuid IS NULL OR p.company_id = $1 ORDER BY p.full_name`, [company]);
  const ids = people.map((p) => p.id);
  const versions = await tx.q<PersonVersion>("SELECT id, person_id, version, kind, bank_name, account_last4, person_account_state(id) AS number_state, telebirr_phone, status, created_by, rejection_reason FROM person_payment_details WHERE person_id = ANY($1::uuid[]) ORDER BY person_id, version DESC", [ids]);
  const paid = await history(tx, "person_payee_id", ids, company);
  return people.map((p): PersonRow => ({ ...p, versions: versions.filter((v) => v.person_id === p.id), history: paid.filter((h) => h.payee_id === p.id) }));
};

/** The methods a person can be paid by today. Transfer and Telebirr need verified details; cash and cheque need none, so a one-time payee can be paid straight away. */
export const readyMethods = (versions: Pick<PersonVersion, "kind" | "status">[]) => Object.keys(PAYMENT_METHODS).filter((m) => { const kind = PERSON_DETAIL_FOR_METHOD[m]; return !kind || versions.some((v) => v.kind === kind && v.status === "VERIFIED"); });
export const needsVerifying = (versions: { status: string }[]) => versions.some((v) => v.status === "PENDING");
export const verifiedVersion = <T extends { status: string }>(versions: T[]) => versions.find((v) => v.status === "VERIFIED") ?? null;

export const VERSION_STATUS: Record<string, string> = { VERIFIED: "Verified", PENDING: "Waiting for verification", REJECTED: "Rejected", SUPERSEDED: "Replaced" };
export const LIST_FILTERS = [
  { key: "status", label: "Status", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] },
  { key: "details", label: "Payment details", options: [{ value: "pending", label: "Waiting for verification" }, { value: "none", label: "Not verified" }] },
];
/** The filter values for one payee. */
export const listFilters = (active: boolean, versions: { status: string }[]) => ({ status: active ? "active" : "inactive", details: needsVerifying(versions) ? "pending" : verifiedVersion(versions) ? "verified" : "none" });
