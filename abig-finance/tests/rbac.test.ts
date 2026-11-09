import { describe, expect, it } from "vitest";
import type { Me } from "../src/lib/session";
import { can, canAccess, navFor, roleCannotHold } from "../src/lib/rbac";

// The same permission sets the migrations give the three built-in roles.
const ACCOUNTANT = ["dashboard:view", "bank_account:view", "bank_balance:update", "transaction:manage", "payment_request:view", "payment_request:create", "payment_request:update", "payment_request:delete", "payment_request:schedule", "recurring_payment:view", "recurring_payment:manage", "supplier:view", "supplier:manage", "report:view"];
const FINANCE_MANAGER = ["dashboard:view", "bank_account:view", "payment_request:view", "payment_request:verify", "payment_request:reject", "approval:view", "recurring_payment:view", "supplier:view", "supplier:manage", "company:view", "report:view"];
const OWNER = ["dashboard:view", "bank_account:view", "payment_request:view", "approval:view", "recurring_payment:view", "supplier:view", "company:view", "report:view", "payment_request:authenticate", "payment_request:reject", "bank_account:manage"];
const me = (over: Partial<Me> & { perms?: string[]; company?: string } = {}): Me => ({
  id: "u", name: "U", isAdmin: false, groupReport: false, restricted: false,
  memberships: over.perms ? [{ company_id: over.company ?? "c1", company: "C1", roles: [], permissions: over.perms }] : [], ...over });
const paths = (m: Me) => navFor(m).map((x) => x.path);

describe("what each role is offered", () => {
  it("Accountant: requests, accounts, suppliers and reports; no approvals and no administration", () => {
    const m = me({ perms: ACCOUNTANT });
    expect(paths(m)).toEqual(["/", "/requests", "/accounts", "/treasury", "/suppliers", "/reports"]);
    expect(canAccess(m, "/requests/new")).toBe(true); expect(canAccess(m, "/approvals")).toBe(false); expect(canAccess(m, "/admin")).toBe(false);
    expect(can(m, "payment_request:verify")).toBe(false); expect(can(m, "payment_request:authenticate")).toBe(false); expect(can(m, "user:manage")).toBe(false);
  });
  it("Finance Manager: approvals (to verify), never to authenticate, no administration, cannot create requests", () => {
    const m = me({ perms: FINANCE_MANAGER });
    expect(paths(m)).toContain("/approvals"); expect(paths(m)).not.toContain("/admin");
    expect(can(m, "payment_request:verify")).toBe(true); expect(can(m, "payment_request:authenticate")).toBe(false); expect(can(m, "user:manage")).toBe(false);
    expect(canAccess(m, "/requests/new")).toBe(false);
  });
  it("Owner: every module except administration; authenticates; does not create requests or enter balances", () => {
    const m = me({ perms: OWNER });
    expect(paths(m)).toEqual(["/", "/requests", "/approvals", "/accounts", "/suppliers", "/reports"]);
    expect(can(m, "payment_request:authenticate")).toBe(true); expect(can(m, "payment_request:verify")).toBe(false); expect(can(m, "user:manage")).toBe(false);
    expect(can(m, "payment_request:create")).toBe(false); expect(can(m, "bank_balance:update")).toBe(false); expect(canAccess(m, "/admin")).toBe(false);
  });
  it("Administrator: everything, including administration", () => {
    const m = me({ isAdmin: true });
    expect(paths(m)).toEqual(["/", "/requests", "/approvals", "/accounts", "/treasury", "/suppliers", "/payees", "/reports", "/admin"]);
    expect(can(m, "user:manage")).toBe(true); expect(can(m, "payment_request:authenticate")).toBe(true); expect(canAccess(m, "/requests/new")).toBe(true);
  });
  it("group reporting people read requests, accounts and reports but cannot act or administer", () => {
    const m = me({ groupReport: true });
    expect(paths(m)).toEqual(["/", "/requests", "/accounts", "/reports"]); expect(canAccess(m, "/approvals")).toBe(false); expect(canAccess(m, "/requests/new")).toBe(false); expect(canAccess(m, "/admin")).toBe(false);
  });
  it("a permission is per company: holding it in one company does not give it in another", () => {
    const m = me({ perms: FINANCE_MANAGER, company: "c1" });
    expect(can(m, "payment_request:verify", "c1")).toBe(true); expect(can(m, "payment_request:verify", "c2")).toBe(false);
  });
  it("unknown paths are closed by default", () => { expect(canAccess(me({ isAdmin: true }), "/nowhere")).toBe(false); });
});

describe("permissions no role can hold (mirrors the database rule)", () => {
  it("user and company administration are administrators only", () => { for (const r of ["ACCOUNTANT", "FINANCE_MANAGER", "OWNER", "CUSTOM"]) { expect(roleCannotHold(r, "user:manage")).toBeTruthy(); expect(roleCannotHold(r, "company:manage")).toBeTruthy(); } });
  it("Accountants cannot approve and Finance Managers cannot authenticate", () => {
    expect(roleCannotHold("ACCOUNTANT", "payment_request:verify")).toBeTruthy(); expect(roleCannotHold("ACCOUNTANT", "payment_request:authenticate")).toBeTruthy();
    expect(roleCannotHold("FINANCE_MANAGER", "payment_request:authenticate")).toBeTruthy(); expect(roleCannotHold("FINANCE_MANAGER", "payment_request:verify")).toBeNull(); expect(roleCannotHold("OWNER", "payment_request:authenticate")).toBeNull();
  });
});
