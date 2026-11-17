import type { Pool } from "pg";
import { resolveMail, senderFor, type EmailSettingsRow, type Mail, type Sender } from "../lib/mail-settings";
import { compose, type OutboxEvent } from "../lib/notification-text";

// The wording lives in lib/notification-text.ts, shared with the in-app bell; it is re-exported here for existing callers.
export { compose, type OutboxEvent };

export type { Mail, Sender };

/**
 * How the worker sends. With a database pool, the settings a system administrator saved are used, and checked again every 30 seconds so that a change
 * on the Administration screen takes effect without a restart. With none saved (or without a pool) it is the environment, as before: SMTP_URL, for
 * example smtps://user:password@smtp.example.com:465, and MAIL_FROM. Without either, mails are printed to the console.
 * A saved configuration that cannot be used (its password cannot be decrypted with this server's key) fails the send, so the outbox retries and the
 * failure shows on the notification monitor; it never falls back silently to another mail server.
 */
export function makeSender(pool?: Pool, env: Record<string, string | undefined> = process.env, refreshMs = 30_000): Sender {
  let current = senderFor(resolveMail(null, env)), stamp = "ENV", checked = 0;
  if (!pool) return current.send;
  return async (m) => {
    if (Date.now() - checked >= refreshMs) {
      let row: EmailSettingsRow | null = null;
      try { row = (await pool.query<EmailSettingsRow>("SELECT * FROM worker_email_settings()")).rows[0] ?? null; }
      catch (e) { if ((e as { code?: string }).code !== "42883") throw e; }   // a database not yet migrated has no saved settings: the environment is used
      const next = row ? `SAVED ${new Date(row.updated_at ?? 0).toISOString()}` : "ENV";
      if (next !== stamp) { const made = senderFor(resolveMail(row, env)); current.close(); current = made; stamp = next; }
      checked = Date.now();
    }
    await current.send(m);
  };
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
