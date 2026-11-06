import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { Tx } from "../src/lib/db";
import { accountDetail, startsTicked } from "../src/lib/treasury-screens";
import { actAs, authorized, CBE, enterFigure, rows, setupDb, user } from "./helpers";

// Each step commits, and each read is a new connection, which is what reopening or reloading the page does.
describe("undoing a tick", () => {
  let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
  let undone: string, other: string, cheque: string;
  const tx = (c: Client): Tx => ({ q: async (sql, p) => (await c.query(sql, p as unknown[])).rows });
  const committed = async (who: string, sql: string, p: unknown[]) => { await owner.query("BEGIN"); await actAs(owner, who); const r = await rows(owner, sql, p); await owner.query("COMMIT"); return r[0]; };
  const reload = (who: string, id: string) => as(who, async (c) => (await accountDetail(tx(c), CBE))!.payments.find((p) => p.id === id)!);
  const opensTicked = async (who: string, id: string) => { const p = await reload(who, id); expect(p.processed_at).toBeNull(); return startsTicked(p); };
  const balance = async () => Number((await rows(owner, "SELECT current_balance b FROM company_bank_accounts WHERE id = $1", [CBE]))[0].b);

  beforeAll(async () => {
    const d = await setupDb("abig_test_tick_reversal"); owner = d.owner; as = d.as;
    await owner.query("BEGIN");
    await actAs(owner, user.samuel); await enterFigure(owner, CBE, 3000000);
    undone = (await authorized(owner, { account: CBE, amounts: [100000], method: "TRANSFER" })).id;
    other = (await authorized(owner, { account: CBE, amounts: [200000], method: "TRANSFER" })).id;
    cheque = (await authorized(owner, { account: CBE, amounts: [400000], method: "CHEQUE" })).id;
    await owner.query("COMMIT");
  });
  afterAll(async () => { await owner?.end(); });

  it("a new balance check starts from the usual defaults", async () => {
    expect(await opensTicked(user.samuel, undone)).toBe(true);
    expect(await opensTicked(user.samuel, cheque)).toBe(false);
  });

  it("undoing keeps the payment unticked when the page is reloaded, for everyone who ticks", async () => {
    await committed(user.samuel, "SELECT * FROM record_balance_check($1, 3000000, $2)", [CBE, [undone]]);
    expect((await reload(user.samuel, undone)).processed_at).not.toBeNull();
    const before = await balance();
    await committed(user.samuel, "SELECT undo_processed_tick($1, 'Bank reversed it')", [undone]);
    expect(await balance()).toBe(before);
    for (const who of [user.samuel, user.tigist]) {
      expect((await reload(who, undone)).tick_undone).toBe(true);
      expect(await opensTicked(who, undone)).toBe(false);
    }
  });

  it("does not affect any other payment", async () => {
    expect((await reload(user.samuel, other)).tick_undone).toBe(false);
    expect(await opensTicked(user.samuel, other)).toBe(true);
    expect(await opensTicked(user.samuel, cheque)).toBe(false);
  });

  it("stays unticked through later checks that leave it alone, and the balance counts it", async () => {
    const entry = await committed(user.samuel, "SELECT * FROM record_balance_check($1, 3000000, $2)", [CBE, [other]]);
    expect(Number(entry.outstanding_total)).toBe(500000);                                                                     // undone and cheque
    expect(await balance()).toBe(2500000);
    expect(await opensTicked(user.samuel, undone)).toBe(false);
  });

  it("is ticked again only when someone selects it", async () => {
    const entry = await committed(user.tigist, "SELECT * FROM record_balance_check($1, 3000000, $2)", [CBE, [undone]]);
    expect(Number(entry.outstanding_total)).toBe(400000);                                                                     // cheque only
    const p = await reload(user.samuel, undone);
    expect(p.processed_at).not.toBeNull(); expect(p.tick_undone).toBe(false);
  });

  it("undoing the same payment again keeps it unticked again", async () => {
    await committed(user.samuel, "SELECT undo_processed_tick($1, 'Reversed a second time')", [undone]);
    expect(await opensTicked(user.samuel, undone)).toBe(false);
    expect((await reload(user.samuel, undone)).tick_undone).toBe(true);
    expect((await rows(owner, "SELECT count(*)::int n FROM audit_events WHERE action = 'PROCESSED_TICK_UNDONE' AND entity_id = $1", [undone]))[0].n).toBe(2);
  });

  it("a payment authenticated afterwards still starts from its default", async () => {
    await owner.query("BEGIN");
    const fresh = (await authorized(owner, { account: CBE, amounts: [5000], method: "TRANSFER" })).id;
    await owner.query("COMMIT");
    expect(await opensTicked(user.samuel, fresh)).toBe(true);
  });

  it("the owning company sees the undone tick, and a company with no access to the payment does not", async () => {
    expect((await reload(user.meron, undone)).tick_undone).toBe(true);
    expect(await as(user.hana, async (c) => (await accountDetail(tx(c), CBE))!.payments.some((p) => p.id === undone))).toBe(false);
  });
});
