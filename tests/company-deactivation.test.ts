import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { Tx } from "../src/lib/db";
import { MY_COMPANIES_SQL } from "../src/lib/company";
import { auditRows, cashRows, outstandingRows, paymentRows, pendingRows, reportFilters, weekRows } from "../src/lib/reports";
import { listRequests, loadRequest, parseRequestFilters } from "../src/lib/requests";
import { reconciliationWeek } from "../src/lib/reconciliation";
import { accountList } from "../src/lib/treasury-screens";
import { actAs, ASKU, authorized, AWASH, BERBERO, CBE, fails, fn, mk, rows, setupDb, user } from "./helpers";

// ASKU's history: a cheque from its own Awash account, paid and closed in a locked reconciliation. BEES owns the CBE account that Berbero and ASKU also use;
// Berbero has a payment on it that is authenticated and not yet paid. Deactivating a company must keep all of that readable and the CBE payment payable.
const BEES = "c0000000-0000-4000-8000-000000000003";
const tx = (c: Client): Tx => ({ q: async (sql, p) => (await c.query(sql, p as unknown[])).rows });
const deactivate = (company: string, name: string, tin: string, phone: string) => `SELECT admin_update_company('${company}', '${name}', '${tin}', '${phone}', false)`;
const ASKU_OFF = deactivate(ASKU, "ASKU PLC", "0011223344", "+251911000001"), BEES_OFF = deactivate(BEES, "BEES PLC", "0033445566", "+251911000003");
const BERBERO_OFF = deactivate(BERBERO, "Berbero Petrochemical PLC", "0022334455", "+251911000002");

let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
let paid: string, paidNo: string, week: string, berberoPay: string;

/** Stored financial records, as a checksum per table. Deactivation must not change any of them. */
const ledger = async () => Object.fromEntries(await Promise.all(["payment_requests", "payment_installments", "bank_balance_history", "treasury_weeks", "reconciliation_lines", "approval_events", "company_bank_accounts", "company_bank_account_access"]
  .map(async (t) => [t, (await rows(owner, `SELECT md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) h FROM ${t} x`))[0].h])));

/** Everything a person reads about the accounts, requests, reconciliation, reports and audit, with no company chosen. */
const seen = (who: string) => as(who, async (c) => {
  const t = tx(c), f = reportFilters(() => null);
  const accounts = (await accountList(t, null)).map((a) => ({ id: a.id, access: a.access, balance: a.current_balance, history: a.history.map((h) => [h.request_no, h.new_balance, h.updated_by_name]) }));
  const w = await reconciliationWeek(t, week, who), r = await loadRequest(t, paid);
  return {
    accounts: accounts.sort((a, b) => a.id.localeCompare(b.id)),
    week: w && { access: w.access, status: w.summary.status, closing: w.summary.closing, locked_by: w.summary.locked_by_name, payments: w.payments.map((p) => [p.request_no, p.payee, p.reference]) },
    request: r && { restricted: r.restricted, state: r.r.workflow_state, payee: r.r.payee, approvals: r.approvals.map((a) => [a.action, a.full_name]) },
    list: (await listRequests(t, parseRequestFilters({}), null)).map((x) => [x.request_no, x.payee, x.workflow_state]).sort(),
    pending: await pendingRows(t), payments: await paymentRows(t, f), outstanding: await outstandingRows(t), weeks: await weekRows(t, f), cash: await cashRows(t),
    audit: (await auditRows(t, { q: null }, 5000)).filter((e) => e.action !== "COMPANY_UPDATED").map((e) => JSON.stringify(e)).sort(),         // one transaction shares a timestamp, so the order among them is not fixed
  };
});
const PEOPLE = { admin: user.admin, meron: user.meron, dawit: user.dawit, kebede: user.kebede, samuel: user.samuel, abebe: user.abebe, nardos: user.nardos, selam: user.selam };

beforeAll(async () => {
  const d = await setupDb("abig_test_company_deactivation"); owner = d.owner; as = d.as;
  const mon = (await rows(owner, "SELECT week_monday(addis_day(clock_timestamp()))::text d"))[0].d;
  const sunday = (await rows(owner, "SELECT ($1::date + 6)::text d", [mon]))[0].d;
  await owner.query("BEGIN");
  await actAs(owner, user.meron); await owner.query("SELECT record_opening_balance($1, 3000000)", [AWASH]);
  await actAs(owner, user.samuel); await owner.query("SELECT record_opening_balance($1, 3000000)", [CBE]);
  paid = (await authorized(owner, { amounts: [100000], method: "CHEQUE" })).id;
  await actAs(owner, user.meron); await owner.query("SELECT record_execution($1,'CHQ-DEACT-1','REF-DEACT-1')", [paid]);
  await owner.query("SELECT record_balance_check($1, 2900000, $2)", [AWASH, [paid]]);
  week = await fn(owner, "start_reconciliation", AWASH, mon, 2900000, 0);
  await owner.query("SELECT match_payment($1,$2,$3,'STMT-DEACT')", [week, paid, sunday]);
  const rev = async () => (await rows(owner, "SELECT revision r FROM treasury_weeks WHERE id = $1", [week]))[0].r;
  await owner.query("SELECT submit_reconciliation($1,$2)", [week, await rev()]);
  await actAs(owner, user.dawit); await owner.query("SELECT lock_week($1,$2)", [week, await rev()]);
  berberoPay = (await authorized(owner, { company: BERBERO, amounts: [40000], method: "TRANSFER" })).id;
  await owner.query("COMMIT");
  paidNo = (await rows(owner, "SELECT request_no n FROM payment_requests WHERE id = $1", [paid]))[0].n;
});
afterAll(async () => { await owner?.end(); });

/** Runs `setup` as the owner, then tries `sql` as the administrator, in one transaction that is always rolled back. */
const refusedAfter = async (setup: () => Promise<unknown>, sql: string) => {
  await owner.query("BEGIN");
  try { await setup(); await actAs(owner, user.admin); return await fails(owner, sql); } finally { await owner.query("ROLLBACK"); }
};

describe("deactivation is refused while work is under way", () => {
  it("the starting point: ASKU's payment is paid, and its reconciliation week is locked", async () => {
    expect((await rows(owner, "SELECT workflow_state::text s FROM payment_requests WHERE id = $1", [paid]))[0].s).toBe("PAID");
    expect((await rows(owner, "SELECT status::text s FROM treasury_weeks WHERE id = $1", [week]))[0].s).toBe("LOCKED");
  });
  it("a Reserved request", async () => {
    expect(await refusedAfter(async () => { await actAs(owner, user.meron); await fn(owner, "wf_submit", await mk(owner, user.meron, { amounts: [1000] })); }, ASKU_OFF)).toMatch(/waiting for approval/);
  });
  it("a Verified request", async () => {
    expect(await refusedAfter(async () => {
      await actAs(owner, user.meron); const id = await mk(owner, user.meron, { amounts: [2000] }); const v = await fn(owner, "wf_submit", id);
      await actAs(owner, user.dawit); await fn(owner, "wf_verify", id, v);
      expect((await rows(owner, "SELECT workflow_state::text s FROM payment_requests WHERE id = $1", [id]))[0].s).toBe("VERIFIED");
    }, ASKU_OFF)).toMatch(/waiting for approval/);
  });
  it("an Authenticated payment not yet paid, whether or not the cheque or transfer has gone out", async () => {
    expect(await refusedAfter(() => authorized(owner, { amounts: [5000], method: "TRANSFER" }), ASKU_OFF)).toMatch(/1 authenticated payment\(s\) not yet paid/);
    expect(await refusedAfter(async () => { const { id } = await authorized(owner, { amounts: [5000], method: "TRANSFER" }); await actAs(owner, user.meron); await owner.query("SELECT record_execution($1, null, 'FT-OUT')", [id]); }, ASKU_OFF)).toMatch(/authenticated payment/);
    expect(await refusedAfter(async () => undefined, BERBERO_OFF)).toMatch(/authenticated payment/);                     // Berbero's payment on the shared account
  });
  it("an Authenticated payment on an account another company owns", async () => {
    expect(await refusedAfter(() => authorized(owner, { account: CBE, amounts: [7000], method: "TRANSFER" }), ASKU_OFF)).toMatch(/authenticated payment/);
  });
  it("a reconciliation in progress on an account the company owns", async () => {
    expect(await refusedAfter(async () => {
      await actAs(owner, user.samuel); await owner.query("SELECT record_balance_check($1, 3000000, '{}')", [CBE]);
      const mon = (await rows(owner, "SELECT week_monday(addis_day(clock_timestamp()))::text d"))[0].d;
      await fn(owner, "start_reconciliation", CBE, mon, 3000000, 0);
    }, BEES_OFF)).toMatch(/reconciliation is in progress/);
  });
  it("nothing was left behind by the refusals", async () => {
    expect((await rows(owner, "SELECT is_active a FROM companies WHERE id IN ($1,$2,$3)", [ASKU, BEES, BERBERO])).map((r) => r.a)).toEqual([true, true, true]);
  });
});

describe("a deactivated company's records", () => {
  const before: Record<string, Awaited<ReturnType<typeof seen>>> = {};
  let stored: Record<string, string>;
  beforeAll(async () => {
    for (const [n, w] of Object.entries(PEOPLE)) before[n] = await seen(w);
    stored = await ledger();
    await owner.query("BEGIN"); await actAs(owner, user.admin); await owner.query(ASKU_OFF); await owner.query(BEES_OFF); await owner.query("COMMIT");      // BEES owns the shared account
  });

  it("are deactivated, with the change in the audit trail", async () => {
    expect((await rows(owner, "SELECT is_active a FROM companies WHERE id IN ($1,$2) ORDER BY code", [ASKU, BEES])).map((r) => r.a)).toEqual([false, false]);
    expect((await rows(owner, "SELECT count(*)::int n FROM audit_events WHERE action = 'COMPANY_UPDATED' AND metadata->'active' = '[true,false]'"))[0].n).toBe(2);
  });
  it("stored data is untouched: requests, balances, weeks, lines, approvals and accounts", async () => { expect(await ledger()).toEqual(stored); });
  it.each(Object.keys(PEOPLE))("%s reads exactly what they read before", async (n) => {
    expect(await seen(PEOPLE[n as keyof typeof PEOPLE])).toEqual(before[n]);
  });
  it("administrators still read the owned accounts and the locked week in full", async () => {
    await as(user.admin, async (c) => {
      expect((await rows(c, "SELECT app_account_access($1) a, app_account_access($2) b", [AWASH, CBE]))[0]).toEqual({ a: "FULL", b: "FULL" });
      const w = (await reconciliationWeek(tx(c), week, user.admin))!;
      expect([w.access, w.summary.status, Number(w.summary.closing), w.payments.map((p) => [p.request_no, p.reference])]).toEqual(["FULL", "LOCKED", 2900000, [[paidNo, "STMT-DEACT"]]]);
      const audit = (await auditRows(tx(c), { q: null }, 200, ASKU)).filter((e) => e.action !== "COMPANY_UPDATED");
      expect(audit.length).toBeGreaterThan(0); expect(audit.every((e) => e.actor !== null)).toBe(true);
    });
  });
  it("the company members keep the history, and group reporting keeps what it had", async () => {
    expect(before.meron.week).toMatchObject({ access: "FULL", status: "LOCKED" });
    expect(before.dawit.request).toMatchObject({ restricted: false, state: "PAID" });
    expect(before.selam.request).toMatchObject({ restricted: true, payee: null });
  });
  it("the shared account keeps working for the companies using it", async () => {
    await owner.query("BEGIN");
    try {
      await actAs(owner, user.nardos); await owner.query("SELECT record_execution($1, null, 'FT-SHARED')", [berberoPay]);
      await actAs(owner, user.samuel); await owner.query("SELECT record_balance_check($1, 2960000, $2)", [CBE, [berberoPay]]);
      const mon = (await rows(owner, "SELECT week_monday(addis_day(clock_timestamp()))::text d"))[0].d;
      const w = await fn(owner, "start_reconciliation", CBE, mon, 2960000, 0);
      expect((await rows(owner, "SELECT status::text s FROM treasury_weeks WHERE id = $1", [w]))[0].s).toBe("RECONCILING");
    } finally { await owner.query("ROLLBACK"); }
  });
  it("can still be picked on their own, after the active companies and marked", async () => {
    const list = (who: string) => as(who, async (c) => (await rows(c, MY_COMPANIES_SQL)).map((r) => r.name));
    const admin = await list(user.admin);
    expect(admin.slice(-2)).toEqual(["ASKU PLC (inactive)", "BEES PLC (inactive)"]);
    expect(admin.slice(0, -2).every((n: string) => !n.endsWith("(inactive)"))).toBe(true);
    expect(await list(user.meron)).toEqual(["ASKU PLC (inactive)"]);
    const scoped = await as(user.admin, async (c) => (await listRequests(tx(c), parseRequestFilters({}), ASKU)).map((r) => r.request_no));
    expect(scoped).toContain(paidNo);
  });
  it("can be reactivated", async () => {
    await owner.query("BEGIN"); await actAs(owner, user.admin);
    await owner.query("SELECT admin_update_company($1,'ASKU PLC','0011223344','+251911000001',true)", [ASKU]); await owner.query("COMMIT");
    expect((await rows(owner, "SELECT is_active a FROM companies WHERE id = $1", [ASKU]))[0].a).toBe(true);
  });
});
