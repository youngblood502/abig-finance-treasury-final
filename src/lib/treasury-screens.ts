import { accountInCompany } from "./company";
import type { Tx } from "./db";

// What the treasury screens read. Row-level security and app_account_access() decide what comes back; the screens only draw it.
// `company` is the company switcher's choice and can only narrow a list.
//
//   FULL  the owner company's finance staff and administrators: every payment on the account.
//   TICK  others who may enter the balance: every payment's number, company, method and amount, but not who it pays.
//   NONE  everyone else who can see the account: the balance, and their own company's payments.

export type AccessLevel = "FULL" | "TICK" | "NONE";

export interface OverviewRow {
  account_id: string; account_label: string; account_kind: string; week_id: string | null; week_start: string; status: string; has_opening: boolean; last_figure_at: Date | null; can_check: boolean; access: AccessLevel; shared: boolean;
  current_balance: string; reserved_balance: string; available_balance: string; shortfall_amount: string;
  outstanding_count: number; overdue_count: number; outstanding_amount: string;
}
/** Each account's week. Balances and reservations are the account's own; the outstanding figures hold only what this person may see. */
export const treasuryOverview = (tx: Tx, company: string | null) => tx.q<OverviewRow>(
  `SELECT s.account_id, s.account_label, a.account_kind::text AS account_kind, s.week_id, s.week_start, s.status, s.has_opening, s.last_figure_at, s.can_check, app_account_access(s.account_id) AS access,
          (SELECT count(*) FROM company_bank_account_access g WHERE g.account_id = s.account_id AND g.revoked_at IS NULL) > 1 AS shared,
          a.current_balance, a.reserved_balance, a.available_balance, a.shortfall_amount, s.outstanding_count, s.overdue_count,
          COALESCE((SELECT sum(o.amount) FROM outstanding_payments(s.account_id) o), 0) AS outstanding_amount
     FROM account_week_status() s JOIN company_bank_accounts a ON a.id = s.account_id WHERE ${accountInCompany("s.account_id", "$1")} ORDER BY s.account_label`, [company]);

export interface ScheduleRow { request_id: string; request_no: string; seq: number; due_date: string; amount: string; workflow_state: string; company: string; payee: string | null; account_id: string | null; account_label: string | null }
/** Installments on requests that hold funds, falling due within 30 days or already overdue. Row-level security limits this to the person's own companies. */
export const paymentSchedule = (tx: Tx, company: string | null) => tx.q<ScheduleRow>(
  `SELECT r.id AS request_id, r.request_no, i.seq, i.due_date::text AS due_date, i.amount, r.workflow_state::text AS workflow_state, c.legal_name AS company, COALESCE(s.legal_name, p.full_name) AS payee, a.id AS account_id, a.account_label
     FROM payment_installments i JOIN payment_requests r ON r.id = i.request_id JOIN companies c ON c.id = r.debtor_company_id LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN person_payees p ON p.id = r.person_payee_id
     LEFT JOIN company_bank_accounts a ON a.id = r.debit_account_id
    WHERE r.workflow_state IN ('RESERVED','VERIFIED') AND i.due_date <= current_date + 30 AND ($1::uuid IS NULL OR r.debtor_company_id = $1) ORDER BY i.due_date, r.request_no, i.seq`, [company]);

export const dueBucket = (due: string, today: string) => {
  const days = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5);
  return days < 0 ? "overdue" : days <= 7 ? "week" : "month";
};
export const DUE_OPTIONS = [{ value: "overdue", label: "Overdue" }, { value: "week", label: "Within 7 days" }, { value: "month", label: "Within 30 days" }];

export interface WeekStatusRow { account_id: string; account_label: string; week_start: string; status: string; has_opening: boolean; can_check: boolean; can_prepare: boolean }
export interface AccountFacts { account_kind: string; current_balance: string; reserved_balance: string; available_balance: string; shortfall_amount: string; min_buffer: string; large_deposit_threshold: string; owner: string | null; companies: string[] }
export interface OutstandingRow { id: string; request_no: string; company: string; payee: string | null; method: string; amount: string; cheque_no: string | null; processed_at: Date | null; age_days: number; overdue: boolean; carried: boolean; default_processed: boolean; tick_undone: boolean }
export interface LogRow { id: string; updated_at: Date; previous_balance: string | null; new_balance: string; updated_by_name: string | null; request_no: string | null; entry_kind: string; bank_figure: string | null; outstanding_total: string | null; implied_deposit: string | null; anomalies: string[] }
export interface WeekRow { id: string; week_start: string; status: string; opening_entry_id: string | null }

/** Everything on one account's page. Null when the person cannot see the account at all. */
export const accountDetail = async (tx: Tx, account: string) => {
  const status = (await tx.q<WeekStatusRow>("SELECT account_id, account_label, week_start, status, has_opening, can_check, can_prepare FROM account_week_status() WHERE account_id = $1", [account]))[0];
  const facts = (await tx.q<AccountFacts>(
    `SELECT a.account_kind::text AS account_kind, a.current_balance, a.reserved_balance, a.available_balance, a.shortfall_amount, a.min_buffer, a.large_deposit_threshold, o.legal_name AS owner,
            COALESCE((SELECT array_agg(c.legal_name ORDER BY g.is_owner DESC, c.legal_name) FROM company_bank_account_access g JOIN companies c ON c.id = g.company_id WHERE g.account_id = a.id AND g.revoked_at IS NULL), '{}') AS companies
       FROM company_bank_accounts a LEFT JOIN companies o ON o.id = account_owner_company(a.id) WHERE a.id = $1`, [account]))[0];
  if (!status || !facts) return null;
  return {
    status, facts,
    access: (await tx.q<{ level: AccessLevel }>("SELECT app_account_access($1) AS level", [account]))[0].level,
    // A check's items are never changed, and only undo_processed_tick() clears a tick, so a payment that is unticked now but was ticked by a check has had its tick undone.
    payments: await tx.q<OutstandingRow>(
      `SELECT o.id, o.request_no, o.company, o.payee, o.method, o.amount, o.cheque_no, o.processed_at, o.age_days, o.overdue, o.carried, o.default_processed,
              o.processed_at IS NULL AND EXISTS (SELECT 1 FROM balance_check_items i WHERE i.request_id = o.id AND i.processed) AS tick_undone
         FROM outstanding_payments($1) o`, [account]),
    log: await tx.q<LogRow>("SELECT id, updated_at, previous_balance, new_balance, updated_by_name, request_no, entry_kind, bank_figure, outstanding_total, implied_deposit, anomalies FROM account_balance_history($1, 100)", [account]),
    weeks: await tx.q<WeekRow>("SELECT id, week_start, status::text AS status, opening_entry_id FROM treasury_weeks WHERE account_id = $1 ORDER BY week_start DESC LIMIT 12", [account]),
    hadOpening: (await tx.q<{ yes: boolean }>("SELECT EXISTS (SELECT 1 FROM treasury_weeks WHERE account_id = $1 AND opening_entry_id IS NOT NULL) AS yes", [account]))[0].yes,
  };
};

export interface AccountUser { id: string; account_id: string; company_id: string; name: string; is_owner: boolean; permissions: string[] }
export interface AccountRow {
  id: string; account_label: string; account_kind: string; wallet_phone: string | null; bank_name: string | null; account_last4: string | null; min_buffer: string; large_deposit_threshold: string; is_active: boolean;
  current_balance: string; reserved_balance: string; available_balance: string; shortfall_amount: string; balance_updated_at: Date | null; owner_company_id: string | null; owner: string | null;
  can_update: boolean; can_manage: boolean; access: AccessLevel; users: AccountUser[]; history: (LogRow & { account_id: string })[];
}
/** The accounts screen: every account with who shares it and its recent log, read in one pass rather than account by account. */
export const accountList = async (tx: Tx, company: string | null) => {
  const accounts = await tx.q<Omit<AccountRow, "users" | "history">>(
    `SELECT a.id, a.account_label, a.account_kind::text AS account_kind, a.wallet_phone, b.name AS bank_name, a.account_last4, a.min_buffer, a.large_deposit_threshold, a.is_active,
            a.current_balance, a.reserved_balance, a.available_balance, a.shortfall_amount, a.balance_updated_at, o.id AS owner_company_id, o.legal_name AS owner,
            app_can_snapshot(a.id) AS can_update, app_can_manage_access(a.id) AS can_manage, app_account_access(a.id) AS access
       FROM company_bank_accounts a LEFT JOIN banks b ON b.id = a.bank_id LEFT JOIN companies o ON o.id = account_owner_company(a.id)
      WHERE ${accountInCompany("a.id", "$1")} ORDER BY a.account_label`, [company]);
  const ids = accounts.map((a) => a.id);
  const users = await tx.q<AccountUser>("SELECT g.id, g.account_id, g.company_id, c.legal_name AS name, g.is_owner, g.permissions FROM company_bank_account_access g JOIN companies c ON c.id = g.company_id WHERE g.account_id = ANY($1::uuid[]) AND g.revoked_at IS NULL ORDER BY g.is_owner DESC, c.legal_name", [ids]);
  const history = await tx.q<LogRow & { account_id: string }>("SELECT a.id AS account_id, h.id, h.updated_at, h.previous_balance, h.new_balance, h.updated_by_name, h.request_no, h.entry_kind, h.bank_figure, h.outstanding_total, h.implied_deposit, h.anomalies FROM unnest($1::uuid[]) a(id) CROSS JOIN LATERAL account_balance_history(a.id, 25) h", [ids]);
  return accounts.map((a): AccountRow => ({ ...a, users: users.filter((u) => u.account_id === a.id), history: history.filter((h) => h.account_id === a.id) }));
};

/** How a payment starts on the balance check. Someone took this tick back on purpose, so it stays off until a person ticks it again. */
export const startsTicked = (p: Pick<OutstandingRow, "default_processed" | "tick_undone">) => p.default_processed && !p.tick_undone;

/** Which payments a figure covers, in words. On a shared account the same number can mean different things to different people. */
export const outstandingScope = (access: AccessLevel, shared: boolean) => (access === "NONE" ? "Your company only" : shared ? "All companies on this account" : "This account");
export const ACCESS_LABEL: Record<AccessLevel, string> = { FULL: "All payments", TICK: "Ticks all payments", NONE: "Your company's payments" };
export const ACCESS_NOTE: Record<AccessLevel, string | null> = {
  FULL: null,
  TICK: "This account is shared. You see every payment so you can tick it, but not who other companies pay.",
  NONE: "This account is shared. You see its balance and your own company's payments. Reservations and balances are the account's totals, so they can include other companies.",
};

/** The log's columns. Below TICK the database leaves most of these empty, and fills only Previous and By, on the company's own payments. Empty columns are not drawn. */
export const logColumnKeys = (access: AccessLevel, entries: Pick<LogRow, "previous_balance" | "updated_by_name">[]) => {
  if (access !== "NONE") return ["when", "entry", "bank", "outstanding", "previous", "balance", "implied", "by"];
  return ["when", "entry", ...(entries.some((e) => e.previous_balance !== null) ? ["previous"] : []), "balance", ...(entries.some((e) => e.updated_by_name !== null) ? ["by"] : [])];
};

const toCents = (v: number) => Math.round(v * 100);

export interface FigureInput { figure: number; previous: number; reserved: number; threshold: number; opening: boolean; /** The account has had an opening in an earlier week. */ hadOpening: boolean }
/**
 * What saving will record: the same arithmetic as record_figure(), so the person sees it first. The database works it out again, and its answer is the one kept.
 *   system balance  = bank figure - payments not ticked as processed
 *   implied deposit = new system balance - previous system balance
 */
export function previewFigure(i: FigureInput, unticked: number[]) {
  const outstanding = unticked.reduce((s, a) => s + toCents(a), 0) / 100;
  const balance = (toCents(i.figure) - toCents(outstanding)) / 100;
  const implied = i.opening ? null : (toCents(balance) - toCents(i.previous)) / 100;
  return {
    outstanding, balance, implied,
    negativeDeposit: implied !== null && implied < 0, largeDeposit: implied !== null && implied > i.threshold, openingChanged: i.opening && i.hadOpening && toCents(balance) !== toCents(i.previous),
    shortfall: Math.max((toCents(i.reserved) - toCents(balance)) / 100, 0),
  };
}
