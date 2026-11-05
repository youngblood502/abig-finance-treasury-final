import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { ASKU, BERBERO, fails, rows, setupDb, user } from "./helpers";

const CBE = "b0000000-0000-4000-8000-000000000001", AWASH = "b0000000-0000-4000-8000-000000000002";
let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"]; let appUrl: string;
beforeAll(async () => { const d = await setupDb("abig_test_p1"); owner = d.owner; as = d.as; appUrl = d.appUrl; });
afterAll(async () => { await owner?.end(); });

describe("company scope", () => {
  it("shows nothing without an authenticated context", async () => {
    await as(null, async (c) => { expect(await rows(c, "SELECT * FROM companies")).toHaveLength(0); });
  });
  it("does not leak context across pooled connections", async () => {
    const c = new Client({ connectionString: appUrl }); await c.connect();
    await c.query("BEGIN"); await c.query("SELECT set_config('app.user_id',$1,true)", [user.meron]);
    expect((await rows(c, "SELECT * FROM companies")).length).toBeGreaterThan(0);
    await c.query("COMMIT");
    expect(await rows(c, "SELECT * FROM companies")).toHaveLength(0);
    await c.end();
  });
  it("Daily Mart user sees only Daily Mart and no accounts", async () => {
    await as(user.bereket, async (c) => {
      expect((await rows(c, "SELECT code FROM companies")).map((r) => r.code)).toEqual(["DAILYMART"]);
      expect(await rows(c, "SELECT * FROM company_bank_accounts")).toHaveLength(0);
    });
  });
  it("ASKU user cannot see users or memberships of BEES", async () => {
    await as(user.meron, async (c) => {
      const emails = (await rows(c, "SELECT email FROM users")).map((r) => r.email);
      expect(emails).toContain("lidya@abig.test"); expect(emails).not.toContain("samuel@abig.test");
      expect(await rows(c, "SELECT 1 FROM company_memberships WHERE company_id=$1", ["c0000000-0000-4000-8000-000000000003"])).toHaveLength(0);
    });
  });
  it("password_hash is not readable by the app role", async () => {
    await as(user.meron, async (c) => { expect(await fails(c, "SELECT password_hash FROM users")).toMatch(/permission denied/); });
  });
});

describe("group reporting", () => {
  it("is explicit per company and read-only", async () => {
    await as(user.selam, async (c) => {
      const codes = (await rows(c, "SELECT code FROM companies")).map((r) => r.code);
      expect(codes).toEqual(expect.arrayContaining(["ASKU", "BEES"]));
      expect(codes).not.toContain("DAILYMART");
      expect(await fails(c, "SELECT record_opening_balance($1, 1)", [CBE])).toMatch(/you may not update the balance/);
    });
  });
});

describe("shared account semantics", () => {
  it("ASKU and Berbero see the same single balance for the BEES account", async () => {
    const q = "SELECT a.id, a.account_last4, a.current_balance AS balance FROM company_bank_accounts a WHERE a.id=$1";
    const a = await as(user.meron, (c) => rows(c, q, [CBE]));
    const b = await as(user.hana, (c) => rows(c, q, [CBE]));
    expect(a).toHaveLength(1); expect(b).toHaveLength(1);
    expect(a[0].balance).toBe(b[0].balance);
  });
  it("shows the legal owner name to a company that only has a grant", async () => {
    await as(user.meron, async (c) => {
      const r = await rows(c, "SELECT o.legal_name FROM company_bank_accounts a JOIN companies o ON o.id=account_owner_company(a.id) WHERE a.id=$1", [CBE]);
      expect(r[0].legal_name).toBe("BEES PLC");
    });
  });
  it("Berbero cannot see ASKU's own Awash account", async () => {
    await as(user.hana, async (c) => { expect(await rows(c, "SELECT 1 FROM company_bank_accounts WHERE id=$1", [AWASH])).toHaveLength(0); });
  });
  it("the owner is a row in the junction (is_owner); an account has exactly one active owner link that cannot be revoked", async () => {
    await as(user.samuel, async (c) => { expect(await rows(c, "SELECT 1 FROM company_bank_accounts WHERE id=$1", [CBE])).toHaveLength(1); });
    await as(user.abebe, async (c) => {
      expect(await fails(c, "INSERT INTO company_bank_account_access (account_id, company_id, is_owner, granted_by) VALUES ($1,$2,true,$3)", [CBE, ASKU, user.abebe])).toMatch(/duplicate key/);
      expect(await fails(c, "UPDATE company_bank_account_access SET revoked_at = now() WHERE account_id=$1 AND is_owner", [CBE])).toMatch(/owner link .* cannot be revoked/);
    });
  });
});

describe("account access history", () => {
  it("revoke then re-grant creates a new row and keeps the old one immutable", async () => {
    await as(user.abebe, async (c) => {
      await c.query("UPDATE company_bank_account_access SET revoked_at = now() WHERE account_id=$1 AND company_id=$2 AND revoked_at IS NULL", [CBE, ASKU]);
      await c.query("INSERT INTO company_bank_account_access (account_id, company_id, granted_by) VALUES ($1,$2,$3)", [CBE, ASKU, user.abebe]);
      const all = await rows(c, "SELECT revoked_at, revoked_by FROM company_bank_account_access WHERE account_id=$1 AND company_id=$2", [CBE, ASKU]);
      expect(all).toHaveLength(2);
      expect(all.filter((r) => r.revoked_at === null)).toHaveLength(1);
      expect(all.find((r) => r.revoked_at)!.revoked_by).toBe(user.abebe);
      expect(await fails(c, "INSERT INTO company_bank_account_access (account_id, company_id, granted_by) VALUES ($1,$2,$3)", [CBE, ASKU, user.abebe])).toMatch(/duplicate key/);
    });
  });
  it("ASKU loses sight of the account while revoked", async () => {
    await as(user.abebe, async (c) => {
      await c.query("UPDATE company_bank_account_access SET revoked_at = now() WHERE account_id=$1 AND company_id=$2 AND revoked_at IS NULL", [CBE, ASKU]);
      await c.query("SELECT set_config('app.user_id',$1,true)", [user.meron]); // switch context inside the same rolled-back transaction
      expect(await rows(c, "SELECT 1 FROM company_bank_accounts WHERE id=$1", [CBE])).toHaveLength(0);
    });
  });
  it("only the account owner delegate can grant; revoked rows cannot be edited or deleted", async () => {
    await as(user.lidya, async (c) => {
      expect(await fails(c, "INSERT INTO company_bank_account_access (account_id, company_id, granted_by) VALUES ($1,$2,$3)", [AWASH, BERBERO, user.lidya])).toMatch(/row-level security/);
    });
    await as(user.abebe, async (c) => {
      expect(await fails(c, "UPDATE company_bank_account_access SET permissions='{USE,RECORD_SNAPSHOT}' WHERE account_id=$1", [CBE])).toMatch(/permission denied/);
      expect(await fails(c, "DELETE FROM company_bank_account_access WHERE account_id=$1", [CBE])).toMatch(/permission denied/);
    });
  });
});

describe("bank balance updates and audit", () => {
  const upd = "SELECT record_opening_balance($1, $2)";
  it("only an Accountant of a company linked with the update right can enter a balance; others cannot", async () => {
    await as(user.samuel, async (c) => { await c.query(upd, [CBE, 4300000]); });   // owner company accountant
    await as(user.tigist, async (c) => { await c.query(upd, [CBE, 4310000]); });   // Berbero accountant, shared with RECORD_SNAPSHOT
    await as(user.lidya, async (c) => { expect(await fails(c, upd, [CBE, 1])).toMatch(/you may not update the balance/); });   // ASKU: use only
    await as(user.abebe, async (c) => { expect(await fails(c, upd, [CBE, 1])).toMatch(/you may not update the balance/); });   // an Owner does not enter balances
  });
  it("the balance and the history cannot be written directly, and the history is append-only", async () => {
    await as(user.samuel, async (c) => {
      expect(await fails(c, "UPDATE company_bank_accounts SET current_balance = 1 WHERE id=$1", [CBE])).toMatch(/permission denied/);
      expect(await fails(c, "INSERT INTO bank_balance_history (account_id, previous_balance, new_balance, updated_by) VALUES ($1,0,1,$2)", [CBE, user.samuel])).toMatch(/permission denied/);
    });
    await owner.query("BEGIN");
    try {
      await owner.query("INSERT INTO audit_events (actor_id, action, entity_type) VALUES ($1,'TEST','test')", [user.admin]);
      await owner.query("SAVEPOINT a");
      await expect(owner.query("UPDATE audit_events SET action='X'")).rejects.toThrow(/append-only/);
      await owner.query("ROLLBACK TO a");
      await owner.query("INSERT INTO bank_balance_history (account_id, previous_balance, new_balance, updated_by) VALUES ($1,0,1,$2)", [CBE, user.samuel]);
      await expect(owner.query("DELETE FROM bank_balance_history")).rejects.toThrow(/cannot be changed/);
    } finally { await owner.query("ROLLBACK"); }
  });
  it("audit events cannot be forged for another actor", async () => {
    await as(user.meron, async (c) => {
      expect(await fails(c, "INSERT INTO audit_events (actor_id, action, entity_type) VALUES ($1,'X','y')", [user.samuel])).toMatch(/row-level security/);
    });
  });
});

describe("system administrator", () => {
  it("has full access: sees every company, account and balance, and manages memberships and roles", async () => {
    await as(user.admin, async (c) => {
      expect((await rows(c, "SELECT 1 FROM companies")).length).toBeGreaterThanOrEqual(4);
      expect((await rows(c, "SELECT 1 FROM company_bank_accounts")).length).toBe(2);
      const m = (await rows(c, "INSERT INTO company_memberships (company_id, user_id) VALUES ($1,$2) RETURNING id", [ASKU, user.bereket]))[0].id;
      await c.query("INSERT INTO membership_roles (membership_id, role_id) SELECT $1, id FROM roles WHERE code='FINANCE_MANAGER'", [m]);
    });
  });
  it("ordinary users cannot change memberships or roles", async () => {
    await as(user.meron, async (c) => {
      expect(await fails(c, "INSERT INTO company_memberships (company_id, user_id) VALUES ($1,$2)", [ASKU, user.meron])).toMatch(/row-level security/);
      expect(await fails(c, "INSERT INTO membership_roles (membership_id, role_id) SELECT m.id, r.id FROM company_memberships m, roles r WHERE r.code='OWNER' AND m.user_id=$1", [user.meron])).toMatch(/row-level security/);
    });
  });
});
