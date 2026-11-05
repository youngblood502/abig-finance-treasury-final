import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { AWASH, mk, rows, setupDb, user } from "./helpers";

// These tests COMMIT data (two real connections at once), so they get a database of their own.
let owner: Client; let appUrl: string;
beforeAll(async () => { const d = await setupDb("abig_test_p7b"); owner = d.owner; appUrl = d.appUrl; });
afterAll(async () => { await owner?.end(); });

describe("concurrent money movements", () => {
  it("two people submitting at the same moment cannot spend the same money", async () => {
    const [a, b] = [new Client({ connectionString: appUrl }), new Client({ connectionString: appUrl })]; await Promise.all([a.connect(), b.connect()]);
    // committed drafts (an app role can create them), 800,000 each against 1,150,000 available
    const mkc = async (c: Client, ref: string) => { await c.query("BEGIN"); await c.query("SELECT set_config('app.user_id',$1,true)", [user.meron]); const id = await mk(c, user.meron, { amounts: [800000], ref }); await c.query("COMMIT"); return id; };
    const r1 = await mkc(a, "RACE-1"), r2 = await mkc(a, "RACE-2");
    try {
      await a.query("BEGIN"); await a.query("SELECT set_config('app.user_id',$1,true)", [user.meron]); await a.query("SELECT wf_submit($1)", [r1]);   // holds the account lock until it commits
      await b.query("BEGIN"); await b.query("SELECT set_config('app.user_id',$1,true)", [user.meron]);
      const second = b.query("SELECT wf_submit($1)", [r2]).then(() => "ok", (e: Error) => e.message);                                            // waits for the lock
      await new Promise((r) => setTimeout(r, 300)); await a.query("COMMIT");
      expect(await second).toMatch(/more than the available balance \(ETB 350,000.00\)/);
      await b.query("ROLLBACK");
      expect(Number((await rows(owner, "SELECT reserved_balance r FROM company_bank_accounts WHERE id=$1", [AWASH]))[0].r)).toBe(800000);
    } finally { await a.end(); await b.end(); }
  });

  it("two Owners authenticating at the same moment debit the account once", async () => {
    const id = await (async () => { const c = new Client({ connectionString: appUrl }); await c.connect(); try { await c.query("BEGIN"); await c.query("SELECT set_config('app.user_id',$1,true)", [user.meron]); const r = await mk(c, user.meron, { amounts: [50000], ref: "TWICE" }); const v = (await c.query("SELECT wf_submit($1) v", [r])).rows[0].v; await c.query("SELECT set_config('app.user_id',$1,true)", [user.dawit]); await c.query("SELECT wf_verify($1,$2)", [r, v]); await c.query("COMMIT"); return r; } finally { await c.end(); } })();
    const version = Number((await rows(owner, "SELECT version FROM payment_requests WHERE id=$1", [id]))[0].version);
    const before = Number((await rows(owner, "SELECT current_balance c FROM company_bank_accounts WHERE id=$1", [AWASH]))[0].c);
    const go = async (who: string) => { const c = new Client({ connectionString: appUrl }); await c.connect(); try { await c.query("BEGIN"); await c.query("SELECT set_config('app.user_id',$1,true)", [who]); await c.query("SELECT wf_authorize($1,$2)", [id, version]); await c.query("COMMIT"); return "ok"; } catch (e) { await c.query("ROLLBACK"); return (e as Error).message; } finally { await c.end(); } };
    const results = await Promise.all([go(user.kebede), go(user.yared)]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1); expect(results.find((r) => r !== "ok")).toMatch(/changed|not waiting|already acted/);
    expect(Number((await rows(owner, "SELECT current_balance c FROM company_bank_accounts WHERE id=$1", [AWASH]))[0].c)).toBe(before - 50000);
  });
});
