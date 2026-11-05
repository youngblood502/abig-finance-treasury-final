import { withUser } from "./db";
import { translate } from "./errors";

// Thin wrapper over the database function that changes a bank balance. The rules (permission, reserved funds floor, history)
// are decided in the database.
const run = async <T>(userId: string, sql: string, params: unknown[]): Promise<T[]> => { try { return await withUser(userId, (tx) => tx.q<T>(sql, params)); } catch (e) { return translate(e); } };

/** An Accountant enters the overall amount now in the bank. The database rejects anything below the reserved funds. */
export const updateBankBalance = (u: string, p: { accountId: string; balance: number }) => run(u, "SELECT update_bank_balance($1,$2::numeric)", [p.accountId, p.balance]);
