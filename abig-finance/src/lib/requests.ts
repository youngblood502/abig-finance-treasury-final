import type { Tx } from "./db";
import { etb, PAYMENT_METHODS, STATE_LABEL } from "./format";
import type { ApprovalStage } from "./workflow";

// What the request screens read. Everything goes through row-level security: `company` is the company switcher's choice and can only narrow a list.
// Every change still goes through the existing actions and the wf_* functions, which decide what is allowed.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, DATE = /^\d{4}-\d{2}-\d{2}$/;
export const REQUEST_LIST_LIMIT = 500;

// Group reporting is read-only access to a company, not membership of it. A group reporter sees a request's number, company, amount, method, account, dates and status, but not
// who is paid or how, the invoice or its documents, who handled it, or why. Administrators count as members.
const MEMBER = "r.debtor_company_id IN (SELECT app_member_companies())";
export const PAYEE_HIDDEN = "Not shown";

export interface RequestFilters { q: string; state: string | null; method: string | null; account: string | null; from: string | null; to: string | null }

/** Reads the filters from the URL. Anything that is not a valid value is dropped, so it never reaches a query. */
export const parseRequestFilters = (sp: Record<string, string | undefined>): RequestFilters => ({
  q: (sp.q ?? "").trim().slice(0, 100),
  state: sp.state && STATE_LABEL[sp.state] ? sp.state : null,
  method: sp.method && PAYMENT_METHODS[sp.method] ? sp.method : null,
  account: sp.account && UUID.test(sp.account) ? sp.account : null,
  from: sp.from && DATE.test(sp.from) ? sp.from : null,
  to: sp.to && DATE.test(sp.to) ? sp.to : null,
});
/** A search is plain text: % and _ mean themselves. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export interface RequestListRow { id: string; request_no: string; company: string; payee: string | null; total_amount: string; workflow_state: string; priority: string; account: string | null; method: string; due: string | null }
export const listRequests = (tx: Tx, f: RequestFilters, company: string | null) => tx.q<RequestListRow>(
  `SELECT r.id, r.request_no, c.legal_name AS company, CASE WHEN ${MEMBER} THEN COALESCE(s.legal_name, p.full_name) END AS payee, r.total_amount, r.workflow_state::text AS workflow_state, r.priority, a.account_label AS account, r.payment_method::text AS method,
          (SELECT min(due_date) FROM payment_installments WHERE request_id = r.id) AS due
     FROM payment_requests r JOIN companies c ON c.id = r.debtor_company_id LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN person_payees p ON p.id = r.person_payee_id
     LEFT JOIN company_bank_accounts a ON a.id = r.debit_account_id
    WHERE ($1::text IS NULL OR r.workflow_state::text = $1) AND ($2::uuid IS NULL OR r.debtor_company_id = $2)
      AND ($3::text IS NULL OR r.request_no ILIKE $3 OR (${MEMBER} AND (COALESCE(s.legal_name, p.full_name) ILIKE $3 OR r.invoice_ref ILIKE $3)))
      AND ($4::text IS NULL OR r.payment_method::text = $4) AND ($5::uuid IS NULL OR r.debit_account_id = $5)
      AND ($6::date IS NULL OR r.created_at >= $6::date) AND ($7::date IS NULL OR r.created_at < $7::date + 1)
    ORDER BY r.created_at DESC LIMIT ${REQUEST_LIST_LIMIT}`,
  [f.state, company, f.q ? likePattern(f.q) : null, f.method, f.account, f.from, f.to]);

export const filterAccounts = (tx: Tx) => tx.q<{ id: string; account_label: string }>("SELECT id, account_label FROM company_bank_accounts ORDER BY account_label");

export interface FormPayee { company_id: string; payee_type: string; payee_id: string; company: string; payee: string; bank_ok: boolean }
export interface FormAccount { company_id: string; id: string; account_label: string; account_kind: string; wallet_phone: string | null; bank_name: string | null; account_last4: string | null; available_balance: number; shortfall_amount: number }

/** Who a person may pay and from which accounts: only companies where they may create requests. */
export const requestFormOptions = async (tx: Tx) => ({
  payees: await tx.q<FormPayee>(
    `SELECT cs.company_id, 'SUPPLIER' AS payee_type, cs.supplier_id AS payee_id, c.legal_name AS company, s.legal_name AS payee,
            EXISTS (SELECT 1 FROM supplier_bank_details b WHERE b.supplier_id = s.id AND b.status = 'VERIFIED') AS bank_ok
       FROM company_suppliers cs JOIN companies c ON c.id = cs.company_id JOIN suppliers s ON s.id = cs.supplier_id
      WHERE cs.status = 'ACTIVE' AND s.is_active AND cs.company_id IN (SELECT app_permitted_companies('payment_request:create')) UNION ALL
     SELECT p.company_id, 'PERSON', p.id, c.legal_name, p.full_name, true
       FROM person_payees p JOIN companies c ON c.id = p.company_id
      WHERE p.is_active AND p.company_id IN (SELECT app_permitted_companies('payment_request:create')) ORDER BY 4, 5`),
  accounts: (await tx.q<Omit<FormAccount, "available_balance" | "shortfall_amount"> & { available_balance: string; shortfall_amount: string }>(
    `SELECT gc.company_id, a.id, a.account_label, a.account_kind::text AS account_kind, a.wallet_phone, b.name AS bank_name, a.account_last4, a.available_balance, a.shortfall_amount
       FROM company_bank_accounts a LEFT JOIN banks b ON b.id = a.bank_id CROSS JOIN LATERAL app_granted_companies(a.id, 'USE') AS gc(company_id)
      WHERE a.is_active AND gc.company_id IN (SELECT app_permitted_companies('payment_request:create')) ORDER BY a.account_label`))
    .map((a) => ({ ...a, available_balance: Number(a.available_balance), shortfall_amount: Number(a.shortfall_amount) })),
});

export interface RequestRow {
  id: string; request_no: string; version: number; workflow_state: string; created_by: string; debtor_company_id: string; supplier_id: string | null; person_payee_id: string | null;
  total_amount: string; priority: string; invoice_ref: string | null; invoice_date: string | null; description: string | null; payment_method: string; cheque_no: string | null; bank_reference: string | null; paid_at: Date | null;
  debit_account_id: string | null; company: string; payee: string | null; tin: string | null; bank_name: string | null; account_last4: string | null; bank_status: string | null; creator_name: string | null;
  person_phone: string | null; id_last4: string | null; person_kind: string | null; person_bank: string | null; person_last4: string | null; telebirr_phone: string | null; person_detail_status: string | null;
  debit_label: string | null; account_kind: string | null; wallet_phone: string | null; debit_bank: string | null; debit_last4: string | null; debit_available: string | null; debit_current: string | null; debit_reserved: string | null; is_member: boolean;
}
export interface InstallmentRow { seq: number; due_date: string; amount: string }
export interface ApprovalRow { id: string; action: string; actor_role: string; reason: string | null; occurred_at: Date; full_name: string | null }
export interface AdjustmentRow { id: string; field: string; old_value: string | null; new_value: string | null; reason: string; occurred_at: Date; full_name: string | null }
export interface FileRow { id: string; kind: string; filename: string; uploaded_at: Date; replaced: number | null }

/** What a group reporter does not get. Applied to everything loadRequest returns, so no page can show it by mistake. */
const PRIVATE_FIELDS: (keyof RequestRow)[] = ["payee", "tin", "bank_name", "account_last4", "bank_status", "creator_name", "person_phone", "id_last4", "person_kind", "person_bank", "person_last4", "telebirr_phone", "person_detail_status", "invoice_ref", "invoice_date", "description", "cheque_no", "bank_reference"];
export const maskRequest = (r: RequestRow): RequestRow => ({ ...r, ...Object.fromEntries(PRIVATE_FIELDS.map((k) => [k, null])) });

export const loadRequest = async (tx: Tx, id: string) => {
  const row = (await tx.q<RequestRow>(
    `SELECT r.id, r.request_no, r.version, r.workflow_state::text AS workflow_state, r.created_by, r.debtor_company_id, r.supplier_id, r.person_payee_id, r.total_amount, r.priority, r.invoice_ref, r.invoice_date, r.description,
            r.payment_method::text AS payment_method, r.cheque_no, r.bank_reference, r.paid_at, r.debit_account_id,
            c.legal_name AS company, COALESCE(s.legal_name, p.full_name) AS payee, s.tin, b.bank_name, b.account_last4, b.status AS bank_status, u.full_name AS creator_name,
            p.phone AS person_phone, p.id_last4, pd.kind AS person_kind, pd.bank_name AS person_bank, pd.account_last4 AS person_last4, pd.telebirr_phone, pd.status AS person_detail_status,
            da.account_label AS debit_label, da.account_kind::text AS account_kind, da.wallet_phone, dk.name AS debit_bank, da.account_last4 AS debit_last4,
            da.available_balance AS debit_available, da.current_balance AS debit_current, da.reserved_balance AS debit_reserved, ${MEMBER} AS is_member
       FROM payment_requests r JOIN companies c ON c.id = r.debtor_company_id LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN person_payees p ON p.id = r.person_payee_id
       LEFT JOIN person_payment_details pd ON pd.id = r.person_payment_detail_id LEFT JOIN supplier_bank_details b ON b.id = r.supplier_bank_detail_id LEFT JOIN users u ON u.id = r.created_by
       LEFT JOIN company_bank_accounts da ON da.id = r.debit_account_id LEFT JOIN banks dk ON dk.id = da.bank_id WHERE r.id = $1`, [id]))[0];
  if (!row) return null;
  const member = row.is_member;
  return {
    r: member ? row : maskRequest(row),
    restricted: !member,
    installments: await tx.q<InstallmentRow>("SELECT seq, due_date, amount FROM payment_installments WHERE request_id = $1 ORDER BY seq", [id]),
    approvals: (await tx.q<ApprovalRow>("SELECT a.id, a.action, a.actor_role, a.reason, a.occurred_at, u.full_name FROM approval_events a LEFT JOIN users u ON u.id = a.actor_id WHERE a.request_id = $1 ORDER BY a.occurred_at, a.id", [id])).map((a) => (member ? a : { ...a, reason: null, full_name: null })),
    adjustments: member ? await tx.q<AdjustmentRow>("SELECT h.id, h.field, h.old_value, h.new_value, h.reason, h.occurred_at, u.full_name FROM adjustment_history h LEFT JOIN users u ON u.id = h.actor_id WHERE h.request_id = $1 ORDER BY h.occurred_at, h.id", [id]) : [],
    files: member ? await tx.q<FileRow>("SELECT id, kind, filename, uploaded_at, (SELECT 1 FROM attachments x WHERE x.supersedes_id = attachments.id) AS replaced FROM attachments WHERE request_id = $1 ORDER BY uploaded_at", [id]) : [],
    stage: (await tx.q<{ stage: ApprovalStage }>("SELECT stage FROM app_actionable_requests() WHERE request_id = $1", [id]))[0]?.stage ?? null,
  };
};

/** A document can name the payee, so it opens only for the company's members. Null reads the same as a file that does not exist. */
export const requestDocument = async (tx: Tx, id: string) => (await tx.q<{ object_key: string; filename: string; mime_type: string }>(
  `SELECT f.object_key, f.filename, f.mime_type FROM attachments f JOIN payment_requests r ON r.id = f.request_id WHERE f.id = $1 AND ${MEMBER}`, [id]))[0] ?? null;

export interface ReviewRow {
  request_id: string; request_no: string; stage: ApprovalStage; request_version: number; total_amount: string; waiting_since: Date; company: string; payee: string | null; creator: string | null; verifier: string | null; verified_at: Date | null;
  method: string; account_label: string | null; current_balance: string | null; reserved_balance: string | null; document: string | null; document_name: string | null; due: string | null;
}
/** The approval queues. The database decides what waits for this person: never their own request, and never one they handled at the other stage. */
export const reviewQueue = (tx: Tx, company: string | null) => tx.q<ReviewRow>(
  `SELECT a.request_id, a.request_no, a.stage, a.request_version, a.total_amount, a.waiting_since, c.legal_name AS company, COALESCE(s.legal_name, p.full_name) AS payee, u.full_name AS creator, vu.full_name AS verifier, r.verified_at,
          r.payment_method::text AS method, da.account_label, da.current_balance, da.reserved_balance,
          (SELECT f.id FROM attachments f WHERE f.request_id = a.request_id AND NOT EXISTS (SELECT 1 FROM attachments x WHERE x.supersedes_id = f.id) ORDER BY f.uploaded_at DESC LIMIT 1) AS document,
          (SELECT f.filename FROM attachments f WHERE f.request_id = a.request_id AND NOT EXISTS (SELECT 1 FROM attachments x WHERE x.supersedes_id = f.id) ORDER BY f.uploaded_at DESC LIMIT 1) AS document_name,
          (SELECT min(due_date) FROM payment_installments WHERE request_id = a.request_id) AS due
     FROM app_actionable_requests() a JOIN payment_requests r ON r.id = a.request_id JOIN companies c ON c.id = a.debtor_company_id
     LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN person_payees p ON p.id = r.person_payee_id LEFT JOIN users u ON u.id = r.created_by LEFT JOIN users vu ON vu.id = r.verified_by
     LEFT JOIN company_bank_accounts da ON da.id = r.debit_account_id
    WHERE $1::uuid IS NULL OR a.debtor_company_id = $1 ORDER BY a.waiting_since`, [company]);

/**
 * What a person is offered on a request. The screen only shows these: the wf_* functions make the same decisions again.
 * `stage` comes from app_actionable_requests(), so verifying and authenticating can never both be offered, and neither is offered to the request's creator.
 */
export const requestActions = (state: string, mine: boolean, stage: ApprovalStage | null, canRecord: boolean) => ({
  edit: mine && state === "DRAFT",
  submit: mine && state === "DRAFT",
  cancel: mine && ["DRAFT", "SCHEDULED", "RESERVED", "VERIFIED"].includes(state),
  verify: stage === "VERIFICATION",
  authenticate: stage === "AUTHORIZATION",
  returnForCorrection: stage !== null,
  reject: stage === "AUTHORIZATION",
  adjust: stage !== null,
  record: canRecord && state === "AUTHENTICATED",
});

/** What authenticating does to the account: the funds guard debits the balance and releases the reservation by the same amount. */
export const authenticateEffect = (current: unknown, reserved: unknown, amount: unknown) => [
  { label: "Balance before", value: etb(current) }, { label: "Balance after", value: etb(Number(current) - Number(amount)) },
  { label: "Reserved before", value: etb(reserved) }, { label: "Reserved after", value: etb(Number(reserved) - Number(amount)) },
];

const ACTION_LABEL: Record<string, string> = { SUBMIT: "Submitted", VERIFY: "Verified", AUTHORIZE: "Authenticated, account debited", RETURN: "Returned for correction", REJECT: "Rejected", CANCEL: "Cancelled", ADJUST: "Adjusted", INVALIDATE: "Earlier approvals cancelled" };
const FIELD_LABEL: Record<string, string> = { total_amount: "Total", amount: "Installment amount", due_date: "Installment due date", priority: "Priority", invoice_ref: "Invoice reference", description: "Notes", supplier_id: "Supplier", supplier_bank_detail_id: "Supplier bank details" };
const MONEY_FIELDS = new Set(["total_amount", "amount"]);

export interface HistoryEntry { key: string; when: Date; who: string; role: string | null; title: string; detail: string | null; reason: string | null; tone: "default" | "warning" | "destructive" }

/** One story from the two audit tables, oldest first. Nothing is left out: the audit tables stay the record. */
export function requestHistory(approvals: ApprovalRow[], adjustments: AdjustmentRow[]): HistoryEntry[] {
  const money = (field: string, v: string | null) => (v !== null && MONEY_FIELDS.has(field) ? etb(v) : v ?? "empty");
  return [
    ...approvals.map((a): HistoryEntry => ({
      key: `a${a.id}`, when: a.occurred_at, who: a.full_name ?? "Someone at the company", role: a.actor_role.toLowerCase().replace(/_/g, " "), title: ACTION_LABEL[a.action] ?? a.action, detail: null, reason: a.reason,
      tone: a.action === "REJECT" || a.action === "CANCEL" ? "destructive" : a.action === "RETURN" ? "warning" : "default",
    })),
    ...adjustments.map((a): HistoryEntry => ({
      key: `h${a.id}`, when: a.occurred_at, who: a.full_name ?? "Someone at the company", role: null, title: `${FIELD_LABEL[a.field] ?? a.field.replace(/_/g, " ")} changed`, detail: `${money(a.field, a.old_value)} to ${money(a.field, a.new_value)}`, reason: a.reason, tone: "warning",
    })),
  ].sort((x, y) => x.when.getTime() - y.when.getTime());
}

/** Why a request is not moving forward, shown first: its latest return, rejection or cancellation, while it still applies. */
export function stopReason(state: string, approvals: ApprovalRow[]) {
  const wanted = state === "DRAFT" ? "RETURN" : state === "REJECTED" ? "REJECT" : state === "CANCELLED" ? "CANCEL" : null;
  if (!wanted) return null;
  const last = [...approvals].reverse().find((a) => ["SUBMIT", "RETURN", "REJECT", "CANCEL"].includes(a.action));
  if (!last || last.action !== wanted || !last.reason) return null;
  return { title: wanted === "RETURN" ? "Returned for correction" : wanted === "REJECT" ? "Rejected" : "Cancelled", reason: last.reason, who: last.full_name ?? "Someone at the company", when: last.occurred_at };
}

/** The Age filter on the approval queues. */
export const ageBucket = (since: Date, now: Date = new Date()) => { const days = (now.getTime() - since.getTime()) / 864e5; return days < 1 ? "today" : days <= 3 ? "recent" : "old"; };
export const AGE_OPTIONS = [{ value: "today", label: "Today" }, { value: "recent", label: "1 to 3 days" }, { value: "old", label: "Over 3 days" }];
