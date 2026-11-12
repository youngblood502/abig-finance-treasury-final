import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { Client } from "pg";
import { assertTestServer, assertTestServerUrl, scrubDatabaseEnv, TEST_PG_MARKER_FILE, TestServerSafetyError } from "../ops/test-db-safety.mjs";

// Runs once, before any test file, in Vitest's main process. Test workers start afterwards and inherit the environment set here.
//  1. Every development or production database variable (and libpq default) is removed from the environment.
//  2. TEST_ADMIN_URL is taken from .env.test only, overriding anything exported in the shell, and must name the isolated test server.
//  3. One connection proves it is that server: identity marker, port, user, listen address, version, marker file, and no foreign database.
// Any failure stops the whole run. No other server is tried.
export default async function setup() {
  scrubDatabaseEnv();
  const file = join(__dirname, "..", ".env.test");
  if (!existsSync(file)) throw new TestServerSafetyError(`${file} does not exist (run \`npm run testdb:init\`, then \`npm run testdb:start\`)`);
  const url = parseEnv(readFileSync(file, "utf8")).TEST_ADMIN_URL;
  assertTestServerUrl(url);
  process.env.TEST_ADMIN_URL = url;
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try { await c.connect(); } catch (e) { throw new TestServerSafetyError(`cannot reach the test server (${(e as Error).message}); start it with \`npm run testdb:start\``); }
  try { await assertTestServer(c, { markerExists: (dir: string) => existsSync(join(dir, TEST_PG_MARKER_FILE)) }); }
  finally { await c.end().catch(() => {}); }
}
