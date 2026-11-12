import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { actAs, ASKU, fails, fn, mk, rows, S_ETHIO, S_HAWASSA, setupDb, urlFor, user } from "./helpers";

let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
beforeAll(async () => { const d = await setupDb("abig_test_p6"); owner = d.owner; as = d.as; await owner.query("ALTER ROLE abig_auth LOGIN PASSWORD 'auth'"); });
afterAll(async () => { await owner?.end(); });
/** A request that holds reserved funds (RESERVED), so its supplier cannot be changed. */
const submittedReq = async (c: Client) => { await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [1000] }); await fn(c, "wf_submit", id); return id; };
// The same server as every other test (TEST_ADMIN_URL), not a hard-coded host and default port.
const authClient = async () => { const c = new Client({ connectionString: urlFor("abig_test_p6", ["abig_auth", "auth"]) }); await c.connect(); return c; };

describe("sign-in storage", () => {
  it("only the auth role can read credentials; the app role cannot read hashes, secrets, sessions", async () => {
    await owner.query("UPDATE users SET password_hash = 'x', totp_secret_enc = 'y' WHERE id = $1", [user.meron]);
    await as(user.meron, async (c) => {
      expect(await fails(c, "SELECT password_hash FROM users")).toMatch(/permission denied/);
      expect(await fails(c, "SELECT totp_secret_enc FROM users")).toMatch(/permission denied/);
      expect(await fails(c, "SELECT * FROM sessions")).toMatch(/permission denied/);
      expect(await fails(c, "UPDATE users SET failed_logins = 0")).toMatch(/permission denied/);
    });
    const a = await authClient();
    try {
      expect((await rows(a, "SELECT password_hash, totp_secret_enc FROM users WHERE id=$1", [user.meron]))[0]).toEqual({ password_hash: "x", totp_secret_enc: "y" });
      await a.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('abc', $1, now() + interval '1 hour')", [user.meron]);
      expect(await rows(a, "SELECT 1 FROM sessions")).toHaveLength(1);
      await a.query("DELETE FROM sessions");
      await a.query("BEGIN");
      expect(await fails(a, "SELECT * FROM company_bank_accounts")).toMatch(/permission denied/); // it sees nothing else
      await a.query("ROLLBACK");
    } finally { await a.end(); }
  });
  it("login events are append-only and visible only to administrators", async () => {
    const a = await authClient();
    try {
      await a.query("INSERT INTO auth_events (user_id, email, event, ip) VALUES ($1,'meron@abig.test','LOGIN_FAILED','1.2.3.4')", [user.meron]);
      await a.query("BEGIN");
      expect(await fails(a, "UPDATE auth_events SET event = 'LOGIN_OK'")).toMatch(/permission denied/);
      await a.query("ROLLBACK");
    } finally { await a.end(); }
    await as(user.admin, async (c) => { expect((await rows(c, "SELECT 1 FROM auth_events")).length).toBeGreaterThan(0); });
    await as(user.meron, async (c) => { expect(await rows(c, "SELECT 1 FROM auth_events")).toHaveLength(0); });
    await expect(owner.query("DELETE FROM auth_events")).rejects.toThrow(/append-only/);
  });
});

describe("administration", () => {
  it("only an administrator can add or edit companies; TIN and phone are required, validated and audited", async () => {
    await as(user.meron, async (c) => {
      expect(await fails(c, "SELECT admin_create_company('NEWCO','New Co','5550001111','+251911223344')")).toMatch(/only a system administrator/);
      expect(await fails(c, "SELECT admin_update_company($1,'X','5550001111','+251911223344',true)", [ASKU])).toMatch(/only a system administrator/);
    });
    await as(user.admin, async (c) => {
      expect(await fn(c, "admin_create_company", "NEWCO", "New Co PLC", "5550001111", "+251911223344")).toBeTruthy();
      expect(await fails(c, "SELECT admin_create_company('bad code','X','5550001112','+251911223344')")).toMatch(/capital letters/);
      expect(await fails(c, "SELECT admin_create_company('NEWC2','New Co 2','','+251911223344')")).toMatch(/TIN number is required/);
      expect(await fails(c, "SELECT admin_create_company('NEWC3','New Co 3','5550001113',' ')")).toMatch(/phone number is required/);
      expect(await fails(c, "SELECT admin_create_company('NEWC4','New Co 4','5550001111','+251911223344')")).toMatch(/duplicate key/); // TIN is unique
      await c.query("SELECT admin_update_company($1,'ASKU Trading PLC','0099887766','+251 11 123 4567',true)", [ASKU]);
      expect((await rows(c, "SELECT legal_name, tin_number, phone FROM companies WHERE id=$1", [ASKU]))[0]).toEqual({ legal_name: "ASKU Trading PLC", tin_number: "0099887766", phone: "+251 11 123 4567" });
      expect(await rows(c, "SELECT 1 FROM audit_events WHERE action IN ('COMPANY_CREATED','COMPANY_UPDATED')")).toHaveLength(2);
    });
  });
  it("lists the company directory (with TIN and phone) for any signed-in person, and for nobody else", async () => {
    await as(user.bereket, async (c) => { const r = await rows(c, "SELECT * FROM company_directory()"); expect(r.length).toBeGreaterThanOrEqual(4); expect(r[0]).toHaveProperty("tin_number"); expect(r[0]).toHaveProperty("phone"); });
    await as(null, async (c) => { expect(await rows(c, "SELECT * FROM company_directory()")).toHaveLength(0); });
  });
});

describe("supplier changes", () => {
  it("a finance manager can correct a supplier, but not while requests are in progress", async () => {
    await as(user.kebede, async (c) => {
      expect(await fails(c, "SELECT supplier_update($1,'X','0012345678',true)", [S_HAWASSA])).toMatch(/you may not change suppliers/);
      await actAs(c, user.dawit);
      await c.query("SELECT supplier_update($1,'Ethio Chemicals Share Co','0023456789',true)", [S_ETHIO]);
      expect((await rows(c, "SELECT legal_name FROM suppliers WHERE id=$1", [S_ETHIO]))[0].legal_name).toBe("Ethio Chemicals Share Co");
      const a = await submittedReq(c); void a;
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT supplier_update($1,'Renamed','0012345678',true)", [S_HAWASSA])).toMatch(/requests in progress/);
      await c.query("SELECT supplier_update($1,'Hawassa Packaging PLC','0012345678',true)", [S_HAWASSA]); // nothing changes, so it is allowed
      expect(await rows(c, "SELECT 1 FROM audit_events WHERE action='SUPPLIER_CHANGED'")).toHaveLength(2);
    });
  });
});

describe("housekeeping", () => {
  it("purges expired and abandoned sessions, and only the worker role may run it", async () => {
    const a = await authClient();
    try {
      await a.query("INSERT INTO sessions (token_hash, user_id, expires_at, last_seen_at) VALUES ('old', $1, now() - interval '1 hour', now() - interval '2 hours'), ('abandoned', $1, now() + interval '5 hours', now() - interval '2 days'), ('live', $1, now() + interval '5 hours', now())", [user.meron]);
      await a.query("BEGIN"); expect(await fails(a, "SELECT purge_expired_sessions()")).toMatch(/permission denied/); await a.query("ROLLBACK");
      await owner.query("SELECT purge_expired_sessions()");
      expect((await rows(a, "SELECT token_hash FROM sessions ORDER BY 1")).map((r) => r.token_hash)).toEqual(["live"]);
      await a.query("DELETE FROM sessions");
    } finally { await a.end(); }
  });
});
