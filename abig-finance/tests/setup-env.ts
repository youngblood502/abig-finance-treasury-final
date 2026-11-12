import { assertTestServerUrl, scrubDatabaseEnv } from "../ops/test-db-safety.mjs";

// Runs in each test worker before each test file. The global setup has already checked the server over a connection; this makes no connection.
// It removes any development or production database variable again (in case a worker received one) and re-checks that TEST_ADMIN_URL names the test server.
scrubDatabaseEnv();
assertTestServerUrl(process.env.TEST_ADMIN_URL);
