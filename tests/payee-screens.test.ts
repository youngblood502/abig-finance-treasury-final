import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { Tx } from "../src/lib/db";
import { listFilters, needsVerifying, personList, readyMethods, supplierList, verifiedVersion } from "../src/lib/payee-screens";
import { ACCESS_LABEL, accountList } from "../src/lib/treasury-screens";
import { actAs, ASKU, authorized, AWASH, BD_HAWASSA, BERBERO, CBE, fails, rows, setupDb, S_HAWASSA, S_ETHIO, S_ADDIS, user } from "./helpers";

describe("how a person can be paid", () => {
  it("cash and cheque need no details, so a one-time payee can be paid straight away", () => { expect(readyMethods([]).sort()).toEqual(["CASH", "CHEQUE"]); });
  it("transfer and Telebirr need verified details of the right kind", () => {
    expect(readyMethods([{ kind: "BANK", status: "PENDING" }])).not.toContain("TRANSFER");
    expect(readyMethods([{ kind: "BANK", status: "REJECTED" }])).not.toContain("TRANSFER");
    expect(readyMethods([{ kind: "BANK", status: "VERIFIED" }])).toContain("TRANSFER");
    expect(readyMethods([{ kind: "BANK", status: "VERIFIED" }])).not.toContain("TELEBIRR");
    expect(readyMethods([{ kind: "TELEBIRR", status: "VERIFIED" }])).toContain("TELEBIRR");
  });
});
describe("the list filters", () => {
  it("say what needs attention", () => {
    expect(listFilters(true, [])).toEqual({ status: "active", details: "none" });
    expect(listFilters(false, [{ status: "VERIFIED" }])).toEqual({ status: "inactive", details: "verified" });
    expect(listFilters(true, [{ status: "PENDING" }, { status: "VERIFIED" }]).details).toBe("pending");
    expect(needsVerifying([{ status: "REJECTED" }])).toBe(false);
    expect(verifiedVersion([{ status: "SUPERSEDED" }])).toBeNull();
  });
  it("name each access level", () => { expect(Object.keys(ACCESS_LABEL).sort()).toEqual(["FULL", "NONE", "TICK"]); });
});

describe("the screens as the application role", () => {
  let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
  let askuPerson: string, berberoPerson: string, pending: string;
  const tx = (c: Client): Tx => ({ q: async (sql, p) => (await c.query(sql, p as unknown[])).rows });
  const person = async (c: Client, name: string, company: string, phone: string, hash: string) => (await c.query("SELECT person_payee_create($1,$2,$3,'v1:cipher','1234',$4,'CASH') id", [company, name, phone, hash.repeat(64)])).rows[0].id as string;

  beforeAll(async () => {
    const d = await setupDb("abig_test_payee_screens"); owner = d.owner; as = d.as;
    await owner.query("BEGIN");
    await actAs(owner, user.meron); askuPerson = await person(owner, "Almaz Private", ASKU, "0911000001", "a");
    pending = (await owner.query("SELECT person_detail_add($1,'BANK','Dashen','4321',NULL) id", [askuPerson])).rows[0].id;
    await actAs(owner, user.nardos); berberoPerson = await person(owner, "Berhanu Private", BERBERO, "0911000002", "b");
    await authorized(owner, { amounts: [1000], method: "TRANSFER" });                                                         // ASKU pays Hawassa
    await owner.query("INSERT INTO company_suppliers (company_id, supplier_id, created_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [BERBERO, S_HAWASSA, user.nardos]);
    await authorized(owner, { company: BERBERO, supplier: S_HAWASSA, bank: BD_HAWASSA, amounts: [2000], method: "TRANSFER" });   // both pay Hawassa
    await owner.query("COMMIT");
  });
  afterAll(async () => { await owner?.end(); });

  it("people stay inside their own company", async () => {
    await as(user.meron, async (c) => { expect((await personList(tx(c), null)).map((p) => p.full_name)).toEqual(["Almaz Private"]); });
    await as(user.nardos, async (c) => { expect((await personList(tx(c), null)).map((p) => p.full_name)).toEqual(["Berhanu Private"]); expect(await personList(tx(c), ASKU)).toEqual([]); });
    await as(user.bereket, async (c) => { expect(await personList(tx(c), null)).toEqual([]); });
    await as(user.admin, async (c) => { expect((await personList(tx(c), BERBERO)).map((p) => p.id)).toEqual([berberoPerson]); });
  });
  it("another company's person cannot be reached by id either", async () => {
    await as(user.nardos, async (c) => {
      expect(await rows(c, "SELECT id FROM person_payment_details WHERE person_id = $1", [askuPerson])).toEqual([]);
      expect(await fails(c, "SELECT person_detail_add($1,'BANK','Dashen','1111',NULL)", [askuPerson])).toMatch(/person not found/);
      expect(await fails(c, "SELECT person_detail_decide($1,true,NULL)", [pending])).toMatch(/payment details not found/);
    });
  });
  it("an ID number stays masked, and cannot be read here at all", async () => {
    await as(user.meron, async (c) => {
      const p = (await personList(tx(c), null))[0];
      expect(p.id_last4).toBe("1234"); expect(JSON.stringify(p)).not.toContain("cipher");
      expect(await fails(c, "SELECT id_number_enc FROM person_payees")).toMatch(/permission denied/);
      expect(await fails(c, "SELECT id_hash FROM person_payees")).toMatch(/permission denied/);
    });
  });
  it("a person shows their versions, and whoever entered details cannot verify them", async () => {
    await as(user.meron, async (c) => {
      const p = (await personList(tx(c), null))[0];
      expect(p.versions.map((v) => [v.bank_name, v.status])).toEqual([["Dashen", "PENDING"]]);
      expect(readyMethods(p.versions)).not.toContain("TRANSFER");
      expect(await fails(c, "SELECT person_detail_decide($1,true,NULL)", [pending])).toMatch(/only a Finance Manager/);
    });
    await as(user.yared, async (c) => {
      await actAs(c, user.meron); const mine = (await c.query("SELECT person_detail_add($1,'TELEBIRR',NULL,NULL,'0911000001') id", [askuPerson])).rows[0].id;
      await actAs(c, user.dawit); await c.query("SELECT person_detail_decide($1,true,NULL)", [mine]);
      expect(readyMethods((await personList(tx(c), null))[0].versions)).toContain("TELEBIRR");
    });
  });

  it("suppliers are one list, and a supplier's companies show only for the person's own", async () => {
    const seen = (who: string) => as(who, async (c) => (await supplierList(tx(c), null)).find((s) => s.id === S_ETHIO)!);
    const meron = await seen(user.meron), nardos = await seen(user.nardos);
    expect(meron.legal_name).toBe(nardos.legal_name);
    expect(meron.links.every((l) => l.company_id === ASKU)).toBe(true);
    expect(nardos.links.every((l) => l.company_id === BERBERO)).toBe(true);
    await as(user.bereket, async (c) => { expect((await supplierList(tx(c), ASKU))).toEqual([]); });
  });
  it("the company switcher narrows the list", async () => {
    await as(user.meron, async (c) => {
      const all = await supplierList(tx(c), null), asku = await supplierList(tx(c), ASKU);
      expect(asku.length).toBeLessThanOrEqual(all.length);
      expect(asku.every((s) => s.links.some((l) => l.company_id === ASKU))).toBe(true);
    });
  });
  it("payment history holds only the person's own companies' payments", async () => {
    const paid = (who: string) => as(who, async (c) => (await supplierList(tx(c), null)).find((s) => s.id === S_HAWASSA)!.history);
    expect((await paid(user.meron)).every((p) => p.company === "ASKU PLC")).toBe(true);
    expect((await paid(user.meron)).length).toBeGreaterThan(0);
    expect((await paid(user.nardos)).every((p) => p.company !== "ASKU PLC")).toBe(true);
    await as(user.meron, async (c) => { expect((await supplierList(tx(c), BERBERO)).flatMap((s) => s.history)).toEqual([]); });
  });
  it("a supplier's bank details cannot be verified by whoever entered them", async () => {
    await as(user.meron, async (c) => {
      const id = (await c.query("INSERT INTO supplier_bank_details (supplier_id, bank_name, account_last4, created_by) VALUES ($1,'Abay','9999',$2) RETURNING id", [S_ADDIS, user.meron])).rows[0].id;
      const v = (await supplierList(tx(c), null)).find((s) => s.id === S_ADDIS)!.versions.find((x) => x.id === id)!;
      expect([v.status, v.created_by]).toEqual(["PENDING", user.meron]);
      await c.query("SAVEPOINT u");
      const changed = await c.query("UPDATE supplier_bank_details SET status = 'VERIFIED', verified_by = $2 WHERE id = $1", [id, user.meron]).then((r) => r.rowCount, () => 0);
      expect(changed).toBe(0);
      await c.query("ROLLBACK TO u");
    });
  });

  it("an account separates its owner from those it was shared with", async () => {
    const cbe = (who: string) => as(who, async (c) => (await accountList(tx(c), null)).find((a) => a.id === CBE)!);
    const samuel = await cbe(user.samuel), meron = await cbe(user.meron), tigist = await cbe(user.tigist);
    expect(samuel.owner).toBe("BEES PLC");
    for (const a of [samuel, meron, tigist]) { expect(a.owner).toBe("BEES PLC"); expect(a.users.filter((u) => u.is_owner).map((u) => u.name)).toEqual(["BEES PLC"]); expect(a.users.length).toBe(3); }
    expect(meron.users.find((u) => u.company_id === ASKU)!.permissions).not.toContain("RECORD_SNAPSHOT");
    expect(tigist.users.find((u) => u.company_id === BERBERO)!.permissions).toContain("RECORD_SNAPSHOT");
    expect([samuel.access, tigist.access, meron.access]).toEqual(["FULL", "TICK", "NONE"]);
  });
  it("only the owner's managers may change who shares an account", async () => {
    await as(user.abebe, async (c) => { expect((await accountList(tx(c), null)).find((a) => a.id === CBE)!.can_manage).toBe(true); });
    await as(user.meron, async (c) => {
      const a = (await accountList(tx(c), null)).find((x) => x.id === CBE)!;
      expect(a.can_manage).toBe(false);
      const grant = a.users.find((u) => u.company_id === BERBERO)!;
      expect((await c.query("UPDATE company_bank_account_access SET revoked_at = now() WHERE id = $1", [grant.id])).rowCount).toBe(0);
      await c.query("SAVEPOINT g");
      await expect(c.query("INSERT INTO company_bank_account_access (account_id, company_id, permissions, granted_by) VALUES ($1,$2,'{USE}',$3)", [AWASH, BERBERO, user.tigist])).rejects.toThrow();
      await c.query("ROLLBACK TO g");
    });
  });
});
