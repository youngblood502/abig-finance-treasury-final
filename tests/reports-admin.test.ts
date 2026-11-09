import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { Tx } from "../src/lib/db";
import { activity, adminBackPath, personDetail, peopleList, roleLimit, systemSettings } from "../src/lib/admin";
import { ageBucket, auditRows, cashRows, filterQuery, outstandingRows, paymentRows, pendingRows, reportFilters, totalOf, totalsBy, weekRows } from "../src/lib/reports";
import { actAs, ASKU, authorized, AWASH, BD_ETHIO, BERBERO, CBE, fails, fn, mk, rows, setupDb, S_ETHIO, S_HAWASSA, user } from "./helpers";

describe("report filters", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  it("fall back to the last 30 days and refuse anything invalid", () => {
    expect(reportFilters(() => null, now)).toEqual({ from: "2026-10-08", to: "2026-11-07", q: null, method: null, state: null });
    expect(reportFilters((k) => ({ from: "nope", to: "2026-99-99", method: "BITCOIN", state: "DRAFT" }[k]), now)).toEqual({ from: "2026-10-08", to: "2026-11-07", q: null, method: null, state: null });
  });
  it("accept valid values, and put reversed dates in order", () => {
    expect(reportFilters((k) => ({ from: "2026-11-05", to: "2026-11-01", method: "CASH", state: "PAID", q: "  PR-1 " }[k]), now)).toEqual({ from: "2026-11-01", to: "2026-11-05", q: "PR-1", method: "CASH", state: "PAID" });
  });
  it("carry into the download link, encoded", () => { expect(filterQuery({ from: "2026-11-01", to: "2026-11-05", q: "a&b", method: "CASH", state: null })).toBe("from=2026-11-01&to=2026-11-05&q=a%26b&method=CASH"); });
  it("sort payments by age", () => { expect([0, 6, 7, 13, 14, 30, 31].map(ageBucket)).toEqual(["Under 7 days", "Under 7 days", "7 to 13 days", "7 to 13 days", "14 to 30 days", "14 to 30 days", "Over 30 days"]); });
  it("total in whole cents, with a hidden value in its own group", () => {
    expect(totalOf([{ a: "0.10" }, { a: "0.20" }], (r) => r.a)).toBe(0.3);
    expect(totalsBy([{ k: "A", a: 1 }, { k: null, a: 5 }, { k: "A", a: 2 }], (r) => r.k, (r) => r.a)).toEqual([{ label: "Not shown", total: 5 }, { label: "A", total: 3 }]);
  });
});

describe("administration helpers", () => {
  it("return only to a person's own page", () => {
    const id = "a0000000-0000-4000-8000-000000000002";
    expect(adminBackPath(id)).toBe(`/admin/people/${id}`);
    for (const bad of ["", "//evil.example", "../reports", `${id}/x`]) expect(adminBackPath(bad)).toBe("/admin?tab=users");
  });
  it("name a role's limit", () => { expect([roleLimit(1), roleLimit(3), roleLimit(null)]).toEqual(["1 company at most", "3 companies at most", "Any number of companies"]); });
  it("never show a secret's value in the system settings", () => {
    const secrets = { APP_ENCRYPTION_KEY: "k3y-secret-value", SMTP_URL: "smtp://user:smtp-secret@host", STORAGE_DIR: "/srv/private/dir", DATABASE_URL: "postgres://x:db-secret@h/d" };
    const seen = JSON.stringify(systemSettings({ ...secrets, NODE_ENV: "production" }));
    for (const v of ["k3y-secret-value", "smtp-secret", "/srv/private", "db-secret"]) expect(seen).not.toContain(v);
    expect(seen).toContain("Configured"); expect(seen).toContain("Set");
    expect(JSON.stringify(systemSettings({}))).toContain("Not configured");
  });
});

// Each person reads on a new connection as themselves, through row-level security.
describe("reports as each person", () => {
  let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
  let askuNo: string, berberoNo: string, hawassa: string, ethio: string, mon: string, from: string, to: string, week: string;
  const tx = (c: Client): Tx => ({ q: async (sql, p) => (await c.query(sql, p as unknown[])).rows });
  const range = () => ({ from, to, q: null, method: null, state: null });
  const FIGURE = 3456789;

  beforeAll(async () => {
    const d = await setupDb("abig_test_reports_admin"); owner = d.owner; as = d.as;
    const days = (await rows(owner, "SELECT week_monday(addis_day(clock_timestamp()))::text m, addis_day(clock_timestamp())::text t"))[0]; mon = days.m; from = "2020-01-01"; to = days.t;
    hawassa = (await rows(owner, "SELECT legal_name n FROM suppliers WHERE id = $1", [S_HAWASSA]))[0].n; ethio = (await rows(owner, "SELECT legal_name n FROM suppliers WHERE id = $1", [S_ETHIO]))[0].n;
    await owner.query("BEGIN");
    await actAs(owner, user.samuel); await owner.query("SELECT record_opening_balance($1,$2)", [CBE, FIGURE]);
    await actAs(owner, user.meron); await owner.query("SELECT record_opening_balance($1, 2000000)", [AWASH]);
    const asku = (await authorized(owner, { amounts: [100000], method: "TRANSFER" })).id;
    const berbero = (await authorized(owner, { company: BERBERO, amounts: [200000], method: "TRANSFER" })).id;
    await actAs(owner, user.meron); await fn(owner, "wf_submit", await mk(owner, user.meron, { amounts: [5000] }));
    await actAs(owner, user.nardos); await fn(owner, "wf_submit", await mk(owner, user.nardos, { company: BERBERO, supplier: S_ETHIO, bank: BD_ETHIO, account: CBE, amounts: [7000] }));
    await actAs(owner, user.samuel); await owner.query("SELECT record_balance_check($1,$2,'{}')", [CBE, FIGURE + 111]);
    week = await fn(owner, "start_reconciliation", CBE, mon, 9876543, 12345);
    await owner.query("COMMIT");
    const no = async (id: string) => (await rows(owner, "SELECT request_no n FROM payment_requests WHERE id = $1", [id]))[0].n as string;
    askuNo = await no(asku); berberoNo = await no(berbero);
  });
  afterAll(async () => { await owner?.end(); });

  it("a company's own people see payees and approvers", async () => {
    await as(user.meron, async (c) => {
      const p = (await paymentRows(tx(c), range())).find((r) => r.request_no === askuNo)!;
      expect([p.payee_name, p.verified_by !== null, p.authenticated_by !== null]).toEqual([hawassa, true, true]);
      expect((await pendingRows(tx(c))).every((r) => r.payee_name !== null)).toBe(true);
    });
  });
  it("group reporting sees amounts and status, with no payee or approver, in every report", async () => {
    await as(user.selam, async (c) => {
      const pay = await paymentRows(tx(c), range()), pend = await pendingRows(tx(c)), out = await outstandingRows(tx(c));
      expect(pay.map((r) => [r.request_no, Number(r.amount), r.company_name, r.payee_name, r.verified_by, r.authenticated_by])).toEqual([[askuNo, 100000, "ASKU PLC", null, null, null]]);
      expect(pend.length).toBeGreaterThan(0); expect(pend.every((r) => r.payee_name === null)).toBe(true);
      expect(out.map((r) => r.request_no)).toEqual([askuNo]); expect(out[0].payee_name).toBeNull();
      const seen = JSON.stringify([pay, pend, out]);
      for (const name of [hawassa, ethio, "Dawit", "Kebede", "Meron"]) expect(seen).not.toContain(name);
    });
  });
  it("group reporting cannot find a payee by searching for it", async () => {
    await as(user.selam, async (c) => {
      expect(await paymentRows(tx(c), { ...range(), q: hawassa.slice(0, 6) })).toEqual([]);
      expect((await paymentRows(tx(c), { ...range(), q: askuNo })).length).toBe(1);
    });
    await as(user.meron, async (c) => { expect((await paymentRows(tx(c), { ...range(), q: hawassa.slice(0, 6) })).length).toBe(1); });
  });
  it("group reporting never gets a company outside its grant, even on a shared account", async () => {
    await as(user.selam, async (c) => {
      const seen = JSON.stringify([await paymentRows(tx(c), range()), await outstandingRows(tx(c)), await pendingRows(tx(c))]);
      expect(seen).not.toContain(berberoNo); expect(seen).not.toContain("Berbero");
      expect(await paymentRows(tx(c), range(), BERBERO)).toEqual([]);
    });
  });
  it("outstanding by age keeps FULL, TICK and NONE", async () => {
    const seen = (who: string) => as(who, async (c) => outstandingRows(tx(c)));
    const samuel = (await seen(user.samuel)).find((r) => r.request_no === berberoNo)!;
    expect([samuel.access, samuel.payee_name]).toEqual(["FULL", ethio]);
    const tigist = await seen(user.tigist), other = tigist.find((r) => r.company_name === "ASKU PLC");
    expect(other).toBeUndefined();                                                                                              // ASKU's payment here is on Awash, not an account Tigist has
    const own = tigist.find((r) => r.request_no === berberoNo)!;
    expect([own.access, own.payee_name]).toEqual(["TICK", ethio]);
    expect((await seen(user.hana)).map((r) => [r.request_no, r.access, r.payee_name])).toEqual([[berberoNo, "NONE", ethio]]);
    expect((await seen(user.meron)).some((r) => r.request_no === berberoNo)).toBe(false);
  });
  it("a TICK viewer gets another company's payment with no payee", async () => {
    await owner.query("BEGIN");
    const { id } = await authorized(owner, { account: CBE, amounts: [3000], method: "TRANSFER" });
    await owner.query("COMMIT");
    const no = (await rows(owner, "SELECT request_no n FROM payment_requests WHERE id = $1", [id]))[0].n as string;
    await as(user.tigist, async (c) => { const r = (await outstandingRows(tx(c))).find((x) => x.request_no === no)!; expect([r.company_name, r.payee_name, Number(r.amount)]).toEqual(["ASKU PLC", null, 3000]); });
    await as(user.selam, async (c) => { const r = (await outstandingRows(tx(c))).find((x) => x.request_no === no)!; expect([r.access, r.payee_name]).toEqual(["NONE", null]); });
  });

  it("the audit trail hides a company's details from group reporting", async () => {
    await as(user.selam, async (c) => {
      const e = await auditRows(tx(c), { q: "BANK_BALANCE" });
      expect(e.length).toBeGreaterThan(0);
      expect(e.every((x) => x.metadata === null && x.actor === null && x.entity_id === null)).toBe(true);
      expect(e[0].company).toBe("BEES PLC");
      const blob = JSON.stringify(await auditRows(tx(c), { q: null }));
      for (const v of [String(FIGURE), "9876543", "12345", "Samuel"]) expect(blob).not.toContain(v);
    });
  });
  it("the owner's Finance Manager and the person who did it read the details", async () => {
    for (const who of [user.abebe, user.samuel]) await as(who, async (c) => {
      const e = (await auditRows(tx(c), { q: "BANK_BALANCE" })).find((x) => x.company === "BEES PLC")!;
      expect(JSON.stringify(e.metadata)).toContain(String(FIGURE)); expect(e.actor).toBe("Samuel (BEES accountant)");
    });
  });
  it("the audit trail's date range and company scope hold", async () => {
    await as(user.abebe, async (c) => {
      expect(await auditRows(tx(c), { q: null, from: "2020-01-01", to: "2020-01-02" })).toEqual([]);
      expect((await auditRows(tx(c), { q: null, from, to }, 200, BERBERO))).toEqual([]);
    });
  });

  it("the weeks report gives statement figures only at FULL", async () => {
    const line = (who: string) => as(who, async (c) => (await weekRows(tx(c), { from: mon, to })).find((r) => r.week_id === week)!);
    const samuel = await line(user.samuel);
    expect([samuel.access, Number(samuel.deposits), samuel.status]).toEqual(["FULL", 12345, "RECONCILING"]);
    for (const who of [user.tigist, user.meron, user.selam]) {
      const r = await line(who);
      expect([r.status, r.deposits, r.implied_total, r.deposit_difference, r.prepared_by_name]).toEqual(["RECONCILING", null, null, null, null]);
    }
    await as(user.bereket, async (c) => { expect(await weekRows(tx(c), { from: mon, to })).toEqual([]); });
    await as(user.samuel, async (c) => { expect(await weekRows(tx(c), { from: "2020-01-01", to: "2020-01-05" })).toEqual([]); });
  });
  it("cash shows the account's balances to all, and only their own 30-day commitments", async () => {
    const cbe = (who: string) => as(who, async (c) => (await cashRows(tx(c))).find((r) => r.account_label === "BEES CBE current")!);
    const nardos = await cbe(user.nardos), meron = await cbe(user.meron);
    expect(meron.reserved_balance).toBe(nardos.reserved_balance); expect(meron.shared).toBe(true);
    expect(Number(meron.due_30_days)).toBe(0);
  });
  it("those with no access get empty reports", async () => {
    await as(user.bereket, async (c) => {
      expect([await paymentRows(tx(c), range()), await pendingRows(tx(c)), await outstandingRows(tx(c)), await cashRows(tx(c))]).toEqual([[], [], [], []]);
    });
  });

  it("only an administrator can read sign-in activity or change people", async () => {
    await as(user.meron, async (c) => {
      expect((await activity(tx(c))).signIns).toEqual([]);
      expect((await c.query("UPDATE users SET is_system_admin = true WHERE id = $1", [user.meron])).rowCount).toBe(0);
      expect(await fails(c, "INSERT INTO users (email, full_name) VALUES ('x@abig.test','X')")).toMatch(/row-level security/);
      expect(await fails(c, "INSERT INTO company_memberships (company_id, user_id) VALUES ($1,$2)", [BERBERO, user.meron])).toMatch(/row-level security/);
      expect(await fails(c, "INSERT INTO group_permission_grants (user_id, permission, company_id) VALUES ($1,'GROUP_REPORT_VIEW',$2)", [user.meron, BERBERO])).toMatch(/row-level security/);
      expect(await fails(c, "SELECT admin_update_company($1,'X','0011223344','0911000000',true)", [ASKU])).toMatch(/./);
      expect(await fails(c, "SELECT admin_create_company('NEWCO','New','0011223344','0911000000')")).toMatch(/./);
    });
  });
  it("only an administrator can change roles, and no role can take what it must not hold", async () => {
    const permission = async (code: string) => (await rows(owner, "SELECT id FROM permissions WHERE code = $1", [code]))[0].id as string;
    const role = async (code: string) => (await rows(owner, "SELECT id FROM roles WHERE code = $1", [code]))[0].id as string;
    const verify = await permission("payment_request:verify"), accountant = await role("ACCOUNTANT"), users = await permission("user:manage"), manager = await role("FINANCE_MANAGER");
    await as(user.dawit, async (c) => {
      expect(await fails(c, "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)", [accountant, verify])).toMatch(/Accountants cannot/);
      expect(await fails(c, "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)", [await role("OWNER"), await permission("transaction:manage")])).toMatch(/row-level security|permission denied/);
      expect((await c.query("UPDATE roles SET name = 'X' WHERE id = $1", [accountant]).then((r) => r.rowCount, () => 0))).toBe(0);
    });
    await as(user.admin, async (c) => {
      expect(await fails(c, "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)", [accountant, verify])).toMatch(/./);
      expect(await fails(c, "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)", [manager, users])).toMatch(/./);
    });
  });
  it("an administrator sees people with their access, and a person's own page", async () => {
    await as(user.admin, async (c) => {
      const d = await peopleList(tx(c));
      expect(d.users.length).toBeGreaterThan(5);
      expect(d.grants.filter((g) => g.user_id === user.selam).map((g) => g.company).sort()).toEqual(["ASKU PLC", "BEES PLC"]);
      const p = (await personDetail(tx(c), user.meron))!;
      expect(p.members.map((m) => [m.company, m.roles.length > 0, m.role_ids.length > 0])).toEqual([["ASKU PLC", true, true]]);
      expect(await personDetail(tx(c), "a0000000-0000-4000-8000-0000000000ff")).toBeNull();
      expect(JSON.stringify(p)).not.toMatch(/password_hash|totp_secret/);
    });
  });
  it("an administrator's change is audited and can be undone without losing history", async () => {
    await as(user.admin, async (c) => {
      const m = (await personDetail(tx(c), user.lidya))!.members[0];
      await c.query("UPDATE company_memberships SET revoked_at = now() WHERE id = $1", [m.id]);
      expect((await personDetail(tx(c), user.lidya))!.members).toEqual([]);
      expect((await rows(c, "SELECT count(*)::int n FROM company_memberships WHERE id = $1", [m.id]))[0].n).toBe(1);             // the record stays
    });
  });
});
