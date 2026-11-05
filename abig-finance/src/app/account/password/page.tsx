import { Flash } from "@/components";
import { changePasswordAction } from "../../auth-actions";
import { getSession } from "@/lib/session";

export default async function Password({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const s = await getSession();
  return (
    <div style={{ maxWidth: 480 }}>
      <h1>Change password</h1>
      <p className="sub">{s?.mustChange ? "Your administrator gave you a temporary password. Choose your own to continue." : "You will be signed out of your other devices."}</p><Flash sp={sp} />
      <form action={changePasswordAction} className="card" style={{ display: "grid", gap: 12 }}>
        <label className="f">Current password<input name="current" type="password" autoComplete="current-password" required /></label>
        <label className="f">New password (at least 12 characters)<input name="next" type="password" autoComplete="new-password" minLength={12} required /></label>
        <label className="f">New password again<input name="again" type="password" autoComplete="new-password" minLength={12} required /></label>
        <button>Change password</button>
      </form>
    </div>
  );
}
