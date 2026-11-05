import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, Pool } from "pg";
import { actAs, ASKU, authorized, AWASH, BD_ETHIO, BERBERO, CBE, fails, fn, mk, rows, S_ETHIO_ID, setupDb, user } from "./helpers";
import { compose, tick } from "../src/worker/mail";

let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"]; let workerUrl: string;
beforeAll(async () => { const d = await setupDb("abig_test_phase1"); owner = d.owner; as = d.as; workerUrl = d.workerUrl; });
afterAll(async () => { await owner?.end(); });

/** Runs as the owner connection in a transaction that is rolled back, so the outbox and audit rows can be read back. Set the actor with actAs. */
async function tx<T>(f: (c: Client) => Promise<T>): Promise<T> {
  await owner.query("BEGIN");
  try { return await f(owner); } finally { await owner.query("ROLLBACK"); }
}
const req = async (c: Client, id: string) => (await rows(c, "SELECT workflow_state::text s, version v, payment_method::text m, cheque_no, bank_reference, paid_at, paid_by FROM payment_requests WHERE id=$1", [id]))[0];
const bal = async (c: Client, id = AWASH) => { const r = (await rows(c, "SELECT current_balance c, reserved_balance r, available_balance a, shortfall_amount s FROM company_bank_accounts WHERE id=$1", [id]))[0]; return { current: Number(r.c), reserved: Number(r.r), available: Number(r.a), shortfall: Number(r.s) }; };
const setBalance = (c: Client, amount: number, id = AWASH) => c.query("SELECT update_bank_balance($1,$2)", [id, amount]);
const submitted = async (c: Client, amount: number, extra = {}) => { await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [amount], ...extra }); await fn(c, "wf_submit", id); return id; };
const shortfallEvents = (c: Client) => rows(c, "SELECT id, payload FROM notification_outbox WHERE event_type = 'ACCOUNT_SHORTFALL' ORDER BY created_at, id");
const integrity = async (c: Client) => { const sql = readFileSync(join(__dirname, "../ops/verify-integrity.sql"), "utf8").replace(/^\\set.*$/m, ""); return Object.fromEntries((await c.query(sql)).rows.map((r) => [r.name, Number(r.violations)])); };

describe("Authenticated is not Paid", () => {
  it("authenticating debits the account and the payment stays Authenticated", async () => {
    await as(user.meron, async (c) => {
      const { id } = await authorized(c, { amounts: [250000] });
      const r = await req(c, id);
      expect(r.s).toBe("AUTHENTICATED"); expect(r.paid_at).toBeNull(); expect(r.paid_by).toBeNull();
      expect(await bal(c)).toEqual({ current: 900000, reserved: 0, available: 800000, shortfall: 0 });
      expect((await rows(c, "SELECT request_payment_status($1) AS p", [id]))[0].p).toBeNull();
    });
  });
  it("the application cannot make a payment Paid", async () => {
    await as(user.meron, async (c) => {
      const { id } = await authorized(c, { amounts: [1000] });
      expect(await fails(c, "UPDATE payment_requests SET workflow_state = 'PAID' WHERE id = $1", [id])).toMatch(/permission denied/);
      expect(await fails(c, "UPDATE payment_requests SET paid_at = now(), paid_by = $2 WHERE id = $1", [id, user.meron])).toMatch(/permission denied/);
      expect(await fails(c, "SELECT wf_mark_paid($1, $2)", [id, user.meron])).toMatch(/permission denied/);
      expect(await fails(c, "SELECT mark_authenticated_paid_at_go_live($1, 'test')", [user.meron])).toMatch(/permission denied/);
    });
  });
  it("even the owner role cannot reach Paid outside reconciliation, or from any other status", async () => {
    await tx(async (c) => {
      const { id } = await authorized(c, { amounts: [1000] });
      const paid = "UPDATE payment_requests SET workflow_state = 'PAID', paid_at = now(), paid_by = $2 WHERE id = $1";
      expect(await fails(c, paid, [id, user.admin])).toMatch(/only becomes paid through reconciliation/);
      await c.query("SELECT set_config('app.wf', 'on', true)");
      expect(await fails(c, paid, [id, user.admin])).toMatch(/only becomes paid through reconciliation/);
      await c.query("SELECT set_config('app.wf', 'off', true)");
      const reserved = await submitted(c, 1000);
      expect(await fails(c, "SELECT wf_mark_paid($1, $2)", [reserved, user.admin])).toMatch(/after authentication/);
      expect(await fails(c, "UPDATE payment_requests SET paid_at = now() WHERE id = $1", [id])).toMatch(/recorded by reconciliation only/);
    });
  });
  it("an authenticated payment cannot be cancelled, rejected or returned, by any path", async () => {
    await tx(async (c) => {
      const { id } = await authorized(c, { amounts: [1000] }); const { v } = await req(c, id);
      await actAs(c, user.meron); expect(await fails(c, "SELECT wf_cancel($1,$2,'too late')", [id, v])).toMatch(/can no longer be cancelled/);
      await actAs(c, user.kebede);
      expect(await fails(c, "SELECT wf_reject($1,$2,'too late')", [id, v])).toMatch(/only a verified request can be rejected/);
      expect(await fails(c, "SELECT wf_return($1,$2,'too late')", [id, v])).toMatch(/only a reserved or verified request/);
      expect(await fails(c, "SELECT wf_set_state($1,'CANCELLED')", [id])).toMatch(/has been debited and cannot be cancelled/);
      expect(await fails(c, "SELECT wf_set_state($1,'DRAFT')", [id])).toMatch(/has been debited and cannot be cancelled/);
    });
  });
});

describe("going live: requests authenticated during testing", () => {
  it("become Paid only when someone runs the step, move no money, are logged, and are final", async () => {
    await tx(async (c) => {
      const { id } = await authorized(c, { amounts: [5000] });
      const reservedOne = await submitted(c, 700);
      const before = await bal(c);
      expect(await fails(c, "SELECT mark_authenticated_paid_at_go_live($1, ' ')", [user.admin])).toMatch(/a note is required/);
      expect(await fn(c, "mark_authenticated_paid_at_go_live", user.admin, "Test data")).toBe(1);
      const r = await req(c, id);
      expect([r.s, r.paid_by]).toEqual(["PAID", user.admin]); expect(r.paid_at).toBeInstanceOf(Date);
      expect((await req(c, reservedOne)).s).toBe("RESERVED");
      expect(await bal(c)).toEqual(before);
      expect((await rows(c, "SELECT request_payment_status($1) AS p", [id]))[0].p).toBe("PAID");
      expect((await rows(c, "SELECT metadata FROM audit_events WHERE action = 'PAYMENT_MARKED_PAID_AT_GO_LIVE' AND entity_id = $1", [id]))[0].metadata).toMatchObject({ note: "Test data" });
      expect((await rows(c, "SELECT from_state, to_state, actor_id FROM request_events WHERE request_id = $1 ORDER BY version DESC LIMIT 1", [id]))[0]).toEqual({ from_state: "AUTHENTICATED", to_state: "PAID", actor_id: user.admin });
      expect(await fails(c, "UPDATE payment_requests SET description = 'changed' WHERE id = $1", [id])).toMatch(/a paid payment is final/);
      expect(await fails(c, "SELECT wf_set_state($1,'AUTHENTICATED')", [id])).toMatch(/only a verified request can be authenticated/);
      expect(await fails(c, "SELECT wf_set_state($1,'CANCELLED')", [id])).toMatch(/a paid payment is final/);
      await actAs(c, user.meron); expect(await fails(c, "SELECT record_execution($1,NULL,'R-1')", [id])).toMatch(/a paid payment is final|authenticated payment/);
      expect(await fails(c, "SELECT wf_cancel($1,$2,'too late')", [id, r.v])).toMatch(/can no longer be cancelled/);
    });
  });
  it("a request cannot be created as Paid", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron);
      expect(await fails(c, `INSERT INTO payment_requests (debtor_company_id, supplier_id, created_by, total_amount, workflow_state) SELECT debtor_company_id, supplier_id, created_by, 1, 'PAID' FROM (SELECT $1::uuid debtor_company_id, supplier_id, $2::uuid created_by FROM company_suppliers WHERE company_id = $1 LIMIT 1) x`, [ASKU, user.meron])).toMatch(/only becomes paid/);
    });
  });
});

describe("Cancelled and Rejected mean different things", () => {
  it("cancelling is Cancelled, releases the funds, keeps the reason and is final", async () => {
    await tx(async (c) => {
      const id = await submitted(c, 400000); expect((await bal(c)).reserved).toBe(400000);
      const { v } = await req(c, id);
      expect(await fails(c, "SELECT wf_cancel($1,$2,' ')", [id, v])).toMatch(/a reason is required/);
      await fn(c, "wf_cancel", id, v, "No longer needed");
      expect((await req(c, id)).s).toBe("CANCELLED"); expect((await bal(c)).reserved).toBe(0);
      expect((await rows(c, "SELECT action, reason FROM approval_events WHERE request_id = $1 AND action = 'CANCEL'", [id]))[0]).toEqual({ action: "CANCEL", reason: "No longer needed" });
      expect(await fails(c, "SELECT wf_submit($1)", [id])).toMatch(/only a draft can be submitted/);
      expect(await fails(c, "SELECT wf_set_state($1,'DRAFT')", [id])).toMatch(/rejected or cancelled request is final/);
    });
  });
  it("a draft with no debit account can be cancelled", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const id = await mk(c, user.meron, { account: null, amounts: [100] });
      await fn(c, "wf_cancel", id, (await req(c, id)).v, "Entered by mistake");
      expect((await req(c, id)).s).toBe("CANCELLED");
    });
  });
  it("only an Owner's refusal is Rejected, and it is final too", async () => {
    await tx(async (c) => {
      const id = await submitted(c, 1000); await actAs(c, user.dawit); const v2 = await fn(c, "wf_verify", id, (await req(c, id)).v);
      await actAs(c, user.kebede); await fn(c, "wf_reject", id, v2, "Duplicate payment");
      expect((await req(c, id)).s).toBe("REJECTED"); expect((await bal(c)).reserved).toBe(0);
      expect(await fails(c, "SELECT wf_set_state($1,'CANCELLED')", [id])).toMatch(/rejected or cancelled request is final/);
    });
  });
  it("frees the invoice for a new request after a cancellation, and still refuses a duplicate while one is active", async () => {
    await tx(async (c) => {
      const id = await submitted(c, 1000, { ref: "INV-AGAIN" });
      await actAs(c, user.meron); const dup = await mk(c, user.meron, { amounts: [1000], ref: "INV-AGAIN" });
      expect(await fails(c, "SELECT wf_submit($1)", [dup])).toMatch(/payment_requests_invoice_once/);
      await fn(c, "wf_cancel", id, (await req(c, id)).v, "Wrong amount");
      await fn(c, "wf_submit", dup); expect((await req(c, dup)).s).toBe("RESERVED");
    });
  });
});

describe("payment methods", () => {
  it.each(["TRANSFER", "CHEQUE", "CASH", "TELEBIRR"])("%s goes through to authentication, and the method is logged", async (method) => {
    await tx(async (c) => {
      const { id } = await authorized(c, { amounts: [1000], method });
      expect((await req(c, id)).m).toBe(method);
      expect((await rows(c, "SELECT metadata FROM audit_events WHERE action = 'PAYMENT_AUTHENTICATED' AND entity_id = $1", [id]))[0].metadata).toMatchObject({ method, amount: 1000 });
    });
  });
  it("defaults to a transfer and refuses anything else", async () => {
    await as(user.meron, async (c) => {
      const id = await mk(c, user.meron, { amounts: [100] }); expect((await req(c, id)).m).toBe("TRANSFER");
      expect(await fails(c, "UPDATE payment_requests SET payment_method = 'BITCOIN' WHERE id = $1", [id])).toMatch(/invalid input value/);
    });
  });
  it("can be changed on a draft and is locked after submission", async () => {
    await as(user.meron, async (c) => {
      const id = await mk(c, user.meron, { amounts: [100] });
      await c.query("UPDATE payment_requests SET payment_method = 'CHEQUE' WHERE id = $1", [id]); expect((await req(c, id)).m).toBe("CHEQUE");
      await fn(c, "wf_submit", id);
      expect((await c.query("UPDATE payment_requests SET payment_method = 'CASH' WHERE id = $1", [id])).rowCount).toBe(0);
      expect((await req(c, id)).m).toBe("CHEQUE");
    });
    await tx(async (c) => {
      const id = await submitted(c, 100);
      expect(await fails(c, "UPDATE payment_requests SET payment_method = 'CASH' WHERE id = $1", [id])).toMatch(/locked after submission/);
    });
  });
});

describe("cheque number and bank reference", () => {
  it("the Accountant can record them after authentication; both are optional and can be corrected; changes are audited", async () => {
    await tx(async (c) => {
      const { id } = await authorized(c, { amounts: [1000], method: "CHEQUE" }); const v0 = (await req(c, id)).v;
      await actAs(c, user.lidya);   // any Accountant of the company, not only the creator
      expect(await fn(c, "record_execution", id, " CHQ-1 ", null)).toBe(v0 + 1);
      expect(await req(c, id)).toMatchObject({ cheque_no: "CHQ-1", bank_reference: null, s: "AUTHENTICATED" });
      await fn(c, "record_execution", id, "CHQ-2", "REF-9");
      await fn(c, "record_execution", id, "", "");
      expect(await req(c, id)).toMatchObject({ cheque_no: null, bank_reference: null });
      const logged = await rows(c, "SELECT actor_id, metadata FROM audit_events WHERE action = 'PAYMENT_EXECUTION_RECORDED' AND entity_id = $1 ORDER BY occurred_at", [id]);
      expect(logged).toHaveLength(3);
      expect(logged[1]).toMatchObject({ actor_id: user.lidya, metadata: { cheque_no: ["CHQ-1", "CHQ-2"], bank_reference: [null, "REF-9"] } });
    });
  });
  it("a cheque number is only for a cheque; a bank reference is for any method", async () => {
    await tx(async (c) => {
      const { id } = await authorized(c, { amounts: [1000] }); await actAs(c, user.meron);
      expect(await fails(c, "SELECT record_execution($1,'CHQ-1',NULL)", [id])).toMatch(/only applies to a cheque/);
      await fn(c, "record_execution", id, null, "REF-1"); expect((await req(c, id)).bank_reference).toBe("REF-1");
    });
  });
  it("needs an authenticated payment, an Accountant of that company, and the database function", async () => {
    await tx(async (c) => {
      const draft = await submitted(c, 1000);
      expect(await fails(c, "SELECT record_execution($1,NULL,'R')", [draft])).toMatch(/only be recorded on an authenticated payment/);
      const { id } = await authorized(c, { amounts: [1000] });
      await actAs(c, user.dawit); expect(await fails(c, "SELECT record_execution($1,NULL,'R')", [id])).toMatch(/only an Accountant/);
      await actAs(c, user.tigist); expect(await fails(c, "SELECT record_execution($1,NULL,'R')", [id])).toMatch(/request not found/);
    });
    await as(user.meron, async (c) => {
      const { id } = await authorized(c, { amounts: [1000], method: "CHEQUE" });
      expect(await fails(c, "UPDATE payment_requests SET bank_reference = 'R' WHERE id = $1", [id])).toMatch(/permission denied/);
      expect(await fails(c, "UPDATE payment_requests SET cheque_no = 'C' WHERE id = $1", [id])).toMatch(/permission denied/);
    });
    await tx(async (c) => {
      await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [100] });
      expect(await fails(c, "UPDATE payment_requests SET bank_reference = 'R' WHERE id = $1", [id])).toMatch(/recorded by the workflow only/);
    });
  });
});

describe("shortfall: a bank figure below the reserved funds", () => {
  it("is accepted, shown, logged and sent to the Finance Managers once", async () => {
    await tx(async (c) => {
      await submitted(c, 400000);
      await setBalance(c, 300000);
      expect(await bal(c)).toEqual({ current: 300000, reserved: 400000, available: -200000, shortfall: 100000 });
      expect((await rows(c, "SELECT previous_balance, new_balance FROM bank_balance_history WHERE account_id = $1 ORDER BY updated_at DESC LIMIT 1", [AWASH]))[0]).toEqual({ previous_balance: "1150000.0000", new_balance: "300000.0000" });
      expect((await rows(c, "SELECT metadata FROM audit_events WHERE action = 'ACCOUNT_SHORTFALL_DETECTED' AND entity_id = $1", [AWASH]))[0].metadata).toMatchObject({ balance: 300000, reserved: 400000, shortfall: 100000 });
      const ev = await shortfallEvents(c); expect(ev).toHaveLength(1);
      expect(ev[0].payload).toMatchObject({ account_id: AWASH, account_label: "ASKU Awash current", shortfall_amount: 100000 });
      expect((await rows(c, "SELECT user_id FROM outbox_recipients($1)", [ev[0].id])).map((r) => r.user_id).sort()).toEqual([user.dawit, user.yared].sort());   // the Owner and the Accountants are not
      await setBalance(c, 300000); expect(await shortfallEvents(c)).toHaveLength(1);   // the same figure again: nothing new
      await setBalance(c, 350000); expect(await shortfallEvents(c)).toHaveLength(1);   // smaller: nothing new
      await setBalance(c, 250000); expect(await shortfallEvents(c)).toHaveLength(2);   // bigger: told again
    });
  });
  it("is not a shortfall at exactly the reserved amount", async () => {
    await tx(async (c) => {
      await submitted(c, 400000); await setBalance(c, 400000);
      expect((await bal(c)).shortfall).toBe(0); expect(await shortfallEvents(c)).toHaveLength(0);
    });
  });
  it("still refuses a negative figure", async () => {
    await as(user.meron, async (c) => { expect(await fails(c, "SELECT update_bank_balance($1, -0.01)", [AWASH])).toMatch(/cannot be negative/); });
  });
  it("blocks new submissions on that account with a clear message, and nothing is reserved", async () => {
    await tx(async (c) => {
      await submitted(c, 400000); await setBalance(c, 300000);
      await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [1] });
      expect(await fails(c, "SELECT wf_submit($1)", [id])).toMatch(/in shortfall: its balance \(ETB 300,000.00\) is ETB 100,000.00 below the reserved funds \(ETB 400,000.00\). New submissions are blocked/);
      expect((await req(c, id)).s).toBe("DRAFT"); expect((await bal(c)).reserved).toBe(400000);
    });
  });
  it("does not block submissions on other accounts", async () => {
    await tx(async (c) => {
      await submitted(c, 400000); await setBalance(c, 300000);
      const other = await submitted(c, 1000, { account: CBE }); expect((await req(c, other)).s).toBe("RESERVED");
    });
  });
  it("refuses to raise a held amount, but allows lowering one", async () => {
    await tx(async (c) => {
      const id = await submitted(c, 400000); await setBalance(c, 300000);
      await actAs(c, user.dawit); const v = (await req(c, id)).v;
      const up = { total_amount: 500000, installments: [{ seq: 1, amount: 500000 }] };
      expect(await fails(c, "SELECT wf_adjust($1,$2,$3::jsonb,'more')", [id, v, JSON.stringify(up)])).toMatch(/in shortfall/);
      await fn(c, "wf_adjust", id, v, JSON.stringify({ total_amount: 350000, installments: [{ seq: 1, amount: 350000 }] }), "smaller invoice");
      expect(await bal(c)).toMatchObject({ reserved: 350000, shortfall: 50000 });
    });
  });
  it("lets requests already holding funds finish, debiting only what the balance covers", async () => {
    await tx(async (c) => {
      const a = await submitted(c, 250000), b = await submitted(c, 150000);
      await setBalance(c, 200000); expect((await bal(c)).shortfall).toBe(200000);
      await actAs(c, user.dawit);
      const va = await fn(c, "wf_verify", a, (await req(c, a)).v), vb = await fn(c, "wf_verify", b, (await req(c, b)).v);
      await actAs(c, user.kebede);
      expect(await fails(c, "SELECT wf_authorize($1,$2)", [a, va])).toMatch(/is lower than the amount/);
      await fn(c, "wf_authorize", b, vb);
      expect(await bal(c)).toMatchObject({ current: 50000, reserved: 250000, shortfall: 200000 });
    });
  });
  it("clears when funds are released or the bank figure recovers, and submissions work again", async () => {
    await tx(async (c) => {
      const a = await submitted(c, 400000); await setBalance(c, 300000);
      await actAs(c, user.meron); await fn(c, "wf_cancel", a, (await req(c, a)).v, "Not needed");
      expect(await bal(c)).toEqual({ current: 300000, reserved: 0, available: 200000, shortfall: 0 });
      await actAs(c, user.meron); const over = await mk(c, user.meron, { amounts: [250000] });
      expect(await fails(c, "SELECT wf_submit($1)", [over])).toMatch(/more than the available balance \(ETB 200,000.00\)/);   // no longer a shortfall, but the buffer still counts
    });
    await tx(async (c) => {
      await submitted(c, 400000); await setBalance(c, 300000); await setBalance(c, 900000);
      expect(await bal(c)).toMatchObject({ shortfall: 0, available: 400000 });
      const b = await submitted(c, 400000); expect((await req(c, b)).s).toBe("RESERVED");
    });
  });
  it("on a shared account: one balance, every linked company blocked, every linked company's Finance Manager told", async () => {
    await tx(async (c) => {
      await actAs(c, user.nardos); const held = await mk(c, user.nardos, { company: BERBERO, supplier: S_ETHIO_ID, bank: BD_ETHIO, amounts: [3000000] }); await fn(c, "wf_submit", held);
      await actAs(c, user.tigist); await setBalance(c, 2500000, CBE);   // Berbero may enter this account's balance
      expect(await bal(c, CBE)).toMatchObject({ current: 2500000, reserved: 3000000, shortfall: 500000 });
      await actAs(c, user.meron); const asku = await mk(c, user.meron, { account: CBE, amounts: [1] });
      expect(await fails(c, "SELECT wf_submit($1)", [asku])).toMatch(/in shortfall/);
      const ev = await shortfallEvents(c);
      expect((await rows(c, "SELECT user_id FROM outbox_recipients($1)", [ev[0].id])).map((r) => r.user_id).sort()).toEqual([user.abebe, user.dawit, user.fikru, user.yared].sort());
    });
  });
  it("the email names the account and the amounts and links to the accounts page", async () => {
    const { subject, text } = compose({ id: "1", event_type: "ACCOUNT_SHORTFALL", request_id: null, payload: { account_label: "BEES CBE current", balance: 2500000, reserved: "3000000", shortfall_amount: 500000 } }, "https://abig.test/");
    expect(subject).toBe("BEES CBE current is in shortfall by ETB 500,000.00");
    expect(text).toContain("Balance: ETB 2,500,000.00"); expect(text).toContain("Reserved: ETB 3,000,000.00"); expect(text).toContain("https://abig.test/accounts");
  });
});

describe("minimum buffer", () => {
  it("available is balance minus reserved minus buffer, and the buffer cannot be committed", async () => {
    await as(user.meron, async (c) => {
      await setBalance(c, 1000000);
      expect((await bal(c)).available).toBe(900000);
      const over = await mk(c, user.meron, { amounts: [900000.01] });
      expect(await fails(c, "SELECT wf_submit($1)", [over])).toMatch(/\(ETB 900,000.01\) is more than the available balance \(ETB 900,000.00\) on this account, which keeps a minimum buffer of ETB 100,000.00/);
      const exact = await mk(c, user.meron, { amounts: [900000] }); await fn(c, "wf_submit", exact);
      expect(await bal(c)).toMatchObject({ reserved: 900000, available: 0 });
    });
  });
  it("applies on shared accounts for every company", async () => {
    await as(user.meron, async (c) => {
      expect((await bal(c, CBE)).available).toBe((await bal(c, CBE)).current - 200000);
      const { available } = await bal(c, CBE);
      const id = await mk(c, user.meron, { account: CBE, amounts: [available + 1] });
      expect(await fails(c, "SELECT wf_submit($1)", [id])).toMatch(/minimum buffer of ETB 200,000.00/);
    });
  });
  it("a balance inside the buffer is not a shortfall: raising is refused, lowering is allowed", async () => {
    await tx(async (c) => {
      const id = await submitted(c, 1000000); await setBalance(c, 1050000);
      expect(await bal(c)).toEqual({ current: 1050000, reserved: 1000000, available: -50000, shortfall: 0 });
      expect(await shortfallEvents(c)).toHaveLength(0);
      await actAs(c, user.dawit); const v = (await req(c, id)).v;
      expect(await fails(c, "SELECT wf_adjust($1,$2,$3::jsonb,'more')", [id, v, JSON.stringify({ total_amount: 1000001, installments: [{ seq: 1, amount: 1000001 }] })])).toMatch(/more than the available balance/);
      await fn(c, "wf_adjust", id, v, JSON.stringify({ total_amount: 900000, installments: [{ seq: 1, amount: 900000 }] }), "smaller invoice");
      expect((await bal(c)).reserved).toBe(900000);
    });
  });
  it("is set by the account owner, cannot be negative, and changes are audited", async () => {
    await tx(async (c) => {
      await actAs(c, user.kebede); await c.query("SELECT set_account_policy($1,$2)", [AWASH, 250000]);
      expect((await bal(c)).available).toBe(900000);
      expect((await rows(c, "SELECT metadata FROM audit_events WHERE action = 'BANK_ACCOUNT_POLICY_CHANGED' AND entity_id = $1", [AWASH]))[0].metadata).toMatchObject({ min_buffer: 250000, previous_min_buffer: 100000 });
      expect(await fails(c, "SELECT set_account_policy($1,$2)", [AWASH, -1])).toMatch(/cannot be negative/);
      await actAs(c, user.meron); expect(await fails(c, "SELECT set_account_policy($1,$2)", [AWASH, 0])).toMatch(/only the account owner/);
    });
  });
});

describe("the owner-approval setting is gone", () => {
  it("from the table and from every function that set or read it", async () => {
    expect(await rows(owner, "SELECT 1 FROM information_schema.columns WHERE table_name = 'company_bank_accounts' AND column_name = 'owner_approval_required'")).toHaveLength(0);
    for (const f of ["register_bank_account(uuid,text,text,text,bytea,numeric,boolean)", "set_account_policy(uuid,numeric,boolean)", "owner_pending_approvals()", "owner_approve_account_use(uuid,uuid)", "owner_revoke_account_use(uuid,text)"])
      expect((await rows(owner, "SELECT to_regprocedure($1) AS f", [f]))[0].f).toBeNull();
  });
  it("a new account is registered without it", async () => {
    await tx(async (c) => {
      await actAs(c, user.kebede);
      const id = (await rows(c, "SELECT register_bank_account($1,'Zemen','ASKU Zemen','1234',NULL,5000) AS id", [ASKU]))[0].id;
      expect((await rows(c, "SELECT min_buffer FROM company_bank_accounts WHERE id = $1", [id]))[0].min_buffer).toBe("5000.0000");
      expect(await fails(c, "SELECT register_bank_account($1,'Zemen','Bad','1235',NULL,-1)", [ASKU])).toMatch(/cannot be negative/);
    });
  });
  it("a linked company still pays from a shared account without any approval, and an unlinked one still cannot", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const id = await mk(c, user.meron, { account: CBE, amounts: [1000] }); await fn(c, "wf_submit", id);
      expect((await req(c, id)).s).toBe("RESERVED");
      await actAs(c, user.nardos);
      await expect(mk(c, user.nardos, { company: BERBERO, supplier: S_ETHIO_ID, bank: BD_ETHIO, account: AWASH, amounts: [1000] })).rejects.toThrow(/not available to this company/);
    });
  });
  it("the archive of the old setting is closed to the application", async () => {
    await as(user.admin, async (c) => { expect(await fails(c, "SELECT * FROM removed_owner_approval_settings")).toMatch(/permission denied/); });
  });
});

describe("integrity check", () => {
  it("is clean with every new status and with a shortfall, which is not a violation", async () => {
    await tx(async (c) => {
      await authorized(c, { amounts: [1000] });
      const c1 = await submitted(c, 1000); await fn(c, "wf_cancel", c1, (await req(c, c1)).v, "Not needed");
      await fn(c, "mark_authenticated_paid_at_go_live", user.admin, "Test data");
      await authorized(c, { amounts: [1000] });
      await submitted(c, 400000); await setBalance(c, 300000);
      const r = await integrity(c);
      expect(Object.entries(r).filter(([, v]) => v > 0)).toEqual([]); expect((await bal(c)).shortfall).toBeGreaterThan(0);
    });
  });
  it("catches statuses that do not match their history", async () => {
    await tx(async (c) => {
      const cancelled = await submitted(c, 1000); await fn(c, "wf_cancel", cancelled, (await req(c, cancelled)).v, "Not needed");
      const { id: paid } = await authorized(c, { amounts: [1000] });
      await actAs(c, user.meron); const never = await mk(c, user.meron, { amounts: [100] });
      await c.query("ALTER TABLE payment_requests DROP CONSTRAINT payment_requests_paid_chk");
      await c.query("ALTER TABLE payment_requests DROP CONSTRAINT payment_requests_cheque_no_chk");
      await c.query("SET LOCAL session_replication_role = replica");
      await c.query("UPDATE payment_requests SET workflow_state = 'REJECTED' WHERE id = $1", [cancelled]);    // a cancellation stored as a rejection
      await c.query("UPDATE payment_requests SET workflow_state = 'CANCELLED' WHERE id = $1", [never]);       // cancelled with no record of it
      await c.query("UPDATE payment_requests SET workflow_state = 'PAID', cheque_no = 'C' WHERE id = $1", [paid]);  // paid with no who or when, cheque on a transfer
      const r = await integrity(c);
      expect(r["rejected request whose last decision was a cancellation"]).toBe(1);
      expect(r["cancelled request without a cancellation record"]).toBe(1);
      expect(r["paid request without who and when, or never authenticated"]).toBe(1);
      expect(r["cheque number on a payment that is not a cheque"]).toBe(1);
    });
  });
});

describe("local time in the database", () => {
  it("the overdue job counts days in Addis Ababa", async () => {
    expect((await rows(owner, "SELECT proconfig FROM pg_proc WHERE proname = 'enqueue_overdue_requests'"))[0].proconfig.join()).toMatch(/timezone=Africa\/Addis_Ababa/i);
  });
});

// Last on purpose: the worker only sees committed rows, so this leaves the account in shortfall.
describe("shortfall notification, end to end", () => {
  it("the background worker delivers it to the Finance Managers", async () => {
    await owner.query("BEGIN"); await submitted(owner, 400000); await setBalance(owner, 300000); await owner.query("COMMIT");
    const pool = new Pool({ connectionString: workerUrl }); const sent: { to: string; subject: string }[] = [];
    try { await tick(pool, async (m) => { sent.push(m); }, "https://abig.test"); } finally { await pool.end(); }
    expect(sent.filter((m) => /in shortfall/.test(m.subject)).map((m) => m.to).sort()).toEqual(["dawit@abig.test", "yared@abig.test"]);
    expect((await rows(owner, "SELECT delivered_at FROM notification_outbox WHERE event_type = 'ACCOUNT_SHORTFALL'"))[0].delivered_at).toBeInstanceOf(Date);
  });
});
