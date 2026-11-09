import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

const scrypt = (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) =>
  new Promise<Buffer>((res, rej) => scryptCb(pw, salt, len, opts, (e, k) => (e ? rej(e) : res(k))));
const N = 32768, R = 8, P = 1, MAXMEM = 128 * 1024 * 1024;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");

// ---------- Passwords (scrypt) ----------
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, 64, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${h.toString("base64")}`;
}
export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  const parts = (stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") { await hashPassword(pw); return false; } // spend the same time either way
  const [, n, r, p, salt, hash] = parts; const expected = Buffer.from(hash, "base64");
  const got = await scrypt(pw, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return got.length === expected.length && timingSafeEqual(got, expected);
}
const COMMON = ["password", "123456789012", "qwertyuiopas", "letmein12345", "abigfinance", "administrator"];
/** Length matters more than character rules (NIST 800-63B). Returns a message, or null when the password is acceptable. */
export function passwordProblem(pw: string, email = ""): string | null {
  if (pw.length < 12) return "Use at least 12 characters. A few random words make a good password.";
  if (pw.length > 200) return "That password is too long.";
  if (new Set(pw).size < 5) return "That password has too few different characters.";
  const local = email.split("@")[0].toLowerCase();
  if ((local.length >= 4 && pw.toLowerCase().includes(local)) || COMMON.some((c) => pw.toLowerCase().includes(c))) return "That password is too easy to guess.";
  return null;
}
export function temporaryPassword(): string { // 4 groups of 4, no look-alike characters
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const b = randomBytes(16);
  return Array.from({ length: 4 }, (_, g) => Array.from({ length: 4 }, (_, i) => alphabet[b[g * 4 + i] % alphabet.length]).join("")).join("-");
}

// ---------- Time-based one-time codes (RFC 6238) ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const base32 = (buf: Buffer) => { let bits = "", out = ""; for (const b of buf) bits += b.toString(2).padStart(8, "0"); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)]; return out; };
export const unbase32 = (s: string) => { let bits = ""; for (const c of s.replace(/=+$/, "").toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, "0"); const out: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
export const newTotpSecret = () => base32(randomBytes(20));
export function totpAt(secret: string, step: number): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", unbase32(secret)).update(msg).digest(); const o = h[h.length - 1] & 15;
  return String(((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1_000_000).padStart(6, "0");
}
/** Returns the time step that matched (so it can be remembered and not reused), or null. Allows one step either side for clock drift. */
export function verifyTotp(secret: string, code: string, lastStep: number | null, nowMs = Date.now()): number | null {
  const clean = code.replace(/\s/g, ""); if (!/^\d{6}$/.test(clean)) return null;
  const now = Math.floor(nowMs / 30000);
  for (const d of [0, -1, 1]) {
    const step = now + d, want = totpAt(secret, step);
    if (timingSafeEqual(Buffer.from(want), Buffer.from(clean)) && (lastStep === null || step > lastStep)) return step;
  }
  return null;
}

// ---------- Encrypting the one-time-code secret at rest (AES-256-GCM) ----------
function key(): Buffer {
  const k = process.env.APP_ENCRYPTION_KEY;
  if (k) { const b = Buffer.from(k, "base64"); if (b.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64 encoded"); return b; }
  if (process.env.NODE_ENV === "production") throw new Error("APP_ENCRYPTION_KEY is required in production");
  return createHash("sha256").update("abig-development-key").digest();
}
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key(), iv), ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "v1:" + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
export function decryptSecret(stored: string): string {
  const raw = Buffer.from(stored.replace(/^v1:/, ""), "base64"), d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28)); return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

// ---------- Finding duplicates among encrypted values ----------
/** A keyed hash, so equal values can be matched without being stored readably. Scoped, so the same value gives a different hash in each scope. */
export function blindIndex(value: string, scope: string): string {
  return createHmac("sha256", createHash("sha256").update("abig-blind-index:").update(key()).digest()).update(scope + "\0" + value).digest("hex");
}
