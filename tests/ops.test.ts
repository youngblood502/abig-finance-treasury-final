import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { ADMIN_URL, actAs, authorized, fn, mk, rows, user } from "./helpers";
import { hashPassword } from "../ops/hash.mjs";
import { verifyPassword } from "../src/lib/crypto";

const root = join(__dirname, "..");
const DB = "abig_test_ops"; const url = (db: string) => { const u = new URL(ADMIN_URL); u.pathname = "/" + db; return u.toString(); };
let admin: Client; let owner: Client;
const run = (script: string, ...args: string[]) => spawnSync("node", [join(root, "ops", script), ...args], { env: { ...process.env, MIGRATION_DATABASE_URL: url(DB) }, encoding: "utf8" });

beforeAll(async () => {
  admin = new Client({ connectionString: ADMIN_URL }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.query(`CREATE DATABASE ${DB}`);
});
afterAll(async () => { await owner?.end(); await admin?.end(); });

describe("migration runner", () => {
  it("shows pending work, applies everything once, and is safe to run again", () => {
    expect(run("migrate.mjs", "--status").stdout).toMatch(/pending\s+20261012000000_foundation/);
    const first = run("migrate.mjs"); expect(first.status).toBe(0); expect(first.stdout).toContain("applying 20261020000000_production ... done"); expect(first.stdout).toContain("up to date");
    const again = run("migrate.mjs"); expect(again.status).toBe(0); expect(again.stdout).not.toContain("applying");
    expect(run("migrate.mjs", "--status").stdout).not.toContain("pending");
  });
  it("can set the application roles' passwords, and refuses weak ones", async () => {
    const o = new Client({ connectionString: url(DB) }); await o.connect();
    const weak = spawnSync("node", [join(root, "ops", "migrate.mjs")], { env: { ...process.env, MIGRATION_DATABASE_URL: url(DB), APP_DB_PASSWORD: "short" }, encoding: "utf8" }); expect(weak.status).toBe(1);
    const good = spawnSync("node", [join(root, "ops", "migrate.mjs")], { env: { ...process.env, MIGRATION_DATABASE_URL: url(DB), APP_DB_PASSWORD: "a-long-random-password-1", AUTH_DB_PASSWORD: "o'quote\"tricky-password-2", WORKER_DB_PASSWORD: "a-long-random-password-3" }, encoding: "utf8" });
    expect(good.status).toBe(0); expect(good.stdout).toContain("login enabled for abig_auth");
    expect((await o.query("SELECT rolname FROM pg_roles WHERE rolname IN ('abig_app','abig_auth','abig_worker') AND rolcanlogin ORDER BY 1")).rows.map((r) => r.rolname)).toEqual(["abig_app", "abig_auth", "abig_worker"]);
    await o.end();
  });
  it("refuses to continue if an applied migration was edited", async () => {
    owner = new Client({ connectionString: url(DB) }); await owner.connect();
    await owner.query("UPDATE schema_migrations SET checksum = 'tampered' WHERE name = '20261012000000_foundation'");
    const r = run("migrate.mjs"); expect(r.status).toBe(1); expect(r.stderr).toMatch(/was changed after it was applied/);
    await owner.query("UPDATE schema_migrations SET checksum = (SELECT encode(sha256(convert_to($1,'UTF8')),'hex')) WHERE name = '20261012000000_foundation'", [readFileSync(join(root, "prisma/migrations/20261012000000_foundation/migration.sql"), "utf8")]);
    expect(run("migrate.mjs").status).toBe(0);
  });
});

describe("first administrator", () => {
  it("creates one with a temporary password that the app can verify, and refuses a duplicate", async () => {
    const r = run("bootstrap-admin.mjs", "first.admin@example.com", "First", "Admin"); expect(r.status).toBe(0);
    const pw = /password: (\S+)/.exec(r.stdout)![1];
    const u = (await rows(owner, "SELECT is_system_admin, must_change_password, password_hash FROM users WHERE email='first.admin@example.com'"))[0];
    expect(u).toMatchObject({ is_system_admin: true, must_change_password: true });
    expect(await verifyPassword(pw, u.password_hash)).toBe(true); expect(await verifyPassword(pw + "x", u.password_hash)).toBe(false);
    expect(run("bootstrap-admin.mjs", "first.admin@example.com", "First", "Admin").status).toBe(1);
  });
  it("uses the same password format as the app", async () => { expect(await verifyPassword("a long enough phrase", await hashPassword("a long enough phrase"))).toBe(true); });
});

describe("money integrity checks", () => {
  const sql = readFileSync(join(root, "ops/verify-integrity.sql"), "utf8").replace(/^\\set.*$/m, "");
  const check = async () => Object.fromEntries((await owner.query(sql)).rows.map((r) => [r.name, Number(r.violations)]));
  it("are clean on healthy data (after reserving, verifying and authenticating payments)", async () => {
    await owner.query("ALTER ROLE abig_app LOGIN PASSWORD 'app'");
    await owner.query(readFileSync(join(root, "prisma/seed.sql"), "utf8"));
    await owner.query("BEGIN");
    await authorized(owner, { amounts: [600, 400] });                       // paid: the account was debited
    await actAs(owner, user.meron); const id = await mk(owner, user.meron, { amounts: [300] }); await fn(owner, "wf_submit", id);   // holds reserved funds
    await owner.query("COMMIT");
    const r = await check(); expect(Object.values(r).every((v) => v === 0)).toBe(true); expect(Object.keys(r).length).toBeGreaterThanOrEqual(12);
  });
  it("catch tampering that bypasses the application", async () => {
    await owner.query("BEGIN"); await owner.query("SET LOCAL session_replication_role = replica"); // switches the safeguards off, as a careless DBA could
    await owner.query("UPDATE payment_requests SET total_amount = total_amount + 1 WHERE workflow_state = 'AUTHENTICATED'");
    await owner.query("UPDATE company_bank_accounts SET reserved_balance = reserved_balance + 5");
    await owner.query("UPDATE company_bank_accounts SET current_balance = current_balance + 7 WHERE id = 'b0000000-0000-4000-8000-000000000002'");
    await owner.query("ALTER TABLE payment_requests DROP CONSTRAINT payment_requests_verifier_chk");   // the table rule itself refuses this; the check is the second line of defence
    await owner.query("UPDATE payment_requests SET created_by = verified_by WHERE workflow_state = 'AUTHENTICATED'");
    const r = await check(); await owner.query("ROLLBACK");
    expect(r["request total differs from its installments"]).toBeGreaterThan(0);
    expect(r["account whose reserved balance differs from its reserved and verified requests"]).toBeGreaterThan(0);
    expect(r["account whose last history entry differs from its current balance"]).toBeGreaterThan(0);
    expect(r["authenticated request not debited exactly once"]).toBeGreaterThan(0);
    expect(r["separation of duties broken (creator, verifier and authenticator are not three different people)"]).toBeGreaterThan(0);
  });
});
