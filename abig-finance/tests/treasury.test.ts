import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { actAs, ASKU, authorized, AWASH, BERBERO, CBE, fails, fn, mk, rows, setupDb, user } from "./helpers";

let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"]; let appUrl: string;
beforeAll(async () => { const d = await setupDb("abig_test_p7"); owner = d.owner; as = d.as; appUrl = d.appUrl; });
afterAll(async () => { await owner?.end(); });

const bal = async (c: Client, id = AWASH) => { const r = (await rows(c, "SELECT current_balance c, reserved_balance r, available_balance a FROM company_bank_accounts WHERE id=$1", [id]))[0]; return { current: Number(r.c), reserved: Number(r.r), available: Number(r.a) }; };
const state = async (c: Client, id: string) => (await rows(c, "SELECT workflow_state::text s FROM payment_requests WHERE id=$1", [id]))[0]?.s as string;
/** A draft by Meron on the ASKU Awash account (balance 1,150,000). */
const draft = async (c: Client, amount: number, extra = {}) => { await actAs(c, user.meron); return mk(c, user.meron, { amounts: [amount], ...extra }); };

describe("balances and their history", () => {
  it("an Accountant enters the overall amount; available is recalculated and the update is logged", async () => {
    await as(user.meron, async (c) => {
      expect(await bal(c)).toEqual({ current: 1150000, reserved: 0, available: 1050000 });
      const h = (await rows(c, "SELECT previous_balance p, new_balance n, updated_by u, updated_at t FROM record_opening_balance($1, 2000000)", [AWASH]))[0];
      expect([Number(h.p), Number(h.n), h.u]).toEqual([1150000, 2000000, user.meron]); expect(h.t).toBeInstanceOf(Date);
      expect(await bal(c)).toEqual({ current: 2000000, reserved: 0, available: 1900000 });   // the ASKU Awash account keeps a 100,000 buffer
      expect((await rows(c, "SELECT previous_balance, new_balance, updated_by_name FROM account_balance_history($1)", [AWASH]))[0]).toMatchObject({ previous_balance: "1150000.0000", new_balance: "2000000.0000", updated_by_name: "Meron (ASKU accountant)" });
    });
  });
  it("can go below the reserved funds, but cannot be negative or empty", async () => {
    await as(user.meron, async (c) => {
      const id = await draft(c, 400000); await fn(c, "wf_submit", id);
      expect((await bal(c)).reserved).toBe(400000);
      await c.query("SELECT record_opening_balance($1, 399999)", [AWASH]);                       // a shortfall: see phase1.test.ts
      expect(await bal(c)).toEqual({ current: 399999, reserved: 400000, available: -100001 });
      expect(await fails(c, "SELECT record_opening_balance($1, -1)", [AWASH])).toMatch(/cannot be negative/);
      expect(await fails(c, "SELECT record_opening_balance($1, NULL)", [AWASH])).toMatch(/enter the total amount/);
    });
  });
  it("only an Accountant linked to the account with the update right can enter it", async () => {
    await as(user.samuel, async (c) => { await c.query("SELECT record_opening_balance($1, 4300000)", [CBE]); });
    await as(user.lidya, async (c) => { expect(await fails(c, "SELECT record_opening_balance($1, 1)", [CBE])).toMatch(/you may not update/); });   // ASKU may only use the BEES account
    await as(user.abebe, async (c) => { expect(await fails(c, "SELECT record_opening_balance($1, 1)", [CBE])).toMatch(/you may not update/); }); // an Owner does not enter balances
    await as(user.dawit, async (c) => { expect(await fails(c, "SELECT record_opening_balance($1, 1)", [AWASH])).toMatch(/you may not update/); });
  });
});

describe("reserving funds when a request is submitted", () => {
  it("refuses an amount above the available balance and keeps nothing locked", async () => {
    await as(user.meron, async (c) => {
      const id = await draft(c, 1150001);
      expect(await fails(c, "SELECT wf_submit($1)", [id])).toMatch(/requested amount \(ETB 1,150,001.00\) is more than the available balance \(ETB 1,050,000.00\)/);
      expect(await state(c, id)).toBe("DRAFT"); expect(await bal(c)).toEqual({ current: 1150000, reserved: 0, available: 1050000 });
    });
  });
  it("moves the whole total (all instalments) from available into reserved, and allows exactly the available amount", async () => {
    await as(user.meron, async (c) => {
      const id = await draft(c, 0, { amounts: [600000, 450000] });
      await fn(c, "wf_submit", id);
      expect(await state(c, id)).toBe("RESERVED"); expect(await bal(c)).toEqual({ current: 1150000, reserved: 1050000, available: 0 });
      const more = await draft(c, 1, { ref: "ONE-MORE" });
      expect(await fails(c, "SELECT wf_submit($1)", [more])).toMatch(/more than the available balance \(ETB 0.00\)/);
    });
  });
  it("requires a debit account the company is linked to", async () => {
    await as(user.meron, async (c) => {
      const none = await draft(c, 10, { account: null });
      expect(await fails(c, "SELECT wf_submit($1)", [none])).toMatch(/choose the account/);
      await actAs(c, user.meron);
      expect(await fails(c, "UPDATE payment_requests SET debit_account_id=$2 WHERE id=$1", [none, "b0000000-0000-4000-8000-0000000000ff"])).toMatch(/not available to this company/);
      await c.query("UPDATE payment_requests SET debit_account_id=$2 WHERE id=$1", [none, CBE]);         // ASKU may use the shared BEES account
      await fn(c, "wf_submit", none); expect((await bal(c, CBE)).reserved).toBe(10);
    });
    await as(user.nardos, async (c) => {                                                                 // Berbero is not linked to ASKU's Awash account
      const id = await mk(c, user.nardos, { company: BERBERO, supplier: "d0000000-0000-4000-8000-000000000002", bank: "e0000000-0000-4000-8000-000000000002", account: null });
      expect(await fails(c, "UPDATE payment_requests SET debit_account_id=$2 WHERE id=$1", [id, AWASH])).toMatch(/not available to this company/);
    });
  });
  it("releases the lock when the request is cancelled, returned or rejected, and resizes it when the amount is adjusted", async () => {
    await as(user.meron, async (c) => {
      const a = await draft(c, 300000); const v = await fn(c, "wf_submit", a);
      await fn(c, "wf_cancel", a, v, "no longer needed"); expect(await state(c, a)).toBe("CANCELLED"); expect((await bal(c)).reserved).toBe(0);
      const b = await draft(c, 300000, { ref: "B" }); const vb = await fn(c, "wf_submit", b);
      await actAs(c, user.dawit); await fn(c, "wf_return", b, vb, "fix the invoice"); expect((await bal(c)).reserved).toBe(0);
      await actAs(c, user.meron); expect(await state(c, b)).toBe("DRAFT");
      const d = await draft(c, 300000, { ref: "D" }); const vd = await fn(c, "wf_submit", d);
      await actAs(c, user.dawit); const vd2 = await fn(c, "wf_adjust", d, vd, JSON.stringify({ total_amount: 200000, installments: [{ seq: 1, amount: 200000 }] }), "corrected");
      expect((await bal(c)).reserved).toBe(200000);
      expect(await fails(c, "SELECT wf_adjust($1,$2,$3::jsonb,'too much')", [d, vd2, JSON.stringify({ total_amount: 9000000, installments: [{ seq: 1, amount: 9000000 }] })])).toMatch(/more than the available balance/);
      expect((await bal(c)).reserved).toBe(200000);
      const v3 = await fn(c, "wf_verify", d, vd2); await actAs(c, user.kebede); await fn(c, "wf_reject", d, v3, "not needed"); expect((await bal(c)).reserved).toBe(0);
    });
  });
});

describe("authenticating pays: the account is debited and the lock released", () => {
  it("debits current and reserved by the amount, records who and when, and logs the debit", async () => {
    await as(user.meron, async (c) => {
      const { id } = await authorized(c, { amounts: [250000] }); await actAs(c, user.meron);
      expect(await state(c, id)).toBe("AUTHENTICATED");
      expect(await bal(c)).toEqual({ current: 900000, reserved: 0, available: 800000 });
      const r = (await rows(c, "SELECT verified_by, authenticated_by, verified_at, authenticated_at, request_payment_status(id) AS paid FROM payment_requests WHERE id=$1", [id]))[0];
      expect([r.verified_by, r.authenticated_by, r.paid]).toEqual([user.dawit, user.kebede, null]); expect(r.authenticated_at).toBeInstanceOf(Date);
      const h = (await rows(c, "SELECT previous_balance p, new_balance n, updated_by u, request_no FROM account_balance_history($1, 1)", [AWASH]))[0];
      expect([Number(h.p), Number(h.n), h.u, h.request_no]).toEqual([1150000, 900000, user.kebede, expect.stringMatching(/^PR-/)]);
    });
  });
  it("only a verified request can be authenticated, once", async () => {
    await as(user.meron, async (c) => {
      const id = await draft(c, 1000); const v1 = await fn(c, "wf_submit", id);
      await actAs(c, user.kebede); expect(await fails(c, "SELECT wf_authorize($1,$2)", [id, v1])).toMatch(/not waiting for authentication/);
      await actAs(c, user.dawit); const v2 = await fn(c, "wf_verify", id, v1);
      await actAs(c, user.kebede); const v3 = await fn(c, "wf_authorize", id, v2);
      expect(await fails(c, "SELECT wf_authorize($1,$2)", [id, v3])).toMatch(/not waiting for authentication/);
      expect(await fails(c, "SELECT wf_reject($1,$2,'too late')", [id, v3])).toMatch(/only a verified request/);
    });
  });
});

describe("reminders", () => {
  it("a request past its due date that still waits for approval is reminded once a day, to whoever must act next and its creator", async () => {
    await owner.query("BEGIN");
    try {
      await actAs(owner, user.meron); const id = await mk(owner, user.meron, { amounts: [1000], dues: ["2026-01-05"] }); await fn(owner, "wf_submit", id);
      expect(Number((await rows(owner, "SELECT enqueue_overdue_requests() AS n"))[0].n)).toBeGreaterThanOrEqual(1);
      expect(Number((await rows(owner, "SELECT enqueue_overdue_requests() AS n"))[0].n)).toBe(0);               // not again within 24 hours
      const ev = (await rows(owner, "SELECT id FROM notification_outbox WHERE request_id=$1 AND event_type='REQUEST_OVERDUE'", [id]))[0];
      expect((await rows(owner, "SELECT email FROM outbox_recipients($1)", [ev.id])).map((r) => r.email).sort()).toEqual(["dawit@abig.test", "meron@abig.test", "yared@abig.test"]);
    } finally { await owner.query("ROLLBACK"); }
  });
});

describe("lists", () => {
  it("the request list can be filtered by status (the status is an enum, the filter is text)", async () => {
    await as(user.meron, async (c) => {
      const id = await draft(c, 1000); await fn(c, "wf_submit", id);
      const q = "SELECT r.request_no FROM payment_requests r WHERE ($1::text IS NULL OR r.workflow_state::text = $1)";
      expect((await rows(c, q, ["RESERVED"])).length).toBeGreaterThanOrEqual(1); expect(await rows(c, q, ["VERIFIED"])).toHaveLength(0); expect((await rows(c, q, [null])).length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("strict roles: Accountant, Finance Manager, Owner, Administrator", () => {
  it("an Accountant creates and submits but can never verify, authenticate, reject or approve", async () => {
    await as(user.meron, async (c) => {
      const id = await draft(c, 1000); const v = await fn(c, "wf_submit", id);
      for (const q of ["SELECT wf_verify($1,$2)", "SELECT wf_authorize($1,$2)"]) expect(await fails(c, q, [id, v])).toMatch(/permission/);
      expect(await rows(c, "SELECT * FROM app_actionable_requests()")).toHaveLength(0);
    });
  });
  it("a Finance Manager verifies but cannot authenticate or reject; an Owner authenticates but cannot verify", async () => {
    await as(user.meron, async (c) => {
      const id = await draft(c, 1000); const v1 = await fn(c, "wf_submit", id);
      await actAs(c, user.kebede); expect(await fails(c, "SELECT wf_verify($1,$2)", [id, v1])).toMatch(/payment_request:verify/);
      expect((await rows(c, "SELECT stage FROM app_actionable_requests() WHERE request_id=$1", [id]))).toHaveLength(0);
      await actAs(c, user.dawit);
      expect((await rows(c, "SELECT stage FROM app_actionable_requests() WHERE request_id=$1", [id]))[0].stage).toBe("VERIFICATION");
      const v2 = await fn(c, "wf_verify", id, v1);
      expect(await fails(c, "SELECT wf_authorize($1,$2)", [id, v2])).toMatch(/payment_request:authenticate/);
      expect(await fails(c, "SELECT wf_reject($1,$2,'not valid')", [id, v2])).toMatch(/payment_request:authenticate/);
      expect((await rows(c, "SELECT 1 FROM app_actionable_requests() WHERE request_id=$1", [id]))).toHaveLength(0);
      await actAs(c, user.kebede);
      expect((await rows(c, "SELECT stage FROM app_actionable_requests() WHERE request_id=$1", [id]))[0].stage).toBe("AUTHORIZATION");
    });
  });
  it("an Administrator has full access, including approvals, but the same separation of duties applies", async () => {
    await as(user.meron, async (c) => {
      const id = await draft(c, 5000); const v1 = await fn(c, "wf_submit", id);
      await actAs(c, user.admin);
      expect((await rows(c, "SELECT 1 FROM app_actionable_requests() WHERE request_id=$1", [id]))).toHaveLength(1);
      const v2 = await fn(c, "wf_verify", id, v1);
      expect(await fails(c, "SELECT wf_authorize($1,$2)", [id, v2])).toMatch(/already acted at the verification stage/);
      expect((await rows(c, "SELECT actor_role FROM approval_events WHERE request_id=$1 AND action='VERIFY'", [id]))[0].actor_role).toBe("ADMIN");
      await actAs(c, user.kebede); await fn(c, "wf_authorize", id, v2);
      await actAs(c, user.admin); await c.query("SELECT record_opening_balance($1, 3000000)", [AWASH]);                  // and can enter balances anywhere
      expect(await fn(c, "admin_create_company", "ZZ", "Zed PLC", "7000000001", "+251900000001")).toBeTruthy();
      // an admin's own request cannot be approved by that admin
      const mine = await mk(c, user.admin, { amounts: [100] }); const vm = await fn(c, "wf_submit", mine);
      expect(await fails(c, "SELECT wf_verify($1,$2)", [mine, vm])).toMatch(/you created this request/);
    });
  });
  it("an Accountant belongs to exactly one company; Finance Managers and Owners can have several", async () => {
    await as(user.admin, async (c) => {
      const m = (await rows(c, "INSERT INTO company_memberships (company_id, user_id) VALUES ($1,$2) RETURNING id", [BERBERO, user.meron]))[0].id;
      expect(await fails(c, "INSERT INTO membership_roles (membership_id, role_id) SELECT $1, id FROM roles WHERE code='ACCOUNTANT'", [m])).toMatch(/limited to 1 company/);
      const m2 = (await rows(c, "INSERT INTO company_memberships (company_id, user_id) VALUES ($1,$2) RETURNING id", [BERBERO, user.dawit]))[0].id;
      await c.query("INSERT INTO membership_roles (membership_id, role_id) SELECT $1, id FROM roles WHERE code='FINANCE_MANAGER'", [m2]);      // Dawit: ASKU and Berbero
      expect(await fails(c, "UPDATE roles SET max_companies = 1 WHERE code='FINANCE_MANAGER'")).toMatch(/already holds it in more/);        // limit set on the role, refused while it would be broken
      expect(await fails(c, "UPDATE roles SET max_companies = 3 WHERE code='ACCOUNTANT'")).toMatch(/exactly one company/);
      await c.query("UPDATE roles SET max_companies = 2 WHERE code='FINANCE_MANAGER'");
    });
  });
  it("some permissions can never be given to a role, and the matrix can be edited otherwise", async () => {
    await as(user.admin, async (c) => {
      const give = (role: string, perm: string) => c.query("INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p WHERE r.code=$1 AND p.code=$2", [role, perm]);
      for (const [r, p, msg] of [["ACCOUNTANT", "payment_request:verify", /Accountants cannot/], ["ACCOUNTANT", "payment_request:authenticate", /Accountants cannot/], ["FINANCE_MANAGER", "payment_request:authenticate", /Finance Managers cannot/], ["OWNER", "user:manage", /administrators/], ["FINANCE_MANAGER", "company:manage", /administrators/]] as const) {
        await c.query("SAVEPOINT s"); await expect(give(r, p)).rejects.toThrow(msg); await c.query("ROLLBACK TO s");
      }
      await c.query("DELETE FROM role_permissions WHERE role_id=(SELECT id FROM roles WHERE code='FINANCE_MANAGER') AND permission_id=(SELECT id FROM permissions WHERE code='supplier:manage')");
      await give("FINANCE_MANAGER", "supplier:manage");
    });
    await as(user.kebede, async (c) => { expect(await fails(c, "INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p WHERE r.code='OWNER' AND p.code='report:view'")).toMatch(/row-level security|duplicate/); });
  });
  it("people see only their own companies, except administrators", async () => {
    await as(user.meron, async (c) => { expect(await rows(c, "SELECT DISTINCT debtor_company_id FROM payment_requests WHERE debtor_company_id <> $1", [ASKU])).toHaveLength(0); });
    await as(user.bereket, async (c) => { expect(await rows(c, "SELECT 1 FROM payment_requests")).toHaveLength(0); expect(await rows(c, "SELECT 1 FROM company_bank_accounts")).toHaveLength(0); });
    await as(user.admin, async (c) => { expect((await rows(c, "SELECT 1 FROM company_bank_accounts")).length).toBe(2); });
  });
});
