import { accountInCompany } from "./company";
import type { Tx } from "./db";
import { addisDate, PAYMENT_METHODS } from "./format";
import type { AccessLevel } from "./treasury-screens";

// One place for the report queries, used by the Reports page and the CSV export, so the two can never show different things.
// They read through row-level security and the database's masked functions, so every person gets only the companies and accounts they may see.
//
// Group reporting is read-only access to a company, not membership of it. A group reporter sees what happened and how much, but not who was paid, who approved it,
// or what an audit entry recorded. `MEMBER` is that line: a value below it comes back empty, in the query itself, for the page and the export alike.
const member = (company: string) => `${company} IN (SELECT app_member_companies())`;

export const REPORT_TABS: [string, string][] = [["pending", "Waiting for payment"], ["payments", "Payments"], ["outstanding", "Outstanding by age"], ["weeks", "Reconciliation and deposits"], ["cash", "Cash and commitments"], ["audit", "Audit trail"]];
export const BUCKETS = ["Not yet due", "1-30 days overdue", "31-60 days overdue", "Over 60 days overdue"];
export const AGE_BUCKETS = ["Under 7 days", "7 to 13 days", "14 to 30 days", "Over 30 days"];
export const ageBucket = (days: number) => AGE_BUCKETS[days < 7 ? 0 : days < 14 ? 1 : days <= 30 ? 2 : 3];
export const AUDIT_LIMIT = 200;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (v: string | null | undefined) => !!v && DATE.test(v) && !Number.isNaN(Date.parse(v));
export interface ReportFilters { from: string; to: string; q: string | null; method: string | null; state: string | null }
/** The filters from a URL, for the page and the export. Anything invalid falls back to the last 30 days and no filter. */
export function reportFilters(get: (key: string) => string | null | undefined, now = new Date()): ReportFilters {
  const from = get("from"), to = get("to"), method = get("method"), state = get("state");
  const dates = [validDate(from) ? from! : addisDate(new Date(now.getTime() - 30 * 864e5)), validDate(to) ? to! : addisDate(now)];
  return { from: dates[0] <= dates[1] ? dates[0] : dates[1], to: dates[0] <= dates[1] ? dates[1] : dates[0], q: (get("q") ?? "").trim().slice(0, 100) || null, method: method && method in PAYMENT_METHODS ? method : null, state: state === "AUTHENTICATED" || state === "PAID" ? state : null };
}
/** The same filters as a query string, so a download matches the screen. */
export const filterQuery = (f: ReportFilters) => { const p = new URLSearchParams({ from: f.from, to: f.to }); if (f.q) p.set("q", f.q); if (f.method) p.set("method", f.method); if (f.state) p.set("state", f.state); return p.toString(); };

export interface PendingRow { request_no: string; company_name: string; payee_name: string | null; workflow_state: string; priority: string; seq: number; due_date: string; amount: string; account_label: string | null; bucket: string }
/** Requests that have reserved funds and are not yet authenticated, one row per instalment. */
export const pendingRows = (tx: Tx, company: string | null = null) => tx.q<PendingRow>(
  `SELECT r.request_no, c.legal_name AS company_name, CASE WHEN ${member("r.debtor_company_id")} THEN COALESCE(s.legal_name, p.full_name) END AS payee_name, r.workflow_state::text AS workflow_state, r.priority, i.seq, i.due_date::text AS due_date, i.amount,
          da.account_label AS account_label,
          CASE WHEN i.due_date >= current_date THEN 'Not yet due' WHEN current_date - i.due_date <= 30 THEN '1-30 days overdue' WHEN current_date - i.due_date <= 60 THEN '31-60 days overdue' ELSE 'Over 60 days overdue' END AS bucket
     FROM payment_requests r JOIN payment_installments i ON i.request_id = r.id JOIN companies c ON c.id = r.debtor_company_id LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN person_payees p ON p.id = r.person_payee_id
     LEFT JOIN company_bank_accounts da ON da.id = r.debit_account_id
    WHERE r.workflow_state IN ('RESERVED', 'VERIFIED') AND ($1::uuid IS NULL OR r.debtor_company_id = $1) ORDER BY i.due_date, r.request_no, i.seq`, [company]);

export interface PaymentRow { authenticated_at: Date; request_no: string; company_name: string; payee_name: string | null; account_label: string | null; amount: string; workflow_state: string; payment_method: string; verified_by: string | null; authenticated_by: string | null }
/** Authenticated and Paid requests: the account was debited. Authenticated ones are not yet confirmed by the bank. A search cannot reach a payee the person may not see. */
export const paymentRows = (tx: Tx, f: Pick<ReportFilters, "from" | "to" | "q" | "method" | "state">, company: string | null = null) => tx.q<PaymentRow>(
  `SELECT r.authenticated_at, r.request_no, c.legal_name AS company_name, CASE WHEN ${member("r.debtor_company_id")} THEN COALESCE(s.legal_name, p.full_name) END AS payee_name, da.account_label AS account_label, r.total_amount AS amount, r.workflow_state::text AS workflow_state, r.payment_method::text AS payment_method,
          CASE WHEN ${member("r.debtor_company_id")} THEN vu.full_name END AS verified_by, CASE WHEN ${member("r.debtor_company_id")} THEN au.full_name END AS authenticated_by
     FROM payment_requests r JOIN companies c ON c.id = r.debtor_company_id LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN person_payees p ON p.id = r.person_payee_id
     LEFT JOIN company_bank_accounts da ON da.id = r.debit_account_id LEFT JOIN users vu ON vu.id = r.verified_by LEFT JOIN users au ON au.id = r.authenticated_by
    WHERE r.workflow_state IN ('AUTHENTICATED', 'PAID') AND r.authenticated_at >= $1::date AND r.authenticated_at < $2::date + 1 AND ($3::uuid IS NULL OR r.debtor_company_id = $3)
      AND ($4::text IS NULL OR r.payment_method::text = $4) AND ($5::text IS NULL OR r.workflow_state::text = $5)
      AND ($6::text IS NULL OR r.request_no ILIKE '%' || $6 || '%' OR c.legal_name ILIKE '%' || $6 || '%' OR (${member("r.debtor_company_id")} AND COALESCE(s.legal_name, p.full_name) ILIKE '%' || $6 || '%'))
    ORDER BY r.authenticated_at DESC`, [f.from, f.to, company, f.method, f.state, f.q]);

export interface OutstandingRow { id: string; account_label: string; access: AccessLevel; request_no: string; company_name: string; payee_name: string | null; payment_method: string; amount: string; age_days: number; overdue: boolean; ticked: boolean }
/**
 * Authenticated payments not yet Paid, oldest first. outstanding_payments() applies FULL, TICK and NONE to each account. On top of that a payee shows only to the account's
 * owner at FULL and to the payment's own company, so a group reporter never gets one.
 */
export const outstandingRows = (tx: Tx, company: string | null = null) => tx.q<OutstandingRow>(
  `SELECT o.id, a.account_label, app_account_access(a.id) AS access, o.request_no, o.company AS company_name, CASE WHEN app_account_access(a.id) = 'FULL' OR ${member("o.company_id")} THEN o.payee END AS payee_name, o.method AS payment_method, o.amount, o.age_days, o.overdue, o.processed_at IS NOT NULL AS ticked
     FROM company_bank_accounts a CROSS JOIN LATERAL outstanding_payments(a.id) o WHERE a.is_active AND ($1::uuid IS NULL OR o.company_id = $1) ORDER BY o.age_days DESC, o.request_no`, [company]);

export interface WeekRow { week_id: string; account_id: string; account_label: string; week_start: string; status: string; access: AccessLevel; deposits: string | null; implied_total: string | null; deposit_difference: string | null; balance_difference: string | null; adjust_total: string | null; prepared_by_name: string | null; locked_by_name: string | null; locked_at: Date | null }
/** Each account's reconciled weeks and deposits. reconciliation_summary() gives the figures at FULL and only the status below it. */
export const weekRows = (tx: Tx, f: Pick<ReportFilters, "from" | "to">, company: string | null = null) => tx.q<WeekRow>(
  `SELECT t.id AS week_id, t.account_id, s.account_label, t.week_start::text AS week_start, s.status, app_account_access(t.account_id) AS access, s.deposits, s.implied_total, s.deposit_difference, s.balance_difference, s.adjust_total, s.prepared_by_name, s.locked_by_name, s.locked_at
     FROM treasury_weeks t CROSS JOIN LATERAL reconciliation_summary(t.id) s
    WHERE t.opening_entry_id IS NOT NULL AND t.week_start + 6 >= $2::date AND t.week_start <= $3::date AND ${accountInCompany("t.account_id", "$1")} ORDER BY t.week_start DESC, s.account_label`, [company, f.from, f.to]);

export interface CashRow { account_label: string; account_kind: string; wallet_phone: string | null; bank_name: string | null; account_last4: string | null; current_balance: string; reserved_balance: string; available_balance: string; shortfall_amount: string; min_buffer: string; balance_updated_at: Date | null; due_30_days: string; shared: boolean }
/** Per account: the three balances, and what falls due in the next 30 days on requests this person can see. The balances are the account's; the 30 days are not a whole-account figure on a shared one. */
export const cashRows = (tx: Tx, company: string | null = null) => tx.q<CashRow>(
  `SELECT a.account_label, a.account_kind::text AS account_kind, a.wallet_phone, b.name AS bank_name, a.account_last4, a.current_balance, a.reserved_balance, a.available_balance, a.shortfall_amount, a.min_buffer, a.balance_updated_at,
          COALESCE((SELECT sum(i.amount) FROM payment_requests r JOIN payment_installments i ON i.request_id = r.id
                     WHERE r.debit_account_id = a.id AND r.workflow_state IN ('RESERVED', 'VERIFIED') AND i.due_date <= current_date + 30), 0) AS due_30_days,
          (SELECT count(*) FROM company_bank_account_access g WHERE g.account_id = a.id AND g.revoked_at IS NULL) > 1 AS shared
     FROM company_bank_accounts a LEFT JOIN banks b ON b.id = a.bank_id WHERE a.is_active AND ${accountInCompany("a.id", "$1")} ORDER BY a.account_label`, [company]);

export interface AuditRow { occurred_at: Date; actor: string | null; company: string | null; action: string; entity_type: string; entity_id: string | null; metadata: unknown }
/**
 * The audit trail. A company's entries can hold bank figures and statement totals that the balance log hides, so who did it and the details show only to the person who did it,
 * that company's Finance Managers and administrators. A group reporter sees that it happened, and when.
 */
export const auditRows = (tx: Tx, f: Pick<ReportFilters, "q"> & Partial<Pick<ReportFilters, "from" | "to">>, limit = AUDIT_LIMIT, company: string | null = null) => {
  // Administrators read every company's detail, a deactivated one's included: app_member_companies('FINANCE_MANAGER') gives them active companies only.
  const full = "(e.actor_id = app_user_id() OR e.company_id IN (SELECT app_member_companies('FINANCE_MANAGER')) OR app_is_admin())";
  return tx.q<AuditRow>(
    `SELECT e.occurred_at, CASE WHEN ${full} THEN u.full_name END AS actor, c.legal_name AS company, e.action, e.entity_type, CASE WHEN ${full} THEN e.entity_id END AS entity_id, CASE WHEN ${full} THEN e.metadata END AS metadata
       FROM audit_events e LEFT JOIN users u ON u.id = e.actor_id LEFT JOIN companies c ON c.id = e.company_id
      WHERE ($1::text IS NULL OR e.action ILIKE '%' || $1 || '%') AND ($2::uuid IS NULL OR e.company_id = $2) AND ($3::date IS NULL OR e.occurred_at >= $3::date) AND ($4::date IS NULL OR e.occurred_at < $4::date + 1)
      ORDER BY e.occurred_at DESC LIMIT ${Math.min(limit, 5000)}`, [f.q, company, f.from ?? null, f.to ?? null]);
};

/** Totals by a key, largest first. A missing value is grouped as `empty`. */
export function totalsBy<T>(rows: T[], key: (r: T) => string | null, amount: (r: T) => string | number, empty = "Not shown") {
  const m = new Map<string, number>();
  for (const r of rows) { const k = key(r) ?? empty; m.set(k, (m.get(k) ?? 0) + Math.round(Number(amount(r)) * 100)); }
  return [...m.entries()].map(([label, cents]) => ({ label, total: cents / 100 })).sort((a, b) => b.total - a.total);
}
export const totalOf = <T,>(rows: T[], amount: (r: T) => string | number) => rows.reduce((s, r) => s + Math.round(Number(amount(r)) * 100), 0) / 100;
