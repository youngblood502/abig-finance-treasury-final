import { Pool } from "pg";
import { WorkflowError } from "./errors";
import { decryptSecret, encryptSecret, hashPassword, newTotpSecret, passwordProblem, randomToken, sha256, verifyPassword, verifyTotp } from "./crypto";

// Credentials live behind a separate database role (abig_auth), so the main app role can never read password hashes or one-time-code secrets.
const g = globalThis as unknown as { authPool?: Pool };
const pool = () => (g.authPool ??= new Pool({ connectionString: process.env.AUTH_DATABASE_URL, max: 5 }));

export const SESSION_HOURS = 8, IDLE_MINUTES = 30, MAX_FAILS = 5, LOCK_MINUTES = 15;
const GENERIC = "The email, password or code is not right.";

async function event(userId: string | null, email: string | null, ev: string, ip?: string, detail?: string) {
  await pool().query("INSERT INTO auth_events (user_id, email, event, ip, detail) VALUES ($1,$2,$3,$4,$5)", [userId, email, ev, ip ?? null, detail ?? null]);
}

export type LoginResult = { ok: true; token: string } | { ok: false; error: string };
export async function login(p: { email: string; password: string; code?: string; ip?: string; userAgent?: string }): Promise<LoginResult> {
  const email = p.email.trim().toLowerCase();
  const u = (await pool().query("SELECT id, password_hash, is_active, totp_enabled, totp_secret_enc, totp_last_step, failed_logins, locked_until FROM users WHERE email = $1", [email])).rows[0];
  if (!u || !u.is_active) { await verifyPassword(p.password, null); await event(u?.id ?? null, email, "LOGIN_FAILED", p.ip, u ? "inactive" : "unknown"); return { ok: false, error: GENERIC }; }
  if (u.locked_until && new Date(u.locked_until) > new Date()) { await event(u.id, email, "LOGIN_LOCKED", p.ip); return { ok: false, error: "Too many attempts. Try again in a few minutes." }; }
  const fail = async (ev: string) => {
    const r = await pool().query("UPDATE users SET failed_logins = failed_logins + 1, locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + ($3 || ' minutes')::interval END WHERE id = $1 RETURNING failed_logins", [u.id, MAX_FAILS, String(LOCK_MINUTES)]);
    await event(u.id, email, ev, p.ip, `attempt ${r.rows[0].failed_logins}`); return { ok: false as const, error: GENERIC };
  };
  if (!(await verifyPassword(p.password, u.password_hash))) return fail("LOGIN_FAILED");
  let step: number | null = null;
  if (u.totp_enabled) {
    step = verifyTotp(decryptSecret(u.totp_secret_enc), p.code ?? "", u.totp_last_step === null ? null : Number(u.totp_last_step));
    if (step === null) return fail("MFA_FAILED");
  }
  const token = randomToken();
  await pool().query("UPDATE users SET failed_logins = 0, locked_until = NULL, totp_last_step = COALESCE($2, totp_last_step) WHERE id = $1", [u.id, step]);
  await pool().query("INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES ($1,$2, now() + ($3 || ' hours')::interval, $4, $5)", [sha256(token), u.id, String(SESSION_HOURS), p.ip ?? null, p.userAgent?.slice(0, 200) ?? null]);
  await event(u.id, email, "LOGIN_OK", p.ip);
  return { ok: true, token };
}

export interface SessionUser { id: string; mustChange: boolean; totpEnabled: boolean }
export async function validateSession(token: string): Promise<SessionUser | null> {
  const r = await pool().query(
    `SELECT u.id, u.must_change_password, u.totp_enabled, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND u.is_active AND s.expires_at > now() AND s.last_seen_at > now() - ($2 || ' minutes')::interval`, [sha256(token), String(IDLE_MINUTES)]);
  if (!r.rows[0]) return null;
  if (Date.now() - new Date(r.rows[0].last_seen_at).getTime() > 60_000) await pool().query("UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1", [sha256(token)]);
  return { id: r.rows[0].id, mustChange: r.rows[0].must_change_password, totpEnabled: r.rows[0].totp_enabled };
}
export async function endSession(token: string, userId?: string) {
  await pool().query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]); if (userId) await event(userId, null, "LOGOUT");
}
export async function revokeSessions(userId: string, exceptToken?: string) {
  await pool().query("DELETE FROM sessions WHERE user_id = $1 AND ($2::text IS NULL OR token_hash <> $2)", [userId, exceptToken ? sha256(exceptToken) : null]);
  await event(userId, null, "SESSIONS_REVOKED");
}

export async function changePassword(userId: string, current: string, next: string, keepToken?: string): Promise<string | null> {
  const u = (await pool().query("SELECT email, password_hash FROM users WHERE id = $1", [userId])).rows[0];
  if (!u || !(await verifyPassword(current, u.password_hash))) return "The current password is not right.";
  const problem = passwordProblem(next, u.email); if (problem) return problem;
  if (await verifyPassword(next, u.password_hash)) return "Choose a password you have not used on this account.";
  await pool().query("UPDATE users SET password_hash = $2, must_change_password = false, password_changed_at = now(), failed_logins = 0, locked_until = NULL WHERE id = $1", [userId, await hashPassword(next)]);
  await revokeSessions(userId, keepToken); await event(userId, u.email, "PASSWORD_CHANGED");
  return null;
}
/**
 * The functions below change somebody else's credentials. They re-check, here and not only in the caller, that the actor is an
 * active system administrator, so no route or action can reach them without that role.
 */
async function assertAdmin(actorId: string) {
  if (!(await pool().query("SELECT 1 FROM users WHERE id = $1 AND is_system_admin AND is_active", [actorId])).rowCount) throw new WorkflowError(403, "Only a system administrator can do that.");
}
/** Administrator action: sets a temporary password that must be changed at the next sign-in, and signs the person out everywhere. */
export async function adminSetPassword(actorId: string, userId: string, temp: string) {
  await assertAdmin(actorId);
  await pool().query("UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL WHERE id = $1", [userId, await hashPassword(temp)]);
  await revokeSessions(userId); await event(userId, null, "PASSWORD_RESET");
}
export async function adminUnlock(actorId: string, userId: string) { await assertAdmin(actorId); await pool().query("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1", [userId]); }

// ---------- One-time codes ----------
export async function startTotp(userId: string): Promise<void> {
  await pool().query("UPDATE users SET totp_secret_enc = $2, totp_enabled = false, totp_last_step = NULL WHERE id = $1 AND NOT totp_enabled", [userId, encryptSecret(newTotpSecret())]);
}
export async function pendingTotp(userId: string): Promise<{ secret: string; email: string } | null> {
  const r = (await pool().query("SELECT email, totp_secret_enc FROM users WHERE id = $1 AND NOT totp_enabled AND totp_secret_enc IS NOT NULL", [userId])).rows[0];
  return r ? { secret: decryptSecret(r.totp_secret_enc), email: r.email } : null;
}
export async function enableTotp(userId: string, code: string): Promise<boolean> {
  const p = await pendingTotp(userId); const step = p ? verifyTotp(p.secret, code, null) : null;
  if (step === null) return false;
  await pool().query("UPDATE users SET totp_enabled = true, totp_last_step = $2 WHERE id = $1", [userId, step]); await event(userId, p!.email, "MFA_ENABLED");
  return true;
}
export async function disableTotp(userId: string, password: string, code: string): Promise<boolean> {
  const u = (await pool().query("SELECT password_hash, totp_secret_enc, totp_last_step, totp_enabled FROM users WHERE id = $1", [userId])).rows[0];
  if (!u?.totp_enabled || !(await verifyPassword(password, u.password_hash)) || verifyTotp(decryptSecret(u.totp_secret_enc), code, u.totp_last_step === null ? null : Number(u.totp_last_step)) === null) return false;
  await pool().query("UPDATE users SET totp_enabled = false, totp_secret_enc = NULL, totp_last_step = NULL WHERE id = $1", [userId]); await event(userId, null, "MFA_DISABLED");
  return true;
}
export async function adminResetTotp(actorId: string, userId: string) { await assertAdmin(actorId); await pool().query("UPDATE users SET totp_enabled = false, totp_secret_enc = NULL, totp_last_step = NULL WHERE id = $1", [userId]); await event(userId, null, "MFA_DISABLED", undefined, "reset by administrator"); }
