import nodemailer from "nodemailer";
import type { Pool } from "pg";

export interface Mail { to: string; subject: string; text: string }
export type Sender = (m: Mail) => Promise<void>;
export interface OutboxEvent { id: string; event_type: string; request_id: string; payload: { request_no?: string; reason?: string; overdue_amount?: number | string } }

/** SMTP_URL, for example smtps://user:password@smtp.example.com:465. Without it, mails are printed to the console. */
export function makeSender(): Sender {
  const url = process.env.SMTP_URL;
  if (!url) return async (m) => { console.log(`[mail] to=${m.to} subject=${m.subject}`); };
  const transport = nodemailer.createTransport(url); const from = process.env.MAIL_FROM ?? "ABIG Finance <no-reply@localhost>";
  return async (m) => { await transport.sendMail({ from, ...m }); };
}

const SUBJECTS: Record<string, (e: OutboxEvent) => string> = {
  REQUEST_SUBMITTED: (e) => `${e.payload.request_no} is waiting for verification`,
  REQUEST_RESTARTED: (e) => `${e.payload.request_no} changed and needs verification again`,
  REQUEST_VERIFIED: (e) => `${e.payload.request_no} is waiting for authorization`,
  REQUEST_AUTHORIZED: (e) => `${e.payload.request_no} is authorized and ready to be funded`,
  REQUEST_RESCHEDULE_NEEDED: (e) => `${e.payload.request_no}: a due date changed, please confirm funding again`,
  REQUEST_RETURNED: (e) => `${e.payload.request_no} was returned for correction`,
  REQUEST_REJECTED: (e) => `${e.payload.request_no} was rejected`,
  REQUEST_ADJUSTED: (e) => `${e.payload.request_no} was adjusted`,
  REQUEST_CANCELLED: (e) => `${e.payload.request_no} was cancelled`,
  REQUEST_OVERDUE: (e) => `${e.payload.request_no} has overdue payments`,
};
export function compose(e: OutboxEvent, appUrl: string): { subject: string; text: string } {
  const subject = (SUBJECTS[e.event_type] ?? (() => `Update on ${e.payload.request_no}`))(e);
  const lines = ["Hello,", "", subject + "."];
  if (e.payload.reason) lines.push("", `Reason: ${e.payload.reason}`);
  if (e.payload.overdue_amount) lines.push("", `Overdue amount: ETB ${Number(e.payload.overdue_amount).toLocaleString("en-US")}`);
  lines.push("", `Open it: ${appUrl.replace(/\/$/, "")}/requests/${e.request_id}`, "", "ABIG Finance");
  return { subject, text: lines.join("\n") };
}

/** Claims a batch, resolves recipients at this moment (so revoked access is respected), sends, and records the outcome. Returns how many events were claimed. */
export async function tick(pool: Pool, send: Sender, appUrl: string): Promise<number> {
  const { rows } = await pool.query<OutboxEvent>("SELECT * FROM outbox_claim(20)");
  for (const e of rows) {
    try {
      const { rows: people } = await pool.query<{ email: string }>("SELECT email FROM outbox_recipients($1)", [e.id]);
      const { subject, text } = compose(e, appUrl);
      for (const p of people) await send({ to: p.email, subject, text });
      await pool.query("SELECT outbox_complete($1)", [e.id]);
    } catch (err) { await pool.query("SELECT outbox_fail($1, $2)", [e.id, String(err)]); }
  }
  return rows.length;
}
