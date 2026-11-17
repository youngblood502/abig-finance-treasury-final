import { accountInCompany } from "./company";
import type { Tx } from "./db";
import { addisDate } from "./format";
import type { AccessLevel } from "./treasury-screens";

// What the reconciliation screens read. The figures and rules live in the database: reconciliation_summary() gives statement figures only at FULL,
// reconciliation_payments() and row-level security decide which payments and lines each person gets, and every step is checked again when it runs.
// The helpers below only decide what to offer on screen.

export interface ReconSummary {
  week_id: string; account_id: string; account_label: string; week_start: string; status: string; revision: number; closing: string | null; deposits: string | null; deposit_explanation: string | null; return_reason: string | null;
  prepared_by: string | null; prepared_by_name: string | null; prepared_at: Date | null; locked_by_name: string | null; locked_at: Date | null; system_balance: string | null; unmatched_total: string | null; implied_total: string | null;
  adjust_total: string | null; known_total: string | null; balance_difference: string | null; deposit_difference: string | null; can_prepare: boolean; can_review: boolean;
}
export interface ReconPayment {
  id: string; request_no: string; company: string; payee: string | null; method: string; amount: string; cheque_no: string | null; bank_reference: string | null; authenticated_at: Date; age_days: number; overdue: boolean;
  line_id: string | null; statement_date: string | null; reference: string | null; carry_reason: string | null; carried_from: string | null; carried_reason: string | null;
}
export interface ReconLine { id: string; kind: string; statement_date: string | null; reference: string | null; amount: string; already_in_balance: boolean; reason: string }

/** One week's reconciliation. Null when the person cannot see the week at all. */
export const reconciliationWeek = async (tx: Tx, week: string, userId: string) => {
  const summary = (await tx.q<ReconSummary>(
    `SELECT week_id, account_id, account_label, week_start::text AS week_start, status, revision, closing, deposits, deposit_explanation, return_reason, prepared_by, prepared_by_name, prepared_at, locked_by_name, locked_at,
            system_balance, unmatched_total, implied_total, adjust_total, known_total, balance_difference, deposit_difference, can_prepare, can_review
       FROM reconciliation_summary($1)`, [week]))[0];
  if (!summary) return null;
  const payments = await tx.q<Omit<ReconPayment, "carried_from" | "carried_reason">>(
    `SELECT id, request_no, company, payee, method, amount, cheque_no, bank_reference, authenticated_at, age_days, overdue, line_id, statement_date::text AS statement_date, reference, carry_reason FROM reconciliation_payments($1)`, [week]);
  // The latest earlier week that carried each payment. Row-level security keeps these reasons to the payment's company and the account's owner.
  const carries = await tx.q<{ request_id: string; reason: string; week_start: string }>(
    `SELECT DISTINCT ON (l.request_id) l.request_id, l.reason, t.week_start::text AS week_start FROM reconciliation_lines l JOIN treasury_weeks t ON t.id = l.week_id
      WHERE l.request_id = ANY($1::uuid[]) AND l.kind = 'CARRY' AND l.voided_at IS NULL AND t.week_start < $2::date ORDER BY l.request_id, t.week_start DESC`, [payments.map((p) => p.id), summary.week_start]);
  return {
    summary,
    access: (await tx.q<{ level: AccessLevel }>("SELECT app_account_access($1) AS level", [summary.account_id]))[0].level,
    payments: payments.map((p): ReconPayment => { const c = carries.find((x) => x.request_id === p.id); return { ...p, carried_from: c?.week_start ?? null, carried_reason: c?.reason ?? null }; }),
    lines: await tx.q<ReconLine>("SELECT id, kind::text AS kind, statement_date::text AS statement_date, reference, amount, already_in_balance, reason FROM reconciliation_lines WHERE week_id = $1 AND kind IN ('BANK_CHARGE','OTHER') AND voided_at IS NULL ORDER BY created_at", [week]),
    // lock_week() refuses whoever started the week or added a line. started_by is not readable, but the first RECONCILIATION_STARTED entry names the same person, and a reviewer may read the audit trail.
    workedOn: (await tx.q<{ yes: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM reconciliation_lines WHERE week_id = $1 AND created_by = $2)
              OR COALESCE((SELECT a.actor_id = $2 FROM audit_events a WHERE a.entity_id = $1 AND a.action = 'RECONCILIATION_STARTED' ORDER BY a.occurred_at LIMIT 1), false) AS yes`, [week, userId]))[0].yes,
  };
};

export type ReconStage = "open" | "reconciling" | "preparing" | "returned" | "review" | "locked";
export const STAGE_LABEL: Record<ReconStage, string> = { open: "Not started", reconciling: "Being reconciled", preparing: "Being prepared", returned: "Returned to the Accountant", review: "With the Finance Manager", locked: "Locked" };

type StageFacts = Pick<ReconSummary, "status" | "prepared_at" | "return_reason">;
/** Where a week stands. Below FULL the database gives only the status, so `reconciling` is as much as those viewers learn. */
export function reconStage(s: StageFacts, access: AccessLevel): ReconStage {
  if (s.status === "LOCKED") return "locked";
  if (s.status === "OPEN") return "open";
  if (access !== "FULL") return "reconciling";
  return s.prepared_at ? "review" : s.return_reason ? "returned" : "preparing";
}

/**
 * What to offer this person. The Accountant prepares; the Finance Manager reviews, returns or locks; nobody reviews their own work.
 * `workedOn`: this person started the week or added a line to it. The database enforces each of these again.
 */
export function reconOffers(s: Pick<ReconSummary, StageKeys | "can_prepare" | "can_review" | "prepared_by">, access: AccessLevel, userId: string, workedOn: boolean) {
  const stage = reconStage(s, access);
  const prepare = (stage === "preparing" || stage === "returned") && s.can_prepare;
  const review = stage === "review" && s.can_review && s.prepared_by !== userId;
  return { stage, prepare, review, lock: review && !workedOn };
}
type StageKeys = keyof StageFacts;

/** A payment that an earlier week left outstanding. */
export const carriedIn = (authenticatedAt: Date, weekStart: string) => addisDate(authenticatedAt) < weekStart;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Where saving the statement figures goes back to. The value comes from a form, so it only ever chooses a week's page by id; anything else falls back to the account. */
export const statementReturnPath = (account: string, week: string) => (UUID.test(week) ? `/treasury/week/${week}` : `/treasury/${account}`);

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** Monday of a day's week. */
export const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
/** A match's statement date must fall on or before the week's Sunday, so an older week does not offer today. */
export const defaultStatementDate = (today: string, weekStart: string) => { const sunday = addDays(weekStart, 6); return today > sunday ? sunday : today < weekStart ? weekStart : today; };

const total = (list: { amount: string }[]) => list.reduce((s, p) => s + Math.round(Number(p.amount) * 100), 0) / 100;
/** Splits a week's payments into those found on the statement and those still outstanding. */
export function paymentColumns(payments: ReconPayment[]) {
  const matched = payments.filter((p) => p.line_id), outstanding = payments.filter((p) => !p.line_id);
  return { matched, outstanding, matchedTotal: total(matched), outstandingTotal: total(outstanding) };
}
export const isZero = (v: string | null) => Number(v ?? 0) === 0;

export interface WeekOverviewRow {
  account_id: string; account_label: string; account_kind: string; current_balance: string; owner: string | null; access: AccessLevel; shared: boolean; week_id: string | null; status: string;
  opening: string | null; payment_count: number; payments: string; implied: string | null; truncated: boolean; prepared_at: Date | null; return_reason: string | null; balance_difference: string | null;
}
/**
 * Each account's week. account_balance_history() is the only way to read the log, and it decides what each person gets: below TICK that is their own company's payments and no implied deposits.
 * It returns at most 100 entries, so `truncated` says when a week may reach further back than that. At FULL the implied deposits come from the reconciliation, which has no such limit.
 */
export const weekOverview = (tx: Tx, company: string | null, week: string) => tx.q<WeekOverviewRow>(
  `SELECT a.id AS account_id, a.account_label, a.account_kind::text AS account_kind, a.current_balance, o.legal_name AS owner, app_account_access(a.id) AS access,
          (SELECT count(*) FROM company_bank_account_access g WHERE g.account_id = a.id AND g.revoked_at IS NULL) > 1 AS shared,
          w.id AS week_id, COALESCE(w.status::text, 'OPEN') AS status, h.opening, h.payment_count, h.payments, COALESCE(s.implied_total, h.implied) AS implied, h.truncated, s.prepared_at, s.return_reason, s.balance_difference
     FROM company_bank_accounts a LEFT JOIN companies o ON o.id = account_owner_company(a.id) LEFT JOIN treasury_weeks w ON w.account_id = a.id AND w.week_start = $2::date
     LEFT JOIN LATERAL reconciliation_summary(w.id) s ON true
     CROSS JOIN LATERAL (
       SELECT max(l.new_balance) FILTER (WHERE l.in_week AND l.entry_kind = 'OPENING') AS opening,
              (count(*) FILTER (WHERE l.in_week AND l.entry_kind = 'PAYMENT'))::int AS payment_count,
              COALESCE(sum(l.previous_balance - l.new_balance) FILTER (WHERE l.in_week AND l.entry_kind IN ('PAYMENT','CANCEL_RELEASE')), 0) AS payments,
              sum(l.implied_deposit) FILTER (WHERE l.in_week AND l.entry_kind = 'CHECK') AS implied,
              count(*) = 100 AND min(l.day) >= $2::date AS truncated
         FROM (SELECT b.*, (b.updated_at AT TIME ZONE 'Africa/Addis_Ababa')::date AS day, (b.updated_at AT TIME ZONE 'Africa/Addis_Ababa')::date BETWEEN $2::date AND $2::date + 6 AS in_week
                 FROM account_balance_history(a.id, 100) b) l) h
    WHERE a.is_active AND ${accountInCompany("a.id", "$1")} ORDER BY o.legal_name, a.account_label`, [company, week]);

/** Which of a row's figures may be incomplete because the log was cut off. A missing opening then means unknown, not unrecorded. */
export const partialFigures = (r: Pick<WeekOverviewRow, "truncated" | "opening" | "access" | "week_id">) => ({
  payments: r.truncated, opening: r.truncated && r.opening === null, implied: r.truncated && !(r.access === "FULL" && r.week_id !== null),
});

/** The weeks that can be chosen, newest first. */
export const overviewWeeks = async (tx: Tx, company: string | null) =>
  (await tx.q<{ week_start: string }>(`SELECT DISTINCT t.week_start::text AS week_start FROM treasury_weeks t WHERE ${accountInCompany("t.account_id", "$1")} ORDER BY 1 DESC LIMIT 12`, [company])).map((w) => w.week_start);

/** The overview, one group for each company that owns accounts. */
export function byOwner(rows: WeekOverviewRow[]) {
  const groups = new Map<string, WeekOverviewRow[]>();
  for (const r of rows) { const k = r.owner ?? "No owner"; groups.set(k, [...(groups.get(k) ?? []), r]); }
  return [...groups.entries()].map(([owner, accounts]) => ({ owner, accounts }));
}
