import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { Tx } from "../src/lib/db";
import { sumRows, tableView } from "../src/lib/table";
import { accountDetail, accountList, ACCESS_NOTE, dueBucket, logColumnKeys, outstandingScope, paymentSchedule, previewFigure, treasuryOverview } from "../src/lib/treasury-screens";
import { actAs, ASKU, authorized, AWASH, BERBERO, CBE, enterFigure, fails, fn, mk, rows, setupDb, user } from "./helpers";

describe("the balance check preview", () => {
  const base = { figure: 0, previous: 0, reserved: 0, threshold: 500000, opening: false, hadOpening: false };
  it("follows the plan's CBE example", () => {
    expect(previewFigure({ ...base, figure: 1100000, previous: 1100000 }, [])).toMatchObject({ outstanding: 0, balance: 1100000, implied: 0 });
    expect(previewFigure({ ...base, figure: 1150000, previous: 900000 }, [200000])).toMatchObject({ outstanding: 200000, balance: 950000, implied: 50000 });
  });
  it("has no implied deposit on an opening", () => { expect(previewFigure({ ...base, figure: 1500000, previous: 4200000, opening: true }, []).implied).toBeNull(); });
  it("warns as the log would", () => {
    expect(previewFigure({ ...base, figure: 900, previous: 1000 }, [])).toMatchObject({ implied: -100, negativeDeposit: true, largeDeposit: false });
    expect(previewFigure({ ...base, figure: 500000 }, []).largeDeposit).toBe(false);                                          // exactly the threshold
    expect(previewFigure({ ...base, figure: 500000.01 }, []).largeDeposit).toBe(true);
    expect(previewFigure({ ...base, figure: 100, reserved: 400 }, []).shortfall).toBe(300);
    expect(previewFigure({ ...base, figure: 400, reserved: 400 }, []).shortfall).toBe(0);
  });
  it("warns of an opening that moved the balance, as the log would", () => {
    const opening = { ...base, opening: true, hadOpening: true, previous: 1000 };
    expect(previewFigure({ ...opening, figure: 1200 }, []).openingChanged).toBe(true);
    expect(previewFigure({ ...opening, figure: 1200 }, [200]).openingChanged).toBe(false);                                    // the same balance once the payment is subtracted
    expect(previewFigure({ ...opening, figure: 1200, hadOpening: false }, []).openingChanged).toBe(false);                    // the account's first opening
    expect(previewFigure({ ...base, figure: 1200, previous: 1000 }, []).openingChanged).toBe(false);                          // a balance check
  });
  it("adds cents without drift", () => { expect(previewFigure({ ...base, figure: 0.3 }, [0.1, 0.1]).balance).toBe(0.1); });
});

describe("the labels", () => {
  it("say whose outstanding payments a figure covers", () => {
    expect(outstandingScope("FULL", false)).toBe("This account");
    expect(outstandingScope("NONE", false)).toBe("Your company only");                                                        // a revoked company can still have payments here
    expect(outstandingScope("FULL", true)).toBe("All companies on this account");
    expect(outstandingScope("TICK", true)).toBe("All companies on this account");
    expect(outstandingScope("NONE", true)).toBe("Your company only");
  });
  it("explain a limited view, and say nothing at FULL", () => { expect(ACCESS_NOTE.FULL).toBeNull(); expect(ACCESS_NOTE.TICK).toMatch(/not who other companies pay/); expect(ACCESS_NOTE.NONE).toMatch(/own company's payments/); });
  it("draw no empty columns below TICK", () => {
    const masked = { previous_balance: null, updated_by_name: null }, own = { previous_balance: "10", updated_by_name: "Meron" };
    expect(logColumnKeys("NONE", [masked])).toEqual(["when", "entry", "balance"]);
    expect(logColumnKeys("TICK", [masked])).toContain("bank"); expect(logColumnKeys("FULL", [])).toContain("implied");
  });
  it("keep a company's own payment details at NONE", () => {
    expect(logColumnKeys("NONE", [{ previous_balance: null, updated_by_name: null }, { previous_balance: "10", updated_by_name: "Meron" }])).toEqual(["when", "entry", "previous", "balance", "by"]);
  });
  it("total only the rows a filter leaves, in whole cents", () => {
    const data = [{ filters: { when: "overdue" }, sort: { amount: 0.1 } }, { filters: { when: "overdue" }, sort: { amount: 0.2 } }, { filters: { when: "week" }, sort: { amount: 500 } }];
    const view = (when: string) => tableView(data, { query: "", filters: { when }, sortKey: null, descending: false, page: 1, pageSize: 1 });
    expect(sumRows(view("overdue").matched, "amount")).toBe(0.3);                                                             // across pages too
    expect(sumRows(view("").matched, "amount")).toBe(500.3);
  });
  it("sort due dates into groups", () => {
    expect(dueBucket("2026-11-05", "2026-11-06")).toBe("overdue"); expect(dueBucket("2026-11-06", "2026-11-06")).toBe("week"); expect(dueBucket("2026-11-13", "2026-11-06")).toBe("week"); expect(dueBucket("2026-11-14", "2026-11-06")).toBe("month");
  });
});

describe("the treasury screens as the application role", () => {
  let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
  let berbero: string, asku: string, askuCarried: string, reservedBerbero: string, today: string;
  const tx = (c: Client): Tx => ({ q: async (sql, p) => (await c.query(sql, p as unknown[])).rows });
  const none = async (c: Client, id: string) => accountDetail(tx(c), id);
  const nearby = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

  beforeAll(async () => {
    const d = await setupDb("abig_test_treasury_screens"); owner = d.owner; as = d.as;
    today = (await rows(owner, "SELECT addis_day(clock_timestamp())::text d"))[0].d;
    await owner.query("BEGIN");
    await actAs(owner, user.samuel); await enterFigure(owner, CBE, 3000000);
    berbero = (await authorized(owner, { company: BERBERO, amounts: [400000], method: "TRANSFER" })).id;
    asku = (await authorized(owner, { account: CBE, amounts: [200000], method: "CHEQUE" })).id;
    await actAs(owner, user.meron); await owner.query("SELECT record_execution($1,$2,$3)", [asku, "CHQ-MASK-1", "REF-MASK-1"]);
    askuCarried = (await authorized(owner, { account: CBE, amounts: [100000], method: "TRANSFER" })).id;
    await actAs(owner, user.samuel); await owner.query("SELECT record_balance_check($1, 2500000, $2)", [CBE, [askuCarried]]);
    await actAs(owner, user.nardos);
    reservedBerbero = await mk(owner, user.nardos, { company: BERBERO, account: CBE, amounts: [50000], dues: [nearby(5)], supplier: "d0000000-0000-4000-8000-000000000002", bank: "e0000000-0000-4000-8000-000000000002" }); await fn(owner, "wf_submit", reservedBerbero);
    await actAs(owner, user.meron);
    const overdue = await mk(owner, user.meron, { amounts: [60000], dues: [nearby(-2)] }); await fn(owner, "wf_submit", overdue);
    const later = await mk(owner, user.meron, { amounts: [70000], dues: [nearby(45)] }); await fn(owner, "wf_submit", later);
    await owner.query("COMMIT");
  });
  afterAll(async () => { await owner?.end(); });

  it("the preview agrees with what the database records", async () => {
    await as(user.samuel, async (c) => {
      const d = (await none(c, CBE))!;
      const waiting = d.payments.filter((p) => !p.processed_at), figure = 2600000;
      const p = previewFigure({ figure, previous: Number(d.facts.current_balance), reserved: Number(d.facts.reserved_balance), threshold: Number(d.facts.large_deposit_threshold), opening: false }, waiting.map((x) => Number(x.amount)));
      const r = (await rows(c, "SELECT * FROM record_balance_check($1,$2)", [CBE, figure]))[0];
      expect([Number(r.outstanding_total), Number(r.new_balance), Number(r.implied_deposit)]).toEqual([p.outstanding, p.balance, p.implied]);
    });
  });

  it("FULL: the owner's staff see every payment with its payee, and the full log", async () => {
    await as(user.samuel, async (c) => {
      const d = (await none(c, CBE))!;
      expect(d.access).toBe("FULL");
      expect(d.payments.map((p) => p.id).sort()).toEqual([berbero, asku, askuCarried].sort());
      expect(d.payments.every((p) => p.payee !== null)).toBe(true);
      expect(d.payments.find((p) => p.id === asku)!.cheque_no).toBe("CHQ-MASK-1");
      expect(d.log.filter((e) => e.request_no).length).toBe(3);
      expect(d.log.find((e) => e.entry_kind === "CHECK")!.bank_figure).not.toBeNull();
    });
  });
  it("TICK: everything needed to tick, and not who other companies pay", async () => {
    await as(user.tigist, async (c) => {
      const d = (await none(c, CBE))!;
      expect([d.access, d.status.can_check]).toEqual(["TICK", true]);
      const other = d.payments.find((p) => p.id === asku)!;
      expect([other.request_no, other.company, Number(other.amount), other.payee, other.cheque_no]).toEqual([other.request_no, "ASKU PLC", 200000, null, null]);
      const seen = JSON.stringify([d, await treasuryOverview(tx(c), null), await accountList(tx(c), null)]);
      expect(seen).not.toContain("CHQ-MASK-1"); expect(seen).not.toContain("REF-MASK-1");
      expect(d.payments.find((p) => p.id === berbero)!.payee).toBeTruthy();                                                   // its own
      expect(d.log.find((e) => e.request_no === other.request_no)!.updated_by_name).toBeNull();
    });
  });
  it("NONE: a sharing company gets the balance, its own payments, and no entry form", async () => {
    await as(user.meron, async (c) => {
      const d = (await none(c, CBE))!;
      expect([d.access, d.status.can_check]).toEqual(["NONE", false]);
      expect(d.payments.map((p) => p.id).sort()).toEqual([asku, askuCarried].sort());
      expect(d.log.filter((e) => e.request_no).length).toBe(2);
      expect(JSON.stringify(d)).not.toContain("Hana");
      expect(await fails(c, "SELECT record_balance_check($1, 1)", [CBE])).toMatch(/you may not update/);                       // the form is hidden, and the database refuses too
      expect(await fails(c, "SELECT undo_processed_tick($1, 'Not mine')", [askuCarried])).toMatch(/you may not change/);
    });
  });
  it("an account a person cannot see does not exist for them", async () => {
    await as(user.bereket, async (c) => { expect(await none(c, CBE)).toBeNull(); expect(await none(c, AWASH)).toBeNull(); });
    await as(user.tigist, async (c) => { expect(await none(c, AWASH)).toBeNull(); });
  });

  it("the overview shows one account total for all, and each person's own outstanding view", async () => {
    const line = async (who: string) => as(who, async (c) => (await treasuryOverview(tx(c), null)).find((a) => a.account_id === CBE)!);
    const [samuel, tigist, meron] = [await line(user.samuel), await line(user.tigist), await line(user.meron)];
    for (const k of ["current_balance", "reserved_balance", "available_balance", "shortfall_amount"] as const) { expect(meron[k]).toBe(samuel[k]); expect(tigist[k]).toBe(samuel[k]); }
    expect([samuel.shared, tigist.shared, meron.shared]).toEqual([true, true, true]);                                         // a sharing company is told it shares
    expect([samuel.access, samuel.outstanding_count, Number(samuel.outstanding_amount)]).toEqual(["FULL", 3, 700000]);
    expect([tigist.access, tigist.outstanding_count, Number(tigist.outstanding_amount)]).toEqual(["TICK", 3, 700000]);
    expect([meron.access, meron.outstanding_count, Number(meron.outstanding_amount)]).toEqual(["NONE", 2, 300000]);
  });
  it("the overview follows the chosen company, and cannot widen", async () => {
    await as(user.admin, async (c) => { expect((await treasuryOverview(tx(c), BERBERO)).map((a) => a.account_id)).toEqual([CBE]); });
    await as(user.bereket, async (c) => { expect(await treasuryOverview(tx(c), ASKU)).toEqual([]); });
    await as(user.meron, async (c) => { expect(await treasuryOverview(tx(c), BERBERO)).toHaveLength(1); });                   // the account they share; its figures stay limited
    await as(user.meron, async (c) => { expect(Number((await treasuryOverview(tx(c), BERBERO))[0].outstanding_amount)).toBe(300000); });
  });

  it("the accounts screen gives one log per person, at their level, in one pass", async () => {
    const one = async (who: string) => as(who, async (c) => (await accountList(tx(c), null)).find((a) => a.id === CBE)!);
    const [samuel, meron] = [await one(user.samuel), await one(user.meron)];
    expect([samuel.access, samuel.can_update, samuel.users.length]).toEqual(["FULL", true, meron.users.length]);
    expect(meron.users.length).toBeGreaterThan(1);                                                                           // a sharing company sees who else shares
    expect([meron.access, meron.can_update, meron.can_manage]).toEqual(["NONE", false, false]);
    expect(samuel.history.filter((h) => h.request_no).length).toBeGreaterThan(meron.history.filter((h) => h.request_no).length);
    expect(meron.history.filter((h) => !h.request_no).every((h) => h.bank_figure === null && h.previous_balance === null)).toBe(true);  // its own payments are its own
    expect(samuel.history.some((h) => h.bank_figure !== null)).toBe(true);
    await as(user.bereket, async (c) => { expect(await accountList(tx(c), null)).toEqual([]); });
  });

  it("the schedule lists what holds funds and falls due, only for the person's own companies", async () => {
    await as(user.meron, async (c) => {
      const s = await paymentSchedule(tx(c), null);
      expect(s.map((x) => Number(x.amount))).toEqual([60000]);                                                                // overdue is in; 45 days away is out
      expect(s[0].due_date).toBe(nearby(-2));
    });
    await as(user.nardos, async (c) => { expect((await paymentSchedule(tx(c), null)).map((x) => x.request_id)).toEqual([reservedBerbero]); });
    await as(user.samuel, async (c) => { expect(await paymentSchedule(tx(c), null)).toEqual([]); });                           // the account's owner does not see other companies' requests here
    await as(user.meron, async (c) => { expect(await paymentSchedule(tx(c), BERBERO)).toEqual([]); });
  });
});
