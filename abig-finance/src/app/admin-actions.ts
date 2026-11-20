"use server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminBackPath, isUuid } from "@/lib/admin";
import { adminResetTotp, adminSetPassword, adminUnlock, revokeSessions } from "@/lib/auth";
import { encryptMailSecret, mailKeyProblem, temporaryPassword } from "@/lib/crypto";
import { withUser } from "@/lib/db";
import { message, translate, WorkflowError } from "@/lib/errors";
import { emailSettingsProblem, isEmail, sendTestEmail, type EmailSettingsRow } from "@/lib/mail-settings";
import { COOKIE, currentUserId } from "@/lib/session";
import { validateLogo } from "@/lib/company-logo";
import { putObject, removeObject } from "@/lib/storage";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Every action here re-checks, in the database, that the caller is a system administrator. */
async function admin<T>(fn: (tx: import("@/lib/db").Tx, uid: string) => Promise<T>) {
  const uid = await currentUserId();
  return withUser(uid, async (tx) => {
    if (!(await tx.q("SELECT 1 FROM users WHERE id = app_user_id() AND is_system_admin AND is_active")).length) throw new WorkflowError(403, "Only a system administrator can do that.");
    return fn(tx, uid);
  }).catch(translate);
}
async function done(back: string, ok: string | (() => string), fn: () => Promise<unknown>, secret?: () => string | undefined): Promise<never> {
  let err: string | null = null;
  try { await fn(); } catch (e) { err = message(e); }
  const s = secret?.(); if (s && !err) (await cookies()).set("abig_flash_secret", s, { httpOnly: true, sameSite: "strict", path: "/admin", maxAge: 60, secure: process.env.NODE_ENV === "production" });
  revalidatePath("/admin", "layout");
  redirect(`${back}${back.includes("?") ? "&" : "?"}${err ? "err=" + encodeURIComponent(err) : "msg=" + encodeURIComponent(typeof ok === "string" ? ok : ok())}`);
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
  return done(adminBackPath(str(f, "user")), "Password reset. Give the person the temporary password shown below.", async () => {
    const actor = await currentUserId();
    temp = temporaryPassword(); await admin((tx, uid) => audit(tx, uid, "USER_PASSWORD_RESET", id, {})); await adminSetPassword(actor, id, temp);
  }, () => temp && `New temporary password for ${str(f, "label")}: ${temp}`);
}
export async function unlockUser(f: FormData) { const id = str(f, "user"); return done(adminBackPath(str(f, "user")), "Account unlocked.", async () => { const actor = await currentUserId(); await admin((tx, uid) => audit(tx, uid, "USER_UNLOCKED", id, {})); await adminUnlock(actor, id); }); }
export async function resetMfa(f: FormData) { const id = str(f, "user"); return done(adminBackPath(str(f, "user")), "Two-step verification reset. The person can set it up again at next sign-in.", async () => { const actor = await currentUserId(); await admin((tx, uid) => audit(tx, uid, "USER_MFA_RESET", id, {})); await adminResetTotp(actor, id); await revokeSessions(id); }); }
export async function setUserActive(f: FormData) {
  const id = str(f, "user"), active = str(f, "active") === "1";
  return done(adminBackPath(str(f, "user")), active ? "User reactivated." : "User deactivated and signed out everywhere.", async () => {
    await admin(async (tx, uid) => { if (id === uid && !active) throw new WorkflowError(422, "You cannot deactivate yourself."); await tx.q("UPDATE users SET is_active = $2 WHERE id = $1", [id, active]); await audit(tx, uid, active ? "USER_REACTIVATED" : "USER_DEACTIVATED", id, {}); });
    if (!active) await revokeSessions(id);
  });
}
const IDENTITY_SAVED: Record<string, string> = {
  UNCHANGED: "Nothing was different, so nothing was changed.", NAME: "Name changed.",
  EMAIL: "Email address changed. The person signs in with the new address from now on and has been signed out everywhere.",
  BOTH: "Name and email address changed. The person signs in with the new address from now on and has been signed out everywhere.",
};
/**
 * Corrects a person's name and the email address they sign in with. The database function does the work: it refuses anyone but a system administrator, keeps
 * names and addresses unique, audits the previous and new values and, when the address changes, signs the person out. Password, two-step sign-in, status,
 * administrator rights, company access and roles are not touched.
 */
export async function updateUserIdentity(f: FormData) {
  const id = str(f, "user"); let out = "UNCHANGED", self = false;
  return done(adminBackPath(id), () => (self && (out === "EMAIL" || out === "BOTH") ? "Your email address was changed. Use it to sign in from now on; your other sessions were signed out." : IDENTITY_SAVED[out] ?? "Saved."), async () => {
    if (!isUuid(id)) throw new WorkflowError(404, "Person not found.");
    const name = str(f, "name").replace(/\s+/g, " "), email = str(f, "email").toLowerCase();
    if (!name) throw new WorkflowError(422, "Enter the person's name.");
    if (!email) throw new WorkflowError(422, "Enter the person's email address.");
    if (!isEmail(email)) throw new WorkflowError(422, "Enter a valid email address.");
    out = await admin(async (tx, uid) => { self = uid === id; return (await tx.q<{ r: string }>("SELECT admin_update_user_identity($1,$2,$3) AS r", [id, name, email]))[0].r; });
    // The database signs everyone else out. An administrator changing their own address keeps the session they are in; the others end here.
    if (self && (out === "EMAIL" || out === "BOTH")) await revokeSessions(id, (await cookies()).get(COOKIE)?.value);
  });
}
export async function setAdmin(f: FormData) {
  const id = str(f, "user"), on = str(f, "on") === "1";
  return done(adminBackPath(str(f, "user")), on ? "Administrator rights given." : "Administrator rights removed.", () => admin(async (tx, uid) => {
    if (id === uid && !on) throw new WorkflowError(422, "You cannot remove your own administrator rights.");
    await tx.q("UPDATE users SET is_system_admin = $2 WHERE id = $1", [id, on]); await audit(tx, uid, on ? "ADMIN_GRANTED" : "ADMIN_REMOVED", id, {});
  }));
}

// ---------- Roles of a person in a company ----------
/** Sets the person's roles in one company. The database refuses a role that is limited to fewer companies than this would make. */
export async function setMembershipRoles(f: FormData) {
  const roleIds = f.getAll("roles").map(String);
  return done(adminBackPath(str(f, "user")), "Roles saved.", () => admin(async (tx, uid) => {
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
  return done(adminBackPath(str(f, "user")), "Access removed.", () => admin(async (tx, uid) => { await tx.q("UPDATE company_memberships SET revoked_at = now() WHERE id = $1", [str(f, "id")]); await audit(tx, uid, "MEMBERSHIP_REVOKED", str(f, "user"), {}); }));
}
export async function addGroupGrant(f: FormData) {
  return done(adminBackPath(str(f, "user")), "Group reporting access granted.", () => admin(async (tx, uid) => {
    await tx.q("INSERT INTO group_permission_grants (user_id, permission, company_id) VALUES ($1,'GROUP_REPORT_VIEW',$2)", [str(f, "user"), str(f, "company")]); await audit(tx, uid, "GROUP_GRANT_ADDED", str(f, "user"), { company: str(f, "company") });
  }));
}
export async function revokeGroupGrant(f: FormData) {
  return done(adminBackPath(str(f, "user")), "Group reporting access removed.", () => admin(async (tx, uid) => { await tx.q("UPDATE group_permission_grants SET revoked_at = now() WHERE id = $1", [str(f, "id")]); await audit(tx, uid, "GROUP_GRANT_REVOKED", str(f, "user"), {}); }));
}

// ---------- Companies ----------
export async function createCompany(f: FormData) {
  return done("/admin?tab=companies", "Company added.", () => admin((tx) => tx.q("SELECT admin_create_company($1,$2,$3,$4)", [str(f, "code").toUpperCase(), str(f, "name"), str(f, "tin"), str(f, "phone")])));
}
export async function updateCompany(f: FormData) {
  return done("/admin?tab=companies", "Company saved.", () => admin((tx) => tx.q("SELECT admin_update_company($1,$2,$3,$4,$5)", [str(f, "id"), str(f, "name"), str(f, "tin"), str(f, "phone"), str(f, "active") === "on"])));
}

/**
 * Uploads or replaces a company's logo. The file is validated first (its real bytes, type, size, dimensions, and that pdfkit can draw it).
 * Then, in one transaction, the database records it (admin only, audited) and the file is written to private storage under a new random
 * key. If anything fails, the transaction rolls back and the new object is deleted, so no row points at a missing file and no file is left
 * without a row. Replaced files are kept with their history rows.
 *
 * An error does not always mean a rollback: the database can commit and the connection drop before its reply arrives. So before deleting
 * the file, the action asks the database (on a new connection) whether the row was recorded. If it was, the upload succeeded and the file
 * stays. If that cannot be found out, the file also stays: a stray file nobody points at is harmless, a current logo without its file is not.
 */
export async function setCompanyLogo(f: FormData) {
  const company = str(f, "company");
  return done("/admin?tab=companies", "Logo saved. Vouchers for this company now show it.", async () => {
    if (!isUuid(company)) throw new WorkflowError(400, "Choose a company.");
    const file = f.get("logo");
    await admin(async () => {});   // only a system administrator gets as far as having a file looked at
    if (!(file instanceof File) || file.size === 0) throw new WorkflowError(400, "Choose a PNG or JPEG file.");
    const logo = await validateLogo(file);
    const key = randomBytes(32).toString("hex");
    try {
      await admin(async (tx) => {
        await tx.q("SELECT admin_company_logo_set($1,$2,$3,$4,$5,$6,$7)", [company, key, logo.mime, logo.size, logo.sha256, logo.width, logo.height]);
        try { await putObject(key, logo.data); } catch { throw new WorkflowError(503, "The logo could not be stored. Nothing was changed; try again."); }
      });
    } catch (e) {
      const recorded = await logoRecorded(key);
      if (recorded === true) return;                                  // committed after all: the logo is saved and its file must stay
      if (recorded === false) await removeObject(key).catch(() => {});   // rolled back: do not leave its file behind
      else console.error(`company logo upload for ${company}: the outcome is unknown, so its new file was kept (${message(e)})`);
      throw e;
    }
  });
}
/** Whether a logo row with this object key exists: true or false, or null when the database cannot be asked. */
async function logoRecorded(key: string): Promise<boolean | null> {
  try { return (await admin((tx) => tx.q("SELECT 1 FROM company_logos WHERE object_key = $1", [key]))).length > 0; } catch { return null; }
}
/** Removes a company's current logo; its vouchers then show the company code. The history and the stored file are kept. */
export async function removeCompanyLogo(f: FormData) {
  const company = str(f, "company");
  return done("/admin?tab=companies", "Logo removed. Vouchers for this company now show its code.", async () => {
    if (!isUuid(company)) throw new WorkflowError(400, "Choose a company.");
    await admin((tx) => tx.q("SELECT admin_company_logo_remove($1)", [company]));
  });
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

// ---------- Notifications ----------
/** Sends a failed or unanswered notification again. The database allows only those, keeps who was already sent it, and audits the retry. */
export async function retryNotification(f: FormData) {
  const id = str(f, "id"), back = str(f, "back").startsWith("/admin?tab=system") ? str(f, "back") : "/admin?tab=system";
  return done(back, "Notification queued to be sent again.", () => admin(async (tx) => {
    if (!isUuid(id)) throw new WorkflowError(404, "Notification not found.");
    await tx.q("SELECT admin_notification_retry($1)", [id]);
  }));
}

// ---------- Tax settings ----------
// The database functions check again that the caller is a system administrator, validate, and audit the previous and new values.
const TAX = "/admin?tab=tax";
/** A percentage or amount as typed, sent as the exact string: never through floating point. */
const decimal = (f: FormData, k: string, what: string) => { const v = str(f, k).replace(/,/g, ""); if (!/^\d+(\.\d+)?$/.test(v)) throw new WorkflowError(422, `Enter ${what} as a number.`); return v; };
export async function addVatRate(f: FormData) {
  return done(TAX, "VAT rate added.", () => admin((tx) => tx.q("SELECT admin_vat_rate_add($1,$2::numeric)", [str(f, "name"), decimal(f, "rate", "the percentage")])));
}
export async function updateVatRate(f: FormData) {
  if (!isUuid(str(f, "id"))) return done(TAX, "", async () => { throw new WorkflowError(404, "VAT rate not found."); });
  return done(TAX, "VAT rate saved. Requests already saved keep the rate they recorded.", () => admin((tx) => tx.q("SELECT admin_vat_rate_update($1,$2,$3::numeric)", [str(f, "id"), str(f, "name"), decimal(f, "rate", "the percentage")])));
}
export async function setVatRateActive(f: FormData) {
  const on = str(f, "active") === "true";
  if (!isUuid(str(f, "id"))) return done(TAX, "", async () => { throw new WorkflowError(404, "VAT rate not found."); });
  return done(TAX, on ? "VAT rate reactivated." : "VAT rate deactivated. It can no longer be chosen; requests that recorded it keep it.", () => admin((tx) => tx.q("SELECT admin_vat_rate_set_active($1,$2)", [str(f, "id"), on])));
}
export async function setDefaultVatRate(f: FormData) {
  if (!isUuid(str(f, "id"))) return done(TAX, "", async () => { throw new WorkflowError(404, "VAT rate not found."); });
  return done(TAX, "Default VAT rate changed.", () => admin((tx) => tx.q("SELECT admin_vat_rate_set_default($1)", [str(f, "id")])));
}
export async function saveWithholding(f: FormData) {
  return done(TAX, "Withholding tax settings saved. Requests already saved keep the settings they recorded.", () => admin((tx) =>
    tx.q("SELECT admin_withholding_update($1::numeric,$2::numeric)", [decimal(f, "rate", "the percentage"), decimal(f, "threshold", "the threshold")])));
}

// ---------- Email settings ----------
/**
 * Saves the mail server settings. The password is encrypted here, on the server, before it goes to the database; an empty password field keeps the saved one.
 * The database checks every value again, refuses anyone but a system administrator, and audits what changed without the password.
 */
export async function saveEmailSettings(f: FormData) {
  return done("/admin?tab=email", "Email settings saved. Send a test email to check them.", () => admin(async (tx) => {
    const i = { host: str(f, "host").toLowerCase(), port: str(f, "port"), username: str(f, "username"), password: String(f.get("password") ?? ""), security: str(f, "security"),
                senderName: str(f, "sender_name").replace(/\s+/g, " "), senderEmail: str(f, "sender_email").toLowerCase() };
    const saved = (await tx.q<{ password_set: boolean }>("SELECT password_set FROM admin_email_settings()"))[0]?.password_set ?? false;
    const problem = emailSettingsProblem(i, saved); if (problem) throw new WorkflowError(422, problem);
    const keyProblem = i.password ? mailKeyProblem() : null; if (keyProblem) throw new WorkflowError(422, keyProblem);
    await tx.q("SELECT admin_save_email_settings($1,$2,$3,$4,$5,$6,$7,$8)",
      [i.host, Number(i.port), i.username, i.password ? encryptMailSecret(i.password) : null, i.security, f.get("tls_verify") === "on", i.senderName, i.senderEmail]);
  }));
}
/** Removes the saved settings, so the deployment's own settings (SMTP_URL, MAIL_FROM) are used again. */
export async function clearEmailSettings() {
  return done("/admin?tab=email", "Saved email settings removed. Email now uses the settings of the deployment.", () => admin((tx) => tx.q("SELECT admin_clear_email_settings()")));
}
/** Sends one test message through the settings in use and says what the mail server answered. The result is audited. */
export async function sendEmailTest(f: FormData) {
  let to = str(f, "to").toLowerCase();
  return done("/admin?tab=email", () => `Test email sent to ${to}. Check that it arrived.`, async () => {
    const d = await admin(async (tx) => ({ row: (await tx.q<EmailSettingsRow>("SELECT * FROM admin_email_transport()"))[0] ?? null, mine: (await tx.q<{ email: string }>("SELECT email FROM users WHERE id = app_user_id()"))[0].email }));
    to ||= d.mine;
    if (!isEmail(to)) throw new WorkflowError(422, "Enter a valid email address to send the test to.");
    const r = await sendTestEmail(d.row, to);   // outside any database transaction: a slow mail server must not hold one open
    if (r.source !== "NONE") await admin((tx) => tx.q("SELECT admin_record_email_test($1,$2,$3)", [to, r.source, r.error]));
    if (!r.ok) throw new WorkflowError(502, r.source === "NONE" ? r.error! : `The test email could not be sent. ${r.error}`);
  });
}
