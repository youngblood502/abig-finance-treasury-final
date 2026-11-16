import { decryptSecret, encryptSecret } from "./crypto";
import type { Tx } from "./db";
import { WorkflowError } from "./errors";

// A full bank account number is encrypted here, before it reaches the database, with APP_ENCRYPTION_KEY. The database keeps the encrypted text and,
// separately, the last four digits for lists. The application role cannot read the encrypted column: a full number comes back only from one of the
// reveal functions, which check who is asking and write an audit event. Pages never load it; the eye button asks for it, one number at a time.

/** What a page may offer for one number. Decided by the database: MASKED (not for this person), NOT_RECORDED (only the last four digits exist), RECORDED. */
export type NumberState = "MASKED" | "NOT_RECORDED" | "RECORDED";
/** account: a company's own bank account. supplier: a supplier bank detail version. person: a person's bank payment detail version. one_time: a one-time payee entered on a request. */
export type NumberKind = "account" | "supplier" | "person" | "one_time";

export const normalizeAccountNumber = (raw: string) => raw.replace(/[\s-]/g, "");

/** Checks a full account number as typed, then returns it encrypted with its last four digits. */
export function protectAccountNumber(raw: string) {
  const n = normalizeAccountNumber(raw);
  if (!/^[0-9]{6,30}$/.test(n)) throw new WorkflowError(422, "Enter the full account number: 6 to 30 digits. Spaces and dashes are ignored.");
  return { enc: encryptSecret(n), last4: n.slice(-4) };
}

const REVEAL: Record<NumberKind, string> = {
  account: "SELECT reveal_account_number($1) AS v",
  supplier: "SELECT reveal_supplier_account($1) AS v",
  person: "SELECT reveal_person_account($1) AS v",
  one_time: "SELECT reveal_one_time_account($1) AS v",
};
export const isNumberKind = (k: unknown): k is NumberKind => k === "account" || k === "supplier" || k === "person" || k === "one_time";

/** The full number for this person, or null when they may not see it or it was never recorded. The database audits every number it hands out. */
export async function revealNumber(tx: Tx, kind: NumberKind, id: string): Promise<string | null> {
  const enc = (await tx.q<{ v: string | null }>(REVEAL[kind], [id]))[0]?.v;
  return enc ? decryptSecret(enc) : null;
}
