import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { ASKU, BD_ETHIO, BERBERO, mk, rows, setupDb, S_ETHIO, user } from "./helpers";

// A reservation and a withdrawal of access both serialize on the bank account's row. These use real connections at the same moment, so they commit,
// and get a database of their own. Each test registers a new account, owned by ASKU and shared with Berbero.
let owner: Client; let appUrl: string;
beforeAll(async () => { const d = await setupDb("abig_test_withdrawal_race"); owner = d.owner; appUrl = d.appUrl; });
afterAll(async () => { await owner?.end(); });

const FUNDS = 500000, AMOUNT = 120000;
let seq = 0;
async function connect(who: string) {
  const c = new Client({ connectionString: appUrl }); await c.connect();
  const begin = async () => { await c.query("BEGIN"); await c.query("SELECT set_config('app.user_id',$1,true)", [who]); };
  return { c, begin };
}
/** Runs in one committed transaction, and returns the error message if it was refused. */
const attempt = async (who: string, sql: string, p: unknown[]) => {
  const { c, begin } = await connect(who);
  try { await begin(); await c.query(sql, p); await c.query("COMMIT"); return "done"; } catch (e) { await c.query("ROLLBACK"); return (e as Error).message; } finally { await c.end(); }
};
const must = async (who: string, sql: string, p: unknown[]) => { const r = await attempt(who, sql, p); expect(r).toBe("done"); };

const SUBMIT = "SELECT wf_submit($1)", WITHDRAW = "UPDATE company_bank_account_access SET revoked_at = now() WHERE account_id = $1 AND company_id = $2 AND revoked_at IS NULL";
const withdrawArgs = (account: string) => [account, BERBERO];

/** A new shared account with an opening balance. */
async function sharedAccount() {
  const { c, begin } = await connect(user.kebede); await begin();
  const account = (await c.query("SELECT register_bank_account($1,'CBE',$2,'1234',NULL,0) v", [ASKU, `Shared ${++seq}`])).rows[0].v as string;
  await c.query("INSERT INTO company_bank_account_access (account_id, company_id, permissions, granted_by) VALUES ($1,$2,'{USE}',$3)", [account, BERBERO, user.kebede]);
  await c.query("COMMIT"); await c.end();
  await must(user.meron, "SELECT record_opening_balance($1,$2)", [account, FUNDS]);
  return account;
}
const draft = async (account: string, who = user.nardos, company = BERBERO) => {
  const { c, begin } = await connect(who); await begin();
  const id = await mk(c, who, company === BERBERO ? { company, supplier: S_ETHIO, bank: BD_ETHIO, account, amounts: [AMOUNT] } : { account, amounts: [1000] });
  await c.query("COMMIT"); await c.end();
  return id;
};
const waiting = async () => {
  for (let i = 0; i < 100; i++) {
    const n = (await rows(owner, "SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()"))[0].n as number;
    if (n > 0) return n;
    await new Promise((r) => setTimeout(r, 50));
  }
  return 0;
};
/** The first step runs and stays uncommitted, so it holds the account lock. The second must wait for it. `end` finishes the first. */
async function raced(firstWho: string, first: string, firstArgs: unknown[], secondWho: string, second: string, secondArgs: unknown[], end: "COMMIT" | "ROLLBACK" = "COMMIT") {
  const a = await connect(firstWho);
  try {
    await a.begin(); await a.c.query(first, firstArgs);
    const later = attempt(secondWho, second, secondArgs);
    const blocked = await waiting();
    await a.c.query(end);
    return { blocked, second: await later };
  } finally { await a.c.end(); }
}
const state = async (id: string) => (await rows(owner, "SELECT workflow_state::text s FROM payment_requests WHERE id = $1", [id]))[0].s as string;
const reserved = async (account: string) => Number((await rows(owner, "SELECT reserved_balance r FROM company_bank_accounts WHERE id = $1", [account]))[0].r);
const held = async (account: string) => Number((await rows(owner, "SELECT COALESCE(sum(total_amount),0) s FROM payment_requests WHERE debit_account_id = $1 AND workflow_state IN ('RESERVED','VERIFIED')", [account]))[0].s);
const granted = async (account: string) => (await rows(owner, "SELECT 1 FROM company_bank_account_access WHERE account_id = $1 AND company_id = $2 AND revoked_at IS NULL", [account, BERBERO])).length === 1;
/** No company without access may hold funds on the account, and the reserved figure must equal what requests hold. */
const noStranded = async (account: string) => {
  expect((await rows(owner, `SELECT r.request_no FROM payment_requests r WHERE r.debit_account_id = $1 AND r.workflow_state IN ('RESERVED','VERIFIED')
    AND NOT EXISTS (SELECT 1 FROM company_bank_account_access g WHERE g.account_id = r.debit_account_id AND g.company_id = r.debtor_company_id AND g.revoked_at IS NULL)`, [account]))).toEqual([]);
  expect(await reserved(account)).toBe(await held(account));
};

describe("a reservation against a withdrawal of access", () => {
  it("the reservation wins the lock: the withdrawal waits, then fails", async () => {
    const account = await sharedAccount(), id = await draft(account);
    const r = await raced(user.nardos, SUBMIT, [id], user.kebede, WITHDRAW, withdrawArgs(account));
    expect(r.blocked).toBeGreaterThan(0);
    expect(r.second).toMatch(/requests holding funds on this account/);
    expect([await state(id), await granted(account), await reserved(account)]).toEqual(["RESERVED", true, AMOUNT]);
    await noStranded(account);
    await must(user.fikru, "SELECT wf_verify($1,2)", [id]);                                                                     // not stranded: it moves on
    expect(await state(id)).toBe("VERIFIED");
  });
  it("the withdrawal wins the lock: the reservation waits, then fails and leaves nothing behind", async () => {
    const account = await sharedAccount(), id = await draft(account);
    const trail = async () => [(await rows(owner, "SELECT version FROM payment_requests WHERE id = $1", [id]))[0].version, (await rows(owner, "SELECT count(*)::int n FROM request_events WHERE request_id = $1", [id]))[0].n];
    const before = await trail();
    const r = await raced(user.kebede, WITHDRAW, withdrawArgs(account), user.nardos, SUBMIT, [id]);
    expect(r.blocked).toBeGreaterThan(0);
    expect(r.second).toMatch(/the debit account is not available to this company/);
    expect([await state(id), await granted(account), await reserved(account)]).toEqual(["DRAFT", false, 0]);
    expect(await trail()).toEqual(before);                                                                                      // the refused reservation left no version or event
    await noStranded(account);
  });
  it("a withdrawal that wins does not touch another company's reservation", async () => {
    const account = await sharedAccount(), asku = await draft(account, user.meron, ASKU), id = await draft(account);
    await must(user.meron, SUBMIT, [asku]);
    const r = await raced(user.kebede, WITHDRAW, withdrawArgs(account), user.nardos, SUBMIT, [id]);
    expect(r.second).toMatch(/not available/);
    expect([await state(asku), await reserved(account)]).toEqual(["RESERVED", 1000]);
    await noStranded(account);
  });
  it("a withdrawal that is rolled back lets the waiting reservation through", async () => {
    const account = await sharedAccount(), id = await draft(account);
    const r = await raced(user.kebede, WITHDRAW, withdrawArgs(account), user.nardos, SUBMIT, [id], "ROLLBACK");
    expect([r.blocked > 0, r.second]).toEqual([true, "done"]);
    expect([await state(id), await granted(account), await reserved(account)]).toEqual(["RESERVED", true, AMOUNT]);
    await noStranded(account);
  });
  it("a reservation that is rolled back lets the waiting withdrawal through", async () => {
    const account = await sharedAccount(), id = await draft(account);
    const r = await raced(user.nardos, SUBMIT, [id], user.kebede, WITHDRAW, withdrawArgs(account), "ROLLBACK");
    expect([r.blocked > 0, r.second]).toEqual([true, "done"]);
    expect([await state(id), await granted(account), await reserved(account)]).toEqual(["DRAFT", false, 0]);
    await noStranded(account);
  });
  it("a cancellation in progress releases the funds exactly once, then the withdrawal goes through", async () => {
    const account = await sharedAccount(), id = await draft(account);
    await must(user.nardos, SUBMIT, [id]);
    const r = await raced(user.nardos, "SELECT wf_cancel($1,2,'Moving it')", [id], user.kebede, WITHDRAW, withdrawArgs(account));
    expect([r.blocked > 0, r.second]).toEqual([true, "done"]);
    expect([await state(id), await granted(account), await reserved(account)]).toEqual(["CANCELLED", false, 0]);
    await noStranded(account);
  });
  it("whichever arrives first, exactly one of them succeeds and the figures agree", async () => {
    const outcomes = { reserved: 0, withdrawn: 0 };
    for (let round = 0; round < 12; round++) {
      const account = await sharedAccount(), id = await draft(account);
      const [submit, withdraw] = await Promise.all([attempt(user.nardos, SUBMIT, [id]), attempt(user.kebede, WITHDRAW, withdrawArgs(account))]);
      expect([submit, withdraw].filter((x) => x === "done")).toHaveLength(1);
      if (submit === "done") { outcomes.reserved++; expect([await state(id), await granted(account), await reserved(account)]).toEqual(["RESERVED", true, AMOUNT]); }
      else { outcomes.withdrawn++; expect([await state(id), await granted(account), await reserved(account)]).toEqual(["DRAFT", false, 0]); }
      await noStranded(account);
    }
    expect(outcomes.reserved + outcomes.withdrawn).toBe(12);
  });
});
