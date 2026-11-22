import pg from "pg";
import { assertTestServerUrl, scrubDatabaseEnv } from "../ops/test-db-safety.mjs";

// Runs in each test worker before each test file. The global setup has already checked the server over a connection; this makes no connection.
// It removes any development or production database variable again (in case a worker received one) and re-checks that TEST_ADMIN_URL names the test server.
scrubDatabaseEnv();
assertTestServerUrl(process.env.TEST_ADMIN_URL);
// With those variables gone, a pool created without a connection string (the app's own pools in src/lib/db.ts and src/lib/auth.ts) would fall back
// to pg's built-in default of localhost:5432. Point that default at port 1, which nothing answers, so such a connection fails instead of reaching
// whatever server might be listening there. Every test-server URL names its host and port explicitly, so this changes nothing for them.
pg.defaults.host = "127.0.0.1";
pg.defaults.port = 1;
