"use server";
import { isNumberKind, revealNumber, type NumberKind } from "@/lib/account-numbers";
import { withUser } from "@/lib/db";
import { currentUserId } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type RevealResult = { number: string } | { error: string };
const NOT_ALLOWED = "This account number cannot be shown to you.";

/** The eye button: one full number, asked for by the signed-in person and checked and audited by the database under their own identity. */
export async function revealAccountNumber(kind: NumberKind, id: string): Promise<RevealResult> {
  if (!isNumberKind(kind) || typeof id !== "string" || !UUID.test(id)) return { error: NOT_ALLOWED };
  const uid = await currentUserId();
  try {
    const n = await withUser(uid, (tx) => revealNumber(tx, kind, id));
    return n ? { number: n } : { error: NOT_ALLOWED };
  } catch {
    return { error: "The account number could not be shown. Please try again." };
  }
}
