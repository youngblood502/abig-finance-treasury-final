"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminResetTotp, adminSetPassword, adminUnlock, revokeSessions } from "@/lib/auth";
import { temporaryPassword } from "@/lib/crypto";
import { withUser } from "@/lib/db";
import { message, translate, WorkflowError } from "@/lib/errors";
import { currentUserId } from "@/lib/session";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Every action here re-checks, in the database, that the caller is a system administrator. */
async function admin<T>(fn: (tx: import("@/lib/db").Tx, uid: string) => Promise<T>) {
  const uid = await currentUserId();
  return withUser(uid, async (tx) => {
    if (!(await tx.q("SELECT 1 FROM users WHERE id = app_user_id() AND is_system_admin AND is_active")).length) throw new WorkflowError(403, "Only a system administrator can do that.");
    return fn(tx, uid);
  }).catch(translate);
}
async function done(back: string, ok: string, fn: () => Promise<unknown>, secret?: () => string | undefined): Promise<never> {
  let err: string | null = null;
  try { await fn(); } catch (e) { err = message(e); }
  const s = secret?.(); if (s && !err) (await cookies()).set("abig_flash_secret", s, { httpOnly: true, sameSite: "strict", path: "/admin", maxAge: 60, secure: process.env.NODE_ENV === "production" });
  revalidatePath("/admin", "layout");
  redirect(`${back}${back.includes("?") ? "&" : "?"}${err ? "err=" + encodeURIComponent(err) : "msg=" + encodeURIComponent(ok)}`);
}
const audit = (tx: import("@/lib/db").Tx, uid: string, action: string, entity: string | null, meta: object, type = "USER") =>
  tx.q("INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)", [uid, action, type, entity, JSON.stringify(meta)]);

// ---------- Users ----------
export async function createUser(f: FormData) {
  let temp: string | undefined;
  return done("/admin?tab=users", "User created. Give them the temporary password shown below; they must change it at first sign-in.", async () => {
    const actor = await currentUserId(); const email = str(f, "email").toLowerCase(), name = str(f, "name"); temp = temporaryPassword();
    const id = await admin(async (tx, uid) => {
      const r = await tx.q<{ id: string }>("INSERT INTO users (email, full_name) VALUES ($1,$2) RETURNING id", [email, name]);
      await audit(tx, uid, "USER_CREATED", r[0].id, { email }); return r[0].id;
    });
    await adminSetPassword(actor, id, temp);
  }, () => temp && `Temporary password for ${str(f, "email")}: ${temp}`);
}
export async function resetPassword(f: FormData) {
  let temp: string | undefined; const id = str(f, "user");
  return done("/admin?tab=users", "Password reset. Give the person the temporary password shown below.", async () => {
    const actor = await currentUserId();
    temp = temporaryPassword(); await admin((tx, uid) => audit(tx, uid, "USER_PASSWORD_RESET", id, {})); await adminSetPassword(actor, id, temp);
  }, () => temp && `New temporary password for ${str(f, "label")}: ${temp}`);
}
export async function unlockUser(f: FormData) { const id = str(f, "user"); return done("/admin?tab=users", "Account unlocked.", async () => { const actor = await currentUserId(); await admin((tx, uid) => audit(tx, uid, "USER_UNLOCKED", id, {})); await adminUnlock(actor, id); }); }
export async function resetMfa(f: FormData) { const id = str(f, "user"); return done("/admin?tab=users", "Two-step verification reset. The person can set it up again at next sign-in.", async () => { const actor = await currentUserId(); await admin((tx, uid) => audit(tx, uid, "USER_MFA_RESET", id, {})); await adminResetTotp(actor, id); await revokeSessions(id); }); }
export async function setUserActive(f: FormData) {
  const id = str(f, "user"), active = str(f, "active") === "1";
  return done("/admin?tab=users", active ? "User reactivated." : "User deactivated and signed out everywhere.", async () => {
    await admin(async (tx, uid) => { if (id === uid && !active) throw new WorkflowError(422, "You cannot deactivate yourself."); await tx.q("UPDATE users SET is_active = $2 WHERE id = $1", [id, active]); await audit(tx, uid, active ? "USER_REACTIVATED" : "USER_DEACTIVATED", id, {}); });
    if (!active) await revokeSessions(id);
  });
}
export async function setAdmin(f: FormData) {
  const id = str(f, "user"), on = str(f, "on") === "1";
  return done("/admin?tab=users", on ? "Administrator rights given." : "Administrator rights removed.", () => admin(async (tx, uid) => {
    if (id === uid && !on) throw new WorkflowError(422, "You cannot remove your own administrator rights.");
    await tx.q("UPDATE users SET is_system_admin = $2 WHERE id = $1", [id, on]); await audit(tx, uid, on ? "ADMIN_GRANTED" : "ADMIN_REMOVED", id, {});
  }));
}

// ---------- Roles of a person in a company ----------
/** Sets the person's roles in one company. The database refuses a role that is limited to fewer companies than this would make. */
export async function setMembershipRoles(f: FormData) {
  const roleIds = f.getAll("roles").map(String);
  return done("/admin?tab=users", "Roles saved.", () => admin(async (tx, uid) => {
    if (!roleIds.length) throw new WorkflowError(422, "Choose at least one role.");
    const user = str(f, "user"), company = str(f, "company");
    const valid = await tx.q<{ id: string; code: string }>("SELECT id, code FROM roles WHERE id = ANY($1::uuid[]) AND is_active", [roleIds]);
    if (valid.length !== new Set(roleIds).size) throw new WorkflowError(422, "One of the roles does not exist or is switched off.");
    let m = (await tx.q<{ id: string }>("SELECT id FROM company_memberships WHERE user_id = $1 AND company_id = $2 AND revoked_at IS NULL", [user, company]))[0];
    if (!m) m = (await tx.q<{ id: string }>("INSERT INTO company_memberships (company_id, user_id) VALUES ($1,$2) RETURNING id", [company, user]))[0];
    await tx.q("DELETE FROM membership_roles WHERE membership_id = $1 AND NOT (role_id = ANY($2::uuid[]))", [m.id, roleIds]);
    for (const r of valid) await tx.q("INSERT INTO membership_roles (membership_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [m.id, r.id]);
    await audit(tx, uid, "MEMBERSHIP_SET", user, { company, roles: valid.map((r) => r.code) });
  }));
}
export async function revokeMembership(f: FormData) {
  return done("/admin?tab=users", "Access removed.", () => admin(async (tx, uid) => { await tx.q("UPDATE company_memberships SET revoked_at = now() WHERE id = $1", [str(f, "id")]); await audit(tx, uid, "MEMBERSHIP_REVOKED", str(f, "user"), {}); }));
}
export async function addGroupGrant(f: FormData) {
  return done("/admin?tab=users", "Group reporting access granted.", () => admin(async (tx, uid) => {
    await tx.q("INSERT INTO group_permission_grants (user_id, permission, company_id) VALUES ($1,'GROUP_REPORT_VIEW',$2)", [str(f, "user"), str(f, "company")]); await audit(tx, uid, "GROUP_GRANT_ADDED", str(f, "user"), { company: str(f, "company") });
  }));
}
export async function revokeGroupGrant(f: FormData) {
  return done("/admin?tab=users", "Group reporting access removed.", () => admin(async (tx, uid) => { await tx.q("UPDATE group_permission_grants SET revoked_at = now() WHERE id = $1", [str(f, "id")]); await audit(tx, uid, "GROUP_GRANT_REVOKED", str(f, "user"), {}); }));
}

// ---------- Companies ----------
export async function createCompany(f: FormData) {
  return done("/admin?tab=companies", "Company added.", () => admin((tx) => tx.q("SELECT admin_create_company($1,$2,$3,$4)", [str(f, "code").toUpperCase(), str(f, "name"), str(f, "tin"), str(f, "phone")])));
}
export async function updateCompany(f: FormData) {
  return done("/admin?tab=companies", "Company saved.", () => admin((tx) => tx.q("SELECT admin_update_company($1,$2,$3,$4,$5)", [str(f, "id"), str(f, "name"), str(f, "tin"), str(f, "phone"), str(f, "active") === "on"])));
}

// ---------- Roles and their permissions ----------
export async function createRole(f: FormData) {
  return done("/admin?tab=roles", "Role added. Choose its permissions below.", () => admin(async (tx, uid) => {
    const code = str(f, "code").toUpperCase().replace(/\s+/g, "_"), max = str(f, "max");
    const r = await tx.q<{ id: string }>("INSERT INTO roles (code, name, description, max_companies) VALUES ($1,$2,$3,$4) RETURNING id", [code, str(f, "name"), str(f, "description") || null, max ? Number(max) : null]);
    await audit(tx, uid, "ROLE_CREATED", r[0].id, { code, max_companies: max || null }, "ROLE");
  }));
}
export async function saveRole(f: FormData) {
  return done("/admin?tab=roles", "Role saved.", () => admin(async (tx, uid) => {
    const id = str(f, "id"), max = str(f, "max");
    if (max && (!Number.isInteger(Number(max)) || Number(max) < 1)) throw new WorkflowError(422, "The number of companies must be a whole number of 1 or more, or empty for no limit.");
    const n = await tx.q("UPDATE roles SET name = $2, description = $3, max_companies = $4, is_active = $5 WHERE id = $1 RETURNING id", [id, str(f, "name"), str(f, "description") || null, max ? Number(max) : null, str(f, "active") === "on"]);
    if (!n.length) throw new WorkflowError(404, "Role not found.");
    await audit(tx, uid, "ROLE_UPDATED", id, { max_companies: max || null, active: str(f, "active") === "on" }, "ROLE");
  }));
}
/** Replaces the role's permissions with the ticked ones. The database refuses the ones no role may hold (user and company administration, approvals for Accountants...). */
export async function saveRolePermissions(f: FormData) {
  const want = new Set(f.getAll("perm").map(String));
  return done("/admin?tab=roles", "Permissions saved.", () => admin(async (tx, uid) => {
    const role = str(f, "role");
    const have = new Set((await tx.q<{ permission_id: string }>("SELECT permission_id FROM role_permissions WHERE role_id = $1", [role])).map((r) => r.permission_id));
    const add = [...want].filter((p) => !have.has(p)), remove = [...have].filter((p) => !want.has(p));
    if (remove.length) await tx.q("DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = ANY($2::uuid[])", [role, remove]);
    for (const p of add) await tx.q("INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)", [role, p]);
    await audit(tx, uid, "ROLE_PERMISSIONS_SET", role, { added: add.length, removed: remove.length }, "ROLE");
  }));
}
