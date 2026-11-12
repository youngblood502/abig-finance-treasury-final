import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { actAs, ASKU, authorized, BERBERO, CBE, fails, fn, mk, rows, S_HAWASSA, setupDb, user } from "./helpers";

// Phase 6 Task 4: the old engine is removed by 20261110000400_remove_legacy_engine as part of a fresh installation. setupDb creates a new database
// and applies every migration from the beginning, as ops/migrate.mjs does on the new server.
const LEGACY = ["cash_reservations", "cash_ledger_entries", "payment_transactions", "payment_reversals", "bank_balance_snapshots", "account_use_approvals"];
const FUNCTIONS = ["treasury_confirm_schedule", "treasury_schedule_queue", "treasury_recommend", "treasury_reserve", "treasury_release", "treasury_record_payment",
  "treasury_reverse_payment", "treasury_manual_movement", "treasury_release_orphaned", "treasury_enqueue_overdue", "report_outstanding", "report_payments",
  "installment_balances", "installment_outstanding", "account_forecast", "_forecast", "account_cash_position", "_cash_position", "assert_account_use",
  "access_revoked_release", "reservation_guard", "snapshot_audit"];
const MIGRATION = "20261110000400_remove_legacy_engine";
let owner: Client;
beforeAll(async () => { owner = (await setupDb("abig_test_fresh_install")).owner; });
afterAll(async () => { await owner?.end(); });

const tableCount = async (c: Client, names: string[]) => (await rows(c, "SELECT count(*)::int n FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND relname = ANY($1)", [names]))[0].n;
const integrity = async (c: Client) => (await c.query(readFileSync(join(__dirname, "../ops/verify-integrity.sql"), "utf8").replace(/^\\set.*$/m, ""))).rows.filter((r) => Number(r.violations) > 0);
async function tx<T>(f: (c: Client) => Promise<T>): Promise<T> { await owner.query("BEGIN"); try { return await f(owner); } finally { await owner.query("ROLLBACK"); } }

describe("a fresh installation", () => {
  it("has no legacy tables, functions, trigger or type", async () => {
    expect(await tableCount(owner, LEGACY)).toBe(0);
    expect(await rows(owner, "SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1)", [FUNCTIONS])).toEqual([]);
    expect(await rows(owner, "SELECT tgname FROM pg_trigger WHERE tgname = 'account_access_release'")).toEqual([]);
    expect(await rows(owner, "SELECT typname FROM pg_type WHERE typname = 'cash_position'")).toEqual([]);
  });
  it("keeps the tables and functions that were not part of the removal", async () => {
    expect(await tableCount(owner, ["cash_forecast_items", "idempotency_keys", "removed_owner_approval_settings"])).toBe(3);
    expect((await rows(owner, "SELECT count(*)::int n FROM pg_proc WHERE proname IN ('forecast_add','forecast_cancel','forecast_guard','forbid_mutation')"))[0].n).toBe(4);
  });
  it("passes the integrity checks", async () => { expect(await integrity(owner)).toEqual([]); });
  it("the migration is in the normal sequence and nothing is left outside it", () => {
    const dirs = require("node:fs").readdirSync(join(__dirname, "../prisma/migrations")) as string[];
    expect(dirs).toContain(MIGRATION);
    // Later migrations may follow, but none of them names a removed table, function, trigger or type (SQL names ignore case). The test above,
    // on a fresh installation with every migration applied, is what proves none of them exists again.
    const removed = [...LEGACY, ...FUNCTIONS, "account_access_release", "cash_position"];
    const later = dirs.filter((d) => d > MIGRATION && !d.endsWith(".toml")).map((d) => [d, readFileSync(join(__dirname, "../prisma/migrations", d, "migration.sql"), "utf8")] as const);
    expect(later.flatMap(([d, sql]) => removed.filter((n) => new RegExp(`\\b${n}\\b`, "i").test(sql)).map((n) => `${d}: ${n}`))).toEqual([]);
    expect(require("node:fs").existsSync(join(__dirname, "../ops/pending/remove-legacy-engine.sql"))).toBe(false);
  });
});

describe("the current workflow on a fresh installation", () => {
  it("submits, verifies, authenticates and records a payment", async () => {
    await tx(async (c) => {
      const { id } = await authorized(c, { company: BERBERO, amounts: [500], method: "TRANSFER" });
      await actAs(c, user.nardos); await fn(c, "record_execution", id, null, "FT-FRESH-1");
      const r = (await rows(c, "SELECT workflow_state::text s, bank_reference FROM payment_requests WHERE id = $1", [id]))[0];
      expect(r).toEqual({ s: "AUTHENTICATED", bank_reference: "FT-FRESH-1" });
      expect(await integrity(c)).toEqual([]);
    });
  });
  it("withdraws a company's access to a shared account (the old trigger is gone), and still refuses while funds are held", async () => {
    await tx(async (c) => {
      await actAs(c, user.abebe);
      await c.query("UPDATE company_bank_account_access SET revoked_at = now() WHERE account_id = $1 AND company_id = $2", [CBE, BERBERO]);
      expect(await rows(c, "SELECT 1 FROM company_bank_account_access WHERE account_id = $1 AND company_id = $2 AND revoked_at IS NULL", [CBE, BERBERO])).toEqual([]);
      // ASKU holds funds on CBE: withdrawing its access is refused, as before.
      await actAs(c, user.meron); const held = await mk(c, user.meron, { amounts: [800], account: CBE }); await fn(c, "wf_submit", held);
      await actAs(c, user.abebe);
      expect(await fails(c, "UPDATE company_bank_account_access SET revoked_at = now() WHERE account_id = $1 AND company_id = $2", [CBE, ASKU])).toMatch(/hold|held|reserved/i);
    });
  });
  it("schedules and releases a payment, generates a recurring Draft, and notifies in the bell", async () => {
    await tx(async (c) => {
      const today = (await rows(c, "SELECT addis_day(clock_timestamp())::text d"))[0].d as string;
      const plus = (n: number) => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
      const clock = (day: string) => c.query(`CREATE OR REPLACE FUNCTION treasury_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $f$ SELECT '${day}T09:00:00+03:00'::timestamptz $f$`);
      await clock(today);
      await actAs(c, user.meron); const s = await mk(c, user.meron, { amounts: [900], dues: [plus(20)] }); await fn(c, "wf_schedule", s, plus(2));
      const t = await fn(c, "recurring_template_save", null, ASKU, "Fresh rent", "SUPPLIER", S_HAWASSA, "b0000000-0000-4000-8000-000000000002", "TRANSFER", 1000, false, "MONTHLY", plus(2), null, 0, "NORMAL", null);
      await clock(plus(2));
      expect(Number(await fn(c, "release_scheduled_requests"))).toBe(1);
      expect(Number(await fn(c, "generate_recurring_requests"))).toBe(1);
      expect((await rows(c, "SELECT workflow_state::text s FROM payment_requests WHERE id = $1", [s]))[0].s).toBe("RESERVED");
      expect((await rows(c, "SELECT workflow_state::text s FROM payment_requests WHERE recurring_template_id = $1", [t]))[0].s).toBe("DRAFT");
      expect(Number(await fn(c, "fan_out_notifications", 200))).toBeGreaterThanOrEqual(2);
      expect((await rows(c, "SELECT u.email FROM user_notifications n JOIN users u ON u.id = n.user_id WHERE n.request_id = $1 ORDER BY 1", [s])).map((r) => r.email)).toEqual(["dawit@abig.test", "yared@abig.test"]);
      expect(await integrity(c)).toEqual([]);
    });
  });
});

describe("the migration's own safety checks", () => {
  it("refuses, and changes nothing, if a legacy table holds a row; runs once it is empty", async () => {
    const d = await setupDb("abig_test_legacy_guard", { before: MIGRATION });
    try {
      expect(await tableCount(d.owner, LEGACY)).toBe(6);
      await d.owner.query("ALTER TABLE bank_balance_snapshots DISABLE TRIGGER USER");
      const cols = await rows(d.owner, "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'bank_balance_snapshots' AND is_nullable = 'NO' AND column_default IS NULL");
      const vals = cols.map((k) => (k.column_name === "account_id" ? `'${CBE}'` : k.column_name === "entered_by" ? `'${user.samuel}'` : k.data_type.includes("time") ? "now()" : k.data_type === "date" ? "current_date" : k.data_type === "numeric" ? "1" : "'X'"));
      await d.owner.query(`INSERT INTO bank_balance_snapshots (${cols.map((k) => k.column_name).join(",")}) VALUES (${vals.join(",")})`);
      await expect(d.migrateRest()).rejects.toThrow(/legacy table bank_balance_snapshots still has 1 row/);
      expect(await tableCount(d.owner, LEGACY)).toBe(6);   // nothing was dropped
      expect(await rows(d.owner, "SELECT 1 FROM pg_trigger WHERE tgname = 'account_access_release'")).toHaveLength(1);
      await d.owner.query("DELETE FROM bank_balance_snapshots");
      await d.migrateRest();
      expect(await tableCount(d.owner, LEGACY)).toBe(0);
    } finally { await d.owner.end(); }
  }, 30_000);   // builds and migrates a whole database inside the test: about 6.5s, past the 5s default
  it("refuses if an unexpected function still uses a legacy table", async () => {
    const d = await setupDb("abig_test_legacy_guard2", { before: MIGRATION });
    try {
      await d.owner.query("CREATE FUNCTION still_uses_old() RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) FROM cash_reservations $$");
      await expect(d.migrateRest()).rejects.toThrow(/unexpected functions still use the legacy tables: still_uses_old\(\)/);
      expect(await tableCount(d.owner, LEGACY)).toBe(6);
    } finally { await d.owner.end(); }
  }, 30_000);   // builds and migrates a whole database inside the test: about 6.5s, past the 5s default
});
