import { withUser } from "./db";
import { translate } from "./errors";

// Thin wrapper over the database function that changes a bank balance. The rules (permission, shortfall, history)
// are decided in the database.
const run = async <T>(userId: string, sql: string, params: unknown[]): Promise<T[]> => { try { return await withUser(userId, (tx) => tx.q<T>(sql, params)); } catch (e) { return translate(e); } };

/** An Accountant enters the overall amount now in the bank. A figure below the reserved funds is accepted and becomes a shortfall. */
export const updateBankBalance = (u: string, p: { accountId: string; balance: number }) => run(u, "SELECT update_bank_balance($1,$2::numeric)", [p.accountId, p.balance]);

/** The Accountant notes how an authenticated payment was sent. Both details are optional. */
export const recordExecution = (u: string, p: { requestId: string; chequeNo: string; bankReference: string }) => run(u, "SELECT record_execution($1,$2,$3)", [p.requestId, p.chequeNo, p.bankReference]);
