import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

export const ADMIN_URL = process.env.TEST_ADMIN_URL ?? "postgres://postgres:pw@127.0.0.1:5432/postgres";
const root = join(__dirname, "..");
const U = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const user = { admin: U(1), meron: U(2), lidya: U(3), hana: U(4), tigist: U(5), samuel: U(6), abebe: U(7), bereket: U(8), selam: U(9), dawit: U(10), kebede: U(11), yared: U(12), nardos: U(13), fikru: U(14) };
export const ASKU = "c0000000-0000-4000-8000-000000000001", BERBERO = "c0000000-0000-4000-8000-000000000002";
export const S_HAWASSA = "d0000000-0000-4000-8000-000000000001", S_ETHIO = "d0000000-0000-4000-8000-000000000002", S_ADDIS = "d0000000-0000-4000-8000-000000000003";
export const BERBERO_ID = BERBERO;
export const CBE = "b0000000-0000-4000-8000-000000000001", AWASH = "b0000000-0000-4000-8000-000000000002";
export const S_ETHIO_ID = "d0000000-0000-4000-8000-000000000002", BD_ETHIO = "e0000000-0000-4000-8000-000000000002";
export const BD_HAWASSA = "e0000000-0000-4000-8000-000000000001", BD_ADDIS = "e0000000-0000-4000-8000-000000000003";

const urlFor = (db: string, login?: [string, string]) => { const u = new URL(ADMIN_URL); u.pathname = `/${db}`; if (login) { u.username = login[0]; u.password = login[1]; } return u.toString(); };

/**
 * Creates a scratch database, applies the migrations in order, then the seed. Returns the owner connection and an `as` helper.
 * With `before`, migrations from that name on are held back until `migrateRest()`, to test how existing data moves forward.
 */
export async function setupDb(db: string, { before }: { before?: string } = {}) {
  const admin = new Client({ connectionString: ADMIN_URL }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${db}`); await admin.query(`CREATE DATABASE ${db}`); await admin.end();
  const owner = new Client({ connectionString: urlFor(db) }); await owner.connect();
  const dir = join(root, "prisma/migrations");
  const all = readdirSync(dir).filter((d) => !d.endsWith(".toml")).sort();
  const apply = async (names: string[]) => { for (const m of names) await owner.query(readFileSync(join(dir, m, "migration.sql"), "utf8")); };
  await apply(all.filter((m) => !before || m < before));
  await owner.query(`ALTER ROLE abig_app LOGIN PASSWORD 'app'`);
  await owner.query(`ALTER ROLE abig_worker LOGIN PASSWORD 'w'`);
  await owner.query(readFileSync(join(root, "prisma/seed.sql"), "utf8"));

  /** Run fn as an authenticated user inside a transaction that is always rolled back. */
  async function as<T>(id: string | null, fn: (c: Client) => Promise<T>): Promise<T> {
    const c = new Client({ connectionString: urlFor(db, ["abig_app", "app"]) }); await c.connect();
    try { await c.query("BEGIN"); if (id) await c.query("SELECT set_config('app.user_id', $1, true)", [id]); return await fn(c); }
    finally { await c.query("ROLLBACK").catch(() => {}); await c.end(); }
  }
  const migrateRest = () => apply(all.filter((m) => before && m >= before));
  return { owner, as, migrateRest, appUrl: urlFor(db, ["abig_app", "app"]), workerUrl: urlFor(db, ["abig_worker", "w"]) };
}
export const rows = async (c: Client, sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows;
export async function fails(c: Client, sql: string, p: unknown[] = []) {
  await c.query("SAVEPOINT s");
  try { await c.query(sql, p); } catch (e) { await c.query("ROLLBACK TO s"); return (e as Error).message; }
  throw new Error("expected the statement to fail: " + sql);
}
/** Switch the acting user inside an open transaction. */
export const actAs = (c: Client, id: string) => c.query("SELECT set_config('app.user_id', $1, true)", [id]);

import { randomUUID } from "node:crypto";
export const key = () => (randomUUID() + randomUUID()).replace(/-/g, "").slice(0, 64);
/** Calls a SQL function and returns its single value. */
export async function fn(c: Client, name: string, ...args: unknown[]) {
  return (await c.query(`SELECT ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) AS v`, args)).rows[0].v;
}
export interface MkOpts { ref?: string; company?: string; supplier?: string; bank?: string; account?: string | null; amounts?: number[]; dues?: string[]; priority?: string; method?: string }
/** Creates a complete draft (installments, invoice file) as `creator` and returns its id. Run inside as(creator, ...). */
export async function mk(c: Client, creator: string, opt: string | MkOpts = {}) {
  const o: MkOpts = typeof opt === "string" ? { ref: opt } : opt;
  const amounts = o.amounts ?? [600, 400];
  const company = o.company ?? ASKU;
  // A request names the account it is paid from: ASKU pays from its own Awash account, Berbero from the shared BEES CBE account.
  const account = o.account === undefined ? (company === BERBERO ? CBE : AWASH) : o.account;
  const id = (await c.query(`INSERT INTO payment_requests (debtor_company_id, supplier_id, supplier_bank_detail_id, debit_account_id, created_by, invoice_ref, invoice_date, total_amount, priority)
    VALUES ($1,$2,$3,$4,$5,$6,'2026-10-01',$7,$8) RETURNING id`, [company, o.supplier ?? S_HAWASSA, o.bank ?? BD_HAWASSA, account, creator, o.ref ?? "INV-" + randomUUID().slice(0, 8), amounts.reduce((a, b) => a + b, 0), o.priority ?? "NORMAL"])).rows[0].id as string;
  if (o.method) await c.query("UPDATE payment_requests SET payment_method = $2::payment_method WHERE id = $1", [id, o.method]);
  for (const [i, amt] of amounts.entries()) await c.query("INSERT INTO payment_installments (request_id, seq, due_date, amount) VALUES ($1,$2,$3::date,$4)", [id, i + 1, o.dues?.[i] ?? "2026-11-01", amt]);
  await c.query(`INSERT INTO attachments (request_id, kind, object_key, filename, mime_type, size_bytes, sha256, uploaded_by) VALUES ($1,'INVOICE',$2,'inv.pdf','application/pdf',1000,$3,$4)`, [id, key(), key(), creator]);
  return id;
}
/** Takes a new request all the way to AUTHENTICATED (debited, not yet paid). Returns the request id and its installment ids in order. */
export async function authorized(c: Client, o: MkOpts = {}) {
  const berbero = o.company === BERBERO;
  const [creator, verifier, authenticator] = berbero ? [user.nardos, user.fikru, user.hana] : [user.meron, user.dawit, user.kebede];
  await actAs(c, creator);
  const id = await mk(c, creator, { supplier: berbero ? S_ETHIO_ID : S_HAWASSA, bank: berbero ? BD_ETHIO : BD_HAWASSA, ...o });
  const v1 = await fn(c, "wf_submit", id);
  await actAs(c, verifier); const v2 = await fn(c, "wf_verify", id, v1);
  await actAs(c, authenticator); await fn(c, "wf_authorize", id, v2);
  const inst = (await c.query("SELECT id FROM payment_installments WHERE request_id=$1 ORDER BY seq", [id])).rows.map((r) => r.id as string);
  return { id, inst };
}
