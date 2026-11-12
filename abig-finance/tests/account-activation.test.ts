import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { Tx } from "../src/lib/db";
import { DEACTIVATION_REASONS } from "../src/lib/format";
import { compose, notificationTitle } from "../src/lib/notification-text";
import { accountList } from "../src/lib/treasury-screens";
import { actAs, ASKU, authorized, AWASH, BD_ETHIO, BERBERO, CBE, fails, fn, mk, rows, setupDb, S_ETHIO, S_HAWASSA, user } from "./helpers";

// Deactivating and reactivating accounts. ASKU owns the Awash account (Kebede, its Owner, manages it); BEES owns the CBE account (Abebe) and shares it
// with ASKU and Berbero. Most tests run in a rolled-back transaction on the owner connection with the treasury clock set, as the scheduled payment
// tests do; the races use real connections that commit, each on an account of its own.
let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"]; let appUrl: string; let today: string;
beforeAll(async () => {
  const d = await setupDb("abig_test_account_activation"); owner = d.owner; as = d.as; appUrl = d.appUrl;
  today = (await rows(owner, "SELECT addis_day(clock_timestamp())::text AS d"))[0].d;
});
afterAll(async () => { await owner?.end(); });

async function tx<T>(f: (c: Client) => Promise<T>): Promise<T> { await owner.query("BEGIN"); try { return await f(owner); } finally { await owner.query("ROLLBACK"); } }
const day = (offset: number) => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const clock = (c: Client, offset: number) => c.query(`CREATE OR REPLACE FUNCTION treasury_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $f$ SELECT '${day(offset)}T09:00:00+03:00'::timestamptz $f$`);
const account = async (c: Client, id: string) => (await rows(c, "SELECT is_active, deactivated_at, deactivated_by, deactivation_reason::text reason, deactivation_note note, current_balance::numeric::float8 cur, reserved_balance::numeric::float8 res FROM company_bank_accounts WHERE id = $1", [id]))[0];
const req = async (c: Client, id: string) => (await rows(c, "SELECT workflow_state::text s, version, total_amount::numeric::float8 amt, schedule_error FROM payment_requests WHERE id = $1", [id]))[0];
const deactivate = (c: Client, id: string, reason = "PROVIDER_SUSPENDED", note: string | null = null) => fn(c, "deactivate_account", id, reason, note);
const reactivate = (c: Client, id: string, note: string | null = null) => fn(c, "reactivate_account", id, true, note);
const commitments = async (c: Client, id: string) => (await rows(c, "SELECT kind, label, company, state FROM account_commitments($1)", [id])).map((r) => `${r.kind}:${r.state}:${r.company ?? ""}`).sort();
const tsx = (c: Client): Tx => ({ q: async (sql, p) => (await c.query(sql, p as unknown[])).rows });
/** Every stored row of the financial tables, as a checksum. */
const ledger = async (c: Client) => Object.fromEntries(await Promise.all(["payment_requests", "payment_installments", "bank_balance_history", "approval_events", "treasury_weeks", "reconciliation_lines", "company_bank_account_access"]
  .map(async (t) => [t, (await rows(c, `SELECT md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) h FROM ${t} x`))[0].h])));

/** A draft by Meron on the Awash account (or `acct`), submitted unless `submit` is false. Returns its id. */
async function reservedOn(c: Client, acct = AWASH, submit = true, amounts = [1000]) {
  await actAs(c, user.meron);
  const id = await mk(c, user.meron, { account: acct, amounts, dues: [day(20)] });
  if (submit) await fn(c, "wf_submit", id);
  return id;
}
async function verifiedOn(c: Client) { const id = await reservedOn(c); await actAs(c, user.dawit); await fn(c, "wf_verify", id, (await req(c, id)).version); return id; }

describe("deactivating and reactivating each kind of account", () => {
  it("a bank account, a Telebirr wallet and a cash account: status, details and history", async () => {
    await tx(async (c) => {
      await actAs(c, user.kebede);
      const wallet = await fn(c, "register_wallet_account", ASKU, "ASKU wallet", "0912345678", 0) as string;
      const cash = await fn(c, "register_cash_account", ASKU, "ASKU petty cash", 0) as string;
      for (const [id, kind] of [[AWASH, "BANK"], [wallet, "WALLET"], [cash, "CASH"]] as const) {
        const before = await account(c, id);
        await actAs(c, user.kebede);
        await deactivate(c, id, "COMPANY_DECISION", "  No longer needed  ");
        expect(await account(c, id)).toMatchObject({ is_active: false, deactivated_by: user.kebede, reason: "COMPANY_DECISION", note: "No longer needed", cur: before.cur, res: before.res });
        expect((await account(c, id)).deactivated_at).toBeInstanceOf(Date);
        await reactivate(c, id, "Back in use");
        expect(await account(c, id)).toMatchObject({ is_active: true, deactivated_at: null, deactivated_by: null, reason: null, note: null, cur: before.cur, res: before.res });
        const hist = await rows(c, "SELECT action, previous_active, new_active, reason::text reason, note, actor_id FROM account_status_events WHERE account_id = $1 ORDER BY occurred_at", [id]);
        expect(hist).toEqual([
          { action: "DEACTIVATED", previous_active: true, new_active: false, reason: "COMPANY_DECISION", note: "No longer needed", actor_id: user.kebede },
          { action: "REACTIVATED", previous_active: false, new_active: true, reason: null, note: "Back in use", actor_id: user.kebede },
        ]);
        const audit = await rows(c, "SELECT action, actor_id, company_id, metadata FROM audit_events WHERE entity_id = $1 AND action LIKE 'BANK_ACCOUNT_%ACTIVATED' ORDER BY occurred_at, action", [id]);   // one transaction shares a timestamp; DEACTIVATED sorts first
        expect(audit.map((a) => [a.action, a.actor_id, a.company_id, a.metadata.kind, a.metadata.previous_status, a.metadata.new_status])).toEqual([
          ["BANK_ACCOUNT_DEACTIVATED", user.kebede, ASKU, kind, "ACTIVE", "INACTIVE"], ["BANK_ACCOUNT_REACTIVATED", user.kebede, ASKU, kind, "INACTIVE", "ACTIVE"]]);
        expect(audit[0].metadata).toMatchObject({ reason: "COMPANY_DECISION", note: "No longer needed" });
        expect(audit[1].metadata).toMatchObject({ restored_confirmed: true, note: "Back in use", previous_reason: "COMPANY_DECISION" });
      }
    });
  });

  it("every reason is accepted; Other needs an explanation; anything else is refused", async () => {
    for (const reason of ["PROVIDER_SUSPENDED", "COMPANY_DECISION", "PERMANENTLY_CLOSED"]) {
      await tx(async (c) => { await actAs(c, user.kebede); await deactivate(c, AWASH, reason); expect((await account(c, AWASH)).reason).toBe(reason); });
    }
    await tx(async (c) => {
      await actAs(c, user.kebede);
      expect(await fails(c, "SELECT deactivate_account($1,'OTHER',NULL)", [AWASH])).toMatch(/explain why/);
      expect(await fails(c, "SELECT deactivate_account($1,'OTHER','  x ')", [AWASH])).toMatch(/explain why/);
      expect(await fails(c, "SELECT deactivate_account($1,'HOLIDAY','Because')", [AWASH])).toMatch(/choose why/);
      expect(await fails(c, "SELECT deactivate_account($1,NULL,'Because')", [AWASH])).toMatch(/choose why/);
      expect(await fails(c, "SELECT deactivate_account($1,'COMPANY_DECISION',$2)", [AWASH, "x".repeat(1001)])).toMatch(/too long/);
      expect((await account(c, AWASH)).is_active).toBe(true);
      await deactivate(c, AWASH, "OTHER", "Signatory left the company");
      expect(await account(c, AWASH)).toMatchObject({ reason: "OTHER", note: "Signatory left the company" });
    });
  });

  it("the screen's reasons are exactly the database's", async () => {
    const db = (await rows(owner, "SELECT unnest(enum_range(NULL::account_deactivation_reason))::text r")).map((r) => r.r);
    expect(Object.keys(DEACTIVATION_REASONS)).toEqual(db);
  });

  it("reactivating needs the restoration confirmed; neither action repeats", async () => {
    await tx(async (c) => {
      await actAs(c, user.kebede);
      expect(await fails(c, "SELECT reactivate_account($1,true,NULL)", [AWASH])).toMatch(/already active/);
      await deactivate(c, AWASH);
      expect(await fails(c, "SELECT deactivate_account($1,'COMPANY_DECISION',NULL)", [AWASH])).toMatch(/already inactive/);
      expect(await fails(c, "SELECT reactivate_account($1,false,NULL)", [AWASH])).toMatch(/confirm that the account has been restored/);
      expect(await fails(c, "SELECT reactivate_account($1,NULL,NULL)", [AWASH])).toMatch(/confirm that the account has been restored/);
      expect((await account(c, AWASH)).is_active).toBe(false);
    });
  });
});

describe("who may change an account's status", () => {
  it("only bank_account:manage holders of the owning company; never a sharer, an accountant or nobody", async () => {
    await tx(async (c) => {
      for (const who of [user.meron, user.dawit, user.samuel]) {
        await actAs(c, who);
        expect(await fails(c, "SELECT deactivate_account($1,'COMPANY_DECISION',NULL)", [AWASH])).toMatch(/only a manager of the company that owns this account/);
      }
      // CBE belongs to BEES. ASKU's and Berbero's owners manage their own companies' accounts, not this shared one.
      for (const who of [user.kebede, user.hana, user.nardos]) {
        await actAs(c, who);
        expect(await fails(c, "SELECT deactivate_account($1,'COMPANY_DECISION',NULL)", [CBE])).toMatch(/only a manager/);
      }
      await c.query("SELECT set_config('app.user_id', '', true)");
      expect(await fails(c, "SELECT deactivate_account($1,'COMPANY_DECISION',NULL)", [AWASH])).toMatch(/only a manager/);
      await actAs(c, user.abebe); await deactivate(c, CBE);
      for (const who of [user.kebede, user.hana]) {
        await actAs(c, who);
        expect(await fails(c, "SELECT reactivate_account($1,true,NULL)", [CBE])).toMatch(/only a manager/);
      }
      await actAs(c, user.abebe); await reactivate(c, CBE);
    });
  });

  it("the application cannot change the status or the history except through the two functions", async () => {
    await as(user.kebede, async (c) => {
      expect(await fails(c, "UPDATE company_bank_accounts SET is_active = false WHERE id = $1", [AWASH])).toMatch(/permission denied/);
      expect(await fails(c, "INSERT INTO account_status_events (account_id, action, previous_active, new_active, reason, actor_id) VALUES ($1,'DEACTIVATED',true,false,'OTHER',$2)", [AWASH, user.kebede])).toMatch(/permission denied/);
      await deactivate(c, AWASH);
      expect(await fails(c, "UPDATE account_status_events SET note = 'x'")).toMatch(/permission denied/);
      expect((await rows(c, "SELECT action FROM account_status_events WHERE account_id = $1", [AWASH])).map((r) => r.action)).toEqual(["DEACTIVATED"]);
    });
    await tx(async (c) => {   // not even the owner role can rewrite it
      await actAs(c, user.kebede); await deactivate(c, AWASH);
      expect(await fails(c, "UPDATE account_status_events SET note = 'x'")).toMatch(/./);
      expect(await fails(c, "DELETE FROM account_status_events")).toMatch(/./);
    });
  });
});

describe("deactivating an account with commitments on it", () => {
  it("is allowed at once and changes nothing that is stored: requests, reservations and balances stay as they were", async () => {
    await tx(async (c) => {
      await clock(c, 0);
      const reserved = await reservedOn(c), verified = await verifiedOn(c), { id: unpaid } = await authorized(c, { dues: [day(20)] });
      const scheduled = await reservedOn(c, AWASH, false); await actAs(c, user.meron); await fn(c, "wf_schedule", scheduled, day(5));
      await actAs(c, user.meron);
      const template = await fn(c, "recurring_template_save", null, ASKU, "Office rent", "SUPPLIER", S_HAWASSA, AWASH, "TRANSFER", 500, false, "MONTHLY", day(3), null, 0, "NORMAL", null);
      const before = await ledger(c), acct = await account(c, AWASH);
      expect(acct.res).toBe(2000);

      await actAs(c, user.kebede);
      const items = await deactivate(c, AWASH, "PROVIDER_SUSPENDED", "Frozen by the bank");
      expect(items).toMatchObject({ reserved_count: 2, reserved_total: 2000, unpaid_count: 1, unpaid_total: 1000, scheduled_count: 1, recurring_count: 1, reconciling_count: 0, reserved_balance: 2000 });
      expect(await ledger(c)).toEqual(before);
      expect(await account(c, AWASH)).toMatchObject({ is_active: false, cur: acct.cur, res: acct.res });   // the balance does not become zero
      expect([(await req(c, reserved)).s, (await req(c, verified)).s, (await req(c, unpaid)).s, (await req(c, scheduled)).s]).toEqual(["RESERVED", "VERIFIED", "AUTHENTICATED", "SCHEDULED"]);
      expect((await rows(c, "SELECT is_active FROM recurring_payment_templates WHERE id = $1", [template]))[0].is_active).toBe(true);

      // What needs attention, for whoever may see it, and the flag to Finance.
      expect(await commitments(c, AWASH)).toEqual(["RECURRING:ACTIVE:ASKU PLC", "REQUEST:AUTHENTICATED:ASKU PLC", "REQUEST:RESERVED:ASKU PLC", "REQUEST:SCHEDULED:ASKU PLC", "REQUEST:VERIFIED:ASKU PLC"]);
      const ev = (await rows(c, "SELECT id, payload FROM notification_outbox WHERE event_type = 'ACCOUNT_DEACTIVATED'"))[0];
      expect(ev.payload).toMatchObject({ account_id: AWASH, account_label: "ASKU Awash current", open_items: 5, path: "/accounts", reason: "The bank or provider deactivated or suspended the account: Frozen by the bank" });
      const to = (await rows(c, "SELECT email FROM outbox_recipients($1)", [ev.id])).map((r) => r.email.replace("@abig.test", ""));
      expect(to).toEqual(expect.arrayContaining(["dawit", "kebede"]));
      expect(to).not.toContain("meron");
      await fn(c, "fan_out_notifications", 100);
      expect((await rows(c, "SELECT payload FROM user_notifications WHERE event_type = 'ACCOUNT_DEACTIVATED' AND user_id = $1", [user.dawit]))[0].payload).toMatchObject({ account_label: "ASKU Awash current" });
    });
  });

  it("nothing new can use it, while releasing money stays possible; reactivation restores use", async () => {
    await tx(async (c) => {
      await clock(c, 0);
      const draft = await reservedOn(c, AWASH, false), reserved = await reservedOn(c), reserved2 = await reservedOn(c), verified = await verifiedOn(c), { id: unpaid } = await authorized(c, { dues: [day(20)] });
      await actAs(c, user.kebede); await deactivate(c, AWASH);
      const balance = await account(c, AWASH);

      await actAs(c, user.meron);
      expect(await fails(c, `INSERT INTO payment_requests (debtor_company_id, supplier_id, supplier_bank_detail_id, debit_account_id, created_by, invoice_ref, invoice_date, total_amount)
        VALUES ($1,$2,(SELECT id FROM supplier_bank_details WHERE supplier_id = $2 AND status = 'VERIFIED'),$3,$4,'NEW-1','2026-10-01',100)`, [ASKU, S_HAWASSA, AWASH, user.meron])).toMatch(/not available/);
      expect(await fails(c, "SELECT wf_submit($1)", [draft])).toMatch(/not available|inactive/);
      expect(await fails(c, "SELECT wf_schedule($1,$2::date)", [draft, day(5)])).toMatch(/not available|inactive/);
      expect(await fails(c, "SELECT record_execution($1,NULL,'TRX-1')", [unpaid])).toMatch(/is inactive, so no payment can be sent from it/);
      expect(await fails(c, "SELECT recurring_template_save(NULL,$1,'X','SUPPLIER',$2,$3,'TRANSFER',100,false,'MONTHLY',$4::date,NULL,0,'NORMAL',NULL)", [ASKU, S_HAWASSA, AWASH, day(3)])).toMatch(/inactive|not available/);
      expect(await fails(c, "SELECT record_balance_check($1,$2)", [AWASH, 1000000])).toMatch(/may not update the balance/);
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT wf_verify($1,$2)", [reserved, (await req(c, reserved)).version])).toMatch(/not available|inactive/);
      expect(await fails(c, "SELECT wf_adjust($1,$2,$3::jsonb,'more')", [reserved, (await req(c, reserved)).version, JSON.stringify({ total_amount: 1500, installments: [{ seq: 1, amount: 1500 }] })])).toMatch(/inactive|not available/);
      await actAs(c, user.kebede);
      expect(await fails(c, "SELECT wf_authorize($1,$2)", [verified, (await req(c, verified)).version])).toMatch(/not available|inactive/);
      expect(await account(c, AWASH)).toMatchObject({ cur: balance.cur, res: balance.res });

      // Cancelling releases the funds as it always does: a person's decision, not an automatic release.
      await actAs(c, user.meron); await fn(c, "wf_cancel", reserved2, (await req(c, reserved2)).version, "Account frozen");
      expect((await account(c, AWASH)).res).toBe(balance.res - 1000);

      await actAs(c, user.kebede); await reactivate(c, AWASH);
      expect([(await req(c, reserved)).s, (await req(c, verified)).s, (await req(c, unpaid)).s, (await req(c, draft)).s]).toEqual(["RESERVED", "VERIFIED", "AUTHENTICATED", "DRAFT"]);
      await actAs(c, user.dawit); await fn(c, "wf_verify", reserved, (await req(c, reserved)).version);
      await actAs(c, user.kebede); await fn(c, "wf_authorize", verified, (await req(c, verified)).version);
      await actAs(c, user.meron); await fn(c, "record_execution", unpaid, null, "TRX-1"); await fn(c, "wf_submit", draft);
      expect([(await req(c, reserved)).s, (await req(c, verified)).s, (await req(c, draft)).s]).toEqual(["VERIFIED", "AUTHENTICATED", "RESERVED"]);
    });
  });
});

describe("scheduled payments and recurring templates", () => {
  it("a scheduled request is not submitted while the account is inactive, nor automatically after it is reactivated", async () => {
    await tx(async (c) => {
      await clock(c, 0);
      const id = await reservedOn(c, AWASH, false); await actAs(c, user.meron); await fn(c, "wf_schedule", id, day(5));
      const res = (await account(c, AWASH)).res;
      await actAs(c, user.kebede); await deactivate(c, AWASH);
      await clock(c, 5);
      expect(Number(await fn(c, "release_scheduled_requests"))).toBe(0);
      expect(await req(c, id)).toMatchObject({ s: "SCHEDULED", schedule_error: "the debit account is not available: it is inactive, so it was not submitted" });
      expect((await rows(c, "SELECT count(*)::int n FROM notification_outbox WHERE request_id = $1 AND event_type = 'REQUEST_SCHEDULE_BLOCKED'", [id]))[0].n).toBe(1);

      await actAs(c, user.kebede); await reactivate(c, AWASH);
      expect(Number(await fn(c, "release_scheduled_requests"))).toBe(0);
      expect(await req(c, id)).toMatchObject({ s: "SCHEDULED", schedule_error: expect.stringMatching(/deactivated after this was scheduled/) });
      expect((await account(c, AWASH)).res).toBe(res);
      expect((await rows(c, "SELECT count(*)::int n FROM approval_events WHERE request_id = $1 AND action = 'SUBMIT'", [id]))[0].n).toBe(0);

      // Its creator decides again: scheduled anew after reactivation, it is released on its date.
      await actAs(c, user.meron); await fn(c, "wf_unschedule", id, (await req(c, id)).version); await fn(c, "wf_schedule", id, day(6));
      await clock(c, 6);
      expect(Number(await fn(c, "release_scheduled_requests"))).toBe(1);
      expect(await req(c, id)).toMatchObject({ s: "RESERVED", schedule_error: null });
    });
  });

  it("a scheduled request on an account that was never deactivated is released as before", async () => {
    await tx(async (c) => {
      await clock(c, 0);
      const id = await reservedOn(c, AWASH, false); await actAs(c, user.meron); await fn(c, "wf_schedule", id, day(2));
      await clock(c, 2);
      expect(Number(await fn(c, "release_scheduled_requests"))).toBe(1);
      expect((await req(c, id)).s).toBe("RESERVED");
    });
  });

  it("a recurring template creates nothing while the account is inactive, stays on, and afterwards only creates drafts", async () => {
    await tx(async (c) => {
      await clock(c, 0);
      await actAs(c, user.meron);
      const t = await fn(c, "recurring_template_save", null, ASKU, "Office rent", "SUPPLIER", S_HAWASSA, AWASH, "TRANSFER", 700, false, "MONTHLY", day(0), null, 5, "NORMAL", null);
      await actAs(c, user.kebede); await deactivate(c, AWASH);
      const res = (await account(c, AWASH)).res;
      expect(Number(await fn(c, "generate_recurring_requests"))).toBe(0);
      expect((await rows(c, "SELECT is_active, last_error, next_date::text nd FROM recurring_payment_templates WHERE id = $1", [t]))[0]).toEqual({ is_active: true, last_error: "the debit account is not available: it is inactive", nd: day(0) });
      await actAs(c, user.meron);
      expect(await fails(c, "SELECT recurring_template_set_active($1,true)", [t])).toMatch(/inactive/);

      await actAs(c, user.kebede); await reactivate(c, AWASH);
      expect(Number(await fn(c, "generate_recurring_requests"))).toBe(1);
      expect((await rows(c, "SELECT workflow_state::text s FROM payment_requests WHERE recurring_template_id = $1", [t])).map((r) => r.s)).toEqual(["DRAFT"]);
      expect((await account(c, AWASH)).res).toBe(res);
    });
  });
});

describe("a shared account", () => {
  it("only its owner deactivates it; every company's commitments stay, each sees its own, and every company's Finance Managers are told", async () => {
    await tx(async (c) => {
      await actAs(c, user.nardos);
      const berbero = await mk(c, user.nardos, { company: BERBERO, supplier: S_ETHIO, bank: BD_ETHIO, account: CBE, amounts: [2500] });
      await fn(c, "wf_submit", berbero);
      const asku = await reservedOn(c, CBE);
      const access = await rows(c, "SELECT id, company_id, permissions, revoked_at FROM company_bank_account_access WHERE account_id = $1 ORDER BY id", [CBE]);
      const before = await account(c, CBE);

      await actAs(c, user.abebe); await deactivate(c, CBE, "PERMANENTLY_CLOSED");
      expect(await account(c, CBE)).toMatchObject({ is_active: false, cur: before.cur, res: before.res });
      expect(await rows(c, "SELECT id, company_id, permissions, revoked_at FROM company_bank_account_access WHERE account_id = $1 ORDER BY id", [CBE])).toEqual(access);
      expect([(await req(c, berbero)).s, (await req(c, asku)).s]).toEqual(["RESERVED", "RESERVED"]);

      expect(await commitments(c, CBE)).toEqual(["REQUEST:RESERVED:ASKU PLC", "REQUEST:RESERVED:Berbero Petrochemical PLC"]);
      await actAs(c, user.nardos); expect(await commitments(c, CBE)).toEqual(["REQUEST:RESERVED:Berbero Petrochemical PLC"]);
      await actAs(c, user.meron); expect(await commitments(c, CBE)).toEqual(["REQUEST:RESERVED:ASKU PLC"]);
      await actAs(c, user.bereket); expect(await commitments(c, CBE)).toEqual([]);   // Daily Mart has no access to the account

      // Every sharer sees the status and why.
      for (const who of [user.nardos, user.meron]) {
        await actAs(c, who);
        expect((await rows(c, "SELECT action, reason FROM account_status_history($1)", [CBE]))).toEqual([{ action: "DEACTIVATED", reason: "PERMANENTLY_CLOSED" }]);
      }
      const ev = (await rows(c, "SELECT id FROM notification_outbox WHERE event_type = 'ACCOUNT_DEACTIVATED'"))[0];
      const to = (await rows(c, "SELECT email FROM outbox_recipients($1)", [ev.id])).map((r) => r.email.replace("@abig.test", ""));
      expect(to).toEqual(expect.arrayContaining(["abebe", "dawit", "fikru"]));
      expect(to).not.toContain("nardos");

      // Berbero cannot move its request forward on the inactive account, but can still take its money back.
      await actAs(c, user.fikru);
      expect(await fails(c, "SELECT wf_verify($1,$2)", [berbero, (await req(c, berbero)).version])).toMatch(/not available|inactive/);
      await actAs(c, user.nardos); await fn(c, "wf_cancel", berbero, (await req(c, berbero)).version, "Account closed");
      expect((await account(c, CBE)).res).toBe(before.res - 2500);
    });
  });
});

describe("the accounts screen", () => {
  it("shows the status, the reason and what needs attention, from the database's view for that person", async () => {
    await tx(async (c) => {
      await reservedOn(c);
      await actAs(c, user.kebede); await deactivate(c, AWASH, "OTHER", "Mandate expired");
      const a = (await accountList(tsx(c), null)).find((x) => x.id === AWASH)!;
      expect(a).toMatchObject({ is_active: false, deactivation_reason: "OTHER", deactivation_note: "Mandate expired", can_manage: true });
      expect(a.commitments.map((x) => [x.kind, x.state])).toEqual([["REQUEST", "RESERVED"]]);
      expect(a.statusHistory.map((h) => [h.action, h.reason, h.actor_name])).toEqual([["DEACTIVATED", "OTHER", "Kebede (ASKU owner)"]]);
      await actAs(c, user.samuel);   // BEES has no access to ASKU's own account: neither its commitments nor its status history
      expect(await commitments(c, AWASH)).toEqual([]);
      expect(await rows(c, "SELECT id FROM account_status_history($1)", [AWASH])).toEqual([]);
    });
  });

  it("the notifications say what happened and what it means", () => {
    const off = compose({ id: "1", event_type: "ACCOUNT_DEACTIVATED", request_id: null, payload: { account_label: "ASKU Awash current", reason: "The account is permanently closed", path: "/accounts" } }, "https://abig.test/");
    expect(off.subject).toBe("ASKU Awash current was deactivated");
    expect(off.text).toContain("Reason: The account is permanently closed");
    expect(off.text).toContain("nothing was cancelled or released");
    expect(off.text).toContain("https://abig.test/accounts");
    expect(notificationTitle({ event_type: "ACCOUNT_REACTIVATED", payload: { account_label: "ASKU Awash current" } })).toBe("ASKU Awash current was reactivated");
  });
});

// ---------- Races: real connections that commit, each on an account of its own ----------
describe("deactivation racing a payment operation", () => {
  const AMOUNT = 120000; let seq = 0;
  async function connect(who: string) {
    const c = new Client({ connectionString: appUrl }); await c.connect();
    return { c, begin: async () => { await c.query("BEGIN"); await c.query("SELECT set_config('app.user_id',$1,true)", [who]); } };
  }
  const attempt = async (who: string, sql: string, p: unknown[]) => {
    const { c, begin } = await connect(who);
    try { await begin(); await c.query(sql, p); await c.query("COMMIT"); return "done"; } catch (e) { await c.query("ROLLBACK"); return (e as Error).message; } finally { await c.end(); }
  };
  const must = async (who: string, sql: string, p: unknown[]) => expect(await attempt(who, sql, p)).toBe("done");
  async function freshAccount() {
    const { c, begin } = await connect(user.kebede); await begin();
    const id = (await c.query("SELECT register_bank_account($1,'CBE',$2,'1234',NULL,0) v", [ASKU, `Race ${++seq}`])).rows[0].v as string;
    await c.query("COMMIT"); await c.end();
    await must(user.meron, "SELECT record_opening_balance($1,$2)", [id, 500000]);
    return id;
  }
  async function draftOn(acct: string) {
    const { c, begin } = await connect(user.meron); await begin();
    const id = await mk(c, user.meron, { account: acct, amounts: [AMOUNT] }); await c.query("COMMIT"); await c.end(); return id;
  }
  const version = async (id: string) => (await rows(owner, "SELECT version FROM payment_requests WHERE id = $1", [id]))[0].version as number;
  const waiting = async () => {
    for (let i = 0; i < 100; i++) {
      const n = (await rows(owner, "SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()"))[0].n as number;
      if (n > 0) return n;
      await new Promise((r) => setTimeout(r, 50));
    }
    return 0;
  };
  async function raced(firstWho: string, first: string, firstArgs: unknown[], secondWho: string, second: string, secondArgs: unknown[], end: "COMMIT" | "ROLLBACK" = "COMMIT") {
    const a = await connect(firstWho);
    try {
      await a.begin(); await a.c.query(first, firstArgs);
      const later = attempt(secondWho, second, secondArgs);
      const blocked = await waiting();
      await a.c.query(end);
      return { blocked, second: await later };
    } finally { await a.c.end(); }
  }
  const DEACTIVATE = "SELECT deactivate_account($1,'PROVIDER_SUSPENDED',NULL)";
  const state = async (id: string) => (await rows(owner, "SELECT workflow_state::text s FROM payment_requests WHERE id = $1", [id]))[0].s as string;
  const facts = async (acct: string) => (await rows(owner, "SELECT is_active, current_balance::numeric::float8 cur, reserved_balance::numeric::float8 res FROM company_bank_accounts WHERE id = $1", [acct]))[0];

  it("a submission that holds the lock first commits; the deactivation waits, then succeeds and leaves the reservation in place", async () => {
    const acct = await freshAccount(), id = await draftOn(acct);
    const r = await raced(user.meron, "SELECT wf_submit($1)", [id], user.kebede, DEACTIVATE, [acct]);
    expect(r.blocked).toBeGreaterThan(0);
    expect(r.second).toBe("done");
    expect([await state(id), await facts(acct)]).toEqual(["RESERVED", { is_active: false, cur: 500000, res: AMOUNT }]);
    expect((await rows(owner, "SELECT open_items FROM account_status_events WHERE account_id = $1", [acct]))[0].open_items).toMatchObject({ reserved_count: 1, reserved_total: AMOUNT });
  });

  it("once a deactivation holds the lock, a submission waits and is then refused: nothing is reserved", async () => {
    const acct = await freshAccount(), id = await draftOn(acct);
    const r = await raced(user.kebede, DEACTIVATE, [acct], user.meron, "SELECT wf_submit($1)", [id]);
    expect(r.blocked).toBeGreaterThan(0);
    expect(r.second).toMatch(/is inactive, so it cannot take new payments/);
    expect([await state(id), await facts(acct)]).toEqual(["DRAFT", { is_active: false, cur: 500000, res: 0 }]);
  });

  it("a deactivation that rolls back lets the waiting submission through", async () => {
    const acct = await freshAccount(), id = await draftOn(acct);
    const r = await raced(user.kebede, DEACTIVATE, [acct], user.meron, "SELECT wf_submit($1)", [id], "ROLLBACK");
    expect(r.blocked).toBeGreaterThan(0);
    expect(r.second).toBe("done");
    expect([await state(id), await facts(acct)]).toEqual(["RESERVED", { is_active: true, cur: 500000, res: AMOUNT }]);
  });

  it("verification and authentication waiting on a deactivation are refused; the reservation and balance are untouched", async () => {
    const acct = await freshAccount(), toVerify = await draftOn(acct), toAuth = await draftOn(acct);
    await must(user.meron, "SELECT wf_submit($1)", [toVerify]); await must(user.meron, "SELECT wf_submit($1)", [toAuth]);
    await must(user.dawit, "SELECT wf_verify($1,$2)", [toAuth, await version(toAuth)]);
    const v = await raced(user.kebede, DEACTIVATE, [acct], user.dawit, "SELECT wf_verify($1,$2)", [toVerify, await version(toVerify)]);
    expect(v.blocked).toBeGreaterThan(0);
    expect(v.second).toMatch(/is inactive/);
    // Reactivate, then race the debit against a second deactivation.
    await must(user.kebede, "SELECT reactivate_account($1,true,NULL)", [acct]);
    const a = await raced(user.kebede, DEACTIVATE, [acct], user.kebede, "SELECT wf_authorize($1,$2)", [toAuth, await version(toAuth)]);
    expect(a.blocked).toBeGreaterThan(0);
    expect(a.second).toMatch(/is inactive/);
    expect([await state(toVerify), await state(toAuth), await facts(acct)]).toEqual(["RESERVED", "VERIFIED", { is_active: false, cur: 500000, res: 2 * AMOUNT }]);
    expect((await rows(owner, "SELECT count(*)::int n FROM bank_balance_history WHERE account_id = $1 AND request_id IS NOT NULL", [acct]))[0].n).toBe(0);
  });
});
