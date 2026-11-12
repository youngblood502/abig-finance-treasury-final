// The isolated test server's identity and the checks that prove a connection reaches it and nothing else.
// Shared by ops/test-db.mjs (start, stop, reset, status) and the Vitest setup (before every test run). Plain JavaScript so both can load it.
// Every check throws: callers stop on the first failure and never try another server.

export const TEST_PG_PORT = 55432;
export const TEST_PG_HOST = "127.0.0.1";
export const TEST_PG_SUPERUSER = "abig_test_admin";
export const TEST_PG_ADMIN_DB = "postgres";
/** Written into postgresql.conf at init; the server reports it as current_setting('abig.instance'). */
export const TEST_PG_INSTANCE = "test";
/** A file in the data directory that marks it as the disposable test server's. Reset deletes nothing without it. */
export const TEST_PG_MARKER_FILE = "ABIG_TEST_CLUSTER";
/** The only databases tests may create or drop. */
export const TEST_DB_NAME = /^abig_test_[a-z0-9_]+$/;
const SYSTEM_DBS = new Set(["postgres", "template0", "template1"]);

/** Environment variables that name a development or production database, its credentials, or libpq defaults the pg driver would fall back to. */
export const FORBIDDEN_TEST_ENV = [
  "DATABASE_URL", "AUTH_DATABASE_URL", "WORKER_DATABASE_URL", "MIGRATION_DATABASE_URL",
  "APP_DB_PASSWORD", "AUTH_DB_PASSWORD", "WORKER_DB_PASSWORD", "POSTGRES_PASSWORD",
  "PGHOST", "PGHOSTADDR", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "PGSSLMODE", "PGOPTIONS",
];

export class TestServerSafetyError extends Error {
  constructor(message) { super(`Test database safety check failed: ${message}. Nothing was run; no other server was tried.`); this.name = "TestServerSafetyError"; }
}
const fail = (m) => { throw new TestServerSafetyError(m); };

/** Removes every forbidden variable from an environment object (process.env by default). Returns the names that were present. */
export function scrubDatabaseEnv(env = process.env) {
  const found = [];
  for (const key of Object.keys(env)) if (FORBIDDEN_TEST_ENV.includes(key.toUpperCase())) { found.push(key); delete env[key]; }
  return found;
}

/** Throws unless a database name is one tests may create or drop. */
export function assertTestDbName(name) {
  if (typeof name !== "string" || !TEST_DB_NAME.test(name)) fail(`"${name}" is not a test database name (must match ${TEST_DB_NAME})`);
  return name;
}

/** Throws unless the URL points at the isolated test server as its superuser, on its admin database. Makes no connection. */
export function assertTestServerUrl(raw) {
  if (!raw) fail("TEST_ADMIN_URL is not set (run `npm run testdb:init`, which writes .env.test)");
  let u; try { u = new URL(raw); } catch { fail("TEST_ADMIN_URL is not a valid URL"); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) fail(`TEST_ADMIN_URL must be a postgresql:// URL, not ${u.protocol}`);
  if (u.hostname !== TEST_PG_HOST) fail(`TEST_ADMIN_URL host is ${u.hostname}, expected ${TEST_PG_HOST}`);
  if (u.port !== String(TEST_PG_PORT)) fail(`TEST_ADMIN_URL port is ${u.port || "(default)"}, expected ${TEST_PG_PORT}`);
  if (decodeURIComponent(u.username) !== TEST_PG_SUPERUSER) fail(`TEST_ADMIN_URL user is ${u.username}, expected ${TEST_PG_SUPERUSER}`);
  if (u.pathname !== `/${TEST_PG_ADMIN_DB}`) fail(`TEST_ADMIN_URL database is ${u.pathname.slice(1)}, expected ${TEST_PG_ADMIN_DB}`);
  if (!u.password) fail("TEST_ADMIN_URL has no password");
  return u;
}

/**
 * Checks, over an open connection, that the server is the isolated test server: its identity marker, port and user, and that it holds no database other than
 * the system ones and abig_test_*. `markerExists(dataDir)` optionally confirms the marker file in the server's data directory. Returns what it found.
 */
export async function assertTestServer(client, { markerExists } = {}) {
  const r = (await client.query(
    `SELECT current_setting('abig.instance', true) AS instance, inet_server_port() AS port, current_user AS usr, current_database() AS db,
            current_setting('data_directory') AS data_dir, current_setting('listen_addresses') AS listen, current_setting('server_version_num')::int AS version`)).rows[0];
  if (r.instance !== TEST_PG_INSTANCE) fail(`the server's abig.instance is ${r.instance === null ? "not set" : `"${r.instance}"`}, expected "${TEST_PG_INSTANCE}" (this is not the isolated test server)`);
  if (Number(r.port) !== TEST_PG_PORT) fail(`the server listens on port ${r.port}, expected ${TEST_PG_PORT}`);
  if (r.usr !== TEST_PG_SUPERUSER) fail(`connected as ${r.usr}, expected ${TEST_PG_SUPERUSER}`);
  if (r.listen !== TEST_PG_HOST) fail(`the server listens on "${r.listen}", expected only ${TEST_PG_HOST}`);
  if (Math.floor(r.version / 10000) !== 18) fail(`the server is PostgreSQL ${Math.floor(r.version / 10000)}, expected 18`);
  if (markerExists && !markerExists(r.data_dir)) fail(`the data directory ${r.data_dir} has no ${TEST_PG_MARKER_FILE} marker`);
  const dbs = (await client.query("SELECT datname FROM pg_database ORDER BY datname")).rows.map((x) => x.datname);
  const foreign = dbs.filter((d) => !SYSTEM_DBS.has(d) && !TEST_DB_NAME.test(d));
  if (foreign.length) fail(`the server holds databases that are not test databases: ${foreign.join(", ")}`);
  return { instance: r.instance, port: Number(r.port), user: r.usr, dataDir: r.data_dir, listen: r.listen, version: r.version, databases: dbs };
}
