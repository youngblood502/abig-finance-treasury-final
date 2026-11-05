import { blindIndex, decryptSecret, encryptSecret } from "./crypto";
import { WorkflowError } from "./errors";

// A person's ID number is encrypted here, before it reaches the database, with APP_ENCRYPTION_KEY. The database keeps the encrypted text,
// the last four characters for lists, and a keyed hash that finds duplicates within a company.
export const normalizeIdNumber = (raw: string) => raw.toUpperCase().replace(/[\s-]/g, "");

export function protectIdNumber(raw: string, companyId: string) {
  const id = normalizeIdNumber(raw);
  if (id.length < 4 || id.length > 40) throw new WorkflowError(422, "Enter the full ID number.");
  return { enc: encryptSecret(id), last4: id.slice(-4), hash: blindIndex(id, companyId) };
}
export const revealIdNumber = (enc: string) => decryptSecret(enc);
export const maskId = (last4: string) => `••••${last4}`;

export const PERSON_DETAIL_FOR_METHOD: Record<string, string | undefined> = { TRANSFER: "BANK", TELEBIRR: "TELEBIRR" };
