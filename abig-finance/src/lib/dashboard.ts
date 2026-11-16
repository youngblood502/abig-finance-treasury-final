import { accountInCompany } from "./company";
import type { Tx } from "./db";
import { etb } from "./format";
import { can, canAccess } from "./rbac";
import type { Me } from "./session";

// The dashboard's questions. Each one reads through row-level security and the existing functions, so a person only ever counts what they may see.
// `company` is the company switcher's choice, or null for all of theirs.

/** Which parts of the dashboard a person gets. Roles combine: someone with two roles sees both parts. */
export const dashboardSections = (me: Me) => ({
  cash: canAccess(me, "/accounts"),
  requests: canAccess(me, "/requests"),
  newRequest: canAccess(me, "/requests/new"),
  /** The Accountant's week: openings, balance checks, outstanding payments, drafts and returned requests. */
  prepare: can(me, "bank_balance:update") || can(me, "payment_request:create"),
  verify: can(me, "payment_request:verify"),
  authenticate: can(me, "payment_request:authenticate"),
});

// The wording of figures that are easy to misread on a shared account. An account has one balance and belongs to one legal owner, but several companies may
// use it, so a figure can be wider or narrower than what a person's own company did.
export const OWNER_CASH_NOTE = "Grouped by each account's legal owner. Shows only the accounts you can see, so this may not be that company's full cash position.";
export const ownerCashLabel = (owner: string) => `Accounts owned by ${owner}`;
export const ownerCashHint = (available: unknown) => `${etb(available)} available on these accounts`;
export const RESERVED_LABEL = "Reserved on these accounts";
export const SHARED_RESERVED_HINT = "Account totals, including other companies that share them";
/** The requests section counts only what the person may see, for the chosen company if there is one. */
export const requestsTitle = (company: string | null) => (company ? `Payment requests visible for ${company}` : "Payment requests visible to you");
export const SHARED_REQUESTS_NOTE = "These count only the requests you can see. Reserved on these accounts is each account's whole total, so it can be higher on a shared account.";
/** The chosen company's name, or null for all of them. */
export const scopeName = (company: string | null, companies: { id: string; name: string }[]) => companies.find((c) => c.id === company)?.name ?? null;

export interface AccountRow {
  id: string; account_label: string; account_kind: string; wallet_phone: string | null; bank_name: string | null; account_last4: string | null; is_active: boolean;
  current_balance: string; reserved_balance: string; available_balance: string; shortfall_amount: string; balance_updated_at: Date | null; companies: string[];
}
export const accountRows = (tx: Tx, company: string | null) => tx.q<AccountRow>(
  `SELECT a.id, a.account_label, a.account_kind::text AS account_kind, a.wallet_phone, b.name AS bank_name, a.account_last4, a.is_active, a.current_balance, a.reserved_balance, a.available_balance, a.shortfall_amount, a.balance_updated_at,
          COALESCE((SELECT array_agg(c.legal_name ORDER BY g.is_owner DESC, c.legal_name) FROM company_bank_account_access g JOIN companies c ON c.id = g.company_id WHERE g.account_id = a.id AND g.revoked_at IS NULL), '{}') AS companies
     FROM company_bank_accounts a LEFT JOIN banks b ON b.id = a.bank_id WHERE ${accountInCompany("a.id", "$1")} ORDER BY a.account_label`, [company]);

export interface WeekRow { account_id: string; account_label: string; has_opening: boolean; last_figure_at: Date | null; outstanding_count: number; overdue_count: number; can_check: boolean }
export const weekRows = (tx: Tx, company: string | null) => tx.q<WeekRow>(
  `SELECT s.account_id, s.account_label, s.has_opening, s.last_figure_at, s.outstanding_count, s.overdue_count, s.can_check FROM account_week_status() s WHERE ${accountInCompany("s.account_id", "$1")}`, [company]);

export interface StateCount { state: string; n: number; amount: string }
export const requestCounts = (tx: Tx, company: string | null) => tx.q<StateCount>(
  "SELECT workflow_state::text AS state, count(*)::int AS n, COALESCE(sum(total_amount), 0) AS amount FROM payment_requests WHERE $1::uuid IS NULL OR debtor_company_id = $1 GROUP BY 1", [company]);

export interface QueueRow { request_id: string; request_no: string; stage: string; company: string; payee: string; total_amount: string; waiting_since: Date }
/** What is waiting for this person. The database decides: never their own request, and never one they handled at the other stage. */
export const approvalQueue = (tx: Tx, company: string | null) => tx.q<QueueRow>(
  `SELECT a.request_id, a.request_no, a.stage, c.legal_name AS company, COALESCE(s.legal_name, p.full_name, ot.full_name) AS payee, a.total_amount, a.waiting_since
     FROM app_actionable_requests() a JOIN payment_requests r ON r.id = a.request_id JOIN companies c ON c.id = a.debtor_company_id
     LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN person_payees p ON p.id = r.person_payee_id LEFT JOIN one_time_payees ot ON ot.id = r.one_time_payee_id
    WHERE $1::uuid IS NULL OR a.debtor_company_id = $1 ORDER BY a.waiting_since`, [company]);

export interface ReturnedRow { id: string; request_no: string; total_amount: string; reason: string; returned_at: Date }
/** Drafts whose last decision was a return, with the reason. A draft is private to its creator, so this is the person's own work. */
export const returnedDrafts = (tx: Tx, company: string | null) => tx.q<ReturnedRow>(
  `SELECT r.id, r.request_no, r.total_amount, e.reason, e.occurred_at AS returned_at
     FROM payment_requests r CROSS JOIN LATERAL (SELECT x.action, x.reason, x.occurred_at FROM approval_events x WHERE x.request_id = r.id AND x.action IN ('SUBMIT','RETURN') ORDER BY x.occurred_at DESC, x.id DESC LIMIT 1) e
    WHERE r.workflow_state = 'DRAFT' AND e.action = 'RETURN' AND ($1::uuid IS NULL OR r.debtor_company_id = $1) ORDER BY e.occurred_at DESC`, [company]);

export interface CompanyCash { company: string; current: string; available: string }
/** Cash by the company that owns each account, so a shared account counts once. */
export const cashByCompany = (tx: Tx, company: string | null) => tx.q<CompanyCash>(
  `SELECT o.legal_name AS company, sum(a.current_balance) AS current, sum(a.available_balance) AS available
     FROM company_bank_accounts a JOIN companies o ON o.id = account_owner_company(a.id)
    WHERE a.is_active AND ${accountInCompany("a.id", "$1")} GROUP BY o.legal_name ORDER BY o.legal_name`, [company]);

/** Authenticated since Monday, in Addis Ababa time: the money that has left the system balance this week. */
export const weekOutflow = async (tx: Tx, company: string | null) => (await tx.q<{ total: string; n: number }>(
  `SELECT COALESCE(sum(total_amount), 0) AS total, count(*)::int AS n FROM payment_requests
    WHERE workflow_state IN ('AUTHENTICATED','PAID') AND authenticated_at >= (week_monday(addis_day(now()))::timestamp AT TIME ZONE 'Africa/Addis_Ababa')
      AND ($1::uuid IS NULL OR debtor_company_id = $1)`, [company]))[0];
