import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { ASKU, mk, rows, setupDb, user } from "./helpers";

// Real connections at the same moment, so these tests COMMIT and get a database of their own. Each one registers its own account.
let owner: Client; let appUrl: string;
beforeAll(async () => { const d = await setupDb("abig_test_weekly_race"); owner = d.owner; appUrl = d.appUrl; });
afterAll(async () => { await owner?.end(); });

let seq = 0;
/** One person's connection. `begin` leaves a transaction open, as a request does while it holds the account lock. */
async function person(who: string) {
  const c = new Client({ connectionString: appUrl }); await c.connect();
  const begin = async () => { await c.query("BEGIN"); await c.query("SELECT set_config('app.user_id',$1,true)", [who]); };
  return { c, begin, commit: () => c.query("COMMIT"), rollback: () => c.query("ROLLBACK"), end: () => c.end(),
    /** Runs and commits, and returns the error text if it was refused. */
    run: async (sql: string, p: unknown[] = []) => { await begin(); try { const r = await c.query(sql, p); await c.query("COMMIT"); return r.rows; } catch (e) { await c.query("ROLLBACK"); return (e as Error).message; } } };
}
const withPerson = async <T>(who: string, f: (p: Awaited<ReturnType<typeof person>>) => Promise<T>) => { const p = await person(who); try { return await f(p); } finally { await p.end(); } };
const once = (who: string, sql: string, p: unknown[] = []) => withPerson(who, (x) => x.run(sql, p));
/** The first statement holds the account lock in an open transaction, so the second must wait for it. Returns the second's result. */
async function raced(firstWho: string, first: string, firstArgs: unknown[], secondWho: string, second: string, secondArgs: unknown[]) {
  const a = await person(firstWho), b = await person(secondWho);
  try {
    await a.begin(); await a.c.query(first, firstArgs);
    const later = b.run(second, secondArgs);
    await new Promise((r) => setTimeout(r, 300));
    const waiting = (await rows(owner, "SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()"))[0].n;
    await a.commit();
    return { result: await later, waiting };
  } finally { await a.end(); await b.end(); }
}
const newAccount = async (figure: number) => {
  const r = await once(user.kebede, "SELECT register_bank_account($1,'CBE',$2,'1234',NULL,0) v", [ASKU, `Race ${++seq}`]) as { v: string }[];
  await once(user.meron, "SELECT record_opening_balance($1,$2)", [r[0].v, figure]);
  return r[0].v;
};
const verified = async (account: string, amount: number, method = "CHEQUE") => withPerson(user.meron, async ({ c }) => {
  await c.query("BEGIN"); await c.query("SELECT set_config('app.user_id',$1,true)", [user.meron]);
  const id = await mk(c, user.meron, { amounts: [amount], account, method });
  const v1 = (await c.query("SELECT wf_submit($1) v", [id])).rows[0].v;
  await c.query("SELECT set_config('app.user_id',$1,true)", [user.dawit]);
  const v2 = (await c.query("SELECT wf_verify($1,$2) v", [id, v1])).rows[0].v;
  await c.query("COMMIT");
  return { id, version: v2 as number };
});
const authenticated = async (account: string, amount: number, method = "CHEQUE") => {
  const { id, version } = await verified(account, amount, method);
  await once(user.kebede, "SELECT wf_authorize($1,$2)", [id, version]);
  return id;
};
const balance = async (id: string) => Number((await rows(owner, "SELECT current_balance c FROM company_bank_accounts WHERE id = $1", [id]))[0].c);
const today = async () => (await rows(owner, "SELECT addis_day(clock_timestamp())::text d"))[0].d as string;
const monday = async () => (await rows(owner, "SELECT week_monday(addis_day(clock_timestamp()))::text d"))[0].d as string;
const weekRow = async (account: string, week: string) => (await rows(owner, "SELECT id, revision FROM treasury_weeks WHERE account_id = $1 AND week_start = $2", [account, week]))[0];
/** A week started and sent for review. */
const prepared = async (account: string, closing: number, reasons: Record<string, string> = {}, matches: string[] = []) => {
  const wk = await monday();
  await once(user.meron, "SELECT start_reconciliation($1,$2,$3,0)", [account, wk, closing]);
  const { id } = await weekRow(account, wk);
  for (const m of matches) expect(Array.isArray(await once(user.meron, "SELECT match_payment($1,$2,$3)", [id, m, await today()]))).toBe(true);
  const rev = (await weekRow(account, wk)).revision;
  const r = await once(user.meron, "SELECT submit_reconciliation($1,$2,$3)", [id, rev, reasons]);
  expect(Array.isArray(r)).toBe(true);
  return { id, revision: (await weekRow(account, wk)).revision as number, week: wk };
};

describe("two people on one account at once", () => {
  it("two balance checks run one after the other, and the second builds on the first", async () => {
    const acct = await newAccount(1000000);
    const { result, waiting } = await raced(user.meron, "SELECT record_balance_check($1, 1100000)", [acct], user.lidya, "SELECT * FROM record_balance_check($1, 1250000)", [acct]);
    expect(waiting).toBeGreaterThan(0);
    const second = (result as Record<string, string>[])[0];
    expect([Number(second.previous_balance), Number(second.implied_deposit)]).toEqual([1100000, 150000]);
    expect(await balance(acct)).toBe(1250000);
  });

  it("two people ticking the same payment: the second is told the list changed, and the payment is ticked once", async () => {
    const acct = await newAccount(1000000); const id = await authenticated(acct, 1000, "TRANSFER");
    const { result } = await raced(user.meron, "SELECT record_balance_check($1, 999000, $2, $2)", [acct, [id]], user.lidya, "SELECT record_balance_check($1, 999000, $2, $2)", [acct, [id]]);
    expect(result).toMatch(/has changed since this page was opened/);
    expect((await rows(owner, "SELECT count(*)::int n FROM bank_balance_history WHERE account_id = $1 AND entry_kind = 'CHECK'", [acct]))[0].n).toBe(1);
    expect((await rows(owner, "SELECT count(*)::int n FROM balance_check_items WHERE request_id = $1 AND processed", [id]))[0].n).toBe(1);
  });

  it("a payment authenticated while a check is being saved is counted, and the money is not lost", async () => {
    const acct = await newAccount(1000000); const { id, version } = await verified(acct, 40000);
    // The check holds the account lock; the authentication waits for it and debits the balance the check just set.
    const { result, waiting } = await raced(user.meron, "SELECT record_balance_check($1, 1020000)", [acct], user.kebede, "SELECT wf_authorize($1,$2)", [id, version]);
    expect(Array.isArray(result)).toBe(true); expect(waiting).toBeGreaterThan(0);
    expect(await balance(acct)).toBe(980000);
    // The other way round: the check waits, then sees the new payment. Its screen did not show it, so it is refused.
    const acct2 = await newAccount(1000000); const v = await verified(acct2, 40000);
    const refused = await raced(user.kebede, "SELECT wf_authorize($1,$2)", [v.id, v.version], user.meron, "SELECT record_balance_check($1, 1000000, '{}', '{}')", [acct2]);
    expect(refused.result).toMatch(/has changed since this page was opened/);
    // With nothing to compare against, the formula still counts it as outstanding: 1,000,000 - 40,000.
    expect(Array.isArray(await once(user.meron, "SELECT record_balance_check($1, 1000000)", [acct2]))).toBe(true);
    expect(await balance(acct2)).toBe(960000);
  });

  it("two people matching one payment: it is matched once", async () => {
    const acct = await newAccount(1000000); const id = await authenticated(acct, 1000); const wk = await monday();
    await once(user.meron, "SELECT start_reconciliation($1,$2,1000000,0)", [acct, wk]); const w = (await weekRow(acct, wk)).id; const d = await today();
    const { result } = await raced(user.meron, "SELECT match_payment($1,$2,$3)", [w, id, d], user.lidya, "SELECT match_payment($1,$2,$3)", [w, id, d]);
    expect(result).toMatch(/reconciliation_lines_match_once/);
    expect((await rows(owner, "SELECT count(*)::int n FROM reconciliation_lines WHERE request_id = $1 AND voided_at IS NULL", [id]))[0].n).toBe(1);
  });

  it("two Finance Managers locking at once: one locks, and the other is told", async () => {
    const acct = await newAccount(1000000); const id = await authenticated(acct, 1000);
    const { id: w, revision } = await prepared(acct, 999000, {}, [id]);
    const { result } = await raced(user.dawit, "SELECT lock_week($1,$2)", [w, revision], user.yared, "SELECT lock_week($1,$2)", [w, revision]);
    expect(result).toMatch(/this week is locked and cannot be changed/);
    expect((await rows(owner, "SELECT workflow_state::text s, paid_by, version FROM payment_requests WHERE id = $1", [id]))[0]).toMatchObject({ s: "PAID", paid_by: user.dawit });
    expect((await rows(owner, "SELECT count(*)::int n FROM audit_events WHERE entity_id = $1 AND action = 'PAYMENT_MARKED_PAID'", [id]))[0].n).toBe(1);
  });

  it("a lock and an authentication at the same moment: the payment lands after the lock, in the next week", async () => {
    const acct = await newAccount(1000000); const { id, version } = await verified(acct, 40000);
    const { id: w, revision, week } = await prepared(acct, 1000000);
    const { result, waiting } = await raced(user.dawit, "SELECT lock_week($1,$2)", [w, revision], user.kebede, "SELECT wf_authorize($1,$2)", [id, version]);
    expect(Array.isArray(result)).toBe(true); expect(waiting).toBeGreaterThan(0);
    const landed = (await rows(owner, "SELECT t.week_start::text w, t.status::text s FROM bank_balance_history h JOIN treasury_weeks t ON t.id = h.week_id WHERE h.request_id = $1", [id]))[0];
    expect(landed.w > week).toBe(true); expect(landed.s).toBe("OPEN");
    expect(await balance(acct)).toBe(960000);
  });

  it("an authentication that gets in first stops the lock instead of slipping past it", async () => {
    const acct = await newAccount(1000000); const { id, version } = await verified(acct, 40000);
    const { id: w, revision } = await prepared(acct, 1000000);
    const { result } = await raced(user.kebede, "SELECT wf_authorize($1,$2)", [id, version], user.dawit, "SELECT lock_week($1,$2)", [w, revision]);
    expect(result).toMatch(/a payment was authenticated after this was prepared/);
    expect((await rows(owner, "SELECT status::text s FROM treasury_weeks WHERE id = $1", [w]))[0].s).toBe("RECONCILING");
  });

  it("a balance check waiting on a lock lands in the next week, and is told that week needs its opening", async () => {
    const acct = await newAccount(1000000); const { id: w, revision } = await prepared(acct, 1000000);
    const { result } = await raced(user.dawit, "SELECT lock_week($1,$2)", [w, revision], user.meron, "SELECT record_balance_check($1, 1100000)", [acct]);
    expect(result).toMatch(/opening balance first/);
    expect(await balance(acct)).toBe(1000000);
    expect((await rows(owner, "SELECT count(*)::int n FROM bank_balance_history WHERE week_id = $1", [w]))[0].n).toBe(1);
  });

  it("an Accountant editing while the Finance Manager locks: the edit is refused once the week is locked", async () => {
    const acct = await newAccount(1000000); const { id: w, revision } = await prepared(acct, 1000000);
    const { result } = await raced(user.dawit, "SELECT lock_week($1,$2)", [w, revision], user.meron, "SELECT add_reconciliation_line($1,'OTHER',5,'Late item')", [w]);
    expect(result).toMatch(/this week is locked and cannot be changed/);
  });

  it("many operations at once on one account end cleanly, with no deadlock, and the integrity check is clean", async () => {
    const acct = await newAccount(5000000);
    const ready: Awaited<ReturnType<typeof verified>>[] = [];
    for (const i of [1, 2, 3, 4, 5, 6]) ready.push(await verified(acct, i * 1000));   // one at a time: this is the set-up, not the race
    const work: Promise<unknown>[] = ready.map((v) => once(user.kebede, "SELECT wf_authorize($1,$2)", [v.id, v.version]));
    for (let i = 0; i < 6; i++) work.push(once(i % 2 ? user.meron : user.lidya, "SELECT record_balance_check($1, $2)", [acct, 5000000 - i]));
    const out = await Promise.all(work);
    expect(out.filter((r) => typeof r === "string")).toEqual([]);
    // Every payment was debited exactly once and all are still outstanding, so the last figure minus all six is the balance.
    expect((await rows(owner, "SELECT count(*)::int n FROM bank_balance_history WHERE account_id = $1 AND entry_kind = 'PAYMENT'", [acct]))[0].n).toBe(6);
    const sql = readFileSync(join(__dirname, "../ops/verify-integrity.sql"), "utf8").replace(/^\\set.*$/m, "");
    expect((await owner.query(sql)).rows.filter((r) => Number(r.violations) > 0)).toEqual([]);
  });
});
