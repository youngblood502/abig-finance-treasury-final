"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { changePassword, disableTotp, enableTotp, endSession, login, startTotp } from "@/lib/auth";
import { COOKIE, currentUserId } from "@/lib/session";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const SECURE = process.env.NODE_ENV === "production";
const back = (path: string, kind: "msg" | "err", text: string): never => redirect(`${path}?${kind}=${encodeURIComponent(text)}`);

export async function loginAction(f: FormData) {
  const h = await headers();
  // Behind your reverse proxy, x-forwarded-for is set by the proxy. Do not expose the app directly to the internet.
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const r = await login({ email: str(f, "email"), password: str(f, "password"), code: str(f, "code"), ip, userAgent: h.get("user-agent") ?? undefined });
  if (!r.ok) return back("/login", "err", r.error);
  (await cookies()).set(COOKIE, r.token, { httpOnly: true, sameSite: "lax", secure: SECURE, path: "/", maxAge: 8 * 3600 });
  redirect("/");
}
export async function logoutAction() {
  const jar = await cookies(); const t = jar.get(COOKIE)?.value;
  if (t) await endSession(t); jar.delete(COOKIE); redirect("/login?msg=" + encodeURIComponent("You have signed out."));
}
export async function changePasswordAction(f: FormData) {
  const uid = await currentUserId({ allowRestricted: true });
  if (str(f, "next") !== str(f, "again")) return back("/account/password", "err", "The two new passwords are different.");
  const e = await changePassword(uid, str(f, "current"), str(f, "next"), (await cookies()).get(COOKIE)?.value);
  if (e) return back("/account/password", "err", e);
  back("/", "msg", "Password changed.");
}
export async function startMfaAction() { await startTotp(await currentUserId({ allowRestricted: true })); redirect("/account/security"); }
export async function enableMfaAction(f: FormData) {
  const ok = await enableTotp(await currentUserId({ allowRestricted: true }), str(f, "code"));
  return ok ? back("/", "msg", "Two-step verification is on.") : back("/account/security", "err", "That code is not right. Check the time on your phone and try again.");
}
export async function disableMfaAction(f: FormData) {
  const ok = await disableTotp(await currentUserId({ allowRestricted: true }), str(f, "password"), str(f, "code"));
  return back("/account/security", ok ? "msg" : "err", ok ? "Two-step verification is off." : "The password or code is not right.");
}
