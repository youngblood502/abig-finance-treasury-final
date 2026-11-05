import { createHash, randomBytes } from "node:crypto";
import type { Tx } from "./db";
import { putObject } from "./storage";
import { WorkflowError } from "./errors";

const MAX = 10 * 1024 * 1024;
const MAGIC: Record<string, number[]> = { "application/pdf": [0x25, 0x50, 0x44, 0x46], "image/png": [0x89, 0x50, 0x4e, 0x47], "image/jpeg": [0xff, 0xd8, 0xff] };

/** Validates the file's size, declared type and real content, then stores it under a random key. The database decides who may attach (creator, draft or returned). */
export async function saveAttachment(tx: Tx, userId: string, requestId: string, file: File, kind: "INVOICE" | "SUPPORTING", supersedes?: string | null) {
  if (file.size === 0 || file.size > MAX) throw new WorkflowError(400, "A file must be between 1 byte and 10 MB.");
  const magic = MAGIC[file.type]; const data = Buffer.from(await file.arrayBuffer());
  if (!magic || !magic.every((b, i) => data[i] === b)) throw new WorkflowError(400, "Only PDF, PNG or JPEG files are accepted.");
  const key = randomBytes(32).toString("hex");
  const rows = await tx.q<{ id: string }>(
    `INSERT INTO attachments (request_id, kind, object_key, filename, mime_type, size_bytes, sha256, uploaded_by, supersedes_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [requestId, kind, key, file.name.slice(0, 200), file.type, file.size, createHash("sha256").update(data).digest("hex"), userId, supersedes || null]);
  await putObject(key, data); // a storage failure rolls the row back
  return rows[0].id;
}
