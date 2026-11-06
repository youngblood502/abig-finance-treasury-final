import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { actAs, authorized, BERBERO, CBE, fails, fn, rows, setupDb, user } from "./helpers";

// One shared account, BEES CBE, with a payment from Berbero and one from ASKU. Every read below runs as the real application role.
//   BEES owns it. Berbero may use it and enter its balance. ASKU may only use it. Selam reports on ASKU and BEES, not Berbero. Bereket has no link.
let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
let berberoPay: string, askuPay: string, week: string;
const BERBERO_AMOUNT = 400000, ASKU_AMOUNT = 200000;
const numbers: Record<string, string> = {};

beforeAll(async () => {
  const d = await setupDb("abig_test_privacy"); owner = d.owner; as = d.as;
  await owner.query("BEGIN");
  await actAs(owner, user.samuel); await fn(owner, "record_opening_balance", CBE, 1500000);
  berberoPay = (await authorized(owner, { company: BERBERO, amounts: [BERBERO_AMOUNT], method: "TRANSFER" })).id;
  askuPay = (await authorized(owner, { account: CBE, amounts: [ASKU_AMOUNT], method: "CHEQUE" })).id;
  await actAs(owner, user.nardos); await fn(owner, "record_execution", berberoPay, null, "FT-SECRET");
  await actAs(owner, user.samuel); await owner.query("SELECT record_balance_check($1, 1100000, $2)", [CBE, [berberoPay]]);
  const wk = (await rows(owner, "SELECT week_start::text w FROM treasury_weeks WHERE account_id = $1", [CBE]))[0].w;
  week = await fn(owner, "start_reconciliation", CBE, wk, 1100000, 0) as string;
  const today = (await rows(owner, "SELECT addis_day(clock_timestamp())::text d"))[0].d;
  await fn(owner, "match_payment", week, berberoPay, today, "STATEMENT-SECRET");
  await owner.query("COMMIT");
  for (const r of await rows(owner, "SELECT id, request_no FROM payment_requests")) numbers[r.id] = r.request_no;
});
afterAll(async () => { await owner?.end(); });

const log = (c: Client) => rows(c, "SELECT * FROM account_balance_history($1, 100)", [CBE]);
const berberoNo = () => numbers[berberoPay], askuNo = () => numbers[askuPay];
const paymentsIn = (r: { request_no: string | null }[]) => r.map((x) => x.request_no).filter(Boolean).sort();
const text = (v: unknown) => JSON.stringify(v);

describe("a company that may only use the account (ASKU)", () => {
  it.each([["Accountant", () => user.meron], ["Finance Manager", () => user.dawit], ["Owner", () => user.kebede]])("%s sees its own payment in full and nothing of Berbero's", async (_n, who) => {
    await as(who(), async (c) => {
      const entries = await log(c);
      expect(paymentsIn(entries)).toEqual([askuNo()]);
      const own = entries.find((e) => e.request_no === askuNo())!;
      expect([Number(own.previous_balance) - Number(own.new_balance), own.updated_by_name]).toEqual([ASKU_AMOUNT, "Kebede (ASKU owner)"]);
      expect(text(entries)).not.toContain("Hana"); expect(text(entries)).not.toContain(berberoNo());
      expect((await rows(c, "SELECT id FROM outstanding_payments($1)", [CBE])).map((r) => r.id)).toEqual([askuPay]);
      expect((await rows(c, "SELECT id FROM reconciliation_payments($1)", [week])).map((r) => r.id)).toEqual([askuPay]);
      expect(await rows(c, "SELECT id FROM balance_check_items WHERE request_id = $1", [berberoPay])).toEqual([]);
      expect(await rows(c, "SELECT id FROM reconciliation_lines WHERE request_id = $1", [berberoPay])).toEqual([]);
    });
  });
  it("gets only the time, kind and balance on every other entry, so no figure gives away a single payment", async () => {
    await as(user.meron, async (c) => {
      const others = (await log(c)).filter((e) => !e.request_no);
      expect(others.map((e) => e.entry_kind).sort()).toEqual(["CHECK", "OPENING"]);
      for (const e of others) expect([e.previous_balance, e.bank_figure, e.outstanding_total, e.implied_deposit, e.updated_by, e.updated_by_name, e.anomalies]).toEqual([null, null, null, null, null, null, []]);
    });
  });
  it("sees a week's status, but no statement figure or total", async () => {
    await as(user.meron, async (c) => {
      const s = (await rows(c, "SELECT * FROM reconciliation_summary($1)", [week]))[0];
      expect(s.status).toBe("RECONCILING");
      expect([s.closing, s.deposits, s.unmatched_total, s.system_balance, s.implied_total, s.balance_difference, s.prepared_by_name, s.can_prepare, s.can_review]).toEqual([null, null, null, null, null, null, null, false, false]);
    });
  });
});

describe("group reporting on the owner company", () => {
  it("does not reach another company's payments, though it reads BEES and ASKU", async () => {
    await as(user.selam, async (c) => {
      const entries = await log(c);
      expect(paymentsIn(entries)).toEqual([askuNo()]);                                   // ASKU is one of Selam's companies
      expect(text(entries)).not.toContain("Hana");
      expect((await rows(c, "SELECT id FROM outstanding_payments($1)", [CBE])).map((r) => r.id)).toEqual([askuPay]);
      expect((await rows(c, "SELECT id FROM reconciliation_payments($1)", [week])).map((r) => r.id)).toEqual([askuPay]);
      expect(await rows(c, "SELECT id FROM balance_check_items WHERE request_id = $1", [berberoPay])).toEqual([]);
      expect(await rows(c, "SELECT id FROM reconciliation_lines WHERE request_id = $1", [berberoPay])).toEqual([]);
      expect((await rows(c, "SELECT closing FROM reconciliation_summary($1)", [week]))[0].closing).toBeNull();
    });
  });
});

describe("someone who may enter the balance (Berbero)", () => {
  it("sees its own payment in full", async () => {
    await as(user.tigist, async (c) => {
      const own = (await rows(c, "SELECT * FROM outstanding_payments($1) WHERE id = $2", [CBE, berberoPay]))[0];
      expect([own.payee, own.bank_reference]).toEqual(["Ethio Chemicals SC", "FT-SECRET"]);
    });
  });
  it("sees what it needs to tick another company's payment, but not who it pays or who approved it", async () => {
    await as(user.tigist, async (c) => {
      const other = (await rows(c, "SELECT * FROM outstanding_payments($1) WHERE id = $2", [CBE, askuPay]))[0];
      expect([other.request_no, other.company, other.method, Number(other.amount)]).toEqual([askuNo(), "ASKU PLC", "CHEQUE", ASKU_AMOUNT]);
      expect([other.payee, other.cheque_no, other.bank_reference]).toEqual([null, null, null]);
      const entry = (await log(c)).find((e) => e.request_no === askuNo())!;
      expect(Number(entry.previous_balance) - Number(entry.new_balance)).toBe(ASKU_AMOUNT);
      expect([entry.updated_by, entry.updated_by_name]).toEqual([null, null]);
      expect((await rows(c, "SELECT payee FROM reconciliation_payments($1) WHERE id = $2", [week, askuPay]))[0].payee).toBeNull();
    });
  });
  it("still enters a balance and ticks, and sees the check's figures", async () => {
    await as(user.tigist, async (c) => {
      await c.query("SELECT record_balance_check($1, 900000, $2)", [CBE, [askuPay]]);
      const e = (await log(c)).find((x) => x.entry_kind === "CHECK")!;
      expect([Number(e.bank_figure), e.updated_by_name]).toEqual([900000, "Tigist (Berbero accountant)"]);
    });
  });
  it("does not read statement references or the owner's lines", async () => {
    await as(user.tigist, async (c) => {
      expect((await rows(c, "SELECT reference FROM reconciliation_lines WHERE request_id = $1", [askuPay]))).toEqual([]);
      expect((await rows(c, "SELECT closing FROM reconciliation_summary($1)", [week]))[0].closing).toBeNull();
    });
  });
});

describe("the company that owns the account", () => {
  it.each([["Accountant", () => user.samuel], ["Finance Manager", () => user.abebe], ["Administrator", () => user.admin]])("%s sees everything needed to reconcile", async (_n, who) => {
    await as(who(), async (c) => {
      const entries = await log(c);
      expect(paymentsIn(entries)).toEqual([berberoNo(), askuNo()].sort());
      expect(entries.find((e) => e.request_no === berberoNo())!.updated_by_name).toBe("Hana (Berbero owner)");
      expect(Number(entries.find((e) => e.entry_kind === "CHECK")!.outstanding_total)).toBe(ASKU_AMOUNT);
      expect((await rows(c, "SELECT payee FROM outstanding_payments($1) ORDER BY payee", [CBE])).map((r) => r.payee)).toEqual(["Ethio Chemicals SC", "Hawassa Packaging PLC"]);
      expect((await rows(c, "SELECT reference FROM reconciliation_payments($1) WHERE id = $2", [week, berberoPay]))[0].reference).toBe("STATEMENT-SECRET");
      expect(Number((await rows(c, "SELECT closing FROM reconciliation_summary($1)", [week]))[0].closing)).toBe(1100000);
    });
  });
  it("still prepares and locks a week as the application role, and the payment becomes Paid", async () => {
    await as(user.samuel, async (c) => {
      const rev = (await rows(c, "SELECT revision FROM reconciliation_summary($1)", [week]))[0].revision;
      const newRev = await fn(c, "submit_reconciliation", week, rev, { [askuPay]: "Cheque not presented yet" });
      await actAs(c, user.abebe); await c.query("SELECT lock_week($1,$2)", [week, newRev]);
      expect((await rows(c, "SELECT workflow_state::text s FROM payment_requests WHERE id = $1", [berberoPay]))).toEqual([]);   // BEES cannot read Berbero's request directly
      expect((await rows(c, "SELECT status, closing FROM reconciliation_summary($1)", [week]))[0].status).toBe("LOCKED");
      await actAs(c, user.nardos);
      expect((await rows(c, "SELECT workflow_state::text s FROM payment_requests WHERE id = $1", [berberoPay]))[0].s).toBe("PAID");
    });
  });
});

describe("no way around it", () => {
  it("the application role cannot read the balance log or statement figures directly, for anyone", async () => {
    for (const who of [user.meron, user.tigist, user.samuel, user.admin]) await as(who, async (c) => {
      expect(await fails(c, "SELECT * FROM bank_balance_history")).toMatch(/permission denied/);
      expect(await fails(c, "SELECT request_id FROM bank_balance_history")).toMatch(/permission denied/);
      expect(await fails(c, "SELECT statement_closing_balance FROM treasury_weeks")).toMatch(/permission denied/);
      expect(await fails(c, "SELECT * FROM treasury_weeks")).toMatch(/permission denied/);
    });
  });
  it("someone with no link sees nothing anywhere", async () => {
    await as(user.bereket, async (c) => {
      expect(await log(c)).toEqual([]);
      expect(await rows(c, "SELECT id FROM outstanding_payments($1)", [CBE])).toEqual([]);
      expect(await rows(c, "SELECT id FROM reconciliation_payments($1)", [week])).toEqual([]);
      expect(await rows(c, "SELECT week_id FROM reconciliation_summary($1)", [week])).toEqual([]);
      expect(await rows(c, "SELECT id FROM treasury_weeks")).toEqual([]);
      expect(await rows(c, "SELECT id FROM balance_check_items")).toEqual([]);
      expect(await rows(c, "SELECT id FROM reconciliation_lines")).toEqual([]);
      expect(await fn(c, "app_account_access", CBE)).toBe("NONE");
    });
  });
  it("the level follows the account: ASKU's staff are FULL on their own account and NONE on this one", async () => {
    const AWASH = "b0000000-0000-4000-8000-000000000002";
    await as(user.meron, async (c) => { expect([await fn(c, "app_account_access", AWASH), await fn(c, "app_account_access", CBE)]).toEqual(["FULL", "NONE"]); });
    await as(user.tigist, async (c) => { expect(await fn(c, "app_account_access", CBE)).toBe("TICK"); });
    await as(user.selam, async (c) => { expect([await fn(c, "app_account_access", AWASH), await fn(c, "app_account_access", CBE)]).toEqual(["NONE", "NONE"]); });
  });
});

describe("nothing else moved", () => {
  it("everyone linked sees the one shared balance", async () => {
    const seen = [];
    for (const who of [user.meron, user.tigist, user.samuel, user.selam]) seen.push(await as(who, async (c) => (await rows(c, "SELECT current_balance c FROM company_bank_accounts WHERE id = $1", [CBE]))[0].c));
    expect(new Set(seen).size).toBe(1);
    expect(Number(seen[0])).toBe(900000);
  });
  it("the log is complete underneath, and the integrity check is clean", async () => {
    expect((await rows(owner, "SELECT count(*)::int n FROM bank_balance_history WHERE account_id = $1", [CBE]))[0].n).toBe(4);
    const sql = readFileSync(join(__dirname, "../ops/verify-integrity.sql"), "utf8").replace(/^\\set.*$/m, "");
    expect((await owner.query(sql)).rows.filter((r) => Number(r.violations) > 0)).toEqual([]);
  });
  it("the integrity check notices if direct access comes back", async () => {
    await owner.query("BEGIN");
    try {
      await owner.query("GRANT SELECT ON bank_balance_history TO abig_app");
      const sql = readFileSync(join(__dirname, "../ops/verify-integrity.sql"), "utf8").replace(/^\\set.*$/m, "");
      expect((await owner.query(sql)).rows.filter((r) => Number(r.violations) > 0).map((r) => r.name)).toEqual(["application role can read the balance log or statement figures directly"]);
    } finally { await owner.query("ROLLBACK"); }
  });
});
