import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Private object storage. Local-disk driver for development; swap for S3-compatible storage (private bucket) in production.
// Files are never served by a public URL: every download goes through an authorized route.
const ROOT = process.env.STORAGE_DIR ?? "./.storage";
const KEY = /^[0-9a-f]{64}$/;

export async function putObject(key: string, data: Buffer) {
  if (!KEY.test(key)) throw new Error("Invalid object key");
  await mkdir(ROOT, { recursive: true });
  await writeFile(join(ROOT, key), data, { flag: "wx" });
}
export async function getObject(key: string): Promise<Buffer> {
  if (!KEY.test(key)) throw new Error("Invalid object key");
  return readFile(join(ROOT, key));
}
