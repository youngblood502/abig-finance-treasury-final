import { AppShell } from "@/components/layout/app-shell";
import { accountInCompany } from "@/lib/company";
import { companyScope, myCompanies } from "@/lib/company-scope";
import { withUser } from "@/lib/db";
import { loadBell } from "@/lib/notifications";
import { devUsers, getMe, type Me } from "@/lib/session";
import { navFor, ROLE_LABEL } from "@/lib/rbac";

/** The lines under a person's name in the account menu. */
export const accessLines = (me: Me) => [
  ...(me.isAdmin ? ["System administrator"] : []),
  ...(me.groupReport && !me.isAdmin && me.memberships.length === 0 ? ["Group reporting (read only)"] : []),
  ...me.memberships.map((m) => `${m.company}: ${m.roles.map(ROLE_LABEL).join(", ")}`),
];

/**
 * Everything around a page that depends on who is signed in: the sidebar, header, company switcher and notification bell, or the plain
 * signed-out frame. It reads the session and the database, so the root layout shows the branded loading screen until it is ready.
 * Moved here unchanged from the root layout: the same checks decide who sees what, and every page still checks access itself.
 */
export async function SignedInFrame({ children }: { children: React.ReactNode }) {
  let users: { id: string; full_name: string }[] = [];
  try { users = await devUsers(); } catch { /* not in development */ }
  const me = await getMe().catch(() => null);
  // Only what this person's roles allow; the pages and the database enforce the same rules (lib/rbac.ts).
  const nav = me && !me.restricted ? navFor(me) : [];
  const has = (path: string) => nav.some((m) => m.path === path);
  // Nobody is offered a company before they have finished signing in.
  const signedIn = me && !me.restricted ? me : null;
  const companies = signedIn ? await myCompanies(signedIn.id) : [], company = signedIn ? await companyScope(signedIn.id) : null;
  const counts = me && (has("/approvals") || has("/treasury")) ? await withUser(me.id, async (tx) => ({
    "/approvals": has("/approvals") ? (await tx.q<{ n: number }>("SELECT count(*)::int AS n FROM app_actionable_requests() WHERE $1::uuid IS NULL OR debtor_company_id = $1", [company]))[0].n : 0,
    "/treasury": has("/treasury") ? (await tx.q<{ n: number }>(`SELECT count(*)::int AS n FROM account_week_status() s WHERE s.can_check AND NOT s.has_opening AND ${accountInCompany("s.account_id", "$1")}`, [company]))[0].n : 0,
  })) : null;
  const items = nav.map((m) => ({ path: m.path, label: m.label, count: (counts as Record<string, number> | null)?.[m.path] ?? 0 }));
  // The bell: only this person's own notifications (row-level security), once they have finished signing in.
  const bell = signedIn ? await withUser(signedIn.id, (tx) => loadBell(tx)).catch(() => null) : null;
  if (!me) return <main className="mx-auto max-w-[900px] p-4 md:px-7 md:py-6">{children}</main>;
  return <AppShell items={items} name={me.name} details={accessLines(me)} companies={companies} company={company} devUsers={users} userId={me.id} bell={bell}>{children}</AppShell>;
}
