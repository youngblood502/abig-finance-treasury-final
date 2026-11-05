import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Pool } from "pg";
import { validateSession } from "./auth";
import { withUser } from "./db";

export const COOKIE = process.env.NODE_ENV === "production" ? "__Host-abig_session" : "abig_session";
const UUID = /^[0-9a-f-]{36}$/i;
const FINANCE_ROLES = ["ACCOUNTANT", "FINANCE_MANAGER", "OWNER"];
export const mfaRequired = () => (process.env.REQUIRE_MFA ?? (process.env.NODE_ENV === "production" ? "true" : "false")) === "true";

export interface SessionInfo { id: string; mustChange: boolean; mfaMissing: boolean }
/** The signed-in person, or null. In development only, the "Acting as" cookie or DEV_USER_ID stands in for a session. */
export async function getSession(): Promise<SessionInfo | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  const s = token ? await validateSession(token) : null;
  if (s) {
    let finance = false;
    if (mfaRequired() && !s.totpEnabled) {
      finance = await withUser(s.id, async (tx) => (await tx.q("SELECT 1 FROM users WHERE id = app_user_id() AND is_system_admin UNION ALL SELECT 1 FROM company_memberships m JOIN membership_roles mr ON mr.membership_id = m.id JOIN roles r ON r.id = mr.role_id WHERE m.user_id = app_user_id() AND m.revoked_at IS NULL AND r.code = ANY($1::text[]) LIMIT 1", [FINANCE_ROLES])).length > 0);
    }
    return { id: s.id, mustChange: s.mustChange, mfaMissing: finance };
  }
  if (process.env.NODE_ENV !== "production") {
    const c = jar.get("abig_dev_user")?.value;
    if (c && UUID.test(c)) return { id: c, mustChange: false, mfaMissing: false };
    if (process.env.DEV_USER_ID && process.env.DEV_AUTO !== "off") return { id: process.env.DEV_USER_ID, mustChange: false, mfaMissing: false };
  }
  return null;
}

/** For pages and actions: signs the person in or sends them to the right place first. */
export async function currentUserId(opts: { allowRestricted?: boolean } = {}): Promise<string> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!opts.allowRestricted) { if (s.mustChange) redirect("/account/password"); if (s.mfaMissing) redirect("/account/security"); }
  return s.id;
}

export interface Me { id: string; name: string; isAdmin: boolean; /** read-only group reporting access */ groupReport: boolean; restricted: boolean; memberships: { company_id: string; company: string; roles: string[]; permissions: string[] }[] }
async function load(id: string, restricted: boolean): Promise<Me> {
  return withUser(id, async (tx) => {
    const u = (await tx.q<{ full_name: string; is_system_admin: boolean }>("SELECT full_name, is_system_admin FROM users WHERE id = app_user_id()"))[0];
    const memberships = await tx.q<{ company_id: string; company: string; roles: string[]; permissions: string[] }>(
      `SELECT c.id AS company_id, c.legal_name AS company,
              COALESCE((SELECT array_agg(r.code ORDER BY r.code) FROM membership_roles mr JOIN roles r ON r.id = mr.role_id AND r.is_active WHERE mr.membership_id = m.id), '{}') AS roles,
              COALESCE((SELECT array_agg(DISTINCT p.code ORDER BY p.code) FROM membership_roles mr JOIN roles r ON r.id = mr.role_id AND r.is_active
                         JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id WHERE mr.membership_id = m.id), '{}') AS permissions
         FROM company_memberships m JOIN companies c ON c.id = m.company_id
       WHERE m.user_id = app_user_id() AND m.revoked_at IS NULL AND m.valid_from <= now() AND (m.valid_to IS NULL OR m.valid_to > now()) ORDER BY c.legal_name`);
    const groupReport = (await tx.q<{ n: number }>("SELECT count(*)::int AS n FROM app_group_companies()"))[0].n > 0;
    return { id, name: u?.full_name ?? "Unknown user", isAdmin: !!u?.is_system_admin, groupReport, restricted, memberships };
  });
}
/** For the page frame: null when nobody is signed in (never redirects). */
export async function getMe(): Promise<Me | null> { const s = await getSession(); return s ? load(s.id, s.mustChange || s.mfaMissing) : null; }
/** For pages: redirects when nobody is signed in. */
export async function requireMe(): Promise<Me> { return load(await currentUserId(), false); }
// Old role names still used by pages that have not been moved to permissions yet (same mapping as app_role_code() in the database).
const LEGACY_ROLE: Record<string, string> = { INPUTTER: "ACCOUNTANT", TREASURY: "ACCOUNTANT", VERIFIER: "FINANCE_MANAGER", AUTHENTICATOR: "OWNER", ACCOUNT_OWNER: "OWNER" };
export const hasRole = (me: Me, role: string) => me.memberships.some((m) => m.roles.includes(LEGACY_ROLE[role] ?? role));
/** What a person may do comes from the permissions of their roles (administrators have every permission). See lib/rbac.ts. */
export const hasPermission = (me: Me, permission: string, companyId?: string) =>
  me.isAdmin || me.memberships.some((m) => (!companyId || m.company_id === companyId) && m.permissions.includes(permission));

let owner: Pool | undefined;
/** Development only: lists seed users for the "Acting as" switcher. */
export async function devUsers(): Promise<{ id: string; full_name: string }[]> {
  if (process.env.NODE_ENV === "production" || !process.env.MIGRATION_DATABASE_URL) return [];
  owner ??= new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
  return (await owner.query("SELECT id, full_name FROM users WHERE is_active ORDER BY full_name")).rows;
}
