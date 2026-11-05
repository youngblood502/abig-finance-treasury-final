export class WorkflowError extends Error { constructor(public status: number, message: string) { super(message); } }

// Rules are written in the database; their messages are ours and safe to show. Built-in database errors are masked.
export function translate(e: unknown): never {
  const err = e as { code?: string; message?: string; constraint?: string };
  if (err && typeof err.code === "string" && typeof err.message === "string") {
    if (err.constraint === "payment_requests_invoice_once") throw new WorkflowError(409, "That supplier invoice is already in another active request.");
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
