#!/usr/bin/env node
// The development server for previews (an AI assistant's browser pane, a demo), held to the isolated test server. It never reads .env's database settings:
// every database URL comes from .env.preview, is checked to name the test server (127.0.0.1:55432, an abig_test_* database) and the server's identity is
// proved over a connection before the app starts. Every other database variable is pinned to an address that cannot connect, so the values in .env
// (Next.js loads that file too, but never over a variable that is already set) cannot reach a development or production database.
//
//   node ops/preview-dev.mjs setup   (re)create abig_test_preview on the test server: every migration, then the seed; writes .env.preview
//   node ops/preview-dev.mjs         check everything above, then run `next dev` on port 3000
//
// The test server must be running (npm run testdb:start). Nothing here connects anywhere else.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import pg from "pg";
import { assertPreviewUrl, assertTestDbName, assertTestServer, assertTestServerUrl, previewEnv, TEST_PG_HOST, TEST_PG_MARKER_FILE, TEST_PG_PORT, TestServerSafetyError } from "./test-db-safety.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREVIEW_DB = assertTestDbName("abig_test_preview");
const PREVIEW_FILE = join(root, ".env.preview");
const URL_KEYS = ["DATABASE_URL", "AUTH_DATABASE_URL", "WORKER_DATABASE_URL"];
// The disposable test server's role passwords: the same ones the automated tests set, so neither breaks the other. Never used outside that server.
const ROLE_LOGINS = { DATABASE_URL: ["abig_app", "app"], AUTH_DATABASE_URL: ["abig_auth", "auth"], WORKER_DATABASE_URL: ["abig_worker", "w"] };

const fail = (m) => { throw new TestServerSafetyError(m); };
const readEnvFile = (file, hint) => { if (!existsSync(file)) fail(`${file} does not exist (${hint})`); return parseEnv(readFileSync(file, "utf8")); };

/** Connects as the test server's superuser (from .env.test only) and proves it is that server. Returns the admin URL. */
async function provenAdminUrl() {
  const url = assertTestServerUrl(readEnvFile(join(root, ".env.test"), "run `npm run testdb:init`").TEST_ADMIN_URL).toString();
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try { await c.connect(); } catch (e) { fail(`cannot reach the test server (${e.message}); start it with \`npm run testdb:start\``); }
  try { await assertTestServer(c, { markerExists: (dir) => existsSync(join(dir, TEST_PG_MARKER_FILE)) }); } finally { await c.end().catch(() => {}); }
  return url;
}
const onDb = (adminUrl, db) => { const u = new URL(adminUrl); u.pathname = `/${assertTestDbName(db)}`; return u.toString(); };

async function setup() {
  const adminUrl = await provenAdminUrl();
  const admin = new pg.Client({ connectionString: adminUrl }); await admin.connect();
  try { await admin.query(`DROP DATABASE IF EXISTS ${PREVIEW_DB} WITH (FORCE)`); await admin.query(`CREATE DATABASE ${PREVIEW_DB}`); } finally { await admin.end(); }
  const owner = new pg.Client({ connectionString: onDb(adminUrl, PREVIEW_DB) }); await owner.connect();
  try {
    const dir = join(root, "prisma/migrations");
    for (const m of readdirSync(dir).filter((d) => !d.endsWith(".toml")).sort()) await owner.query(readFileSync(join(dir, m, "migration.sql"), "utf8"));
    for (const [role, pw] of Object.values(ROLE_LOGINS)) await owner.query(`ALTER ROLE ${role} LOGIN PASSWORD ${owner.escapeLiteral(pw)}`);
    await owner.query(readFileSync(join(root, "prisma/seed.sql"), "utf8"));
  } finally { await owner.end(); }
  const lines = URL_KEYS.map((k) => { const u = new URL(onDb(adminUrl, PREVIEW_DB)); [u.username, u.password] = ROLE_LOGINS[k]; return `${k}=${u}`; });
  writeFileSync(PREVIEW_FILE, `# Written by \`node ops/preview-dev.mjs setup\`. The preview's databases, on the disposable test server only.\n${lines.join("\n")}\n`);
  console.log(`preview: ${PREVIEW_DB} created on the test server and ${PREVIEW_FILE} written`);
}

async function run() {
  const file = readEnvFile(PREVIEW_FILE, "run `npm run preview:setup`");
  const urls = Object.fromEntries(URL_KEYS.map((k) => [k, assertPreviewUrl(k, file[k]).toString()]));
  await provenAdminUrl();
  // Each preview URL must reach the test server's preview database, as its role.
  for (const [k, url] of Object.entries(urls)) {
    const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
    try { await c.connect(); const r = (await c.query("SELECT current_setting('abig.instance', true) AS i, inet_server_port() AS p, current_database() AS d")).rows[0];
      if (r.i !== "test" || Number(r.p) !== TEST_PG_PORT) fail(`${k} does not reach the isolated test server`); assertTestDbName(r.d); }
    catch (e) { if (e instanceof TestServerSafetyError) throw e; fail(`${k} cannot connect (${e.message}); run \`node ops/preview-dev.mjs setup\``); }
    finally { await c.end().catch(() => {}); }
  }
  const env = previewEnv(process.env, urls);
  console.log(`preview: every database variable checked; starting next dev on ${PREVIEW_DB} (test server ${TEST_PG_HOST}:${TEST_PG_PORT})`);
  const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-p", "3000"], { cwd: root, env, stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

(process.argv[2] === "setup" ? setup() : run()).catch((e) => { console.error(e.message); process.exit(1); });
