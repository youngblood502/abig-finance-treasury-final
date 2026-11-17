import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { accountRows, approvalQueue, cashByCompany, dashboardSections, ownerCashHint, ownerCashLabel, OWNER_CASH_NOTE, requestCounts, requestsTitle, RESERVED_LABEL, returnedDrafts, scopeName, SHARED_REQUESTS_NOTE, SHARED_RESERVED_HINT, weekOutflow, weekRows } from "../src/lib/dashboard";
import type { Tx } from "../src/lib/db";
import { ageSince } from "../src/lib/format";
import type { Me } from "../src/lib/session";
import { actAs, ASKU, authorized, AWASH, BERBERO, CBE, fn, mk, rows, setupDb, user } from "./helpers";

const person = (permissions: string[], extra: Partial<Me> = {}): Me => ({ id: "u", name: "Test", isAdmin: false, groupReport: false, restricted: false, memberships: [{ company_id: "c", company: "C", roles: [], permissions }], ...extra });

describe("which parts of the dashboard a person gets", () => {
  it("an Accountant gets the week's work, and no approval queues", () => {
    expect(dashboardSections(person(["bank_balance:update", "payment_request:create", "payment_request:view", "bank_account:view"]))).toEqual({ cash: true, requests: true, newRequest: true, prepare: true, verify: false, authenticate: false });
  });
  it("a Finance Manager gets the verification queue", () => { expect(dashboardSections(person(["payment_request:verify", "payment_request:view", "bank_account:view"]))).toMatchObject({ prepare: false, verify: true, authenticate: false, newRequest: false }); });
  it("an Owner gets the authentication queue and the cash per company", () => { expect(dashboardSections(person(["payment_request:authenticate", "payment_request:view", "bank_account:view"]))).toMatchObject({ prepare: false, verify: false, authenticate: true }); });
  it("roles combine", () => { expect(dashboardSections(person(["payment_request:verify", "payment_request:authenticate"]))).toMatchObject({ verify: true, authenticate: true }); });
  it("group reporting reads, and acts on nothing", () => { expect(dashboardSections(person([], { memberships: [], groupReport: true }))).toEqual({ cash: true, requests: true, newRequest: false, prepare: false, verify: false, authenticate: false }); });
  it("someone with no access gets nothing", () => { expect(dashboardSections(person([]))).toEqual({ cash: false, requests: false, newRequest: false, prepare: false, verify: false, authenticate: false }); });
});

describe("the labels on a shared account", () => {
  it("names the legal owner of the accounts, not the company's cash", () => {
    expect(ownerCashLabel("BEES PLC")).toBe("Accounts owned by BEES PLC");
    expect(ownerCashLabel("BEES PLC")).not.toMatch(/^BEES PLC$/);
    expect(ownerCashHint(1700000)).toBe("ETB 1,700,000.00 available on these accounts");
  });
  it("says the figure may not be the owner's full cash position", () => { expect(OWNER_CASH_NOTE).toMatch(/legal owner/); expect(OWNER_CASH_NOTE).toMatch(/only the accounts you can see/i); expect(OWNER_CASH_NOTE).toMatch(/may not be that company's full cash position/); });
  it("keeps account reservations apart from the requests a person can see", () => {
    expect(RESERVED_LABEL).toBe("Reserved on these accounts");
    expect(SHARED_RESERVED_HINT).toMatch(/other companies that share them/);
    expect(SHARED_REQUESTS_NOTE).toMatch(/only the requests you can see/); expect(SHARED_REQUESTS_NOTE).toMatch(/can be higher on a shared account/);
  });
  it("names the chosen company on the requests section", () => {
    expect(requestsTitle(null)).toBe("Payment requests visible to you");
    expect(requestsTitle("BEES PLC")).toBe("Payment requests visible for BEES PLC");
  });
  it("uses a company's name only if it is one of the person's own", () => {
    const mine = [{ id: "a", name: "ASKU PLC" }, { id: "b", name: "BEES PLC" }];
    expect(scopeName("b", mine)).toBe("BEES PLC");
    expect(scopeName(null, mine)).toBeNull();
    expect(scopeName("other", mine)).toBeNull();
  });
});

describe("how long ago", () => {
  const now = new Date("2026-11-06T12:00:00Z"), ago = (ms: number) => new Date(now.getTime() - ms);
  it.each([[0, "Just now"], [59e3, "Just now"], [60e3, "1 minute ago"], [59 * 60e3, "59 minutes ago"], [60 * 60e3, "1 hour ago"], [23 * 3600e3, "23 hours ago"], [24 * 3600e3, "1 day ago"], [72 * 3600e3, "3 days ago"]])("%d ms is %s", (ms, text) => { expect(ageSince(ago(ms), now)).toBe(text); });
  it("a clock slightly ahead does not show a negative age", () => { expect(ageSince(new Date(now.getTime() + 5000), now)).toBe("Just now"); });
});

describe("what the dashboard reads, as the application role", () => {
  let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
  let returned: string, waitingVerify: string, waitingAuth: string, berberoPaid: string;
  const REASON = "The invoice number does not match";

  beforeAll(async () => {
    const d = await setupDb("abig_test_dashboard"); owner = d.owner; as = d.as;
    await owner.query("BEGIN");
    await actAs(owner, user.meron);
    await fn(owner, "record_opening_balance", AWASH, 1000000);
    returned = await mk(owner, user.meron, { amounts: [1000] });
    const v = await fn(owner, "wf_submit", returned);
    await actAs(owner, user.dawit); await fn(owner, "wf_return", returned, v, REASON);
    await actAs(owner, user.meron);
    await mk(owner, user.meron, { amounts: [2000] });                                    // a plain draft
    waitingVerify = await mk(owner, user.meron, { amounts: [3000] }); await fn(owner, "wf_submit", waitingVerify);
    waitingAuth = await mk(owner, user.meron, { amounts: [4000] });
    const v2 = await fn(owner, "wf_submit", waitingAuth);
    await actAs(owner, user.dawit); await fn(owner, "wf_verify", waitingAuth, v2);
    await authorized(owner, { amounts: [50000] });                                       // ASKU paid from its own account this week
    berberoPaid = (await authorized(owner, { company: BERBERO, amounts: [70000] })).id;  // Berbero paid from the shared account
    await owner.query("COMMIT");
  });
  afterAll(async () => { await owner?.end(); });
  const tx = (c: Client): Tx => ({ q: async (sql, p) => (await c.query(sql, p as unknown[])).rows });

  it("an Accountant sees their returned request with its reason, and not an ordinary draft", async () => {
    await as(user.meron, async (c) => {
      const r = await returnedDrafts(tx(c), null);
      expect(r.map((x) => [x.id, x.reason])).toEqual([[returned, REASON]]);
      expect((await requestCounts(tx(c), null)).find((s) => s.state === "DRAFT")!.n).toBe(2);
    });
  });
  it("someone else's drafts stay private", async () => {
    await as(user.lidya, async (c) => {                                                  // same company, not the creator
      expect(await returnedDrafts(tx(c), null)).toEqual([]);
      expect((await requestCounts(tx(c), null)).find((s) => s.state === "DRAFT")).toBeUndefined();
    });
    await as(user.dawit, async (c) => { expect(await returnedDrafts(tx(c), null)).toEqual([]); });
  });
  it("a Finance Manager's queue is what awaits verification, and an Owner's what awaits authentication", async () => {
    await as(user.dawit, async (c) => { expect((await approvalQueue(tx(c), null)).map((q) => [q.request_id, q.stage])).toEqual([[waitingVerify, "VERIFICATION"]]); });
    await as(user.kebede, async (c) => {
      const q = await approvalQueue(tx(c), null);
      expect(q.map((x) => [x.request_id, x.stage, x.company])).toEqual([[waitingAuth, "AUTHORIZATION", "ASKU PLC"]]);
      expect(q[0].waiting_since).toBeInstanceOf(Date);
    });
    await as(user.meron, async (c) => { expect(await approvalQueue(tx(c), null)).toEqual([]); });      // never their own
  });
  it("this week's outflow counts only the person's own companies", async () => {
    await as(user.kebede, async (c) => { expect(await weekOutflow(tx(c), null)).toEqual({ total: "50000.0000", n: 1 }); });
    await as(user.hana, async (c) => { expect(await weekOutflow(tx(c), null)).toEqual({ total: "70000.0000", n: 1 }); });
    await as(user.bereket, async (c) => { expect(await weekOutflow(tx(c), null)).toEqual({ total: "0", n: 0 }); });
  });
  it("the choice of company narrows every query, and cannot widen one", async () => {
    await as(user.admin, async (c) => {
      expect(Number((await weekOutflow(tx(c), null)).total)).toBe(120000);
      expect(Number((await weekOutflow(tx(c), BERBERO)).total)).toBe(70000);
      expect((await approvalQueue(tx(c), BERBERO))).toEqual([]);
      expect((await accountRows(tx(c), BERBERO)).map((a) => a.id)).toEqual([CBE]);
      expect((await weekRows(tx(c), BERBERO)).map((w) => w.account_id)).toEqual([CBE]);
    });
    await as(user.meron, async (c) => {                                                  // a forged choice of another company
      expect(Number((await weekOutflow(tx(c), BERBERO)).total)).toBe(0);
      expect(await requestCounts(tx(c), BERBERO)).toEqual([]);
      expect(await returnedDrafts(tx(c), BERBERO)).toEqual([]);
    });
  });
  it("cash per company counts a shared account once, under its owner", async () => {
    await as(user.admin, async (c) => {
      const cash = await cashByCompany(tx(c), null);
      expect(cash.filter((x) => x.company === "BEES PLC")).toHaveLength(1);
      const accounts = await accountRows(tx(c), null);
      expect(cash.reduce((s, x) => s + Number(x.current), 0)).toBe(accounts.filter((a) => a.is_active).reduce((s, a) => s + Number(a.current_balance), 0));
    });
  });
  it("a shared account's outstanding count holds only the company's own payments below the owner's staff", async () => {
    await as(user.meron, async (c) => { expect((await weekRows(tx(c), null)).find((w) => w.account_id === CBE)!.outstanding_count).toBe(0); });
    await as(user.samuel, async (c) => { expect((await weekRows(tx(c), null)).find((w) => w.account_id === CBE)!.outstanding_count).toBe(1); });
    expect(await as(user.meron, async (c) => (await rows(c, "SELECT id FROM payment_requests WHERE id = $1", [berberoPaid])).length)).toBe(0);
    expect(ASKU).toBeTruthy();
  });
});
