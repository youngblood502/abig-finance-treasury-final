import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { accountInCompany, MY_COMPANIES_SQL, resolveCompany } from "../src/lib/company";
import { tableView } from "../src/lib/table";
import { trackerSteps } from "../src/lib/tracker";
import { ASKU, AWASH, BERBERO, CBE, rows, setupDb, user } from "./helpers";

const a = { id: "c1", name: "A" }, b = { id: "c2", name: "B" };
describe("choosing a company", () => {
  it("accepts only the person's own companies", () => {
    expect(resolveCompany("c2", [a, b])).toBe("c2");
    expect(resolveCompany("someone-elses", [a, b])).toBeNull();
    expect(resolveCompany("' OR 1=1 --", [a, b])).toBeNull();
    expect(resolveCompany(undefined, [a, b])).toBeNull();
  });
  it("needs no choice with one company", () => { expect(resolveCompany("c1", [a])).toBeNull(); });
});

describe("the companies a person is offered, and what a choice shows", () => {
  let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
  beforeAll(async () => { const d = await setupDb("abig_test_ui"); owner = d.owner; as = d.as; });
  afterAll(async () => { await owner?.end(); });
  const offered = (who: string) => as(who, async (c) => (await rows(c, MY_COMPANIES_SQL)).map((r) => r.id));

  it("an Accountant gets their one company, and not the companies that share an account with it", async () => {
    expect(await offered(user.meron)).toEqual([ASKU]);                 // ASKU shares the BEES account, but Meron works for ASKU only
    expect(await offered(user.tigist)).toEqual([BERBERO]);
  });
  it("someone with no link to a company never gets it", async () => { expect(await offered(user.hana)).not.toContain(ASKU); expect(await offered(user.bereket)).not.toContain(BERBERO); });
  it("group reporting gets the companies it was granted, and an administrator gets all of them", async () => {
    const all = (await rows(owner, "SELECT id FROM companies WHERE is_active")).map((r) => r.id);
    expect((await offered(user.admin)).sort()).toEqual(all.sort());
    expect((await offered(user.selam)).length).toBeGreaterThan(0);
  });
  it("a choice cannot show more than row-level security allows", async () => {
    await as(user.meron, async (c) => {   // the filter asks for Berbero, which Meron cannot see
      expect(await rows(c, "SELECT id FROM person_payees WHERE company_id = $1", [BERBERO])).toEqual([]);
      expect(await rows(c, "SELECT id FROM payment_requests WHERE debtor_company_id = $1", [BERBERO])).toEqual([]);
    });
  });
  it("an account follows every company linked to it", async () => {
    const sql = `SELECT a.id FROM company_bank_accounts a WHERE ${accountInCompany("a.id", "$1")} ORDER BY a.account_label`;
    await as(user.admin, async (c) => {
      expect((await rows(c, sql, [BERBERO])).map((r) => r.id)).toEqual([CBE]);
      expect((await rows(c, sql, [ASKU])).map((r) => r.id).sort()).toEqual([AWASH, CBE].sort());   // its own account, and the one shared with it
      expect((await rows(c, sql, [null])).length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("the data table's rows", () => {
  const data = [{ id: 1, search: "alpha", filters: { m: "x" }, sort: { n: 10, s: "b2" } }, { id: 2, search: "beta", filters: { m: "y" }, sort: { n: 2, s: "b10" } }, { id: 3, search: "alphabet", filters: { m: "x" }, sort: { s: "a" } }];
  const q = { query: "", filters: {}, sortKey: null, descending: false, page: 1, pageSize: 2 };
  it("keeps the given order until sorted", () => { expect(tableView(data, { ...q, pageSize: 9 }).rows.map((r) => r.id)).toEqual([1, 2, 3]); });
  it("searches without case, and filters", () => {
    expect(tableView(data, { ...q, query: " ALPHA " }).rows.map((r) => r.id)).toEqual([1, 3]);
    expect(tableView(data, { ...q, filters: { m: "y" } }).rows.map((r) => r.id)).toEqual([2]);
    expect(tableView(data, { ...q, filters: { m: "" } }).total).toBe(3);
  });
  it("sorts numbers as numbers, text naturally, and empty values last both ways", () => {
    expect(tableView(data, { ...q, sortKey: "n", pageSize: 9 }).rows.map((r) => r.id)).toEqual([2, 1, 3]);
    expect(tableView(data, { ...q, sortKey: "n", descending: true, pageSize: 9 }).rows.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(tableView(data, { ...q, sortKey: "s", pageSize: 9 }).rows.map((r) => r.id)).toEqual([3, 1, 2]);
  });
  it("pages, and keeps the page in range when the list shrinks", () => {
    expect(tableView(data, q)).toMatchObject({ total: 3, pages: 2, page: 1 });
    expect(tableView(data, { ...q, page: 2 }).rows.map((r) => r.id)).toEqual([3]);
    expect(tableView(data, { ...q, page: 9 }).page).toBe(2);
    expect(tableView([], { ...q, page: 3 })).toMatchObject({ total: 0, pages: 1, page: 1 });
  });
});

describe("the status tracker", () => {
  const marks = (s: string) => trackerSteps(s).map((x) => x.status[0]).join("");
  it("follows a payment from Draft to Paid", () => {
    expect(trackerSteps("DRAFT").map((s) => s.label)).toEqual(["Draft", "Reserved", "Verified", "Authenticated", "Paid"]);
    expect(marks("DRAFT")).toBe("cuuuu"); expect(marks("RESERVED")).toBe("dcuuu"); expect(marks("VERIFIED")).toBe("ddcuu"); expect(marks("AUTHENTICATED")).toBe("dddcu"); expect(marks("PAID")).toBe("ddddd");
  });
  it("shows a scheduled request in the first step", () => { expect(trackerSteps("SCHEDULED")[0]).toMatchObject({ label: "Scheduled", status: "current" }); });
  it("does not claim progress for a rejected or cancelled request", () => { expect(marks("REJECTED")).toBe("uuuuu"); expect(marks("CANCELLED")).toBe("uuuuu"); });
});
