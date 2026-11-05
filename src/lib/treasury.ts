import { withUser } from "./db";
import { translate } from "./errors";

// Thin wrappers over the database functions that change balances and reconciliations. The rules (permissions, the formula, weeks, locks)
// are decided in the database.
const run = async <T>(userId: string, sql: string, params: unknown[]): Promise<T[]> => { try { return await withUser(userId, (tx) => tx.q<T>(sql, params)); } catch (e) { return translate(e); } };

/**
 * The Accountant enters what the bank says, as the week's opening or as a balance check, with the outstanding payments the bank has processed.
 * `shown` is the list the screen offered: the database refuses the entry if that list has changed. A figure that leaves the balance below the
 * reserved funds is accepted and becomes a shortfall.
 */
export const recordFigure = (u: string, p: { accountId: string; figure: number; processed: string[]; shown: string[]; opening: boolean }) =>
  run(u, `SELECT ${p.opening ? "record_opening_balance" : "record_balance_check"}($1,$2::numeric,$3::uuid[],$4::uuid[])`, [p.accountId, p.figure, p.processed, p.shown]);
export const undoProcessedTick = (u: string, p: { requestId: string; reason: string }) => run(u, "SELECT undo_processed_tick($1,$2)", [p.requestId, p.reason]);

export const startReconciliation = (u: string, p: { accountId: string; week: string; closing: number; deposits: number }) => run<{ id: string }>(u, "SELECT start_reconciliation($1,$2::date,$3::numeric,$4::numeric) AS id", [p.accountId, p.week, p.closing, p.deposits]);
export const matchPayment = (u: string, p: { week: string; requestId: string; date: string; reference: string }) => run(u, "SELECT match_payment($1,$2,$3::date,$4)", [p.week, p.requestId, p.date, p.reference]);
export const addReconciliationLine = (u: string, p: { week: string; kind: string; amount: number; reason: string; date: string | null; reference: string; known: boolean }) =>
  run(u, "SELECT add_reconciliation_line($1,$2,$3::numeric,$4,$5::date,$6,$7)", [p.week, p.kind, p.amount, p.reason, p.date, p.reference, p.known]);
export const removeReconciliationLine = (u: string, p: { line: string; reason: string }) => run(u, "SELECT remove_reconciliation_line($1,$2)", [p.line, p.reason]);
export const submitReconciliation = (u: string, p: { week: string; revision: number; reasons: Record<string, string>; explanation: string }) => run(u, "SELECT submit_reconciliation($1,$2,$3::jsonb,$4)", [p.week, p.revision, JSON.stringify(p.reasons), p.explanation]);
export const returnReconciliation = (u: string, p: { week: string; reason: string }) => run(u, "SELECT return_reconciliation($1,$2)", [p.week, p.reason]);
export const lockWeek = (u: string, p: { week: string; revision: number }) => run(u, "SELECT lock_week($1,$2)", [p.week, p.revision]);

/** The Accountant notes how an authenticated payment was sent. Both details are optional. */
export const recordExecution = (u: string, p: { requestId: string; chequeNo: string; bankReference: string }) => run(u, "SELECT record_execution($1,$2,$3)", [p.requestId, p.chequeNo, p.bankReference]);
