import { IDLE_MINUTES, LOCK_MINUTES, MAX_FAILS, SESSION_HOURS } from "./auth";
import type { Tx } from "./db";
import { TIME_ZONE } from "./format";

// What the administration screens read. Row-level security limits people, roles and sign-in activity to system administrators. Every change goes through admin-actions.ts,
// which checks that in the database again before it does anything.

export interface AdminCompany { id: string; code: string; legal_name: string; is_active: boolean; tin_number: string | null; phone: string | null }
export interface AdminUser { id: string; email: string; full_name: string; is_system_admin: boolean; is_active: boolean; must_change_password: boolean; totp_enabled: boolean; locked_until: Date | null }
export interface AdminMembership { id: string; user_id: string; company_id: string; company: string; roles: string[]; role_ids: string[] }
export interface AdminGrant { id: string; user_id: string; company: string }
export interface AdminRole { id: string; code: string; name: string; description: string | null; max_companies: number | null; is_active: boolean; is_system: boolean; people: number }
export interface AdminPermission { id: string; code: string; resource: string; action: string; description: string | null }

export const companyList = (tx: Tx) => tx.q<AdminCompany>("SELECT id, code, legal_name, is_active, tin_number, phone FROM company_directory()");
export const roleList = (tx: Tx) => tx.q<AdminRole>("SELECT r.id, r.code, r.name, r.description, r.max_companies, r.is_active, r.is_system, (SELECT count(*) FROM membership_roles mr JOIN company_memberships m ON m.id = mr.membership_id AND m.revoked_at IS NULL WHERE mr.role_id = r.id)::int AS people FROM roles r ORDER BY r.is_system DESC, r.name");
export const permissionList = async (tx: Tx) => ({
  permissions: await tx.q<AdminPermission>("SELECT id, code, resource, action, description FROM permissions ORDER BY resource, action"),
  held: await tx.q<{ role_id: string; permission_id: string }>("SELECT role_id, permission_id FROM role_permissions"),
});

const USER = "SELECT id, email, full_name, is_system_admin, is_active, must_change_password, totp_enabled, locked_until FROM users";
const MEMBERS = `SELECT m.id, m.user_id, m.company_id, c.legal_name AS company, COALESCE((SELECT array_agg(r.name ORDER BY r.name) FROM membership_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.membership_id = m.id), '{}') AS roles,
                        COALESCE((SELECT array_agg(mr.role_id) FROM membership_roles mr WHERE mr.membership_id = m.id), '{}') AS role_ids
                   FROM company_memberships m JOIN companies c ON c.id = m.company_id WHERE m.revoked_at IS NULL`;
const GRANTS = "SELECT g.id, g.user_id, c.legal_name AS company FROM group_permission_grants g JOIN companies c ON c.id = g.company_id WHERE g.revoked_at IS NULL";

export const peopleList = async (tx: Tx) => ({
  users: await tx.q<AdminUser>(`${USER} ORDER BY full_name`),
  members: await tx.q<AdminMembership>(`${MEMBERS} ORDER BY c.legal_name`),
  grants: await tx.q<AdminGrant>(`${GRANTS} ORDER BY c.legal_name`),
});
/** One person, or null when there is no such person or the caller may not read them. */
export const personDetail = async (tx: Tx, id: string) => {
  const user = (await tx.q<AdminUser>(`${USER} WHERE id = $1`, [id]))[0];
  if (!user) return null;
  return { user, members: await tx.q<AdminMembership>(`${MEMBERS} AND m.user_id = $1 ORDER BY c.legal_name`, [id]), grants: await tx.q<AdminGrant>(`${GRANTS} AND g.user_id = $1 ORDER BY c.legal_name`, [id]) };
};

export interface AdminChange { occurred_at: Date; actor: string | null; action: string; metadata: unknown }
export interface SignInEvent { occurred_at: Date; email: string | null; event: string; ip: string | null; detail: string | null }
export const activity = async (tx: Tx) => ({
  changes: await tx.q<AdminChange>("SELECT e.occurred_at, u.full_name AS actor, e.action, e.metadata FROM audit_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.action ~ '^(ROLE_|MEMBERSHIP_|ADMIN_|COMPANY_|USER_|GROUP_)' ORDER BY e.occurred_at DESC LIMIT 50"),
  signIns: await tx.q<SignInEvent>("SELECT occurred_at, email, event, ip, detail FROM auth_events ORDER BY occurred_at DESC LIMIT 50"),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);
/** Where a change to a person goes back to. The value comes from a form, so it only ever chooses a person's page by id. */
export const adminBackPath = (user: string) => (isUuid(user) ? `/admin/people/${user}` : "/admin?tab=users");
export const roleLimit = (max: number | null) => (max ? `${max} ${max === 1 ? "company" : "companies"} at most` : "Any number of companies");
export const signedInLocked = (u: Pick<AdminUser, "locked_until">, now = new Date()) => !!u.locked_until && new Date(u.locked_until) > now;

/**
 * What the running system is set to. These come from the environment and the code, so they are shown and not edited here. A setting that holds a secret shows only whether it
 * is set: no value from the environment reaches this list.
 */
export function systemSettings(env: Record<string, string | undefined> = process.env) {
  const set = (k: string) => (env[k] ? "Set" : "Not set");
  return [
    { label: "Environment", value: env.NODE_ENV === "production" ? "Production" : "Not production" },
    { label: "Two-step sign-in required", value: (env.REQUIRE_MFA ?? (env.NODE_ENV === "production" ? "true" : "false")) === "true" ? "Yes" : "No" },
    { label: "Session length", value: `${SESSION_HOURS} hours, or ${IDLE_MINUTES} minutes idle` },
    { label: "Account lock", value: `${LOCK_MINUTES} minutes after ${MAX_FAILS} failed sign-ins` },
    { label: "Time zone", value: TIME_ZONE },
    { label: "Encryption key for ID numbers", value: set("APP_ENCRYPTION_KEY") },
    { label: "Email sending", value: env.SMTP_URL ? "Configured" : "Not configured" },
    { label: "Document storage folder", value: set("STORAGE_DIR") },
  ];
}
