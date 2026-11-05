import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import ThemeToggle from "./theme-toggle";
import { withUser } from "@/lib/db";
import { devUsers, getMe } from "@/lib/session";
import { navFor, ROLE_LABEL } from "@/lib/rbac";
import { switchUser } from "./actions";
import { logoutAction } from "./auth-actions";

export const metadata: Metadata = { title: "ABIG Finance" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let users: { id: string; full_name: string }[] = [];
  try { users = await devUsers(); } catch { /* not in development */ }
  const me = await getMe().catch(() => null);
  const nav = me && !me.restricted ? navFor(me) : [];
  const waiting = nav.some((m) => m.path === "/approvals") && me ? (await withUser(me.id, (tx) => tx.q<{ n: number }>("SELECT count(*)::int AS n FROM app_actionable_requests()")))[0].n : 0;
  return (
    <html lang="en" suppressHydrationWarning><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /></head>
      <body suppressHydrationWarning>
        {!me ? <main style={{ maxWidth: 900, margin: "0 auto" }}>{children}</main> : (
          <div className="shell">
            <aside>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/abig-logo.png" alt="ABIG" /><small>Finance Management</small>
              {/* Only what this person's roles allow; the pages and the database enforce the same rules (lib/rbac.ts). */}
              {nav.map((m) => <Link className="nav" key={m.path} href={m.path}>{m.label}{m.path === "/approvals" && waiting > 0 && <span className="chip" style={{ marginLeft: 8 }}>{waiting}</span>}</Link>)}
              <div className="bottom">
                <div className="mute">Signed in as <b>{me.name}</b>{me.isAdmin && <><br />System administrator</>}{me.groupReport && !me.isAdmin && me.memberships.length === 0 && <><br />Group reporting (read only)</>}{me.memberships.length > 0 && <><br />{me.memberships.map((m) => `${m.company}: ${m.roles.map(ROLE_LABEL).join(", ")}`).join(" · ")}</>}</div>
                <div className="inline"><Link className="mute" href="/account/password">Password</Link><Link className="mute" href="/account/security">Two-step</Link></div>
                {users.length > 0 && (
                  <form action={switchUser} className="inline">
                    <label className="f">Acting as (development only)<select name="user" defaultValue={me.id}>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label>
                    <button className="sec">Switch</button>
                  </form>
                )}
                <div className="inline"><ThemeToggle /><form action={logoutAction}><button className="sec">Sign out</button></form></div>
              </div>
            </aside>
            <main>{children}</main>
          </div>
        )}
      </body></html>
  );
}
