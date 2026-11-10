import nodemailer from "nodemailer";
import type { Pool } from "pg";
import { dstr, etb } from "../lib/format";

export interface Mail { to: string; subject: string; text: string }
export type Sender = (m: Mail) => Promise<void>;
export interface OutboxEvent { id: string; event_type: string; request_id: string | null; lease_token?: string | null; payload: { path?: string; week_start?: string; supplier_name?: string; person_name?: string; company_name?: string; request_no?: string; reason?: string; overdue_amount?: number | string; account_label?: string; balance?: number | string; reserved?: number | string; shortfall_amount?: number | string } }

/**
 * SMTP_URL, for example smtps://user:password@smtp.example.com:465. Without it, mails are printed to the console.
 * The timeouts keep one send well inside the five-minute lease, which is renewed before each recipient (nodemailer's own default is ten minutes).
 */
export function makeSender(): Sender {
  const url = process.env.SMTP_URL;
  if (!url) return async (m) => { console.log(`[mail] to=${m.to} subject=${m.subject}`); };
  const transport = nodemailer.createTransport({ url, connectionTimeout: 30_000, greetingTimeout: 30_000, socketTimeout: 60_000 } as Parameters<typeof nodemailer.createTransport>[0]); const from = process.env.MAIL_FROM ?? "ABIG Finance <no-reply@localhost>";
  return async (m) => { await transport.sendMail({ from, ...m }); };
}

const SUBJECTS: Record<string, (e: OutboxEvent) => string> = {
  REQUEST_SUBMITTED: (e) => `${e.payload.request_no} is waiting for verification`,
  REQUEST_RESTARTED: (e) => `${e.payload.request_no} changed and needs verification again`,
  REQUEST_VERIFIED: (e) => `${e.payload.request_no} is waiting for authorization`,
  REQUEST_AUTHORIZED: (e) => `${e.payload.request_no} is authenticated and ready to be paid`,
  REQUEST_RESCHEDULE_NEEDED: (e) => `${e.payload.request_no}: a due date was changed`,
  REQUEST_RETURNED: (e) => `${e.payload.request_no} was returned for correction`,
  REQUEST_REJECTED: (e) => `${e.payload.request_no} was rejected`,
  REQUEST_ADJUSTED: (e) => `${e.payload.request_no} was adjusted`,
  REQUEST_CANCELLED: (e) => `${e.payload.request_no} was cancelled`,
  REQUEST_OVERDUE: (e) => `${e.payload.request_no} has overdue payments`,
  ACCOUNT_SHORTFALL: (e) => `${e.payload.account_label} is in shortfall by ${etb(e.payload.shortfall_amount)}`,
  REQUEST_PAID: (e) => `${e.payload.request_no} is paid`,
  REQUEST_SCHEDULE_BLOCKED: (e) => `${e.payload.request_no} was not submitted on its scheduled date`,
  RECONCILIATION_SUBMITTED: (e) => `${e.payload.account_label}: the reconciliation for the week of ${dstr(e.payload.week_start)} is waiting for your review`,
  RECONCILIATION_RETURNED: (e) => `${e.payload.account_label}: the reconciliation for the week of ${dstr(e.payload.week_start)} was returned for changes`,
  RECONCILIATION_LOCKED: (e) => `${e.payload.account_label}: the reconciliation for the week of ${dstr(e.payload.week_start)} is locked`,
  ACCOUNT_OPENING_OVERDUE: (e) => `${e.payload.account_label}: the opening balance for the week of ${dstr(e.payload.week_start)} has not been entered`,
  SUPPLIER_BANK_DETAILS_PENDING: (e) => `${e.payload.supplier_name}: new bank details are waiting for verification`,
  PERSON_DETAILS_PENDING: (e) => `${e.payload.person_name}: new payment details are waiting for verification`,
  ACCOUNT_ACCESS_GRANTED: (e) => `${e.payload.company_name} can now use the account ${e.payload.account_label}`,
  ACCOUNT_ACCESS_WITHDRAWN: (e) => `${e.payload.company_name} can no longer use the account ${e.payload.account_label}`,
  USER_LOCKED: () => "Your ABIG Finance account is locked after repeated failed sign-ins",
  PASSWORD_RESET_COMPLETED: () => "Your ABIG Finance password was changed",
};
/** Extra lines for some events. */
const NOTES: Record<string, string[]> = {
  REQUEST_AUTHORIZED: ["The amount is now deducted from the account's system balance. It is marked Paid when the weekly reconciliation matches it to the bank statement."],
  REQUEST_SCHEDULE_BLOCKED: ["It stays Scheduled and nothing is reserved. It is tried again automatically; you can also change it or cancel it. You are not told again."],
  REQUEST_RESCHEDULE_NEEDED: ["Only the due date changed: the request keeps its approvals and its reserved funds, and nothing else is needed."],
  USER_LOCKED: ["It unlocks by itself after a few minutes. If it was not you trying to sign in, tell a system administrator."],
  PASSWORD_RESET_COMPLETED: ["You replaced the temporary password an administrator gave you. If this was not you, tell a system administrator now."],
  ACCOUNT_OPENING_OVERDUE: ["Balance checks on this account are refused until the week's opening balance is entered."],
};
export function compose(e: OutboxEvent, appUrl: string): { subject: string; text: string } {
  const subject = (SUBJECTS[e.event_type] ?? (() => `Update on ${e.payload.request_no}`))(e);
  const lines = ["Hello,", "", subject + "."];
  if (e.payload.reason) lines.push("", `Reason: ${e.payload.reason}`);
  if (e.payload.overdue_amount) lines.push("", `Overdue amount: ${etb(e.payload.overdue_amount)}`);
  if (e.event_type === "ACCOUNT_SHORTFALL") lines.push("", `Balance: ${etb(e.payload.balance)}`, `Reserved: ${etb(e.payload.reserved)}`, "New submissions on this account are blocked until the shortfall is cleared.");
  if (NOTES[e.event_type]) lines.push("", ...NOTES[e.event_type]);
  lines.push("", `Open it: ${appUrl.replace(/\/$/, "")}${e.request_id ? `/requests/${e.request_id}` : e.payload.path ?? "/accounts"}`, "", "ABIG Finance");
  return { subject, text: lines.join("\n") };
}

/** Claims a batch and delivers each event. Returns how many events were claimed. */
export async function tick(pool: Pool, send: Sender, appUrl: string): Promise<number> {
  const { rows } = await pool.query<OutboxEvent>("SELECT * FROM outbox_claim(20)");
  for (const e of rows) await deliver(pool, send, appUrl, e);
  return rows.length;
}

/**
 * One event. Recipients are resolved at this moment, so revoked access is respected. Each recipient is recorded on its own: one who was sent the
 * email on an earlier attempt is skipped, so a retry after a partial failure reaches only those still waiting. Everything is recorded under the
 * claim's lease token; if another worker has since claimed the event, the database answers LOST and this worker stops without recording anything.
 */
async function deliver(pool: Pool, send: Sender, appUrl: string, e: OutboxEvent) {
  const token = e.lease_token ?? null;
  try {
    const { rows: people } = await pool.query<{ user_id: string; email: string }>("SELECT user_id, email FROM outbox_recipients($1)", [e.id]);
    const { subject, text } = compose(e, appUrl);
    const problems: string[] = [];
    for (const p of people) {
      const step = (await pool.query<{ s: string }>("SELECT outbox_begin_delivery($1,$2,$3,$4) AS s", [e.id, token, p.user_id, p.email])).rows[0].s;
      if (step === "LOST") return;
      if (step === "SKIP") continue;
      if (step === "BUSY") { problems.push(`${p.email}: an earlier attempt may still be sending`); continue; }
      try { await send({ to: p.email, subject, text }); }
      catch (err) { problems.push(`${p.email}: ${String(err)}`); await pool.query("SELECT outbox_record_delivery($1,$2,$3,$4)", [e.id, token, p.user_id, String(err)]); continue; }
      await pool.query("SELECT outbox_record_delivery($1,$2,$3,NULL)", [e.id, token, p.user_id]);
    }
    // No recipients at all ends as NO_RECIPIENTS, not as delivered; the database decides from what was actually sent.
    if (problems.length > 0) await pool.query("SELECT outbox_fail($1,$2,$3)", [e.id, token, problems.join("; ")]);
    else await pool.query("SELECT outbox_finish($1,$2)", [e.id, token]);
  } catch (err) {
    await pool.query("SELECT outbox_fail($1,$2,$3)", [e.id, token, String(err)]).catch(() => {});
  }
}
