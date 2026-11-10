import QRCode from "qrcode";
import { SubmitButton } from "@/components/ui/submit-button";
import { Flash } from "@/components";
import { disableMfaAction, enableMfaAction, startMfaAction } from "../../auth-actions";
import { pendingTotp } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { currentUserId, mfaRequired } from "@/lib/session";

export default async function Security({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId({ allowRestricted: true });
  const enabled = (await withUser(uid, (tx) => tx.q<{ totp_enabled: boolean }>("SELECT totp_enabled FROM users WHERE id = app_user_id()")))[0]?.totp_enabled;
  const pending = enabled ? null : await pendingTotp(uid);
  const qr = pending ? await QRCode.toDataURL(`otpauth://totp/ABIG%20Finance:${encodeURIComponent(pending.email)}?secret=${pending.secret}&issuer=ABIG%20Finance`, { margin: 1, width: 200 }) : null;
  return (
    <div style={{ maxWidth: 560 }}>
      <h1>Two-step verification</h1>
      <p className="sub">A code from an authenticator app on your phone, in addition to your password. {mfaRequired() ? "It is required for finance roles." : ""}</p><Flash sp={sp} />
      {enabled ? (
        <form action={disableMfaAction} className="card" style={{ display: "grid", gap: 12 }}>
          <p><span className="chip">On</span> Your account asks for a code at sign-in.</p>
          <label className="f">Password<input name="password" type="password" autoComplete="current-password" required /></label>
          <label className="f">Current code<input name="code" inputMode="numeric" required /></label>
          <SubmitButton plain className="sec" pendingText="Turning off…">Turn off</SubmitButton>
        </form>
      ) : pending ? (
        <div className="card" style={{ display: "grid", gap: 12 }}>
          <p>1. Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy) and scan this picture.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr!} alt="QR code for your authenticator app" width={200} height={200} />
          <p className="mute">Cannot scan? Type this key into the app: <code>{pending.secret}</code></p>
          <form action={enableMfaAction} className="inline"><label className="f">2. Enter the 6-digit code it shows<input name="code" inputMode="numeric" autoComplete="one-time-code" required /></label><SubmitButton plain pendingText="Turning on…">Turn on</SubmitButton></form>
        </div>
      ) : (
        <form action={startMfaAction} className="card"><p>Two-step verification is off.</p><SubmitButton plain>Set it up</SubmitButton></form>
      )}
    </div>
  );
}
