import { Pool, types } from "pg";
import { TIME_ZONE } from "./format";

// A DATE is a calendar day, not a moment: keep it as text so that no time zone can move it to the day before.
types.setTypeParser(types.builtins.DATE, (v) => v);

// DATABASE_URL must be the abig_app login (NOBYPASSRLS). Never run the app as the owner role.
const g = globalThis as unknown as { pool?: Pool };
export const pool = g.pool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== "production") g.pool = pool;

export interface Tx { q<T = any>(sql: string, params?: unknown[]): Promise<T[]> }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One transaction with the authenticated user set for row-level security. The setting is transaction-local, so it cannot leak across pooled connections. */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(userId)) throw new Error("Invalid user id");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('TimeZone', $2, true)", [userId, TIME_ZONE]);  // current_date and date filters mean today in Addis Ababa
    const out = await fn({ q: async (sql, params) => (await client.query(sql, params as unknown[])).rows });
    await client.query("COMMIT");
    return out;
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  finally { client.release(); }
}
