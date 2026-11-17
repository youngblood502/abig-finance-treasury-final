import nodemailer from "nodemailer";
import { decryptMailSecret } from "./crypto";

// One place that turns email settings into a mail connection, used by the website (the test email) and by the background worker (notifications),
// so both send exactly the same way. Settings saved by a system administrator come first; without them the environment (SMTP_URL, MAIL_FROM) is
// used, as it always was. No value here ever goes to the browser: this module is only imported by server code.

export const EMAIL_SECURITY = { TLS: "TLS from the start (usually port 465)", STARTTLS: "STARTTLS (usually port 587)", NONE: "Not encrypted (no password allowed)" } as const;
export type EmailSecurity = keyof typeof EMAIL_SECURITY;

/** What the database hands to a server: the saved settings, with the password still encrypted. */
export interface EmailSettingsRow {
  smtp_host: string; smtp_port: number; smtp_username: string | null; smtp_password_enc: string | null; security: string; tls_verify: boolean;
  sender_name: string; sender_email: string; updated_at?: Date | string | null;
}
export interface EmailSettingsInput { host: string; port: string; username: string; password: string; security: string; senderName: string; senderEmail: string }
export interface Mail { to: string; subject: string; text: string }
export type Sender = (m: Mail) => Promise<void>;
export type MailSource = "SAVED" | "ENVIRONMENT" | "NONE";

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const isEmail = (v: string) => v.length <= 254 && EMAIL.test(v);

/**
 * Checks what an administrator typed, before anything is encrypted or saved. The database checks the same rules again.
 * `passwordSaved` says whether a password is already stored, in which case an empty password field means "keep it".
 */
export function emailSettingsProblem(i: EmailSettingsInput, passwordSaved: boolean): string | null {
  if (!i.host) return "Enter the SMTP host.";
  if (!/^[a-z0-9]([a-z0-9.:-]{0,251}[a-z0-9])?$/i.test(i.host)) return "Enter the SMTP host as a server name or address, for example smtp.example.com, without smtp:// in front.";
  if (!/^\d{1,5}$/.test(i.port) || Number(i.port) < 1 || Number(i.port) > 65535) return "The SMTP port must be a number from 1 to 65535.";
  if (!Object.hasOwn(EMAIL_SECURITY, i.security)) return "Choose how the connection is secured.";
  if (i.username.length > 320 || /[\u0000-\u001f\u007f]/.test(i.username)) return "The SMTP user name is not valid.";
  if (i.password.length > 1000) return "That SMTP password is too long.";
  if (!i.username && i.password) return "A password needs an SMTP user name.";
  if (i.username && !i.password && !passwordSaved) return "Enter the SMTP password for that user name.";
  if (i.username && i.security === "NONE") return "A password cannot be sent over an unencrypted connection. Choose TLS or STARTTLS.";
  if (!i.senderName) return "Enter the sender name.";
  if (i.senderName.length > 100 || /[\u0000-\u001f\u007f<>"]/.test(i.senderName)) return "The sender name is too long or has characters an email program would refuse.";
  if (!i.senderEmail) return "Enter the sender email address.";
  if (!isEmail(i.senderEmail)) return "Enter a valid sender email address.";
  return null;
}

/** nodemailer's own default is ten minutes; these keep one send well inside the worker's five-minute lease. */
const TIMEOUTS = { connectionTimeout: 30_000, greetingTimeout: 30_000, socketTimeout: 60_000 };
type Options = Parameters<typeof nodemailer.createTransport>[0];
export interface ResolvedMail { source: MailSource; options: Options | null; from: string | { name: string; address: string } }

/**
 * The connection to use: the saved settings if there are any, otherwise the environment, otherwise none (mail is printed to the log).
 * The saved password is decrypted here, in memory, with MAIL_ENCRYPTION_KEY (its own key, so the worker never holds APP_ENCRYPTION_KEY). It is never logged or returned to a caller outside the server.
 */
export function resolveMail(row: EmailSettingsRow | null | undefined, env: Record<string, string | undefined> = process.env, timeouts: Partial<typeof TIMEOUTS> = {}): ResolvedMail {
  if (row) {
    const auth = row.smtp_username && row.smtp_password_enc ? { user: row.smtp_username, pass: decryptMailSecret(row.smtp_password_enc) } : undefined;
    return {
      source: "SAVED", from: { name: row.sender_name, address: row.sender_email },
      options: { host: row.smtp_host, port: row.smtp_port, secure: row.security === "TLS", requireTLS: row.security === "STARTTLS", auth, tls: { rejectUnauthorized: row.tls_verify }, ...TIMEOUTS, ...timeouts } as Options,
    };
  }
  const from = env.MAIL_FROM ?? "ABIG Finance <no-reply@localhost>";
  if (env.SMTP_URL) return { source: "ENVIRONMENT", from, options: { url: env.SMTP_URL, ...TIMEOUTS, ...timeouts } as Options };
  return { source: "NONE", from, options: null };
}

/** A sender for one resolved connection. Without a mail server, mails are printed to the console. */
export function senderFor(r: ResolvedMail): { send: Sender; close: () => void } {
  if (!r.options) return { send: async (m) => { console.log(`[mail] to=${m.to} subject=${m.subject}`); }, close: () => {} };
  const transport = nodemailer.createTransport(r.options);
  return { send: async (m) => { await transport.sendMail({ from: r.from, ...m }); }, close: () => transport.close() };
}

/** A mail server's answer, made safe to show and store: one line, no longer than a sentence or two. */
export const mailError = (e: unknown) => String((e as { message?: string })?.message ?? e).replace(/\s+/g, " ").trim().slice(0, 300) || "The mail server did not answer.";

export interface TestResult { ok: boolean; source: MailSource; error: string | null }
/** Sends one short message through the settings in use and reports what the mail server said. Shorter timeouts: somebody is waiting for the answer. */
export async function sendTestEmail(row: EmailSettingsRow | null | undefined, to: string, env: Record<string, string | undefined> = process.env): Promise<TestResult> {
  let r: ResolvedMail;
  try { r = resolveMail(row, env, { connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000 }); }
  catch { return { ok: false, source: "SAVED", error: "The saved SMTP password could not be read with this server's encryption key. Enter the password again and save." }; }
  if (!r.options) return { ok: false, source: "NONE", error: "No mail server is set. Save the email settings first." };
  const { send, close } = senderFor(r);
  try {
    await send({ to, subject: "ABIG Finance test email", text: "This is a test email from ABIG Finance.\n\nIf you are reading it, the email settings work and notifications can be delivered.\n" });
    return { ok: true, source: r.source, error: null };
  } catch (e) { return { ok: false, source: r.source, error: mailError(e) }; }
  finally { close(); }
}
