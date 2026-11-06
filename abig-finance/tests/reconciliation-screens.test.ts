import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { Tx } from "../src/lib/db";
import { byOwner, carriedIn, defaultStatementDate, mondayOf, overviewWeeks, partialFigures, paymentColumns, reconciliationWeek, reconOffers, reconStage, statementReturnPath, weekOverview, type ReconPayment, type WeekOverviewRow } from "../src/lib/reconciliation";
import { actAs, ASKU, authorized, AWASH, BERBERO, CBE, fails, fn, rows, setupDb, user } from "./helpers";

describe("where a week stands", () => {
  const facts = (status: string, prepared_at: Date | null = null, return_reason: string | null = null) => ({ status, prepared_at, return_reason });
  it("reads the stage from the week", () => {
    expect(reconStage(facts("OPEN"), "FULL")).toBe("open");
    expect(reconStage(facts("RECONCILING"), "FULL")).toBe("preparing");
    expect(reconStage(facts("RECONCILING", null, "Fix the fee"), "FULL")).toBe("returned");
    expect(reconStage(facts("RECONCILING", new Date()), "FULL")).toBe("review");
    expect(reconStage(facts("LOCKED", new Date()), "FULL")).toBe("locked");
  });
  it("tells a limited viewer no more than the status", () => { expect(reconStage(facts("RECONCILING"), "TICK")).toBe("reconciling"); expect(reconStage(facts("RECONCILING"), "NONE")).toBe("reconciling"); });
  const week = (o: object) => ({ ...facts("RECONCILING"), can_prepare: false, can_review: false, prepared_by: null, ...o });
  it("offers preparation to the Accountant only while it can change", () => {
    expect(reconOffers(week({ can_prepare: true }), "FULL", "me", false).prepare).toBe(true);
    expect(reconOffers(week({ can_prepare: true, return_reason: "Again" }), "FULL", "me", false).prepare).toBe(true);
    expect(reconOffers(week({ can_prepare: true, prepared_at: new Date() }), "FULL", "me", false).prepare).toBe(false);
    expect(reconOffers(week({ can_prepare: true, status: "LOCKED" }), "FULL", "me", false).prepare).toBe(false);
    expect(reconOffers(week({ can_prepare: false }), "FULL", "me", false).prepare).toBe(false);
  });
  it("offers the review to a Finance Manager who did not do the work", () => {
    const sent = { prepared_at: new Date(), prepared_by: "them", can_review: true };
    expect(reconOffers(week(sent), "FULL", "me", false)).toMatchObject({ review: true, lock: true });
    expect(reconOffers(week({ ...sent, prepared_by: "me" }), "FULL", "me", false)).toMatchObject({ review: false, lock: false });
    expect(reconOffers(week(sent), "FULL", "me", true)).toMatchObject({ review: true, lock: false });       // added a line: may return it, not lock it
    expect(reconOffers(week({ ...sent, status: "LOCKED" }), "FULL", "me", false)).toMatchObject({ review: false, lock: false });
    expect(reconOffers(week({ prepared_by: "them", can_review: true }), "FULL", "me", false).review).toBe(false);      // not sent yet
  });
});

describe("dates and totals", () => {
  it("finds a day's Monday", () => { expect(mondayOf("2026-11-02")).toBe("2026-11-02"); expect(mondayOf("2026-11-08")).toBe("2026-11-02"); expect(mondayOf("2026-11-09")).toBe("2026-11-09"); });
  it("never offers a statement date outside the week", () => {
    expect(defaultStatementDate("2026-11-06", "2026-11-02")).toBe("2026-11-06");
    expect(defaultStatementDate("2026-11-20", "2026-11-02")).toBe("2026-11-08");
    expect(defaultStatementDate("2026-10-30", "2026-11-02")).toBe("2026-11-02");
  });
  it("calls a payment carried by the Addis Ababa day it was authenticated", () => {
    expect(carriedIn(new Date("2026-11-01T20:59:00Z"), "2026-11-02")).toBe(true);                                             // Sunday 23:59
    expect(carriedIn(new Date("2026-11-01T21:00:00Z"), "2026-11-02")).toBe(false);                                            // Monday 00:00
  });
  it("splits the payments and totals them in whole cents", () => {
    const p = (line_id: string | null, amount: string) => ({ line_id, amount }) as ReconPayment;
    expect(paymentColumns([p("a", "0.10"), p("b", "0.20"), p(null, "5.00")])).toMatchObject({ matchedTotal: 0.3, outstandingTotal: 5 });
  });
  it("returns to a week only by its id, so a form cannot send anyone elsewhere", () => {
    const week = "3963e21d-e458-4f29-acba-4453bfb7ae7a";
    expect(statementReturnPath(CBE, week)).toBe(`/treasury/week/${week}`);
    for (const bad of ["", "//evil.example", "https://evil.example", "../admin", `${week}/../..`, `${week}?x=1`]) expect(statementReturnPath(CBE, bad)).toBe(`/treasury/${CBE}`);
  });
  it("marks a figure partial only when the log was cut off and nothing else can give it", () => {
    const row = { truncated: true, opening: null, access: "TICK" as const, week_id: "w" };
    expect(partialFigures(row)).toEqual({ payments: true, opening: true, implied: true });
    expect(partialFigures({ ...row, opening: "10" }).opening).toBe(false);                                                    // found, so it is the opening
    expect(partialFigures({ ...row, access: "FULL" }).implied).toBe(false);                                                   // the reconciliation has the whole week
    expect(partialFigures({ ...row, access: "FULL", week_id: null }).implied).toBe(true);
    expect(partialFigures({ ...row, truncated: false })).toEqual({ payments: false, opening: false, implied: false });
  });
  it("groups accounts by the company that owns them", () => {
    const r = (owner: string | null, account_id: string) => ({ owner, account_id }) as WeekOverviewRow;
    expect(byOwner([r("A", "1"), r("A", "2"), r("B", "3")]).map((g) => [g.owner, g.accounts.length])).toEqual([["A", 2], ["B", 1]]);
  });
});

// Each step commits, and each read is a new connection as that person, as the page does. BEES owns CBE: Samuel prepares, Abebe locks.
describe("the reconciliation as each person", () => {
  let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
  let mon: string, week: string, askuCheque: string, berberoTransfer: string;
  const tx = (c: Client): Tx => ({ q: async (sql, p) => (await c.query(sql, p as unknown[])).rows });
  const view = (who: string, id = week) => as(who, (c) => reconciliationWeek(tx(c), id, who));
  const offers = async (who: string) => { const d = (await view(who))!; return reconOffers(d.summary, d.access, who, d.workedOn); };
  const committed = async (who: string, sql: string, p: unknown[]) => { await owner.query("BEGIN"); await actAs(owner, who); const r = await rows(owner, sql, p); await owner.query("COMMIT"); return r[0]; };
  const clock = (offset: number) => { const d = new Date(`${mon}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return owner.query(`CREATE OR REPLACE FUNCTION treasury_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $f$ SELECT '${d.toISOString().slice(0, 10)}T09:00:00+03:00'::timestamptz $f$`); };
  const revision = async () => (await rows(owner, "SELECT revision r FROM treasury_weeks WHERE id = $1", [week]))[0].r;
  const sunday = () => { const d = new Date(`${mon}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10); };

  beforeAll(async () => {
    const d = await setupDb("abig_test_recon_screens"); owner = d.owner; as = d.as;
    mon = (await rows(owner, "SELECT week_monday(addis_day(clock_timestamp()))::text d"))[0].d;
    await clock(0);
    await owner.query("BEGIN");
    await actAs(owner, user.samuel); await owner.query("SELECT record_opening_balance($1, 3000000)", [CBE]);
    askuCheque = (await authorized(owner, { account: CBE, amounts: [200000], method: "CHEQUE" })).id;
    await actAs(owner, user.meron); await owner.query("SELECT record_execution($1,$2,$3)", [askuCheque, "CHQ-REC-1", "REF-REC-1"]);
    berberoTransfer = (await authorized(owner, { company: BERBERO, amounts: [100000], method: "TRANSFER" })).id;
    await actAs(owner, user.samuel); await owner.query("SELECT record_balance_check($1, 3050000, '{}')", [CBE]);               // 300,000 outstanding, so 2,750,000 and 50,000 implied
    week = await fn(owner, "start_reconciliation", CBE, mon, 2949500, 50000);
    await owner.query("SELECT match_payment($1,$2,$3,'STMT-77')", [week, berberoTransfer, sunday()]);
    await owner.query("SELECT add_reconciliation_line($1,'BANK_CHARGE',500,'Monthly fee')", [week]);
    await owner.query("COMMIT");
  });
  afterAll(async () => { await owner?.end(); });

  it("FULL: the Accountant sees every figure, payee and reference, and may prepare", async () => {
    const d = (await view(user.samuel))!;
    expect(d.access).toBe("FULL");
    expect([d.summary.closing, d.summary.unmatched_total, d.summary.system_balance, d.summary.adjust_total].map(Number)).toEqual([2949500, 200000, 2750000, -500]);
    expect([Number(d.summary.balance_difference), Number(d.summary.deposit_difference)]).toEqual([0, 0]);
    const p = d.payments.find((x) => x.id === askuCheque)!;
    expect([p.payee !== null, p.cheque_no, p.bank_reference]).toEqual([true, "CHQ-REC-1", "REF-REC-1"]);
    expect(d.payments.find((x) => x.id === berberoTransfer)!.reference).toBe("STMT-77");
    expect(d.lines.map((l) => [l.kind, Number(l.amount), l.reason])).toEqual([["BANK_CHARGE", -500, "Monthly fee"]]);
    expect(d.workedOn).toBe(true);
    expect(await offers(user.samuel)).toMatchObject({ stage: "preparing", prepare: true, review: false });
  });
  it("FULL: the Finance Manager sees the figures, and nothing to do until it is sent", async () => {
    expect(await offers(user.abebe)).toMatchObject({ stage: "preparing", prepare: false, review: false });
  });
  it("TICK: every payment, but no statement figures, payees, references or lines from other companies", async () => {
    const d = (await view(user.tigist))!;
    expect(d.access).toBe("TICK");
    expect(d.payments.map((p) => p.id).sort()).toEqual([askuCheque, berberoTransfer].sort());
    const other = d.payments.find((p) => p.id === askuCheque)!;
    expect([other.payee, other.cheque_no, other.bank_reference]).toEqual([null, null, null]);
    expect(d.payments.find((p) => p.id === berberoTransfer)!.reference).toBe("STMT-77");                                     // its own
    expect([d.summary.closing, d.summary.deposits, d.summary.balance_difference, d.summary.system_balance, d.summary.prepared_by_name]).toEqual([null, null, null, null, null]);
    expect(d.lines).toEqual([]);
    const seen = JSON.stringify(d);
    for (const s of ["CHQ-REC-1", "REF-REC-1", "Monthly fee", "2949500"]) expect(seen).not.toContain(s);
    expect(await offers(user.tigist)).toMatchObject({ stage: "reconciling", prepare: false, review: false });
  });
  it("NONE: the status and the company's own payments", async () => {
    const d = (await view(user.meron))!;
    expect(d.access).toBe("NONE");
    expect(d.payments.map((p) => p.id)).toEqual([askuCheque]);
    expect(d.payments[0].cheque_no).toBe("CHQ-REC-1");
    expect(d.lines).toEqual([]);
    expect(d.summary.closing).toBeNull();
    const hana = (await view(user.hana))!;
    expect(hana.payments.map((p) => p.id)).toEqual([berberoTransfer]);
  });
  it("a week on an account a person cannot see does not exist for them", async () => {
    expect(await view(user.bereket)).toBeNull();
    const awash = (await rows(owner, "SELECT count(*)::int n FROM treasury_weeks WHERE account_id = $1", [AWASH]))[0].n;
    expect(awash).toBe(0);
  });
  it("the steps stay refused to those who hold no such role, whatever the screen shows", async () => {
    await as(user.tigist, async (c) => {
      expect(await fails(c, "SELECT match_payment($1,$2,$3)", [week, askuCheque, sunday()])).toMatch(/only an Accountant of the company that owns/);
      expect(await fails(c, "SELECT lock_week($1, 1)", [week])).toMatch(/only a Finance Manager/);
    });
    await as(user.abebe, async (c) => { expect(await fails(c, "SELECT add_reconciliation_line($1,'OTHER',1,'Nope')", [week])).toMatch(/only an Accountant/); });
    await as(user.meron, async (c) => { expect(await fails(c, "SELECT return_reconciliation($1,'Nope')", [week])).toMatch(/only a Finance Manager/); });
  });

  it("sent for review: it moves to the Finance Manager, and the Accountant cannot review it", async () => {
    await committed(user.samuel, "SELECT submit_reconciliation($1,$2,$3::jsonb)", [week, await revision(), JSON.stringify({ [askuCheque]: "Cheque not cashed yet" })]);
    expect(await offers(user.samuel)).toMatchObject({ stage: "review", prepare: false, review: false, lock: false });
    expect(await offers(user.abebe)).toMatchObject({ stage: "review", review: true, lock: true });
    expect((await view(user.abebe))!.payments.find((p) => p.id === askuCheque)!.carry_reason).toBe("Cheque not cashed yet");
    expect((await view(user.tigist))!.payments.find((p) => p.id === askuCheque)!.carry_reason).toBeNull();
  });
  it("returned: the reason reaches the Accountant, and it can change again", async () => {
    await committed(user.abebe, "SELECT return_reconciliation($1,'Check the fee')", [week]);
    expect(await offers(user.samuel)).toMatchObject({ stage: "returned", prepare: true });
    expect((await view(user.samuel))!.summary.return_reason).toBe("Check the fee");
    expect((await view(user.tigist))!.summary.return_reason).toBeNull();
    expect((await view(user.samuel))!.payments.find((p) => p.id === askuCheque)!.carry_reason).toBeNull();                   // given again when sent again
  });
  it("locked: nobody is offered anything, and the database refuses every change", async () => {
    await committed(user.samuel, "SELECT submit_reconciliation($1,$2,$3::jsonb)", [week, await revision(), JSON.stringify({ [askuCheque]: "Cheque not cashed yet" })]);
    await committed(user.abebe, "SELECT lock_week($1,$2)", [week, await revision()]);
    for (const who of [user.samuel, user.abebe, user.tigist, user.meron]) expect(await offers(who)).toMatchObject({ stage: "locked", prepare: false, review: false, lock: false });
    const line = (await view(user.samuel))!.lines[0].id;
    await as(user.samuel, async (c) => {
      for (const [sql, p] of [["SELECT match_payment($1,$2,$3)", [week, askuCheque, sunday()]], ["SELECT add_reconciliation_line($1,'OTHER',5,'Too late')", [week]], ["SELECT remove_reconciliation_line($1,'Too late')", [line]], ["SELECT start_reconciliation($1,$2,1,1)", [CBE, mon]], ["SELECT submit_reconciliation($1,0)", [week]]] as [string, unknown[]][])
        expect(await fails(c, sql, p)).toMatch(/locked and cannot be changed/);
    });
    await as(user.abebe, async (c) => {
      expect(await fails(c, "SELECT return_reconciliation($1,'Too late')", [week])).toMatch(/locked and cannot be changed/);
      expect(await fails(c, "SELECT lock_week($1,$2)", [week, await revision()])).toMatch(/locked and cannot be changed/);
    });
    const d = (await view(user.samuel))!;
    expect((await rows(owner, "SELECT workflow_state::text s FROM payment_requests WHERE id = ANY($1) ORDER BY total_amount", [[berberoTransfer, askuCheque]])).map((r) => r.s)).toEqual(["PAID", "AUTHENTICATED"]);
    expect(paymentColumns(d.payments)).toMatchObject({ matchedTotal: 100000, outstandingTotal: 200000 });
  });

  it("the overview follows each person's access to the same account", async () => {
    const row = (who: string) => as(who, async (c) => (await weekOverview(tx(c), null, mon)).find((r) => r.account_id === CBE)!);
    const [samuel, tigist, meron] = [await row(user.samuel), await row(user.tigist), await row(user.meron)];
    for (const r of [samuel, tigist, meron]) { expect(r.owner).toBe("BEES PLC"); expect(r.shared).toBe(true); expect(Number(r.opening)).toBe(3000000); expect(r.status).toBe("LOCKED"); expect(r.truncated).toBe(false); expect(r.current_balance).toBe(samuel.current_balance); }
    expect([samuel.access, samuel.payment_count, Number(samuel.payments), Number(samuel.implied)]).toEqual(["FULL", 2, 300000, 50000]);
    expect([tigist.access, tigist.payment_count, Number(tigist.payments), Number(tigist.implied)]).toEqual(["TICK", 2, 300000, 50000]);
    expect([meron.access, meron.payment_count, Number(meron.payments), meron.implied]).toEqual(["NONE", 1, 200000, null]);
    expect([samuel.prepared_at !== null, meron.prepared_at]).toEqual([true, null]);
  });
  it("the overview keeps a week's entries to that week, and follows the chosen company", async () => {
    const other = await as(user.samuel, async (c) => (await weekOverview(tx(c), null, "2020-01-06")).find((r) => r.account_id === CBE)!);
    expect([other.opening, other.payment_count, Number(other.payments), other.implied, other.week_id, other.status]).toEqual([null, 0, 0, null, null, "OPEN"]);
    await as(user.admin, async (c) => { expect((await weekOverview(tx(c), BERBERO, mon)).map((r) => r.account_id)).toEqual([CBE]); });
    await as(user.bereket, async (c) => { expect(await weekOverview(tx(c), null, mon)).toEqual([]); expect(await weekOverview(tx(c), ASKU, mon)).toEqual([]); expect(await overviewWeeks(tx(c), null)).toEqual([]); });
    await as(user.samuel, async (c) => { expect(await overviewWeeks(tx(c), null)).toEqual([mon]); });
  });

  it("does not offer the lock to someone who started the week, who the database refuses too", async () => {
    await as(user.yared, async (c) => {                                                                                       // holds every ASKU role
      await c.query("SELECT record_opening_balance($1, 1000000)", [AWASH]);
      const awash = await fn(c, "start_reconciliation", AWASH, mon, 1000000, 0);
      await actAs(c, user.meron);
      const rev = (await rows(c, "SELECT revision FROM reconciliation_summary($1)", [awash]))[0].revision;
      await c.query("SELECT submit_reconciliation($1,$2)", [awash, rev]);
      const read = async (who: string) => { await actAs(c, who); const d = (await reconciliationWeek(tx(c), awash, who))!; return { d, o: reconOffers(d.summary, d.access, who, d.workedOn) }; };
      const yared = await read(user.yared);
      expect(yared.d.workedOn).toBe(true);
      expect(yared.o).toMatchObject({ stage: "review", review: true, lock: false });                                          // prepared by Meron, so Yared may still return it
      expect(await fails(c, "SELECT lock_week($1,$2)", [awash, yared.d.summary.revision])).toMatch(/you worked on this reconciliation/);
      expect((await read(user.dawit)).o).toMatchObject({ review: true, lock: true });
      expect((await read(user.meron)).o).toMatchObject({ review: false, lock: false });
    });
  });
  it("correcting the statement figures does not count as starting the week", async () => {
    await as(user.yared, async (c) => {
      await actAs(c, user.meron);
      await c.query("SELECT record_opening_balance($1, 1000000)", [AWASH]);
      const awash = await fn(c, "start_reconciliation", AWASH, mon, 1000000, 0);
      await actAs(c, user.yared); await c.query("SELECT start_reconciliation($1,$2,1000000,0)", [AWASH, mon]);
      expect((await reconciliationWeek(tx(c), awash, user.yared))!.workedOn).toBe(false);
    });
  });
  it("past 100 log entries the overview says what it cannot know, and the reconciliation's figure stays whole", async () => {
    await as(user.meron, async (c) => {
      await c.query("SELECT record_opening_balance($1, 1000000)", [AWASH]);
      for (let i = 1; i <= 101; i++) await c.query("SELECT record_balance_check($1,$2)", [AWASH, 1000000 + i]);               // each one implies a deposit of 1
      const r = (await weekOverview(tx(c), null, mon)).find((x) => x.account_id === AWASH)!;
      expect([r.truncated, r.opening, Number(r.implied), r.access]).toEqual([true, null, 101, "FULL"]);
      expect(partialFigures(r)).toEqual({ payments: true, opening: true, implied: false });
    });
    await as(user.meron, async (c) => {
      await c.query("SELECT record_opening_balance($1, 1000000)", [AWASH]);
      for (let i = 1; i <= 50; i++) await c.query("SELECT record_balance_check($1,$2)", [AWASH, 1000000 + i]);
      const r = (await weekOverview(tx(c), null, mon)).find((x) => x.account_id === AWASH)!;
      expect([r.truncated, Number(r.opening), Number(r.implied)]).toEqual([false, 1000000, 50]);
    });
  });

  it("the next week shows the carried payment, and why, to those allowed to read it", async () => {
    await clock(7);
    await committed(user.samuel, "SELECT record_opening_balance($1, 2950000)", [CBE]);
    const next = (await rows(owner, "SELECT id FROM treasury_weeks WHERE account_id = $1 AND week_start > $2::date", [CBE, mon]))[0].id;
    const samuel = (await view(user.samuel, next))!, p = samuel.payments.find((x) => x.id === askuCheque)!;
    expect(carriedIn(p.authenticated_at, samuel.summary.week_start)).toBe(true);
    expect([p.carried_from, p.carried_reason, p.overdue]).toEqual([mon, "Cheque not cashed yet", false]);
    const meron = (await view(user.meron, next))!.payments[0];
    expect([meron.carried_from, meron.carried_reason]).toEqual([mon, "Cheque not cashed yet"]);
    const tigist = (await view(user.tigist, next))!.payments.find((x) => x.id === askuCheque)!;
    expect(carriedIn(tigist.authenticated_at, samuel.summary.week_start)).toBe(true);
    expect([tigist.carried_from, tigist.carried_reason]).toEqual([null, null]);
    await clock(25);
    const late = (await view(user.samuel, next))!.payments.find((x) => x.id === askuCheque)!;
    expect(late.overdue).toBe(true); expect(late.age_days).toBeGreaterThanOrEqual(14);
  });
});
