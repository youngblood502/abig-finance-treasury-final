import { Flash } from "@/components";
import { SubmitButton } from "@/components/ui/submit-button";
import { loginAction } from "../auth-actions";

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <div style={{ maxWidth: 420, margin: "8vh auto" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/abig-logo.png" alt="ABIG" width={110} style={{ marginBottom: 8 }} />
      <h1>Sign in</h1><p className="sub">ABIG Finance Management</p><Flash sp={sp} />
      <form action={loginAction} className="card" style={{ display: "grid", gap: 12 }}>
        <label className="f">Email<input name="email" type="email" autoComplete="username" required autoFocus /></label>
        <label className="f">Password<input name="password" type="password" autoComplete="current-password" required /></label>
        <label className="f">Authentication code<input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="6 digits, if you have set it up" maxLength={8} /></label>
        <SubmitButton plain>Sign in</SubmitButton>
        <span className="mute">Forgot your password? Ask your system administrator for a new temporary one.</span>
      </form>
    </div>
  );
}
