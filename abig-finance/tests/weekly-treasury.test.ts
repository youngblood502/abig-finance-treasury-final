import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { actAs, ASKU, authorized, AWASH, BERBERO, CBE, fails, fn, mk, rows, setupDb, user } from "./helpers";

let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
let mon: string;   // Monday of the real current week: payments are stamped with the real date, so statement dates are given as its Sunday
beforeAll(async () => {
  const d = await setupDb("abig_test_weekly"); owner = d.owner; as = d.as;
  mon = (await rows(owner, "SELECT week_monday(addis_day(clock_timestamp()))::text AS d"))[0].d;
});
afterAll(async () => { await owner?.end(); });

/** Runs on the owner connection in a transaction that is rolled back, the clock change included. Set the actor with actAs. */
async function tx<T>(f: (c: Client) => Promise<T>): Promise<T> {
  await owner.query("BEGIN");
  try { return await f(owner); } finally { await owner.query("ROLLBACK"); }
}
const clockSql = (c: Client, expr: string) => c.query(`CREATE OR REPLACE FUNCTION treasury_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $f$ SELECT ${expr} $f$`);
const day = (offset: number) => { const d = new Date(mon + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
/** Sets the treasury clock to a day of the test's week (0 = Monday) at a time in Addis Ababa. */
const at = (c: Client, offset: number, time = "09:00") => clockSql(c, `'${day(offset)}T${time}:00+03:00'::timestamptz`);
const open = async (c: Client, account: string, figure: number, ticks: string[] = []) => (await rows(c, "SELECT * FROM record_opening_balance($1,$2,$3)", [account, figure, ticks]))[0];
const check = async (c: Client, account: string, figure: number, ticks: string[] = []) => (await rows(c, "SELECT * FROM record_balance_check($1,$2,$3)", [account, figure, ticks]))[0];
const outstanding = (c: Client, account: string) => rows(c, "SELECT * FROM outstanding_payments($1) WHERE processed_at IS NULL", [account]);
const balance = async (c: Client, account: string) => Number((await rows(c, "SELECT current_balance c FROM company_bank_accounts WHERE id = $1", [account]))[0].c);
const state = async (c: Client, id: string) => (await rows(c, "SELECT workflow_state::text s, paid_by, paid_at, reconciliation_id, bank_processed_at, debtor_company_id FROM payment_requests WHERE id=$1", [id]))[0];
const summary = async (c: Client, week: string) => (await rows(c, "SELECT * FROM reconciliation_summary($1)", [week]))[0];
const integrity = async (c: Client) => { const sql = readFileSync(join(__dirname, "../ops/verify-integrity.sql"), "utf8").replace(/^\\set.*$/m, ""); return (await c.query(sql)).rows.filter((r) => Number(r.violations) > 0); };
const num = (v: unknown) => (v === null ? null : Number(v));

/** Awash, ASKU: Meron prepares, Dawit locks. Opens the test's week at the given figure. */
const opened = async (c: Client, figure = 1000000, account = AWASH) => { await at(c, 0, "08:30"); await actAs(c, user.meron); await open(c, account, figure); };
const startRec = async (c: Client, closing: number, deposits: number, week = day(0), account = AWASH, who = user.meron) => { await actAs(c, who); return fn(c, "start_reconciliation", account, week, closing, deposits) as Promise<string>; };
const revision = async (c: Client, week: string) => Number((await rows(c, "SELECT revision r FROM treasury_weeks WHERE id = $1", [week]))[0].r);
const submit = async (c: Client, week: string, reasons: Record<string, string> = {}, explanation: string | null = null) => fn(c, "submit_reconciliation", week, await revision(c, week), reasons, explanation);
const lock = async (c: Client, week: string, who = user.dawit) => { await actAs(c, who); return c.query("SELECT lock_week($1,$2)", [week, await revision(c, week)]); };
/** A clean week with nothing in it: opened at 1,000,000 and locked. */
const lockedWeek = async (c: Client) => { await opened(c); const w = await startRec(c, 1000000, 0); await submit(c, w); await lock(c, w); return w; };

describe("the CBE worked example from the development plan", () => {
  it("runs from Monday's opening to the lock, and a cheque carries into a second week and is matched there", async () => {
    await tx(async (c) => {
      const company = async (id: string) => (await rows(c, "SELECT legal_name n FROM companies WHERE id = $1", [id]))[0].n as string;
      // Mon 08:30 opening balance, entered by the accountant of the company that owns the account.
      await at(c, 0, "08:30"); await actAs(c, user.samuel);
      const opening = await open(c, CBE, 1500000);
      expect([num(opening.bank_figure), num(opening.outstanding_total), num(opening.new_balance), opening.implied_deposit, opening.entry_kind]).toEqual([1500000, 0, 1500000, null, "OPENING"]);
      // Mon 10:00 Transfer A (Berbero) authenticated.
      await at(c, 0, "10:00");
      const { id: A } = await authorized(c, { company: BERBERO, amounts: [400000], method: "TRANSFER" });
      expect(await balance(c, CBE)).toBe(1100000);
      // Mon 11:00 balance check by Berbero, which shares the account and may enter its balance; A processed.
      await at(c, 0, "11:00"); await actAs(c, user.tigist);
      const list = await outstanding(c, CBE);
      expect(list.map((p) => [p.id, p.company, p.default_processed, p.method])).toEqual([[A, await company(BERBERO), true, "TRANSFER"]]);
      const c1 = await check(c, CBE, 1100000, [A]);
      expect([num(c1.bank_figure), num(c1.outstanding_total), num(c1.new_balance), num(c1.implied_deposit)]).toEqual([1100000, 0, 1100000, 0]);
      // Mon 14:00 Cheque B (ASKU) authenticated.
      await at(c, 0, "14:00");
      const { id: B } = await authorized(c, { account: CBE, amounts: [200000], method: "CHEQUE" });
      expect(await balance(c, CBE)).toBe(900000);
      // Mon 16:00 balance check; B not cashed. A is no longer asked about.
      await at(c, 0, "16:00"); await actAs(c, user.samuel);
      const list2 = await outstanding(c, CBE);
      expect(list2.map((p) => [p.id, p.company, p.default_processed])).toEqual([[B, await company(ASKU), false]]);
      const c2 = await check(c, CBE, 1150000);
      expect([num(c2.bank_figure), num(c2.outstanding_total), num(c2.new_balance), num(c2.implied_deposit), c2.anomalies]).toEqual([1150000, 200000, 950000, 50000, []]);
      // A and B stay Authenticated until the weekly reconciliation.
      expect([(await state(c, A)).s, (await state(c, B)).s]).toEqual(["AUTHENTICATED", "AUTHENTICATED"]);

      // Sunday: the statement shows the 50,000 deposit, a 500 charge and A, but not B.
      await at(c, 6, "17:00");
      const week = await startRec(c, 1149500, 50000, day(0), CBE, user.samuel);
      const pay = await rows(c, "SELECT * FROM reconciliation_payments($1)", [week]);
      expect(pay.map((p) => [p.id, p.company])).toEqual([[A, await company(BERBERO)], [B, await company(ASKU)]]);   // each payment names its company
      await fn(c, "match_payment", week, A, day(6), "FT-2211");
      expect((await state(c, A)).s).toBe("AUTHENTICATED");                                                        // Paid waits for the review
      await fn(c, "add_reconciliation_line", week, "BANK_CHARGE", 500, "Monthly service charge");
      const s = await summary(c, week);
      expect([num(s.system_balance), num(s.unmatched_total), num(s.implied_total), num(s.adjust_total), num(s.balance_difference), num(s.deposit_difference)]).toEqual([950000, 200000, 50000, -500, 0, 0]);
      await submit(c, week, { [B]: "Cheque not presented yet" });
      await lock(c, week, user.abebe);

      const w1 = (await rows(c, "SELECT * FROM treasury_weeks WHERE id = $1", [week]))[0];
      expect([w1.status, w1.prepared_by, w1.locked_by, num(w1.balance_difference), w1.adjustment_posted]).toEqual(["LOCKED", user.samuel, user.abebe, 0, true]);
      const a = await state(c, A); expect([a.s, a.paid_by, a.reconciliation_id]).toEqual(["PAID", user.abebe, week]);
      expect((await state(c, B)).s).toBe("AUTHENTICATED");
      expect(await balance(c, CBE)).toBe(949500);                                                                 // the charge reaches the system balance
      expect((await rows(c, "SELECT entry_kind::text k, previous_balance p, new_balance n FROM bank_balance_history WHERE account_id = $1 ORDER BY updated_at DESC LIMIT 1", [CBE]))[0]).toEqual({ k: "RECONCILIATION_ADJUSTMENT", p: "950000.0000", n: "949500.0000" });

      // Next Monday: B is listed for ticking in the opening, marked as carried over, and stays unticked by default.
      await at(c, 7, "08:30"); await actAs(c, user.samuel);
      const carried = await outstanding(c, CBE);
      expect(carried.map((p) => [p.id, p.carried, p.default_processed])).toEqual([[B, true, false]]);
      const opening2 = await open(c, CBE, 1149500);
      expect([num(opening2.outstanding_total), num(opening2.new_balance), opening2.anomalies]).toEqual([200000, 949500, []]);
      // Wednesday: the bank has paid the cheque.
      await at(c, 9, "12:00");
      const c3 = await check(c, CBE, 949500, [B]);
      expect([num(c3.outstanding_total), num(c3.new_balance), num(c3.implied_deposit)]).toEqual([0, 949500, 0]);
      expect(await outstanding(c, CBE)).toEqual([]);
      // Week two: B is on the statement.
      await at(c, 13, "17:00");
      const week2 = await startRec(c, 949500, 0, day(7), CBE, user.samuel);
      await fn(c, "match_payment", week2, B, day(9), "CHQ-77");
      await submit(c, week2);
      await lock(c, week2, user.abebe);
      const b = await state(c, B); expect([b.s, b.paid_by, b.reconciliation_id]).toEqual(["PAID", user.abebe, week2]);
      expect(await balance(c, CBE)).toBe(949500);
      expect(await integrity(c)).toEqual([]);
    });
  });
});

describe("Monday opening", () => {
  it("is needed once per week before any balance check, and the accounts without one are listed", async () => {
    await tx(async (c) => {
      await at(c, 0); await actAs(c, user.meron);
      const missing = async () => (await rows(c, "SELECT account_id, has_opening FROM account_week_status() WHERE account_id = $1", [AWASH]))[0].has_opening;
      expect(await missing()).toBe(false);
      expect(await fails(c, "SELECT record_balance_check($1, 1000)", [AWASH])).toMatch(/opening balance first/);
      await open(c, AWASH, 1000);
      expect(await missing()).toBe(true);
      expect(await fails(c, "SELECT record_opening_balance($1, 1000)", [AWASH])).toMatch(/already has its opening balance/);
      await at(c, 7); expect(await missing()).toBe(false);                                       // a new week needs its own
    });
  });
  it("uses the week in Addis Ababa: late Sunday in London is already Monday there", async () => {
    await tx(async (c) => {
      await clockSql(c, `'${day(6)}T22:30:00+00:00'::timestamptz`); await actAs(c, user.meron);   // 01:30 on Monday in Addis Ababa
      await open(c, AWASH, 1000);
      expect((await rows(c, "SELECT week_start::text w FROM treasury_weeks WHERE account_id = $1", [AWASH]))[0].w).toBe(day(7));
    });
  });
  it("flags a balance that changed between weeks with no check to see it", async () => {
    await tx(async (c) => {
      const w = await lockedWeek(c);
      await at(c, 7); await actAs(c, user.meron);
      expect((await open(c, AWASH, 1200000)).anomalies).toEqual(["OPENING_CHANGED"]);
      expect(w).toBeTruthy();
    });
  });
});

describe("balance checks", () => {
  it("defaults each method's tick: transfer and Telebirr ticked, cheque not, and cash never appears", async () => {
    await tx(async (c) => {
      await at(c, 0); await actAs(c, user.kebede);
      const tele = await fn(c, "register_wallet_account", ASKU, "T", "0911000123", 0) as string; const till = await fn(c, "register_cash_account", ASKU, "Till", 0) as string;
      await actAs(c, user.meron); await open(c, AWASH, 1000000); await open(c, tele, 5000); await open(c, till, 5000);
      const { id: tr } = await authorized(c, { amounts: [100], method: "TRANSFER" }); const { id: ch } = await authorized(c, { amounts: [200], method: "CHEQUE" });
      await actAs(c, user.meron);
      expect((await outstanding(c, AWASH)).map((p) => [p.id, p.default_processed])).toEqual([[tr, true], [ch, false]]);
      const person = await fn(c, "person_payee_create", ASKU, "Almaz", "0911234567", "v1:x", "1234", "f".repeat(64), "CASH") as string;
      const { id: ca } = await authorized(c, { person, supplier: undefined, bank: undefined, amounts: [300], method: "CASH", account: till });
      await actAs(c, user.meron);
      expect(await outstanding(c, till)).toEqual([]);
      expect((await state(c, ca)).bank_processed_at).toBeInstanceOf(Date);
      const detail = await fn(c, "person_detail_add", person, "TELEBIRR", null, null, "0911234567") as string;
      await actAs(c, user.dawit); await fn(c, "person_detail_decide", detail, true, null);
      const { id: te } = await authorized(c, { person, detail, amounts: [400], method: "TELEBIRR", account: tele });
      await actAs(c, user.meron);
      expect((await outstanding(c, tele)).map((p) => [p.id, p.default_processed])).toEqual([[te, true]]);
    });
  });
  it("records every payment shown, what was suggested and what was said, and asks until it is ticked", async () => {
    await tx(async (c) => {
      await opened(c);
      const { id: tr } = await authorized(c, { amounts: [1000], method: "TRANSFER" }); const { id: ch } = await authorized(c, { amounts: [2000], method: "CHEQUE" });
      await actAs(c, user.meron);
      const first = await check(c, AWASH, 997000);        // neither ticked: the transfer is still asked about
      expect(num(first.new_balance)).toBe(994000);
      expect(await rows(c, "SELECT request_id, default_processed, processed FROM balance_check_items WHERE entry_id = $1 ORDER BY amount", [first.id])).toEqual([
        { request_id: tr, default_processed: true, processed: false }, { request_id: ch, default_processed: false, processed: false }]);
      expect((await outstanding(c, AWASH)).map((p) => p.id)).toEqual([tr, ch]);
      const second = await check(c, AWASH, 995000, [tr, ch]);
      const r = (await rows(c, "SELECT bank_processed_by, balance_check_id FROM payment_requests WHERE id = $1", [ch]))[0];
      expect(r).toEqual({ bank_processed_by: user.meron, balance_check_id: second.id });
      expect(await outstanding(c, AWASH)).toEqual([]);
      expect(num((await check(c, AWASH, 995000)).implied_deposit)).toBe(0);
    });
  });
  it("flags a negative implied deposit, and one above the account's threshold, and only the owner sets the threshold", async () => {
    await tx(async (c) => {
      await opened(c);
      expect((await check(c, AWASH, 999000)).anomalies).toEqual(["NEGATIVE_DEPOSIT"]);
      expect((await check(c, AWASH, 1499000)).anomalies).toEqual([]);                            // exactly the threshold of 500,000
      expect((await check(c, AWASH, 2000000)).anomalies).toEqual(["LARGE_DEPOSIT"]);
      expect((await rows(c, "SELECT anomalies, implied_deposit FROM account_balance_history($1, 1)", [AWASH]))[0].anomalies).toEqual(["LARGE_DEPOSIT"]);
      expect(await fails(c, "SELECT set_large_deposit_threshold($1, 100)", [AWASH])).toMatch(/only the account owner/);
      await actAs(c, user.kebede); await c.query("SELECT set_large_deposit_threshold($1, 100)", [AWASH]);
      await actAs(c, user.meron); expect((await check(c, AWASH, 2000200)).anomalies).toEqual(["LARGE_DEPOSIT"]);
    });
  });
  it("lets the system balance fall below zero, and a shortfall is still reported", async () => {
    await tx(async (c) => {
      await opened(c);
      await authorized(c, { amounts: [900000], method: "CHEQUE" });
      await actAs(c, user.meron);
      expect(num((await check(c, AWASH, 100000)).new_balance)).toBe(-800000);
      const id = await mk(c, user.meron, { amounts: [1] });
      expect(await fails(c, "SELECT wf_submit($1)", [id])).toMatch(/in shortfall/);
      expect((await rows(c, "SELECT payload FROM notification_outbox WHERE event_type = 'ACCOUNT_SHORTFALL'"))[0].payload).toMatchObject({ shortfall_amount: 800000 });
    });
  });
  it("refuses a list that changed, a payment that is not outstanding, and a negative figure", async () => {
    await tx(async (c) => {
      await opened(c);
      const { id } = await authorized(c, { amounts: [1000], method: "CHEQUE" });
      await actAs(c, user.meron);
      expect(await fails(c, "SELECT record_balance_check($1, 5, '{}', '{}')", [AWASH])).toMatch(/has changed since this page was opened/);    // the page showed nothing, but there is one
      expect(await fails(c, "SELECT record_balance_check($1, 5, $2, $2)", [AWASH, [user.meron]])).toMatch(/has changed/);
      expect(await fails(c, "SELECT record_balance_check($1, 5, $2)", [AWASH, [user.meron]])).toMatch(/not outstanding on this account/);
      expect(await fails(c, "SELECT record_balance_check($1, -1)", [AWASH])).toMatch(/cannot be negative/);
      await c.query("SELECT record_balance_check($1, 5, $2, $2)", [AWASH, [id]]);
      expect(await fails(c, "SELECT record_balance_check($1, 5, $2)", [AWASH, [id]])).toMatch(/not outstanding/);
    });
  });
  it("a wrong tick can be undone until the payment is matched, and the next check asks again", async () => {
    await tx(async (c) => {
      await opened(c);
      const { id } = await authorized(c, { amounts: [1000], method: "CHEQUE" });
      await actAs(c, user.meron); await check(c, AWASH, 999000, [id]);
      expect(await fails(c, "SELECT undo_processed_tick($1, '')", [id])).toMatch(/a reason is required/);
      await actAs(c, user.dawit); expect(await fails(c, "SELECT undo_processed_tick($1, 'Wrong tick')", [id])).toMatch(/you may not change/);
      await actAs(c, user.meron); await c.query("SELECT undo_processed_tick($1, 'Wrong tick')", [id]);
      expect((await state(c, id)).bank_processed_at).toBeNull();
      expect((await outstanding(c, AWASH)).map((p) => p.id)).toEqual([id]);
      await check(c, AWASH, 999000, [id]);
      const w = await startRec(c, 999000, 0); await fn(c, "match_payment", w, id, day(6));
      expect(await fails(c, "SELECT undo_processed_tick($1, 'Wrong tick')", [id])).toMatch(/matched to the statement/);
    });
  });
  it("cash is not undone, and the figures can only be written through the functions", async () => {
    await as(user.meron, async (c) => {
      expect(await fails(c, "SELECT update_bank_balance($1, 1)", [AWASH])).toMatch(/does not exist/);
      expect(await fails(c, "UPDATE treasury_weeks SET status = 'OPEN'")).toMatch(/permission denied/);
      expect(await fails(c, "INSERT INTO reconciliation_lines (week_id, account_id, kind, company_id, amount, reason, created_by) VALUES ($1,$2,'OTHER',$3,1,'xxx',$4)", [user.meron, AWASH, ASKU, user.meron])).toMatch(/permission denied/);
      expect(await fails(c, "INSERT INTO balance_check_items (entry_id, account_id, request_id, company_id, amount, default_processed, processed) VALUES ($1,$2,$1,$3,1,true,true)", [user.meron, AWASH, ASKU])).toMatch(/permission denied/);
      expect(await fails(c, "SELECT record_figure('CHECK', $1, 1, '{}', NULL)", [AWASH])).toMatch(/permission denied/);
      expect(await fails(c, "SELECT recon_lock($1)", [AWASH])).toMatch(/permission denied/);
    });
  });
});

describe("who may do what on a shared account", () => {
  it("anyone with the update right enters the balance; only the owner company reconciles it, once", async () => {
    await tx(async (c) => {
      await at(c, 0); await actAs(c, user.tigist); await open(c, CBE, 1000000);                 // Berbero, shared with the update right
      await actAs(c, user.lidya); expect(await fails(c, "SELECT record_balance_check($1, 1)", [CBE])).toMatch(/you may not update/);   // ASKU may only use it
      await actAs(c, user.abebe); expect(await fails(c, "SELECT record_balance_check($1, 1)", [CBE])).toMatch(/you may not update/);   // an Owner does not enter balances
      for (const who of [user.tigist, user.lidya]) { await actAs(c, who); expect(await fails(c, "SELECT start_reconciliation($1, $2, 1, 1)", [CBE, day(0)])).toMatch(/only an Accountant of the company that owns/); }
      await actAs(c, user.fikru); expect(await fails(c, "SELECT start_reconciliation($1, $2, 1, 1)", [CBE, day(0)])).toMatch(/only an Accountant/);   // nor a Finance Manager
      const w = await startRec(c, 1000000, 0, day(0), CBE, user.samuel);
      await submit(c, w);
      for (const who of [user.fikru, user.dawit, user.tigist]) { await actAs(c, who); expect(await fails(c, "SELECT lock_week($1, $2)", [w, await revision(c, w)])).toMatch(/only a Finance Manager of the company that owns/); }
      await lock(c, w, user.abebe);
    });
  });
  it("a company sharing the account sees the week and its own payments, not the other company's", async () => {
    await tx(async (c) => {
      await at(c, 0); await actAs(c, user.samuel); await open(c, CBE, 2000000);
      const { id: mine } = await authorized(c, { account: CBE, amounts: [1000], method: "CHEQUE" });
      const { id: theirs } = await authorized(c, { company: BERBERO, amounts: [2000], method: "CHEQUE" });
      await actAs(c, user.samuel); const w = await startRec(c, 2000000, 0, day(0), CBE, user.samuel);
      await fn(c, "match_payment", w, mine, day(6)); await fn(c, "match_payment", w, theirs, day(6));
      await c.query("SET LOCAL ROLE abig_app");
      await actAs(c, user.meron);                                                               // ASKU: use only
      expect((await rows(c, "SELECT id FROM treasury_weeks WHERE account_id = $1", [CBE]))).toHaveLength(1);
      expect((await rows(c, "SELECT request_id FROM reconciliation_lines")).map((r) => r.request_id)).toEqual([mine]);
      expect((await rows(c, "SELECT id FROM outstanding_payments($1)", [CBE])).map((r) => r.id)).toEqual([mine]);
      expect((await rows(c, "SELECT id FROM reconciliation_payments($1)", [w])).map((r) => r.id)).toEqual([mine]);
      await actAs(c, user.samuel);                                                              // the owner company reconciles them all
      expect((await rows(c, "SELECT id FROM reconciliation_payments($1)", [w])).map((r) => r.id).sort()).toEqual([mine, theirs].sort());
      await actAs(c, user.bereket);                                                             // no link to the account
      expect(await rows(c, "SELECT id FROM treasury_weeks")).toEqual([]);
      expect(await rows(c, "SELECT id FROM reconciliation_payments($1)", [w])).toEqual([]);
      expect(await rows(c, "SELECT id FROM outstanding_payments($1)", [CBE])).toEqual([]);
      await c.query("RESET ROLE");
    });
  });
});

describe("preparing a reconciliation", () => {
  it("a week needs its opening, and earlier weeks lock first", async () => {
    await tx(async (c) => {
      await at(c, 0); await actAs(c, user.meron);
      expect(await fails(c, "SELECT start_reconciliation($1, $2, 1, 1)", [AWASH, day(0)])).toMatch(/no opening balance/);
      await open(c, AWASH, 1000);
      await at(c, 7); await open(c, AWASH, 1000);
      expect(await fails(c, "SELECT start_reconciliation($1, $2, 1000, 0)", [AWASH, day(7)])).toMatch(/earlier week .* not locked/);
    });
  });
  it("the balance must agree, or the difference must be explained by a line with a reason", async () => {
    await tx(async (c) => {
      await opened(c);
      const w = await startRec(c, 999000, 0);
      expect(num((await summary(c, w)).balance_difference)).toBe(-1000);
      expect(await fails(c, "SELECT submit_reconciliation($1,$2)", [w, await revision(c, w)])).toMatch(/the balance is out by ETB -1,000.00/);
      expect(await fails(c, "SELECT add_reconciliation_line($1,'OTHER',-1000,'')", [w])).toMatch(/a reason is required/);
      expect(await fails(c, "SELECT add_reconciliation_line($1,'BANK_CHARGE',-1000,'Fee')", [w])).toMatch(/positive amount/);
      expect(await fails(c, "SELECT add_reconciliation_line($1,'PAYMENT',1,'xxx')", [w])).toMatch(/bank charge or another item/);
      await fn(c, "add_reconciliation_line", w, "OTHER", -1000, "Standing order to the landlord");
      expect(num((await summary(c, w)).balance_difference)).toBe(0);
      await submit(c, w); await lock(c, w);
      expect(await balance(c, AWASH)).toBe(999000);
    });
  });
  it("statement deposits differing from the implied deposits need an explanation", async () => {
    await tx(async (c) => {
      await opened(c);
      await check(c, AWASH, 1050000);
      const w = await startRec(c, 1080000, 80000);                     // 30,000 arrived after the last check
      await fn(c, "add_reconciliation_line", w, "OTHER", 30000, "Customer deposit after Friday's check");
      expect(num((await summary(c, w)).deposit_difference)).toBe(30000);
      expect(await fails(c, "SELECT submit_reconciliation($1,$2)", [w, await revision(c, w)])).toMatch(/differ from the implied deposits by ETB 30,000.00: explain/);
      await submit(c, w, {}, "Deposit on Saturday, after the last check");
      await lock(c, w);
      const r = (await rows(c, "SELECT deposit_explanation e, deposit_difference d FROM treasury_weeks WHERE id = $1", [w]))[0];
      expect([r.e, num(r.d)]).toEqual(["Deposit on Saturday, after the last check", 30000]);
      expect(await balance(c, AWASH)).toBe(1080000);
    });
  });
  it("a charge a balance check already picked up explains the deposits and does not move the balance twice", async () => {
    await tx(async (c) => {
      await opened(c);
      expect((await check(c, AWASH, 999500)).anomalies).toEqual(["NEGATIVE_DEPOSIT"]);   // the charge looks like a negative deposit
      await check(c, AWASH, 1049500);
      const w = await startRec(c, 1049500, 50000);
      expect([num((await summary(c, w)).balance_difference), num((await summary(c, w)).deposit_difference)]).toEqual([0, 500]);
      await fn(c, "add_reconciliation_line", w, "BANK_CHARGE", 500, "Service charge", day(1), null, true);
      expect([num((await summary(c, w)).balance_difference), num((await summary(c, w)).deposit_difference)]).toEqual([0, 0]);
      await submit(c, w); await lock(c, w);
      expect(await balance(c, AWASH)).toBe(1049500);
    });
  });
  it("items a later bank figure already includes are not posted again", async () => {
    await tx(async (c) => {
      await opened(c);
      await at(c, 7); await actAs(c, user.meron); await open(c, AWASH, 999500);          // Monday's figure includes Sunday's charge
      const w = await startRec(c, 999500, 0);                                            // the statement arrives after the opening
      await fn(c, "add_reconciliation_line", w, "BANK_CHARGE", 500, "Sunday's service charge");
      expect(num((await summary(c, w)).balance_difference)).toBe(0);
      await submit(c, w); await lock(c, w);
      expect(await balance(c, AWASH)).toBe(999500);
      expect((await rows(c, "SELECT adjustment_posted a, adjustments_total t FROM treasury_weeks WHERE id = $1", [w]))[0]).toEqual({ a: false, t: "-500.0000" });
      expect(await integrity(c)).toEqual([]);
    });
  });
  it("reads the balance as the week ended, not as it stands now", async () => {
    await tx(async (c) => {
      await opened(c);
      const { id: a } = await authorized(c, { amounts: [1000], method: "CHEQUE" });
      await at(c, 8); const { id: b } = await authorized(c, { amounts: [5000], method: "CHEQUE" });   // Tuesday of the next week
      await actAs(c, user.meron);
      const w = await startRec(c, 1000000, 0);
      const s = await summary(c, w);
      expect([num(s.system_balance), num(s.unmatched_total), num(s.balance_difference)]).toEqual([999000, 1000, 0]);
      expect((await rows(c, "SELECT id FROM reconciliation_payments($1)", [w])).map((r) => r.id)).toEqual([a]);
      expect(await fails(c, "SELECT match_payment($1,$2,$3)", [w, b, day(6)])).toMatch(/not outstanding on this account for this week/);
    });
  });
  it("a payment is matched once, on its own account, with a date that fits; a removed match can be redone", async () => {
    await tx(async (c) => {
      await opened(c);
      const { id } = await authorized(c, { amounts: [1000], method: "TRANSFER" });
      const draftOne = await mk(c, user.meron, { amounts: [10] });
      await actAs(c, user.samuel); await open(c, CBE, 1000);
      const other = await startRec(c, 1000, 0, day(0), CBE, user.samuel);
      expect(await fails(c, "SELECT match_payment($1,$2,$3)", [other, id, day(6)])).toMatch(/not outstanding on this account/);
      const w = await startRec(c, 999000, 0);
      expect(await fails(c, "SELECT match_payment($1,$2,$3)", [w, draftOne, day(6)])).toMatch(/not outstanding/);
      expect(await fails(c, "SELECT match_payment($1,$2,NULL)", [w, id])).toMatch(/enter the date/);
      expect(await fails(c, "SELECT match_payment($1,$2,$3)", [w, id, day(7)])).toMatch(/between the day the payment was authenticated and the end of this week/);
      expect(await fails(c, "SELECT match_payment($1,$2,$3)", [w, id, day(-30)])).toMatch(/between the day/);
      const line = await fn(c, "match_payment", w, id, day(6), "FT-1");
      expect(await fails(c, "SELECT match_payment($1,$2,$3)", [w, id, day(6)])).toMatch(/reconciliation_lines_match_once/);
      expect(await fails(c, "SELECT remove_reconciliation_line($1, '')", [line])).toMatch(/a reason is required/);
      await c.query("SELECT remove_reconciliation_line($1, 'Wrong payment')", [line]);
      expect(await fails(c, "SELECT remove_reconciliation_line($1, 'Again')", [line])).toMatch(/already been removed/);
      expect(num((await summary(c, w)).unmatched_total)).toBe(1000);
      await fn(c, "match_payment", w, id, day(6), "FT-2");
      expect(num((await summary(c, w)).unmatched_total)).toBe(0);
    });
  });
  it("every unmatched payment needs a reason to carry over", async () => {
    await tx(async (c) => {
      await opened(c);
      const { id } = await authorized(c, { amounts: [1000], method: "CHEQUE" });
      const w = await startRec(c, 1000000, 0);
      expect(await fails(c, "SELECT submit_reconciliation($1,$2)", [w, await revision(c, w)])).toMatch(/give a reason for carrying .* into next week/);
      await submit(c, w, { [id]: "Cheque not presented yet" });
      expect((await rows(c, "SELECT carry_reason r FROM reconciliation_payments($1)", [w]))[0].r).toBe("Cheque not presented yet");
    });
  });
  it("cash reconciles the same way, with a count in place of the statement", async () => {
    await tx(async (c) => {
      await at(c, 0); await actAs(c, user.kebede); const till = await fn(c, "register_cash_account", ASKU, "Till", 0) as string;
      await actAs(c, user.meron); await open(c, till, 50000);
      const person = await fn(c, "person_payee_create", ASKU, "Almaz", "0911234567", "v1:x", "1234", "f".repeat(64), "CASH") as string;
      const { id } = await authorized(c, { person, supplier: undefined, bank: undefined, amounts: [8000], method: "CASH", account: till });
      await actAs(c, user.meron);
      const w = await startRec(c, 42000, 0, day(0), till);
      expect(num((await summary(c, w)).balance_difference)).toBe(-8000);       // an unmatched cash payment shows at once: the money has left
      await fn(c, "match_payment", w, id, day(6), "Receipt 14");
      expect(num((await summary(c, w)).balance_difference)).toBe(0);
      await submit(c, w); await lock(c, w);
      expect((await state(c, id)).s).toBe("PAID");
    });
  });
});

describe("review and lock", () => {
  it("nobody locks their own work, even an administrator", async () => {
    await tx(async (c) => {
      await opened(c);
      const w = await startRec(c, 1000000, 0, day(0), AWASH, user.admin);
      await submit(c, w);
      await actAs(c, user.admin);
      expect(await fails(c, "SELECT lock_week($1,$2)", [w, await revision(c, w)])).toMatch(/you worked on this reconciliation/);
    });
    await tx(async (c) => {            // adding a line counts as working on it, whoever pressed Submit
      await opened(c);
      const w = await startRec(c, 999000, 0, day(0), AWASH, user.admin);
      await fn(c, "add_reconciliation_line", w, "OTHER", -1000, "Item");
      await actAs(c, user.meron); await submit(c, w);
      await actAs(c, user.admin);
      expect(await fails(c, "SELECT lock_week($1,$2)", [w, await revision(c, w)])).toMatch(/you worked on this reconciliation/);
    });
  });
  it("only a Finance Manager locks, an Accountant cannot, and it must have been sent for review", async () => {
    await tx(async (c) => {
      await opened(c);
      const w = await startRec(c, 1000000, 0);
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT lock_week($1,$2)", [w, 1])).toMatch(/has not sent this reconciliation for review/);
      await actAs(c, user.lidya); expect(await fails(c, "SELECT lock_week($1,$2)", [w, 1])).toMatch(/only a Finance Manager/);
      await actAs(c, user.kebede); expect(await fails(c, "SELECT lock_week($1,$2)", [w, 1])).toMatch(/only a Finance Manager/);   // an Owner reads it, no more
      await actAs(c, user.dawit); expect(await fails(c, "SELECT start_reconciliation($1,$2,1,1)", [AWASH, day(0)])).toMatch(/only an Accountant/);
    });
  });
  it("freezes once sent; the Finance Manager can return it with a reason, and it can be sent again", async () => {
    await tx(async (c) => {
      await opened(c);
      const { id } = await authorized(c, { amounts: [1000], method: "CHEQUE" });
      const w = await startRec(c, 1000000, 0);
      await submit(c, w, { [id]: "Not presented" });
      expect(await fails(c, "SELECT add_reconciliation_line($1,'OTHER',1,'xxx')", [w])).toMatch(/with the Finance Manager/);
      expect(await fails(c, "SELECT start_reconciliation($1,$2,1,1)", [AWASH, day(0)])).toMatch(/with the Finance Manager/);
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT return_reconciliation($1, '')", [w])).toMatch(/a reason is required/);
      await c.query("SELECT return_reconciliation($1, 'Check the cheque number')", [w]);
      expect((await summary(c, w)).return_reason).toBe("Check the cheque number");
      expect((await rows(c, "SELECT carry_reason r FROM reconciliation_payments($1)", [w]))[0].r).toBeNull();
      await actAs(c, user.meron); await submit(c, w, { [id]: "Not presented yet" });
      await lock(c, w);
    });
  });
  it("locks only the revision reviewed", async () => {
    await tx(async (c) => {
      await opened(c);
      const w = await startRec(c, 1000000, 0); await submit(c, w);
      const seen = await revision(c, w);
      await actAs(c, user.yared); await c.query("SELECT return_reconciliation($1, 'Looking again')", [w]);
      await actAs(c, user.meron); await submit(c, w);
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT lock_week($1,$2)", [w, seen])).toMatch(/has changed since it was opened/);
    });
  });
  it("refuses when a check or a payment landed after it was prepared", async () => {
    await tx(async (c) => {
      await opened(c);
      const w = await startRec(c, 1000000, 0); await submit(c, w);
      await actAs(c, user.meron); await check(c, AWASH, 1010000);
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT lock_week($1,$2)", [w, await revision(c, w)])).toMatch(/balance has moved by ETB -10,000.00 since this was prepared/);
    });
    await tx(async (c) => {
      await opened(c);
      const w = await startRec(c, 1000000, 0); await submit(c, w);
      await authorized(c, { amounts: [1000], method: "CHEQUE" });
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT lock_week($1,$2)", [w, await revision(c, w)])).toMatch(/a payment was authenticated after this was prepared/);
    });
  });
});

describe("a locked week", () => {
  it("refuses every change, by every path, for everyone", async () => {
    await tx(async (c) => {
      await opened(c);
      const { id: paid } = await authorized(c, { amounts: [1000], method: "TRANSFER" });
      const { id: carried } = await authorized(c, { amounts: [2000], method: "CHEQUE" });
      await actAs(c, user.meron); await check(c, AWASH, 999000, [paid]);
      const w = await startRec(c, 997000, 0);
      const matched = await fn(c, "match_payment", w, paid, day(6));
      const charge = await fn(c, "add_reconciliation_line", w, "OTHER", -2000, "Item");
      await submit(c, w, { [carried]: "Not presented" }); const rev = await revision(c, w); await lock(c, w);
      await actAs(c, user.meron);
      const locked = /this week is locked and cannot be changed/;
      expect(await fails(c, "SELECT start_reconciliation($1,$2,1,1)", [AWASH, day(0)])).toMatch(locked);
      expect(await fails(c, "SELECT match_payment($1,$2,$3)", [w, carried, day(6)])).toMatch(locked);
      expect(await fails(c, "SELECT add_reconciliation_line($1,'OTHER',1,'xxx')", [w])).toMatch(locked);
      expect(await fails(c, "SELECT remove_reconciliation_line($1,'Oops')", [matched])).toMatch(locked);
      expect(await fails(c, "SELECT remove_reconciliation_line($1,'Oops')", [charge])).toMatch(locked);
      expect(await fails(c, "SELECT submit_reconciliation($1,$2)", [w, rev])).toMatch(locked);
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT return_reconciliation($1,'Oops')", [w])).toMatch(locked);
      expect(await fails(c, "SELECT lock_week($1,$2)", [w, rev])).toMatch(locked);
      await actAs(c, user.admin);
      expect(await fails(c, "SELECT return_reconciliation($1,'Oops')", [w])).toMatch(locked);
      // Even the database owner, going around the functions.
      expect(await fails(c, "UPDATE treasury_weeks SET status = 'RECONCILING' WHERE id = $1", [w])).toMatch(locked);
      expect(await fails(c, "UPDATE treasury_weeks SET statement_closing_balance = 1 WHERE id = $1", [w])).toMatch(locked);
      expect(await fails(c, "DELETE FROM treasury_weeks WHERE id = $1", [w])).toMatch(/cannot be changed|not allowed|append-only|immutable/i);
      expect(await fails(c, "UPDATE reconciliation_lines SET voided_at = now(), voided_by = $2 WHERE id = $1", [matched, user.admin])).toMatch(locked);
      expect(await fails(c, "INSERT INTO reconciliation_lines (week_id, account_id, kind, company_id, amount, reason, created_by) VALUES ($1,$2,'OTHER',$3,1,'xxx',$4)", [w, AWASH, ASKU, user.admin])).toMatch(locked);
      expect(await fails(c, "DELETE FROM reconciliation_lines WHERE id = $1", [matched])).toMatch(/cannot be changed|not allowed|append-only|immutable/i);
      expect(await fails(c, "UPDATE bank_balance_history SET new_balance = 1 WHERE week_id = $1", [w])).toMatch(/cannot be changed/);
      expect(await fails(c, "UPDATE balance_check_items SET processed = false")).toMatch(/cannot be changed|not allowed|append-only|immutable/i);
      // A paid payment is final, and a tick from a locked week stands.
      await actAs(c, user.meron);
      expect(await fails(c, "SELECT record_execution($1,NULL,'R')", [paid])).toMatch(/authenticated payment|final/);
      expect(await fails(c, "SELECT undo_processed_tick($1,'Oops')", [paid])).toMatch(/not ticked/);
    });
  });
  it("a tick from a locked week cannot be undone on a payment that carried over", async () => {
    await tx(async (c) => {
      await opened(c);
      const { id } = await authorized(c, { amounts: [1000], method: "TRANSFER" });
      await actAs(c, user.meron); await check(c, AWASH, 999000, [id]);
      const w = await startRec(c, 999000, 0); await fn(c, "add_reconciliation_line", w, "OTHER", -1000, "Bank error"); await submit(c, w, { [id]: "Not on the statement" }); await lock(c, w);
      await actAs(c, user.meron);
      expect(await fails(c, "SELECT undo_processed_tick($1,'Oops')", [id])).toMatch(/this week is locked/);
    });
  });
  it("whatever happens after the lock falls into the following week", async () => {
    await tx(async (c) => {
      const w = await lockedWeek(c);                                    // locked on the test week's Monday
      const { id } = await authorized(c, { amounts: [1000], method: "CHEQUE" });
      const h = (await rows(c, "SELECT t.week_start::text w, t.id FROM bank_balance_history h JOIN treasury_weeks t ON t.id = h.week_id WHERE h.request_id = $1", [id]))[0];
      expect(h.w).toBe(day(7)); expect(h.id).not.toBe(w);
      await actAs(c, user.meron);
      expect(await fails(c, "SELECT record_balance_check($1, 1)", [AWASH])).toMatch(/opening balance first/);
      expect((await rows(c, "SELECT week_start::text w FROM account_week_status() WHERE account_id = $1", [AWASH]))[0].w).toBe(day(7));
    });
  });
  it("a correction is a line in the next week", async () => {
    await tx(async (c) => {
      await lockedWeek(c);
      await at(c, 7); await actAs(c, user.meron); await open(c, AWASH, 1000000);
      const w2 = await startRec(c, 1000000, 0, day(7));
      const l = await fn(c, "add_reconciliation_line", w2, "OTHER", 250, "Correction to last week", null, null, true);
      expect(l).toBeTruthy();
      expect(num((await summary(c, w2)).deposit_difference)).toBe(250);
    });
  });
});

describe("carried payments", () => {
  it("stay outstanding from week to week and are flagged once 14 days have passed", async () => {
    await tx(async (c) => {
      await at(c, 0); await actAs(c, user.meron); await open(c, AWASH, 1000000);
      const { id } = await authorized(c, { amounts: [1000], method: "CHEQUE" });
      await actAs(c, user.meron);
      const flag = async (days: number) => {
        await clockSql(c, `addis_now.t FROM (SELECT (date_trunc('day', clock_timestamp() AT TIME ZONE 'Africa/Addis_Ababa') + interval '${days} days 12 hours') AT TIME ZONE 'Africa/Addis_Ababa' AS t) addis_now`);
        return (await rows(c, "SELECT age_days a, overdue o FROM outstanding_payments($1) WHERE id = $2", [AWASH, id]))[0];
      };
      expect(await flag(13)).toEqual({ a: 13, o: false });
      expect(await flag(14)).toEqual({ a: 14, o: true });
      expect((await rows(c, "SELECT overdue_count n FROM account_week_status() WHERE account_id = $1", [AWASH]))[0].n).toBe(1);
    });
  });
  it("carry through two locked weeks and are matched in the third, and the carry-over reason of each week stays", async () => {
    await tx(async (c) => {
      await opened(c);
      const { id } = await authorized(c, { amounts: [1000], method: "CHEQUE" });
      await at(c, 6); const w1 = await startRec(c, 1000000, 0); await submit(c, w1, { [id]: "Not presented" }); await lock(c, w1);
      await at(c, 7); await actAs(c, user.meron); await open(c, AWASH, 1000000);
      const w2 = await startRec(c, 1000000, 0, day(7)); expect((await rows(c, "SELECT id FROM reconciliation_payments($1)", [w2])).map((r) => r.id)).toEqual([id]);
      await submit(c, w2, { [id]: "Still not presented" }); await lock(c, w2);
      await at(c, 14); await actAs(c, user.meron); await open(c, AWASH, 1000000);
      await check(c, AWASH, 999000, [id]);
      const w3 = await startRec(c, 999000, 0, day(14)); await fn(c, "match_payment", w3, id, day(15)); await submit(c, w3); await lock(c, w3);
      expect((await state(c, id)).reconciliation_id).toBe(w3);
      expect((await rows(c, "SELECT reason FROM reconciliation_lines WHERE request_id = $1 AND kind = 'CARRY' ORDER BY created_at", [id])).map((r) => r.reason)).toEqual(["Not presented", "Still not presented"]);
      expect(await integrity(c)).toEqual([]);
    });
  });
});

describe("the integrity check", () => {
  it("notices a Paid payment with no matched line, and a broken system balance", async () => {
    await tx(async (c) => {
      await opened(c);
      const { id } = await authorized(c, { amounts: [1000], method: "CHEQUE" });
      await c.query("SELECT wf_mark_paid($1, $2)", [id, user.admin]);
      await c.query("ALTER TABLE bank_balance_history DISABLE TRIGGER bank_balance_history_no_change");
      await c.query("UPDATE bank_balance_history SET outstanding_total = 5, implied_deposit = 7 WHERE entry_kind = 'OPENING'");
      await c.query("UPDATE bank_balance_history SET entry_kind = 'CHECK' WHERE entry_kind = 'OPENING'");
      const found = (await integrity(c)).map((r) => r.name);
      expect(found).toEqual(expect.arrayContaining(["paid payment without a matched line in a locked week", "balance check whose system balance is not the bank figure minus the outstanding payments", "balance check whose implied deposit is not the change in system balance"]));
    });
  });
});
