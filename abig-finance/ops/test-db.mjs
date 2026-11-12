#!/usr/bin/env node
// The disposable PostgreSQL 18 server the automated tests run on. It is separate from every development or production server: its own data
// directory (outside the repository), its own superuser and generated password, port 55432 on 127.0.0.1 only, and an identity marker the tests
// check before every run. It is started by hand, never as a Windows service, and nothing here reads .env or any other server's credentials.
//
//   node ops/test-db.mjs init     create the server's data directory and write .env.test (refuses if the directory is not empty)
//   node ops/test-db.mjs start    start it (waits until it accepts connections, then checks it)
//   node ops/test-db.mjs stop     stop it
//   node ops/test-db.mjs status   show whether it runs, and check its identity, port, user and databases
//   node ops/test-db.mjs reset    stop it, delete its data directory (only if it carries the marker), then init and start again
//
// TEST_PG_DATA overrides the data directory; PG_BIN overrides where the PostgreSQL 18 programs are.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import pg from "pg";
import {
  assertTestServer, assertTestServerUrl, TEST_PG_ADMIN_DB, TEST_PG_HOST, TEST_PG_INSTANCE, TEST_PG_MARKER_FILE, TEST_PG_PORT, TEST_PG_SUPERUSER,
} from "./test-db-safety.mjs";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = resolve(APP_DIR, "..");
const ENV_FILE = join(APP_DIR, ".env.test");
const WIN = process.platform === "win32";
const DATA_DIR = resolve(process.env.TEST_PG_DATA ?? join(WIN ? process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local") : process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "abig-fms", "test-pg"));
const LOG_FILE = join(dirname(DATA_DIR), "test-pg.log");
const BIN_DIR = process.env.PG_BIN ?? (WIN ? "C:\\Program Files\\PostgreSQL\\18\\bin" : null);
const MARKER = join(DATA_DIR, TEST_PG_MARKER_FILE);

const stop = (msg) => { console.error(`test-db: ${msg}`); process.exit(1); };
const say = (msg) => console.log(`test-db: ${msg}`);
const exe = (name) => (BIN_DIR ? join(BIN_DIR, WIN ? `${name}.exe` : name) : name);
const run = (name, args, opts = {}) => spawnSync(exe(name), args, { encoding: "utf8", windowsHide: true, ...opts });

/** The data directory must be outside the repository, so nothing in it is ever committed, watched or scanned. */
function checkDataDir() {
  const rel = relative(REPO_DIR, DATA_DIR);
  if (!rel.startsWith("..") && !isAbsolute(rel)) stop(`the data directory ${DATA_DIR} is inside the repository; set TEST_PG_DATA to a folder outside it`);
}
/** The PostgreSQL 18 programs this script uses, checked before anything is created or started. */
function checkBinaries() {
  for (const name of ["initdb", "pg_ctl"]) {
    const r = run(name, ["--version"]);
    if (r.error || r.status !== 0) stop(`cannot run ${exe(name)}${r.error ? ` (${r.error.message})` : ""}; set PG_BIN to PostgreSQL 18's bin folder`);
    if (!/\(PostgreSQL\) 18\./.test(r.stdout)) stop(`${exe(name)} is not PostgreSQL 18: ${r.stdout.trim()}`);
  }
}
const portInUse = (port) => new Promise((res) => {
  const s = createConnection({ host: TEST_PG_HOST, port }); s.setTimeout(1500);
  s.once("connect", () => { s.destroy(); res(true); }); s.once("timeout", () => { s.destroy(); res(false); }); s.once("error", () => res(false));
});
/** 0 running, 3 not running, 4 no data directory: pg_ctl's own answer. */
const pgStatus = () => run("pg_ctl", ["status", "-D", DATA_DIR]).status;
const hasMarker = () => existsSync(MARKER);
const dataDirEmpty = () => !existsSync(DATA_DIR) || readdirSync(DATA_DIR).length === 0;

function readTestUrl() {
  if (!existsSync(ENV_FILE)) stop(`${ENV_FILE} does not exist; run \`npm run testdb:init\``);
  return parseEnv(readFileSync(ENV_FILE, "utf8")).TEST_ADMIN_URL;
}

/** Connects once with .env.test and checks the server. Any failure stops here; no other server is tried. */
async function verify() {
  const url = assertTestServerUrl(readTestUrl());
  const c = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
  try {
    await c.connect();
    return await assertTestServer(c, { markerExists: (dir) => existsSync(join(dir, TEST_PG_MARKER_FILE)) });
  } finally { await c.end().catch(() => {}); }
}

async function init() {
  checkDataDir(); checkBinaries();
  if (!dataDirEmpty()) stop(`${DATA_DIR} is not empty; use \`npm run testdb:reset\` to recreate it`);
  if (await portInUse(TEST_PG_PORT)) stop(`something already listens on ${TEST_PG_HOST}:${TEST_PG_PORT}; stop it first`);
  mkdirSync(DATA_DIR, { recursive: true });
  // A new random password for this server only. It is written to a temporary file for initdb and to .env.test, and nowhere else.
  const password = randomBytes(24).toString("base64url");
  const tmp = mkdtempSync(join(tmpdir(), "abig-test-pg-"));
  try {
    writeFileSync(join(tmp, "pw"), password + "\n", { mode: 0o600 });
    const r = run("initdb", ["-D", DATA_DIR, "-U", TEST_PG_SUPERUSER, `--pwfile=${join(tmp, "pw")}`, "-A", "scram-sha-256", "-E", "UTF8", "--locale=C", "--no-instructions"]);
    if (r.status !== 0) stop(`initdb failed:\n${r.stdout}\n${r.stderr}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  appendFileSync(join(DATA_DIR, "postgresql.conf"), [
    "", "# ---- ABIG FMS disposable test server (written by ops/test-db.mjs) ----",
    `port = ${TEST_PG_PORT}`, `listen_addresses = '${TEST_PG_HOST}'`, `abig.instance = '${TEST_PG_INSTANCE}'`,
    "# Test data is thrown away, so durability is traded for speed.",
    "fsync = off", "synchronous_commit = off", "full_page_writes = off", "max_connections = 100", "",
  ].join("\n"));
  // Password logins from 127.0.0.1 only. No other address, socket or trust rule.
  writeFileSync(join(DATA_DIR, "pg_hba.conf"), `# ABIG FMS disposable test server: password logins from 127.0.0.1 only.\nhost all all ${TEST_PG_HOST}/32 scram-sha-256\n`);
  writeFileSync(MARKER, JSON.stringify({ purpose: "ABIG FMS disposable test server", port: TEST_PG_PORT, superuser: TEST_PG_SUPERUSER, created_at: new Date().toISOString() }, null, 2) + "\n");
  writeFileSync(ENV_FILE, [
    "# Generated by `npm run testdb:init`. The disposable test server only; never a development or production credential.",
    `TEST_ADMIN_URL=postgresql://${TEST_PG_SUPERUSER}:${password}@${TEST_PG_HOST}:${TEST_PG_PORT}/${TEST_PG_ADMIN_DB}`, "",
  ].join("\n"), { mode: 0o600 });
  say(`created ${DATA_DIR} and ${ENV_FILE}. Start it with \`npm run testdb:start\`.`);
}

async function start() {
  checkDataDir(); checkBinaries();
  if (!hasMarker()) stop(`${DATA_DIR} has no ${TEST_PG_MARKER_FILE} marker; run \`npm run testdb:init\` first`);
  if (pgStatus() === 0) { say("already running"); await status(); return; }
  if (await portInUse(TEST_PG_PORT)) stop(`something else listens on ${TEST_PG_HOST}:${TEST_PG_PORT}; stop it first`);
  // stdio is ignored: the server outlives this command and writes to its own log.
  const r = run("pg_ctl", ["start", "-D", DATA_DIR, "-l", LOG_FILE, "-w", "-t", "60"], { stdio: "ignore" });
  if (r.status !== 0) stop(`pg_ctl start failed; see ${LOG_FILE}`);
  say(`started (log: ${LOG_FILE})`);
  await status();
}

async function stopServer() {
  checkDataDir(); checkBinaries();
  if (!hasMarker()) stop(`${DATA_DIR} has no ${TEST_PG_MARKER_FILE} marker; nothing to stop here`);
  if (pgStatus() !== 0) { say("not running"); return; }
  const r = run("pg_ctl", ["stop", "-D", DATA_DIR, "-m", "fast", "-w", "-t", "60"]);
  if (r.status !== 0) stop(`pg_ctl stop failed:\n${r.stdout}\n${r.stderr}`);
  say("stopped");
}

async function status() {
  checkDataDir(); checkBinaries();
  const st = pgStatus();
  say(`data directory ${DATA_DIR}${hasMarker() ? "" : " (no marker)"}; ${st === 0 ? "running" : st === 4 ? "not initialised" : "not running"}`);
  if (st !== 0) process.exit(st === 4 ? 4 : 3);
  const s = await verify().catch((e) => stop(e.message));
  say(`identity abig.instance=${s.instance}, port ${s.port} on ${s.listen}, user ${s.user}, PostgreSQL ${Math.floor(s.version / 10000)}.${s.version % 10000}`);
  say(`databases: ${s.databases.join(", ")}`);
  say("all safety checks passed");
}

async function reset() {
  checkDataDir(); checkBinaries();
  if (existsSync(DATA_DIR) && !dataDirEmpty() && !hasMarker()) stop(`${DATA_DIR} is not empty and has no ${TEST_PG_MARKER_FILE} marker; refusing to delete it`);
  if (hasMarker() && pgStatus() === 0) await stopServer();
  if (await portInUse(TEST_PG_PORT)) stop(`something still listens on ${TEST_PG_HOST}:${TEST_PG_PORT}; refusing to delete the data directory`);
  if (existsSync(DATA_DIR)) { rmSync(DATA_DIR, { recursive: true, force: true }); say(`deleted ${DATA_DIR}`); }
  await init();
  await start();
}

const commands = { init, start, stop: stopServer, status, reset };
const cmd = process.argv[2];
if (!commands[cmd]) { console.error("Usage: node ops/test-db.mjs init|start|stop|status|reset"); process.exit(2); }
await commands[cmd]();
