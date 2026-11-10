// Background worker: `npm run worker`. Connects as abig_worker, which can only call the outbox and housekeeping functions.
import { Pool } from "pg";
import { makeSender, tick } from "./mail";

const pool = new Pool({ connectionString: process.env.WORKER_DATABASE_URL, max: 3 });
const send = makeSender(); const appUrl = process.env.APP_URL ?? "http://localhost:3000";
const log = (msg: string, extra: object = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));
const every = (ms: number, name: string, sql: string) => setInterval(() => pool.query(sql).then((r) => { const n = Object.values(r.rows[0])[0]; if (Number(n) > 0) log(name, { count: n }); }).catch((e) => log(name + " failed", { error: String(e) })), ms);

// Funds are released by the request itself (cancel, return, reject, authenticate), so there is nothing to sweep up any more.
every(60 * 60_000, "queued overdue reminders", "SELECT enqueue_overdue_requests()");
every(60 * 60_000, "queued missing opening balances", "SELECT enqueue_missing_openings()");
// Scheduled requests due today (Addis Ababa) are submitted, and their funds reserved, through the normal submission checks.
every(15 * 60_000, "submitted scheduled requests", "SELECT release_scheduled_requests()");
// Recurring payments: a Draft for each occurrence that has come. Never submitted, scheduled or reserved, and no email.
every(15 * 60_000, "created recurring drafts", "SELECT generate_recurring_requests()");
every(15 * 60_000, "purged expired sessions", "SELECT purge_expired_sessions()");
process.on("SIGTERM", () => { log("stopping"); pool.end().finally(() => process.exit(0)); });

(async function main() {
  log("worker started");
  for (;;) {
    try { if ((await tick(pool, send, appUrl)) === 0) await new Promise((r) => setTimeout(r, 5000)); }
    catch (e) { log("tick failed", { error: String(e) }); await new Promise((r) => setTimeout(r, 15000)); }
  }
})();
