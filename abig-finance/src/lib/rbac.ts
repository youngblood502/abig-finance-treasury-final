import { redirect } from "next/navigation";
import { WorkflowError } from "./errors";
import { hasPermission, type Me } from "./session";

/**
 * Who may do what. The permissions come from the database (roles -> permissions, per company) and are the same ones the
 * database itself enforces with row-level security and the wf_* functions; this file decides what the SCREENS and ROUTES offer,
 * so a person is never shown, or let into, something the database would refuse anyway.
 *
 *   Accountant       one company only; payment requests, balances, vendors, recurring. No verification, authentication or admin.
 *   Finance Manager  one or several companies (set on the role); verifies. Cannot authenticate or manage users.
 *   Owner            several companies; every module except user administration; authenticates (final approval).
 *   Administrator    everything, including user administration (not tied to a company).
 */
export const can = (me: Me, permission: string, companyId?: string): boolean => hasPermission(me, permission, companyId);
export const canAny = (me: Me, ...permissions: string[]): boolean => permissions.some((p) => can(me, p));

/** The permission that opens each part of the application. Group reporting people may read, never act. */
export interface Module { path: string; label: string; nav: boolean; allow: (me: Me) => boolean; why: string }
export const MODULES: Module[] = [
  { path: "/", label: "Dashboard", nav: true, allow: () => true, why: "" },
  { path: "/requests/new", label: "New payment request", nav: false, allow: (me) => can(me, "payment_request:create"), why: "Only Accountants create payment requests." },
  { path: "/requests", label: "Payment requests", nav: true, allow: (me) => can(me, "payment_request:view") || me.groupReport, why: "Your role cannot see payment requests." },
  { path: "/approvals", label: "Approvals", nav: true, allow: (me) => canAny(me, "payment_request:verify", "payment_request:authenticate"), why: "Approvals are for Finance Managers and Owners." },
  { path: "/accounts", label: "Accounts", nav: true, allow: (me) => can(me, "bank_account:view") || me.groupReport, why: "Your role cannot see bank accounts." },
  { path: "/treasury", label: "Weekly treasury", nav: true, allow: (me) => canAny(me, "reconciliation:view", "bank_balance:update"), why: "Your role cannot see the weekly treasury." },
  { path: "/suppliers", label: "Suppliers", nav: true, allow: (me) => can(me, "supplier:view"), why: "Your role cannot see suppliers." },
  { path: "/payees", label: "People", nav: true, allow: (me) => can(me, "payee:view"), why: "Your role cannot see people who are paid." },
  { path: "/reports", label: "Reports", nav: true, allow: (me) => can(me, "report:view") || me.groupReport, why: "Your role cannot see reports." },
  { path: "/admin", label: "Administration", nav: true, allow: (me) => me.isAdmin, why: "Only system administrators can use administration." },
];
const moduleFor = (path: string) => MODULES.find((m) => m.path === "/" ? path === "/" : path === m.path || path.startsWith(m.path + "/"));

export const canAccess = (me: Me, path: string): boolean => (moduleFor(path)?.allow(me)) ?? false;
export const navFor = (me: Me): Module[] => MODULES.filter((m) => m.nav && m.allow(me));

/** For pages: send the person back to the dashboard with the reason. */
export function requireAccess(me: Me, path: string): void {
  const m = moduleFor(path);
  if (!m || !m.allow(me)) redirect(`/?err=${encodeURIComponent(m?.why || "You do not have access to that page.")}`);
}
/** For API routes: a 403 instead of a redirect. */
export function denyApi(me: Me, path: string): Response | null {
  return canAccess(me, path) ? null : new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
}
/** For server actions: throws the 403 that the action wrapper shows to the person. */
export function assertCan(me: Me, ...permissions: string[]): void {
  if (!permissions.some((p) => can(me, p))) throw new WorkflowError(403, "You do not have permission to do that.");
}

export const ROLE_LABEL = (code: string) => code.toLowerCase().replace(/_/g, " ");

/**
 * Permissions a role can never hold. The database refuses them too (role_permissions_guard); this lets the screen grey them out.
 * user:manage and company:manage are for system administrators only.
 */
export function roleCannotHold(roleCode: string, permissionCode: string): string | null {
  if (permissionCode === "user:manage" || permissionCode === "company:manage") return "Only system administrators";
  if (roleCode === "ACCOUNTANT" && ["payment_request:verify", "payment_request:authenticate", "payment_request:reject", "approval:view"].includes(permissionCode)) return "Accountants cannot approve";
  if (roleCode === "FINANCE_MANAGER" && permissionCode === "payment_request:authenticate") return "Finance Managers cannot authenticate";
  return null;
}
