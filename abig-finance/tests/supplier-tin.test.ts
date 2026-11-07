import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { Tx } from "../src/lib/db";
import { supplierList } from "../src/lib/payee-screens";
import { actAs, ASKU, authorized, fails, fn, mk, rows, setupDb, S_HAWASSA, user } from "./helpers";

const NAME = "20261109000000_supplier_tin_optional";

// The migration runs over a database that already has suppliers, as the live one does.
describe("making a supplier's TIN optional", () => {
  let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"]; let migrateRest: () => Promise<void>;
  let before: { id: string; legal_name: string; tin: string }[];
  const tx = (c: Client): Tx => ({ q: async (sql, p) => (await c.query(sql, p as unknown[])).rows });
  const add = (c: Client, name: string, tin: string | null) => c.query("INSERT INTO suppliers (legal_name, tin, created_by) VALUES ($1,$2,$3) RETURNING id", [name, tin, user.meron]);
  const tinOf = async (id: string) => (await rows(owner, "SELECT tin FROM suppliers WHERE id = $1", [id]))[0].tin as string | null;

  beforeAll(async () => {
    const d = await setupDb("abig_test_supplier_tin", { before: NAME }); owner = d.owner; as = d.as; migrateRest = d.migrateRest;
    before = await rows(owner, "SELECT id, legal_name, tin FROM suppliers ORDER BY id");
  });
  afterAll(async () => { await owner?.end(); });

  it("before the migration a TIN is required", async () => {
    await as(user.meron, async (c) => { expect(await fails(c, "INSERT INTO suppliers (legal_name, tin, created_by) VALUES ('No TIN Co',NULL,$1)", [user.meron])).toMatch(/null value in column "tin"/); });
  });
  it("the migration changes no existing supplier", async () => {
    await migrateRest();
    expect(before.length).toBeGreaterThan(0);
    expect(await rows(owner, "SELECT id, legal_name, tin FROM suppliers ORDER BY id")).toEqual(before);
  });
  it("any number of suppliers can have no TIN", async () => {
    await as(user.meron, async (c) => {
      await add(c, "No TIN One", null); await add(c, "No TIN Two", null);
      expect((await rows(c, "SELECT count(*)::int n FROM suppliers WHERE tin IS NULL"))[0].n).toBe(2);
      expect((await supplierList(tx(c), null)).filter((s) => s.tin === null).map((s) => s.legal_name)).toEqual(["No TIN One", "No TIN Two"]);
    });
  });
  it("a TIN that is entered must still be valid and unique", async () => {
    await as(user.meron, async (c) => {
      expect(await fails(c, "INSERT INTO suppliers (legal_name, tin, created_by) VALUES ('Bad',' ',$1)", [user.meron])).toMatch(/check constraint/);
      expect(await fails(c, "INSERT INTO suppliers (legal_name, tin, created_by) VALUES ('Bad','12',$1)", [user.meron])).toMatch(/check constraint/);
      expect(await fails(c, "INSERT INTO suppliers (legal_name, tin, created_by) VALUES ('Copy',$2,$1)", [user.meron, before[0].tin])).toMatch(/unique/);
    });
  });

  it("a correction can add or clear a TIN, and empty means none", async () => {
    await owner.query("BEGIN"); await actAs(owner, user.meron);
    const id = (await add(owner, "Cleared Co", "0077777777")).rows[0].id as string;
    await actAs(owner, user.dawit);
    await owner.query("SELECT supplier_update($1,'Cleared Co','  ',true)", [id]);
    await owner.query("COMMIT");
    expect(await tinOf(id)).toBeNull();
    await owner.query("BEGIN"); await actAs(owner, user.dawit);
    await owner.query("SELECT supplier_update($1,'Cleared Co',NULL,true)", [id]);
    await owner.query("SELECT supplier_update($1,'Cleared Co','abc-12345',true)", [id]);
    await owner.query("COMMIT");
    expect(await tinOf(id)).toBe("ABC-12345");
    const audit = await rows(owner, "SELECT metadata FROM audit_events WHERE action = 'SUPPLIER_CHANGED' AND entity_id = $1 ORDER BY occurred_at, id", [id]);
    expect(audit.some((a) => a.metadata.tin === "ABC-12345" && a.metadata.was_tin === null)).toBe(true);
    expect(audit.some((a) => a.metadata.tin === null && a.metadata.was_tin === "0077777777")).toBe(true);
    await as(user.dawit, async (c) => { expect(await fails(c, "SELECT supplier_update($1,'Cleared Co','!!',true)", [id])).toMatch(/check constraint/); });
  });

  it("a supplier with no TIN goes through the whole payment workflow", async () => {
    await owner.query("BEGIN"); await actAs(owner, user.meron);
    const id = (await add(owner, "Workflow No TIN", null)).rows[0].id as string;
    await owner.query("INSERT INTO company_suppliers (company_id, supplier_id, created_by) VALUES ($1,$2,$3)", [ASKU, id, user.meron]);
    const bank = (await owner.query("INSERT INTO supplier_bank_details (supplier_id, bank_name, account_last4, created_by) VALUES ($1,'Abay','1111',$2) RETURNING id", [id, user.meron])).rows[0].id;
    await actAs(owner, user.dawit); await owner.query("UPDATE supplier_bank_details SET status = 'VERIFIED', verified_by = $2 WHERE id = $1", [bank, user.dawit]);
    await owner.query("COMMIT");
    await owner.query("BEGIN");
    const r = await authorized(owner, { supplier: id, bank, amounts: [100] });
    await owner.query("COMMIT");
    expect((await rows(owner, "SELECT workflow_state::text s FROM payment_requests WHERE id = $1", [r.id]))[0].s).toBe("AUTHENTICATED");
  });

  it("clearing or adding a TIN stays frozen while a request holds funds", async () => {
    await owner.query("BEGIN");
    await actAs(owner, user.meron);
    const noTin = (await add(owner, "Frozen No TIN", null)).rows[0].id as string;
    await owner.query("INSERT INTO company_suppliers (company_id, supplier_id, created_by) VALUES ($1,$2,$3)", [ASKU, noTin, user.meron]);
    const bank = (await owner.query("INSERT INTO supplier_bank_details (supplier_id, bank_name, account_last4, created_by) VALUES ($1,'Abay','2222',$2) RETURNING id", [noTin, user.meron])).rows[0].id;
    await actAs(owner, user.dawit); await owner.query("UPDATE supplier_bank_details SET status = 'VERIFIED', verified_by = $2 WHERE id = $1", [bank, user.dawit]);
    await actAs(owner, user.meron);
    await fn(owner, "wf_submit", await mk(owner, user.meron, { supplier: noTin, bank, amounts: [100] }));
    await fn(owner, "wf_submit", await mk(owner, user.meron, { supplier: S_HAWASSA, amounts: [100] }));
    await actAs(owner, user.dawit);
    const refused = async (sql: string, p: unknown[]) => { await owner.query("SAVEPOINT a"); await expect(owner.query(sql, p)).rejects.toThrow(/requests in progress/); await owner.query("ROLLBACK TO a"); };
    await refused("SELECT supplier_update($1,'Frozen No TIN','0088888888',true)", [noTin]);                                    // adding
    const hawassa = (await rows(owner, "SELECT legal_name, tin FROM suppliers WHERE id = $1", [S_HAWASSA]))[0];
    await refused("SELECT supplier_update($1,$2,NULL,true)", [S_HAWASSA, hawassa.legal_name]);                                 // clearing
    await owner.query("SELECT supplier_update($1,'Frozen No TIN',NULL,true)", [noTin]);                                        // nothing changed, so it is allowed
    await owner.query("SELECT supplier_update($1,$2,$3,true)", [S_HAWASSA, hawassa.legal_name, hawassa.tin]);
    await owner.query("ROLLBACK");
  });
});
