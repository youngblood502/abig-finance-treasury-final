import nodemailer from "nodemailer";
import type { Pool } from "pg";
import { compose, type OutboxEvent } from "../lib/notification-text";

// The wording lives in lib/notification-text.ts, shared with the in-app bell; it is re-exported here for existing callers.
export { compose, type OutboxEvent };

export interface Mail { to: string; subject: string; text: string }
export type Sender = (m: Mail) => Promise<void>;

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
