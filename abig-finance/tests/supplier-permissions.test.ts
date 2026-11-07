import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { Tx } from "../src/lib/db";
import { canChangeSupplierStatus } from "../src/lib/payee-screens";
import { actAs, authorized, fails, fn, mk, rows, setupDb, S_ADDIS, S_ETHIO, S_HAWASSA, user } from "./helpers";

const update = "SELECT supplier_update($1,$2,$3,$4)";

// Accountants correct a supplier's name and TIN. Verifiers and Finance Managers also decide its status and verify its bank details. Each test rolls back.
describe("who may change a supplier", () => {
  let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
  let hawassa: { legal_name: string; tin: string };
  const tx = (c: Client): Tx => ({ q: async (sql, p) => (await c.query(sql, p as unknown[])).rows });
  const facts = async (c: Client, id: string) => (await rows(c, "SELECT legal_name, tin, is_active FROM suppliers WHERE id = $1", [id]))[0];

  beforeAll(async () => {
    const d = await setupDb("abig_test_supplier_permissions"); owner = d.owner; as = d.as;
    hawassa = (await rows(owner, "SELECT legal_name, tin FROM suppliers WHERE id = $1", [S_HAWASSA]))[0];
  });
  afterAll(async () => { await owner?.end(); });

  it("an Accountant adds suppliers with or without a TIN", async () => {
    await as(user.meron, async (c) => {
      const add = (name: string, tin: string | null) => c.query("INSERT INTO suppliers (legal_name, tin, created_by) VALUES ($1,$2,$3)", [name, tin, user.meron]);
      await add("With TIN", "0066666666"); await add("Without TIN", null);
      expect((await rows(c, "SELECT tin FROM suppliers WHERE legal_name = 'Without TIN'"))[0].tin).toBeNull();
    });
  });
  it("an Accountant corrects the name, and adds, changes or clears the TIN, without touching the status", async () => {
    await as(user.meron, async (c) => {
      await c.query(update, [S_ADDIS, "Addis Hardware Traders PLC", "0056789012", null]);
      expect(await facts(c, S_ADDIS)).toEqual({ legal_name: "Addis Hardware Traders PLC", tin: "0056789012", is_active: true });
      await c.query(update, [S_ADDIS, "Addis Hardware Traders PLC", "new-tin-001", null]);
      expect((await facts(c, S_ADDIS)).tin).toBe("NEW-TIN-001");
      await c.query(update, [S_ADDIS, "Addis Hardware Traders PLC", "", null]);
      expect((await facts(c, S_ADDIS)).tin).toBeNull();
      await c.query(update, [S_ADDIS, "Addis Hardware Traders PLC", "0056789012", true]);                                       // the status it already has
      expect((await facts(c, S_ADDIS)).tin).toBe("0056789012");
      const audit = await rows(c, "SELECT actor_id FROM audit_events WHERE action = 'SUPPLIER_CHANGED' AND entity_id = $1", [S_ADDIS]);
      expect(audit.length).toBeGreaterThan(0); expect(audit.every((a) => a.actor_id === user.meron)).toBe(true);
    });
  });
  it("an Accountant cannot change the status, in either direction", async () => {
    await as(user.meron, async (c) => {
      expect(await fails(c, update, [S_ADDIS, "Addis Hardware Traders", "0056789012", false])).toMatch(/only a verifier or finance manager can change a supplier's status/);
      await actAs(c, user.dawit); await c.query(update, [S_ADDIS, "Addis Hardware Traders", "0056789012", false]);
      await actAs(c, user.meron);
      expect(await fails(c, update, [S_ADDIS, "Addis Hardware Traders", "0056789012", true])).toMatch(/status/);
      await c.query(update, [S_ADDIS, "Addis Hardware Traders Co", "0056789012", null]);                                        // a name is still correctable, and it stays inactive
      expect(await facts(c, S_ADDIS)).toMatchObject({ legal_name: "Addis Hardware Traders Co", is_active: false });
    });
  });
  it("a Finance Manager can do all of it", async () => {
    await as(user.dawit, async (c) => {
      await c.query(update, [S_ADDIS, "Addis Renamed", "", false]);
      expect(await facts(c, S_ADDIS)).toEqual({ legal_name: "Addis Renamed", tin: null, is_active: false });
      await c.query(update, [S_ADDIS, "Addis Renamed", "0056789012", true]);
      expect((await facts(c, S_ADDIS)).is_active).toBe(true);
    });
  });
  it("those with neither role change nothing, and nobody can edit the table directly", async () => {
    for (const who of [user.kebede, user.hana, user.selam]) await as(who, async (c) => { expect(await fails(c, update, [S_ADDIS, "Nope", "", null])).toMatch(/you may not change suppliers/); });
    await as(null, async (c) => { expect(await fails(c, update, [S_ADDIS, "Nope", "", null])).toMatch(/you may not change suppliers/); });
    for (const who of [user.meron, user.dawit]) await as(who, async (c) => { expect(await fails(c, "UPDATE suppliers SET is_active = false WHERE id = $1", [S_ADDIS])).toMatch(/permission denied/); });
  });

  it("the status check the form and action use matches the database for every role", async () => {
    for (const who of [user.meron, user.lidya, user.tigist, user.nardos, user.samuel, user.bereket, user.dawit, user.fikru, user.abebe, user.yared, user.kebede, user.hana]) {
      await as(who, async (c) => {
        const offered = await canChangeSupplierStatus(tx(c));
        await c.query("SAVEPOINT s");
        const accepted = await c.query(update, [S_ADDIS, "Addis Hardware Traders", "0056789012", false]).then(() => true, () => false);
        await c.query("ROLLBACK TO s");
        expect([who, offered]).toEqual([who, accepted]);
      });
    }
    await as(user.meron, async (c) => { expect(await canChangeSupplierStatus(tx(c))).toBe(false); });
    await as(user.dawit, async (c) => { expect(await canChangeSupplierStatus(tx(c))).toBe(true); });
  });

  it("an Accountant gains no verification or authentication", async () => {
    const perms = await rows(owner, "SELECT p.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id WHERE r.code = 'ACCOUNTANT'");
    const codes = perms.map((p) => p.code as string);
    for (const code of ["payment_request:verify", "payment_request:authenticate", "payment_request:reject", "approval:view"]) expect(codes).not.toContain(code);
    expect(codes).toContain("supplier:manage");
    await as(user.meron, async (c) => {
      await actAs(c, user.lidya);                                                                                               // entered by someone else, so only the role could stop Meron
      const pending = (await c.query("INSERT INTO supplier_bank_details (supplier_id, bank_name, account_last4, created_by) VALUES ($1,'Abay','9999',$2) RETURNING id", [S_ADDIS, user.lidya])).rows[0].id;
      await actAs(c, user.meron);
      await c.query("SAVEPOINT u");
      const verified = await c.query("UPDATE supplier_bank_details SET status = 'VERIFIED', verified_by = $2 WHERE id = $1", [pending, user.meron]).then((r) => r.rowCount, () => 0);
      await c.query("ROLLBACK TO u");
      expect(verified).toBe(0);
      const reqId = await mk(c, user.meron, { supplier: S_HAWASSA, amounts: [100] }); const v = await fn(c, "wf_submit", reqId);
      expect(await fails(c, "SELECT wf_verify($1,$2)", [reqId, v])).toMatch(/./);
      expect(await fails(c, "SELECT wf_authorize($1,$2)", [reqId, v])).toMatch(/./);
    });
  });

  it("a TIN must still be valid and unique, whoever enters it", async () => {
    for (const who of [user.meron, user.dawit]) await as(who, async (c) => {
      expect(await fails(c, update, [S_ADDIS, "Addis Hardware Traders", "12", null])).toMatch(/check constraint/);
      expect(await fails(c, update, [S_ADDIS, "Addis Hardware Traders", "bad tin!", null])).toMatch(/check constraint/);
      expect(await fails(c, update, [S_ADDIS, "Addis Hardware Traders", hawassa.tin, null])).toMatch(/unique/);
    });
  });
  it("nothing can change while a request holds funds, for an Accountant or a Finance Manager", async () => {
    await as(user.meron, async (c) => {
      await fn(c, "wf_submit", await mk(c, user.meron, { supplier: S_HAWASSA, amounts: [100] }));
      for (const who of [user.meron, user.dawit]) {
        await actAs(c, who);
        expect(await fails(c, update, [S_HAWASSA, "Renamed", hawassa.tin, null])).toMatch(/requests in progress/);
        expect(await fails(c, update, [S_HAWASSA, hawassa.legal_name, "0011111111", null])).toMatch(/requests in progress/);
        expect(await fails(c, update, [S_HAWASSA, hawassa.legal_name, "", null])).toMatch(/requests in progress/);
        await c.query(update, [S_HAWASSA, hawassa.legal_name, hawassa.tin, null]);                                              // nothing changes, so it is allowed
      }
      await actAs(c, user.dawit);
      expect(await fails(c, update, [S_HAWASSA, hawassa.legal_name, hawassa.tin, false])).toMatch(/requests in progress/);
    });
  });
  it("a supplier the Accountant's company does not use can be corrected too, because the list is the group's", async () => {
    await as(user.meron, async (c) => {
      expect((await rows(c, "SELECT 1 FROM company_suppliers WHERE supplier_id = $1", [S_ETHIO]))).toEqual([]);                 // only Berbero uses it
      await c.query(update, [S_ETHIO, "Ethio Chemicals SC", "0023456700", null]);
      expect((await facts(c, S_ETHIO)).tin).toBe("0023456700");
    });
  });
  it("a request paying the supplier still works after a correction", async () => {
    await owner.query("BEGIN");
    await actAs(owner, user.meron); await owner.query(update, [S_HAWASSA, hawassa.legal_name, "", null]);
    const r = await authorized(owner, { supplier: S_HAWASSA, amounts: [100] });
    expect((await rows(owner, "SELECT workflow_state::text s FROM payment_requests WHERE id = $1", [r.id]))[0].s).toBe("AUTHENTICATED");
    await owner.query("ROLLBACK");
  });
});
