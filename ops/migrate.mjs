#!/usr/bin/env node
// Applies the SQL migrations in prisma/migrations in order, once each, and refuses to continue if an applied one was edited.
//   node ops/migrate.mjs            apply what is pending
//   node ops/migrate.mjs --status   show what is applied
//   node ops/migrate.mjs --baseline mark every migration as applied (for a database that was set up by hand)
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) { console.error("Set MIGRATION_DATABASE_URL (the owner role)."); process.exit(2); }
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "prisma", "migrations");
const files = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sha = (s) => createHash("sha256").update(s).digest("hex");
const c = new pg.Client({ connectionString: url }); await c.connect();
try {
  await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  const applied = new Map((await c.query("SELECT name, checksum FROM schema_migrations")).rows.map((r) => [r.name, r.checksum]));
  const flag = process.argv[2];
  for (const name of files) {
    const sql = readFileSync(join(dir, name, "migration.sql"), "utf8"), sum = sha(sql);
    if (applied.has(name)) {
      if (applied.get(name) !== sum) { console.error(`STOP: ${name} was changed after it was applied. Never edit an applied migration; add a new one.`); process.exit(1); }
      if (flag === "--status") console.log(`applied  ${name}`);
      continue;
    }
    if (flag === "--status") { console.log(`pending  ${name}`); continue; }
    if (flag === "--baseline") { await c.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1,$2)", [name, sum]); console.log(`baselined ${name}`); continue; }
    process.stdout.write(`applying ${name} ... `);
    try { await c.query("BEGIN"); await c.query(sql); await c.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1,$2)", [name, sum]); await c.query("COMMIT"); console.log("done"); }
    catch (e) { await c.query("ROLLBACK"); console.error(`FAILED\n${e.message}`); process.exit(1); }
  }
  if (!flag) {
    // Optional: give the three application roles their login passwords (safe to repeat). Use long random values.
    for (const [role, envName] of [["abig_app", "APP_DB_PASSWORD"], ["abig_auth", "AUTH_DB_PASSWORD"], ["abig_worker", "WORKER_DB_PASSWORD"]]) {
      const pw = process.env[envName]; if (!pw) continue;
      if (pw.length < 16) { console.error(`${envName} must be at least 16 characters.`); process.exit(1); }
      await c.query(`ALTER ROLE ${role} LOGIN PASSWORD ${c.escapeLiteral(pw)}`); console.log(`login enabled for ${role}`);
    }
    console.log("Database is up to date.");
  }
} finally { await c.end(); }
