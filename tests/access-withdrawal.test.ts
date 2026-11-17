import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { Tx } from "../src/lib/db";
import { accountDetail, accountList, paymentSchedule, treasuryOverview } from "../src/lib/treasury-screens";
import { actAs, ASKU, authorized, BD_ETHIO, BERBERO, CBE, enterFigure, fails, fn, mk, rows, setupDb, S_ETHIO, user } from "./helpers";

const withdraw = "UPDATE company_bank_account_access SET revoked_at = now() WHERE account_id = $1 AND company_id = $2 AND revoked_at IS NULL";

// Regression: withdrawing access used to strand a request holding funds: it could not be verified or authenticated, and its funds stayed reserved. Each test rolls back.
describe("withdrawing a company's access to a shared account", () => {
  let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
  const tx = (c: Client): Tx => ({ q: async (sql, p) => (await c.query(sql, p as unknown[])).rows });
  const reserved = async (c: Client) => Number((await rows(c, "SELECT reserved_balance r FROM company_bank_accounts WHERE id = $1", [CBE]))[0].r);
  const hasAccess = async (c: Client, company: string) => (await rows(c, "SELECT 1 FROM company_bank_account_access WHERE account_id = $1 AND company_id = $2 AND revoked_at IS NULL", [CBE, company])).length === 1;
  const berberoRequest = (c: Client) => mk(c, user.nardos, { company: BERBERO, supplier: S_ETHIO, bank: BD_ETHIO, account: CBE, amounts: [120000], dues: ["2026-12-01"] });
  /** Runs as Abebe, who may manage the account, on one connection: other people are switched in with actAs. */
  const scenario = (f: (c: Client) => Promise<void>) => as(user.samuel, async (c) => { await enterFigure(c, CBE, 3000000); await f(c); });

  beforeAll(async () => { const d = await setupDb("abig_test_access_withdrawal"); owner = d.owner; as = d.as; });
  afterAll(async () => { await owner?.end(); });

  it("is refused while the company's request is Reserved, and nothing changes", async () => {
    await scenario(async (c) => {
      await actAs(c, user.nardos); const id = await berberoRequest(c); const v = await fn(c, "wf_submit", id);
      await actAs(c, user.abebe);
      expect(await fails(c, withdraw, [CBE, BERBERO])).toMatch(/requests holding funds on this account/);
      expect(await hasAccess(c, BERBERO)).toBe(true);
      expect(await reserved(c)).toBe(120000);
      await actAs(c, user.nardos); expect((await rows(c, "SELECT workflow_state::text s FROM payment_requests WHERE id = $1", [id]))[0].s).toBe("RESERVED");
      await actAs(c, user.fikru); await fn(c, "wf_verify", id, v);                                                               // and the request can still move on
    });
  });
  it("is refused while the request is Verified, and it can still be authenticated", async () => {
    await scenario(async (c) => {
      await actAs(c, user.nardos); const id = await berberoRequest(c); const v1 = await fn(c, "wf_submit", id);
      await actAs(c, user.fikru); const v2 = await fn(c, "wf_verify", id, v1);
      await actAs(c, user.abebe);
      expect(await fails(c, withdraw, [CBE, BERBERO])).toMatch(/holding funds/);
      await actAs(c, user.hana); await fn(c, "wf_authorize", id, v2);
      expect(await reserved(c)).toBe(0);
    });
  });
  it("goes through once the request is cancelled, with the funds released", async () => {
    await scenario(async (c) => {
      await actAs(c, user.nardos); const id = await berberoRequest(c); const v = await fn(c, "wf_submit", id);
      await fn(c, "wf_cancel", id, v, "Moving to another account");
      expect(await reserved(c)).toBe(0);
      await actAs(c, user.abebe);
      expect((await c.query(withdraw, [CBE, BERBERO])).rowCount).toBe(1);
      expect(await hasAccess(c, BERBERO)).toBe(false);
    });
  });
  it("is not held up by another company's reservation or by a draft", async () => {
    await scenario(async (c) => {
      await actAs(c, user.meron); await fn(c, "wf_submit", await mk(c, user.meron, { account: CBE, amounts: [5000] }));          // ASKU holds funds here
      await actAs(c, user.nardos); await berberoRequest(c);                                                                      // Berbero has only a draft
      await actAs(c, user.abebe);
      expect((await c.query(withdraw, [CBE, BERBERO])).rowCount).toBe(1);
      expect(await reserved(c)).toBe(5000);                                                                                      // ASKU's stays
      expect(await hasAccess(c, ASKU)).toBe(true);
    });
  });

  it("an Authenticated payment stays correct and reconcilable, and the company loses the account", async () => {
    await scenario(async (c) => {
      const { id } = await authorized(c, { company: BERBERO, amounts: [400000], method: "TRANSFER" });
      await actAs(c, user.samuel); const balance = (await rows(c, "SELECT current_balance b FROM company_bank_accounts WHERE id = $1", [CBE]))[0].b;
      await actAs(c, user.abebe); expect((await c.query(withdraw, [CBE, BERBERO])).rowCount).toBe(1);
      expect((await rows(c, "SELECT current_balance b FROM company_bank_accounts WHERE id = $1", [CBE]))[0].b).toBe(balance);

      await actAs(c, user.nardos);
      expect((await rows(c, "SELECT workflow_state::text s FROM payment_requests WHERE id = $1", [id]))[0].s).toBe("AUTHENTICATED");   // its own record
      expect(await accountDetail(tx(c), CBE)).toBeNull();
      expect((await accountList(tx(c), null)).some((a) => a.id === CBE)).toBe(false);
      expect((await treasuryOverview(tx(c), null)).some((a) => a.account_id === CBE)).toBe(false);
      expect(await rows(c, "SELECT 1 FROM account_balance_history($1, 100)", [CBE])).toEqual([]);
      expect(await rows(c, "SELECT 1 FROM outstanding_payments($1)", [CBE])).toEqual([]);
      expect(await fails(c, "SELECT record_balance_check($1, 1)", [CBE])).toMatch(/you may not update/);
      await c.query("SAVEPOINT r");
      await expect(berberoRequest(c)).rejects.toThrow(/the debit account is not available/);                                      // no new request can name it
      await c.query("ROLLBACK TO r");
      expect(await paymentSchedule(tx(c), null)).toEqual([]);

      await actAs(c, user.tigist); expect(await accountDetail(tx(c), CBE)).toBeNull();
      await actAs(c, user.samuel);                                                                                               // the owner still answers for the payment
      const seen = (await accountDetail(tx(c), CBE))!;
      expect(seen.payments.map((p) => p.id)).toEqual([id]);
      expect(seen.facts.companies).not.toContain("Berbero Petrochemical PLC");
    });
  });

  it("only the account's managers can withdraw access, and it can be granted again", async () => {
    await as(user.meron, async (c) => { expect((await c.query(withdraw, [CBE, BERBERO])).rowCount).toBe(0); });
    await as(user.samuel, async (c) => {
      await actAs(c, user.abebe); await c.query(withdraw, [CBE, BERBERO]);
      await c.query("INSERT INTO company_bank_account_access (account_id, company_id, permissions, granted_by) VALUES ($1,$2,'{USE}',$3)", [CBE, BERBERO, user.abebe]);
      expect(await hasAccess(c, BERBERO)).toBe(true);
    });
  });
});
