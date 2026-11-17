import { describe, expect, it } from "vitest";
import { assertPreviewUrl, assertTestDbName, assertTestServer, assertTestServerUrl, FORBIDDEN_TEST_ENV, PREVIEW_NOWHERE, previewEnv, TEST_PG_PORT } from "../ops/test-db-safety.mjs";
import { setupDb } from "./helpers";

// The tests run on the isolated test server only, and the test process holds no development or production database credential.
// None of these checks connects to any server other than the test server; the refusals happen before a connection is made.
describe("the test process", () => {
  it("has no development or production database variable, nor a libpq default the driver could fall back to", () => {
    const present = Object.keys(process.env).filter((k) => FORBIDDEN_TEST_ENV.includes(k.toUpperCase()));
    expect(present).toEqual([]);
  });

  it("uses the isolated test server, as its superuser, on port 55432 of 127.0.0.1", () => {
    const u = new URL(process.env.TEST_ADMIN_URL!);
    expect([u.hostname, u.port, u.username, u.pathname]).toEqual(["127.0.0.1", String(TEST_PG_PORT), "abig_test_admin", "/postgres"]);
  });

  it("gives the application's database pool no connection string, so it cannot reach the development database", async () => {
    const { pool } = await import("../src/lib/db");
    expect((pool as unknown as { options: { connectionString?: string } }).options.connectionString).toBeUndefined();
  });
});

describe("the safety checks refuse anything but the test server, before connecting", () => {
  it("refuses a URL for another server, port, user or database", () => {
    for (const bad of [undefined, "", "postgresql://postgres:x@127.0.0.1:5433/postgres", "postgresql://abig_test_admin:x@127.0.0.1:5432/postgres",
      "postgresql://abig_test_admin:x@localhost:55432/postgres", "postgresql://postgres:x@127.0.0.1:55432/postgres", "postgresql://abig_test_admin:x@127.0.0.1:55432/abig_treasury",
      "postgresql://abig_test_admin@127.0.0.1:55432/postgres"]) {
      expect(() => assertTestServerUrl(bad)).toThrow(/Test database safety check failed/);
    }
  });

  it("the preview's dev server gets only test-server databases, and .env cannot put another one back", () => {
    const good = "postgresql://abig_app:app@127.0.0.1:55432/abig_test_preview";
    for (const bad of [undefined, "", "postgresql://abig_app:x@localhost:5433/abig_treasury", "postgresql://abig_app:x@127.0.0.1:5432/abig_test_preview",
      "postgresql://abig_app:x@127.0.0.1:55432/abig_treasury", "postgresql://abig_app:x@127.0.0.1:55432/abig_finance", "postgresql://abig_app:x@localhost:55432/abig_test_preview", "mysql://x@127.0.0.1:55432/abig_test_preview"]) {
      expect(() => assertPreviewUrl("DATABASE_URL", bad)).toThrow(/Test database safety check failed/);
    }
    // Inherited development settings are dropped; every database variable is set (Next.js never overrides a set variable from .env), unused ones to nowhere.
    const env = previewEnv({ PATH: "/bin", DATABASE_URL: "postgresql://abig_app:x@localhost:5433/abig_treasury", PGPORT: "5433", MIGRATION_DATABASE_URL: "postgresql://o:x@localhost:5433/abig_treasury" }, { DATABASE_URL: good });
    expect(env.PATH).toBe("/bin"); expect(env.DATABASE_URL).toBe(good);
    for (const k of FORBIDDEN_TEST_ENV) expect(Object.hasOwn(env, k)).toBe(true);
    for (const k of ["AUTH_DATABASE_URL", "WORKER_DATABASE_URL", "MIGRATION_DATABASE_URL"]) expect(env[k]).toBe(PREVIEW_NOWHERE);
    expect(env.PGPORT).toBe(""); expect(JSON.stringify(env)).not.toMatch(/:543[23]\b|abig_treasury|abig_finance/);   // 55432, the test server, is allowed
    expect(() => previewEnv({}, { DATABASE_URL: "postgresql://abig_app:x@localhost:5433/abig_treasury" })).toThrow(/Test database safety check failed/);
  });

  it("never creates or drops a database that is not abig_test_*", async () => {
    for (const name of ["abig_treasury", "abig_finance", "postgres", "template1", "abig_test_", "abig_test_X", "abig_test_a; DROP DATABASE abig_treasury", "x_abig_test_a"]) {
      expect(() => assertTestDbName(name)).toThrow(/not a test database name/);
    }
    await expect(setupDb("abig_treasury")).rejects.toThrow(/not a test database name/);
    expect(assertTestDbName("abig_test_ok_1")).toBe("abig_test_ok_1");
  });

  it("refuses a server without the test identity, on another port, or holding a foreign database", async () => {
    const server = (over: Record<string, unknown>, dbs = ["postgres", "template0", "template1"]) => ({
      query: async (sql: string) => (sql.includes("pg_database") ? { rows: dbs.map((datname) => ({ datname })) }
        : { rows: [{ instance: "test", port: TEST_PG_PORT, usr: "abig_test_admin", db: "postgres", data_dir: "x", listen: "127.0.0.1", version: 180003, ...over }] }),
    });
    await expect(assertTestServer(server({ instance: null }))).rejects.toThrow(/abig.instance is not set/);
    await expect(assertTestServer(server({ port: 5433 }))).rejects.toThrow(/port 5433/);
    await expect(assertTestServer(server({ usr: "postgres" }))).rejects.toThrow(/connected as postgres/);
    await expect(assertTestServer(server({ listen: "*" }))).rejects.toThrow(/listens on "\*"/);
    await expect(assertTestServer(server({ version: 170005 }))).rejects.toThrow(/PostgreSQL 17/);
    await expect(assertTestServer(server({}, ["postgres", "abig_treasury"]))).rejects.toThrow(/not test databases: abig_treasury/);
    await expect(assertTestServer(server({}), { markerExists: () => false })).rejects.toThrow(/no ABIG_TEST_CLUSTER marker/);
    await expect(assertTestServer(server({}, ["postgres", "abig_test_x"]))).resolves.toMatchObject({ port: TEST_PG_PORT });
  });
});
