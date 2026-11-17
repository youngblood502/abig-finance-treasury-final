export class WorkflowError extends Error { constructor(public status: number, message: string) { super(message); } }

// Rules are written in the database; their messages are ours and safe to show. Built-in database errors are masked.
export function translate(e: unknown): never {
  const err = e as { code?: string; message?: string; constraint?: string };
  if (err && typeof err.code === "string" && typeof err.message === "string") {
    if (err.constraint === "payment_requests_invoice_once") throw new WorkflowError(409, "That supplier invoice is already in another active request.");
    if (err.constraint === "payment_requests_person_invoice_once") throw new WorkflowError(409, "That reference is already in another active request for this person.");
    if (err.constraint === "person_payees_phone_key") throw new WorkflowError(409, "Someone in this company already has that phone number.");
    if (err.constraint === "person_payees_id_hash_key") throw new WorkflowError(409, "Someone in this company already has that ID number.");
    if (err.constraint === "company_bank_accounts_wallet_phone") throw new WorkflowError(409, "A Telebirr wallet with that phone number already exists.");
    if (err.constraint === "payment_requests_payee_chk") throw new WorkflowError(422, "A request pays exactly one supplier, one person or one one-time payee, and cannot be switched to another kind of payee.");
    if (err.constraint === "payment_requests_one_time_payee_once") throw new WorkflowError(409, "Those payee details already belong to another request.");
    if (err.constraint === "suppliers_phone_check" || err.constraint === "one_time_payees_phone_chk") throw new WorkflowError(422, "Enter a valid phone number, or leave it empty.");
    if (err.constraint === "reconciliation_lines_match_once") throw new WorkflowError(409, "That payment is already matched.");
    if (err.constraint === "payment_transactions_account_id_reference_key") throw new WorkflowError(409, "That bank reference was already recorded on this account.");
    if (/row-level security|permission denied/.test(err.message)) throw new WorkflowError(403, "You are not allowed to do that.");
    const status = ({ "40001": 409, "42501": 403, P0002: 404, "23514": 422, "23505": 409, "22023": 422, P0001: 422 } as Record<string, number>)[err.code];
    if (status) throw new WorkflowError(status, err.message.replace(/^duplicate key value violates unique constraint .*$/s, "That already exists."));
    if (err.code === "23502" || err.code === "22P02" || err.code === "22007") throw new WorkflowError(400, "Please check the values you entered.");
    throw new WorkflowError(500, "Something went wrong.");
  }
  throw e;
}
export const message = (e: unknown) => (e instanceof WorkflowError ? e.message : "Something went wrong.");
