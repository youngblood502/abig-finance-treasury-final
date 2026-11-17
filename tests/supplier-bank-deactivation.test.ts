import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { actAs, ASKU, AWASH, BD_HAWASSA, BERBERO, CBE, enterFigure, fails, fn, mk, rows, S_HAWASSA, setupDb, urlFor, user } from "./helpers";
import { compose, type OutboxEvent } from "../src/lib/notification-text";
import { protectAccountNumber } from "../src/lib/account-numbers";

// Deactivating and reactivating a supplier's bank details (H3). Workflow paths run on the owner connection with actAs inside a transaction that is
// rolled back; privileges run as abig_app through `as`; the races use two connections and committed data of their own.
const DB = "abig_test_supplier_bank_deactivation";
let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];

async function tx<T>(f: (c: Client) => Promise<T>): Promise<T> {
  await owner.query("BEGIN");
  try { return await f(owner); } finally { await owner.query("ROLLBACK"); }
}
const state = async (c: Client, id: string) => (await rows(c, "SELECT workflow_state::text s, version v, supplier_bank_detail_id d, destination_review dr, verified_by FROM payment_requests WHERE id=$1", [id]))[0];
const detail = async (c: Client, id: string) => (await rows(c, "SELECT status, is_active, deactivated_by, deactivation_reason FROM supplier_bank_details WHERE id=$1", [id]))[0];
const balance = async (c: Client) => (await rows(c, "SELECT current_balance::text c, reserved_balance::text r FROM company_bank_accounts WHERE id=$1", [AWASH]))[0];
const deactivate = async (c: Client, who: string, d = BD_HAWASSA, reason = "The bank closed this account") => { await actAs(c, who); return fn(c, "supplier_bank_detail_deactivate", d, reason); };
const reactivate = async (c: Client, who: string, d = BD_HAWASSA, note = "The supplier confirmed the account is open again") => { await actAs(c, who); return fn(c, "supplier_bank_detail_reactivate", d, note); };
/** A draft paying Hawassa by transfer to its current details, created by Meron. */
const draft = async (c: Client, o: { bank?: string; method?: string } = {}) => { await actAs(c, user.meron); return mk(c, user.meron, { amounts: [1000], dues: ["2026-12-31"], bank: o.bank ?? BD_HAWASSA, method: o.method }); };
const submit = async (c: Client, id: string) => { await actAs(c, user.meron); return fn(c, "wf_submit", id) as Promise<number>; };
const verify = async (c: Client, id: string, v: number, who = user.dawit) => { await actAs(c, who); return fn(c, "wf_verify", id, v) as Promise<number>; };
const authorize = async (c: Client, id: string, v: number, who = user.kebede) => { await actAs(c, who); return fn(c, "wf_authorize", id, v) as Promise<number>; };
/** Requests in each open state, all naming BD_HAWASSA. */
async function everyState(c: Client) {
  const d = await draft(c);
  const r = await draft(c); const rv = await submit(c, r);
  const v = await draft(c); const vv = await verify(c, v, await submit(c, v));
  const a = await draft(c); await authorize(c, a, await verify(c, a, await submit(c, a)));
  return { draft: d, reserved: r, verified: v, authenticated: a, rv, vv };
}
/** New bank details for a supplier, entered by Meron and verified by Dawit; they supersede the current verified version. */
async function newVerifiedVersion(c: Client, supplier = S_HAWASSA) {
  await actAs(c, user.meron); const n = protectAccountNumber("9988 7766 5544");
  const id = await fn(c, "supplier_bank_detail_add", supplier, "Awash", n.last4, n.enc) as string;
  await actAs(c, user.dawit); await c.query("UPDATE supplier_bank_details SET status = 'VERIFIED' WHERE id = $1", [id]);
  return id;
}
const integrity = async (c: Client) => (await c.query(readFileSync(join(__dirname, "../ops/verify-integrity.sql"), "utf8").replace(/^\\set.*$/m, ""))).rows.filter((r) => Number(r.violations) > 0).map((r) => r.name);

beforeAll(async () => { const d = await setupDb(DB); owner = d.owner; as = d.as; });
afterAll(async () => { await owner?.end(); });

describe("who may deactivate or reactivate", () => {
  it("deactivating: anyone who manages the supplier or verifies its payments in a linked company; nobody else", async () => {
    for (const who of [user.meron, user.lidya, user.dawit, user.yared, user.admin]) {
      await tx(async (c) => { await deactivate(c, who); expect((await detail(c, BD_HAWASSA)).is_active).toBe(false); });
    }
    // An Owner holds neither permission; Berbero's people do not use Hawassa; nobody signed in is nobody.
    for (const who of [user.kebede, user.fikru, user.nardos, user.hana]) {
      await tx(async (c) => { await actAs(c, who); expect(await fails(c, "SELECT supplier_bank_detail_deactivate($1,$2)", [BD_HAWASSA, "Closed account"])).toMatch(/only someone who manages this supplier/); });
    }
    await tx(async (c) => { expect(await fails(c, "SELECT supplier_bank_detail_deactivate($1,$2)", [BD_HAWASSA, "Closed account"])).toMatch(/only someone who manages this supplier/); });
  });
  it("reactivating: a Finance Manager of a linked company only, and never the person who entered the details", async () => {
    // Accountants (Meron entered these details), Owners and other companies' Finance Managers are refused.
    for (const who of [user.meron, user.lidya, user.kebede, user.fikru]) {
      await tx(async (c) => {
        await deactivate(c, user.dawit); await actAs(c, who);
        expect(await fails(c, "SELECT supplier_bank_detail_reactivate($1,$2)", [BD_HAWASSA, "Open again"])).toMatch(/only a Finance Manager/);
        expect((await detail(c, BD_HAWASSA)).is_active).toBe(false);
      });
    }
    await tx(async (c) => {
      // Yared is an Accountant and a Finance Manager: having entered the details, he cannot reactivate them; another Finance Manager can, and pending
      // details come back pending.
      await actAs(c, user.yared); const n = protectAccountNumber("5555 4444 3333");
      const mine = await fn(c, "supplier_bank_detail_add", S_HAWASSA, "Dashen", n.last4, n.enc) as string;
      await deactivate(c, user.meron, mine);
      await actAs(c, user.yared); expect(await fails(c, "SELECT supplier_bank_detail_reactivate($1,$2)", [mine, "Open again"])).toMatch(/someone other than the person who entered them/);
      await reactivate(c, user.dawit, mine); expect((await detail(c, mine))).toMatchObject({ status: "PENDING", is_active: true });
    });
  });
  it("the application role cannot change the active status directly, whatever settings it tries", async () => {
    for (const who of [user.dawit, user.meron, user.admin]) {
      await as(who, async (c) => {
        expect(await fails(c, "UPDATE supplier_bank_details SET is_active = false WHERE id = $1", [BD_HAWASSA])).toMatch(/permission denied/);
        await c.query("SELECT set_config('app.bank_status', 'on', true)");
        expect(await fails(c, "UPDATE supplier_bank_details SET is_active = false, deactivated_by = $2, deactivated_at = now(), deactivation_reason = 'xyz' WHERE id = $1", [BD_HAWASSA, who])).toMatch(/permission denied/);
        expect(await fails(c, "INSERT INTO supplier_bank_detail_status_events (detail_id, supplier_id, action, reason, detail_status, actor_id) VALUES ($1,$2,'REACTIVATED','xyz','VERIFIED',$3)", [BD_HAWASSA, S_HAWASSA, who])).toMatch(/permission denied/);
      });
    }
    const f = ["supplier_bank_detail_deactivate(uuid,text)", "supplier_bank_detail_reactivate(uuid,text)", "wf_replace_destination(uuid,integer,uuid,text)", "wf_reverify_destination(uuid,integer)", "wf_reauthorize_destination(uuid,integer)"];
    for (const name of f) {
      expect((await rows(owner, `SELECT has_function_privilege('abig_app', $1, 'EXECUTE') app, has_function_privilege('abig_worker', $1, 'EXECUTE') worker, has_function_privilege('abig_auth', $1, 'EXECUTE') auth,
        EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid = to_regprocedure($1))) a WHERE a.grantee = 0) pub`, [name]))[0]).toEqual({ app: true, worker: false, auth: false, pub: false });
    }
    // Even the owner cannot change other columns while setting the status, nor the status outside the functions without the flag.
    await tx(async (c) => {
      await c.query("SELECT set_config('app.bank_status', 'on', true)");
      expect(await fails(c, "UPDATE supplier_bank_details SET bank_name = 'Other' WHERE id = $1", [BD_HAWASSA])).toMatch(/only the active status/);
    });
  });
});

describe("deactivating", () => {
  it("is soft: the row, its status and verification stay; the reason, the history and the audit are written; a reason is required", async () => {
    await tx(async (c) => {
      const before = (await rows(c, "SELECT id, supplier_id, version, bank_name, account_last4, account_number_enc, status, verified_by, verified_at, created_by FROM supplier_bank_details WHERE id=$1", [BD_HAWASSA]))[0];
      await actAs(c, user.dawit);
      for (const reason of ["", "  ", "ab", null]) expect(await fails(c, "SELECT supplier_bank_detail_deactivate($1,$2)", [BD_HAWASSA, reason])).toMatch(/explain why/);
      await deactivate(c, user.dawit, BD_HAWASSA, "  The bank   closed it ");
      expect((await rows(c, "SELECT id, supplier_id, version, bank_name, account_last4, account_number_enc, status, verified_by, verified_at, created_by FROM supplier_bank_details WHERE id=$1", [BD_HAWASSA]))[0]).toEqual(before);
      expect(await detail(c, BD_HAWASSA)).toEqual({ status: "VERIFIED", is_active: false, deactivated_by: user.dawit, deactivation_reason: "The bank closed it" });
      expect(await rows(c, "SELECT action, reason, detail_status, actor_id FROM supplier_bank_detail_status_events WHERE detail_id=$1", [BD_HAWASSA])).toEqual([{ action: "DEACTIVATED", reason: "The bank closed it", detail_status: "VERIFIED", actor_id: user.dawit }]);
      expect((await rows(c, "SELECT actor_id, entity_type, entity_id, metadata FROM audit_events WHERE action = 'SUPPLIER_BANK_DETAILS_DEACTIVATED'"))[0])
        .toMatchObject({ actor_id: user.dawit, entity_type: "SUPPLIER", entity_id: S_HAWASSA, metadata: { detail: BD_HAWASSA, reason: "The bank closed it", previous_active: true, new_active: false } });
      expect(await fails(c, "SELECT supplier_bank_detail_deactivate($1,$2)", [BD_HAWASSA, "Again please"])).toMatch(/already inactive/);
      expect(await fails(c, "DELETE FROM supplier_bank_details WHERE id = $1", [BD_HAWASSA])).toBeTruthy();
      expect(await integrity(c)).toEqual([]);
    });
  });
  it("changes no request in any state: no state, version, details, approval or reservation moves, and the open requests are counted", async () => {
    await tx(async (c) => {
      const ids = await everyState(c);
      const snap = async () => ({ requests: await rows(c, "SELECT id, workflow_state, version, supplier_bank_detail_id, verified_by, authenticated_by, total_amount FROM payment_requests WHERE id = ANY($1) ORDER BY id", [Object.values(ids).filter((x) => typeof x === "string")]),
        approvals: await rows(c, "SELECT count(*)::int n FROM approval_events"), balance: await balance(c) });
      const before = await snap();
      const counted = await deactivate(c, user.dawit);
      expect(await snap()).toEqual(before);
      expect(counted).toEqual({ DRAFT: 1, RESERVED: 1, VERIFIED: 1, AUTHENTICATED: 1 });
    });
  });
  it("tells the Finance Managers of the linked companies and the creators of the open requests that use them", async () => {
    await tx(async (c) => {
      await draft(c); await c.query("DELETE FROM notification_outbox");
      await deactivate(c, user.dawit);
      const ev = (await rows(c, "SELECT id, event_type, payload FROM notification_outbox"))[0];
      expect(ev).toMatchObject({ event_type: "SUPPLIER_BANK_DETAILS_DEACTIVATED", payload: { detail_id: BD_HAWASSA, reason: "The bank closed this account" } });
      const to = (await rows(c, "SELECT user_id FROM outbox_recipients($1)", [ev.id])).map((r) => r.user_id);
      expect(to).toEqual(expect.arrayContaining([user.dawit, user.yared, user.meron]));
      expect(to).not.toContain(user.kebede); expect(to).not.toContain(user.fikru);
    });
  });
});

describe("deactivated details cannot be used", () => {
  it("not for a new request: submitting or scheduling a draft naming them is refused", async () => {
    await tx(async (c) => {
      const d = await draft(c); await deactivate(c, user.dawit);
      await actAs(c, user.meron);
      expect(await fails(c, "SELECT wf_submit($1)", [d])).toMatch(/were deactivated/);
      expect(await fails(c, "SELECT wf_schedule($1, (now() + interval '3 days')::date)", [d])).toMatch(/were deactivated/);
      expect((await state(c, d)).s).toBe("DRAFT");
    });
  });
  it("not to go on: verification, authentication and recording how the payment was sent are refused; cancelling still works", async () => {
    await tx(async (c) => {
      const ids = await everyState(c); await deactivate(c, user.dawit);
      await actAs(c, user.dawit); expect(await fails(c, "SELECT wf_verify($1,$2)", [ids.reserved, ids.rv])).toMatch(/were deactivated/);
      await actAs(c, user.kebede); expect(await fails(c, "SELECT wf_authorize($1,$2)", [ids.verified, ids.vv])).toMatch(/were deactivated/);
      await actAs(c, user.meron); expect(await fails(c, "SELECT record_execution($1,NULL,'FT-1')", [ids.authenticated])).toMatch(/were deactivated; a Finance Manager must choose active details/);
      // Releasing money is never blocked.
      const before = await balance(c);
      await fn(c, "wf_cancel", ids.reserved, ids.rv, "Supplier account closed");
      expect(Number((await balance(c)).r)).toBe(Number(before.r) - 1000);
    });
  });
  it("cash and cheque never needed bank details, so a supplier paid by cheque is unaffected", async () => {
    await tx(async (c) => {
      await deactivate(c, user.dawit);
      const d = await draft(c, { method: "CHEQUE" }); await c.query("UPDATE payment_requests SET supplier_bank_detail_id = NULL WHERE id = $1", [d]);
      await authorize(c, d, await verify(c, d, await submit(c, d)));
      expect((await state(c, d)).s).toBe("AUTHENTICATED");
    });
  });
  it("pending details that were deactivated cannot be verified", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const n = protectAccountNumber("1212 3434 5656");
      const p = await fn(c, "supplier_bank_detail_add", S_HAWASSA, "Abyssinia", n.last4, n.enc) as string;
      await deactivate(c, user.meron, p);
      await actAs(c, user.dawit); expect(await fails(c, "UPDATE supplier_bank_details SET status = 'VERIFIED' WHERE id = $1", [p])).toMatch(/deactivated; reactivate them before verifying/);
      expect((await detail(c, BD_HAWASSA)).status).toBe("VERIFIED");   // the verified version was not superseded
    });
  });
});

describe("moving a request on to the supplier's active details", () => {
  it("reserved: a Finance Manager adjusts it; it stays reserved with its verification cleared and the change recorded", async () => {
    await tx(async (c) => {
      const ids = await everyState(c); await deactivate(c, user.dawit); const alt = await newVerifiedVersion(c);
      await actAs(c, user.dawit); const v = await fn(c, "wf_adjust", ids.reserved, ids.rv, JSON.stringify({ supplier_bank_detail_id: alt }), "Supplier's new account") as number;
      expect(await state(c, ids.reserved)).toMatchObject({ s: "RESERVED", d: alt });
      expect(await rows(c, "SELECT old_value, new_value, actor_id FROM adjustment_history WHERE request_id=$1 AND field='supplier_bank_detail_id'", [ids.reserved])).toEqual([{ old_value: BD_HAWASSA, new_value: alt, actor_id: user.dawit }]);
      await authorize(c, ids.reserved, await verify(c, ids.reserved, v, user.yared));
      expect((await state(c, ids.reserved)).s).toBe("AUTHENTICATED");
    });
  });
  it("verified: an Owner adjusts it and it goes back to verification, so it is verified and authorized again", async () => {
    await tx(async (c) => {
      const ids = await everyState(c); await deactivate(c, user.dawit); const alt = await newVerifiedVersion(c);
      await actAs(c, user.kebede); const v = await fn(c, "wf_adjust", ids.verified, ids.vv, JSON.stringify({ supplier_bank_detail_id: alt }), "Supplier's new account") as number;
      expect(await state(c, ids.verified)).toMatchObject({ s: "RESERVED", d: alt, verified_by: null });
      await actAs(c, user.kebede); expect(await fails(c, "SELECT wf_authorize($1,$2)", [ids.verified, v])).toMatch(/not waiting for authentication/);
      await authorize(c, ids.verified, await verify(c, ids.verified, v, user.yared));
    });
  });
  it("only to that supplier's active verified details: inactive, pending or another supplier's are refused", async () => {
    await tx(async (c) => {
      const ids = await everyState(c); await deactivate(c, user.dawit);
      await actAs(c, user.meron); const n = protectAccountNumber("7878 6565 4343");
      const pending = await fn(c, "supplier_bank_detail_add", S_HAWASSA, "Wegagen", n.last4, n.enc) as string;
      await actAs(c, user.dawit);
      for (const bad of [BD_HAWASSA, pending, "e0000000-0000-4000-8000-000000000002"]) {
        await c.query("SAVEPOINT s");
        expect(await fails(c, "SELECT wf_adjust($1,$2,$3::jsonb,$4)", [ids.reserved, ids.rv, JSON.stringify({ supplier_bank_detail_id: bad }), "Try other details"])).toBeTruthy();
        await c.query("ROLLBACK TO SAVEPOINT s");
      }
      expect((await state(c, ids.reserved)).d).toBe(BD_HAWASSA);
    });
  });
  it("draft: saving it with the supplier's active details lets the creator submit it", async () => {
    await tx(async (c) => {
      const d = await draft(c); await deactivate(c, user.dawit); const alt = await newVerifiedVersion(c);
      await actAs(c, user.meron); await c.query("UPDATE payment_requests SET supplier_bank_detail_id = $2 WHERE id = $1", [d, alt]);
      await submit(c, d); expect((await state(c, d)).s).toBe("RESERVED");
    });
  });
});

describe("an authenticated payment whose details were deactivated", () => {
  it("is held, moved on, re-verified and re-authorized, with the debit untouched and every step recorded", async () => {
    await tx(async (c) => {
      const ids = await everyState(c); await deactivate(c, user.dawit); const alt = await newVerifiedVersion(c);
      const debit = await balance(c); let v = (await state(c, ids.authenticated)).v;
      // The Accountant cannot choose new details; the creator and the Owner cannot either.
      for (const who of [user.meron, user.kebede, user.lidya]) {
        await actAs(c, who); expect(await fails(c, "SELECT wf_replace_destination($1,$2,$3,$4)", [ids.authenticated, v, alt, "New account"])).toMatch(/permission|creator/);
      }
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT wf_replace_destination($1,$2,$3,$4)", [ids.authenticated, v, alt, "ab"])).toMatch(/reason is required/);
      v = await fn(c, "wf_replace_destination", ids.authenticated, v, alt, "Supplier's new account") as number;
      expect(await state(c, ids.authenticated)).toMatchObject({ s: "AUTHENTICATED", d: alt, dr: "REVERIFY" });
      expect(await balance(c)).toEqual(debit);
      await actAs(c, user.meron); expect(await fails(c, "SELECT record_execution($1,NULL,'FT-2')", [ids.authenticated])).toMatch(/waiting to be verified/);
      // Re-verification: not the Finance Manager who chose them, not the creator, not an Owner.
      await actAs(c, user.dawit); expect(await fails(c, "SELECT wf_reverify_destination($1,$2)", [ids.authenticated, v])).toMatch(/another Finance Manager must verify/);
      await actAs(c, user.meron); expect(await fails(c, "SELECT wf_reverify_destination($1,$2)", [ids.authenticated, v])).toMatch(/permission|creator/);
      await actAs(c, user.kebede); expect(await fails(c, "SELECT wf_reverify_destination($1,$2)", [ids.authenticated, v])).toMatch(/permission|authentication stage/);
      await actAs(c, user.kebede); expect(await fails(c, "SELECT wf_reauthorize_destination($1,$2)", [ids.authenticated, v])).toMatch(/no verified new bank details/);
      await actAs(c, user.yared); v = await fn(c, "wf_reverify_destination", ids.authenticated, v) as number;
      expect((await state(c, ids.authenticated)).dr).toBe("REAUTHORIZE");
      await actAs(c, user.meron); expect(await fails(c, "SELECT record_execution($1,NULL,'FT-3')", [ids.authenticated])).toMatch(/waiting to be authorized/);
      // Re-authorization: an Owner who took no part in verifying (Yared verified; Dawit chose them and holds no authentication permission).
      await actAs(c, user.yared); expect(await fails(c, "SELECT wf_reauthorize_destination($1,$2)", [ids.authenticated, v])).toMatch(/verification stage/);
      await actAs(c, user.dawit); expect(await fails(c, "SELECT wf_reauthorize_destination($1,$2)", [ids.authenticated, v])).toMatch(/permission/);
      await actAs(c, user.kebede); v = await fn(c, "wf_reauthorize_destination", ids.authenticated, v) as number;
      expect(await state(c, ids.authenticated)).toMatchObject({ s: "AUTHENTICATED", d: alt, dr: null });
      await actAs(c, user.meron); await fn(c, "record_execution", ids.authenticated, null, "FT-4");
      expect(await balance(c)).toEqual(debit);
      // The original details stay in the history, with who did what.
      expect(await rows(c, "SELECT old_value, new_value, actor_id, workflow_stage FROM adjustment_history WHERE request_id=$1", [ids.authenticated])).toEqual([{ old_value: BD_HAWASSA, new_value: alt, actor_id: user.dawit, workflow_stage: "VERIFICATION" }]);
      expect((await rows(c, "SELECT action, stage, actor_id FROM approval_events WHERE request_id=$1 ORDER BY occurred_at", [ids.authenticated])).slice(-3))
        .toEqual([{ action: "ADJUST", stage: "VERIFICATION", actor_id: user.dawit }, { action: "VERIFY", stage: "VERIFICATION", actor_id: user.yared }, { action: "AUTHORIZE", stage: "AUTHORIZATION", actor_id: user.kebede }]);
      expect((await rows(c, "SELECT action FROM audit_events WHERE entity_id=$1 AND action LIKE 'PAYMENT_DESTINATION_%' ORDER BY occurred_at", [ids.authenticated])).map((r) => r.action))
        .toEqual(["PAYMENT_DESTINATION_REPLACED", "PAYMENT_DESTINATION_REVERIFIED", "PAYMENT_DESTINATION_REAUTHORIZED"]);
      expect(await integrity(c)).toEqual([]);
    });
  });
  it("is not moved when nothing needs replacing, to details that are not usable, or once the payment was recorded as sent", async () => {
    await tx(async (c) => {
      const ids = await everyState(c); let v = (await state(c, ids.authenticated)).v;
      await actAs(c, user.dawit); expect(await fails(c, "SELECT wf_replace_destination($1,$2,$3,$4)", [ids.authenticated, v, BD_HAWASSA, "No reason"])).toMatch(/still active and verified/);
      await deactivate(c, user.dawit);
      await actAs(c, user.dawit); expect(await fails(c, "SELECT wf_replace_destination($1,$2,$3,$4)", [ids.authenticated, v, BD_HAWASSA, "Same details"])).toMatch(/active verified bank details/);
      await actAs(c, user.dawit); expect(await fails(c, "SELECT wf_replace_destination($1,$2,$3,$4)", [ids.authenticated, v, "e0000000-0000-4000-8000-000000000002", "Other supplier"])).toMatch(/active verified bank details/);
      // A reserved request is adjusted, not replaced this way.
      await actAs(c, user.dawit); expect(await fails(c, "SELECT wf_replace_destination($1,$2,$3,$4)", [ids.reserved, ids.rv, BD_HAWASSA, "Wrong path"])).toMatch(/only an authenticated payment/);
    });
    await tx(async (c) => {
      const ids = await everyState(c);
      await actAs(c, user.meron); await fn(c, "record_execution", ids.authenticated, null, "FT-9");
      await deactivate(c, user.dawit); const alt = await newVerifiedVersion(c);
      const v = (await state(c, ids.authenticated)).v;
      await actAs(c, user.dawit); expect(await fails(c, "SELECT wf_replace_destination($1,$2,$3,$4)", [ids.authenticated, v, alt, "Too late"])).toMatch(/already sent/);
    });
  });
  it("a completed payment keeps its original details: paying and deactivating afterwards change nothing on it", async () => {
    await tx(async (c) => {
      const ids = await everyState(c);
      await c.query("SELECT wf_mark_paid($1, $2)", [ids.authenticated, user.admin]);
      const before = await state(c, ids.authenticated);
      await deactivate(c, user.dawit);
      expect(await state(c, ids.authenticated)).toEqual(before);
      expect(before).toMatchObject({ s: "PAID", d: BD_HAWASSA, dr: null });
      await actAs(c, user.dawit); expect(await fails(c, "SELECT wf_replace_destination($1,$2,$3,$4)", [ids.authenticated, before.v, BD_HAWASSA, "Paid already"])).toMatch(/only an authenticated payment/);
    });
  });
});

describe("reactivating", () => {
  it("restores the details with their status, records why, and lets requests use them again", async () => {
    await tx(async (c) => {
      const d = await draft(c); await deactivate(c, user.meron);
      await actAs(c, user.dawit);
      for (const note of ["", "ab", null]) expect(await fails(c, "SELECT supplier_bank_detail_reactivate($1,$2)", [BD_HAWASSA, note])).toMatch(/explain why/);
      await reactivate(c, user.dawit);
      expect(await detail(c, BD_HAWASSA)).toEqual({ status: "VERIFIED", is_active: true, deactivated_by: null, deactivation_reason: null });
      expect(await fails(c, "SELECT supplier_bank_detail_reactivate($1,$2)", [BD_HAWASSA, "Again please"])).toMatch(/already active/);
      expect((await rows(c, "SELECT action, actor_id FROM supplier_bank_detail_status_events WHERE detail_id=$1 ORDER BY occurred_at", [BD_HAWASSA]))).toEqual([{ action: "DEACTIVATED", actor_id: user.meron }, { action: "REACTIVATED", actor_id: user.dawit }]);
      expect((await rows(c, "SELECT metadata FROM audit_events WHERE action = 'SUPPLIER_BANK_DETAILS_REACTIVATED'"))[0].metadata).toMatchObject({ previous_reason: "The bank closed this account", previous_active: false, new_active: true });
      expect((await rows(c, "SELECT version, action, actor_name FROM supplier_bank_detail_history($1)", [S_HAWASSA])).map((r) => r.action)).toEqual(["REACTIVATED", "DEACTIVATED"]);
      await submit(c, d); expect((await state(c, d)).s).toBe("RESERVED");
      expect(await integrity(c)).toEqual([]);
    });
  });
  it("is refused once newer details were verified: they superseded these", async () => {
    await tx(async (c) => {
      await deactivate(c, user.dawit); await newVerifiedVersion(c);
      expect(await detail(c, BD_HAWASSA)).toMatchObject({ status: "SUPERSEDED", is_active: false });
      await actAs(c, user.yared); expect(await fails(c, "SELECT supplier_bank_detail_reactivate($1,$2)", [BD_HAWASSA, "Open again"])).toMatch(/newer bank details have been verified/);
    });
  });
});

describe("deactivation at the same moment as a payment step", () => {
  /** A supplier of its own with verified details and an authenticated and a reserved request, all committed, so two connections see them. */
  async function committed() {
    await owner.query("BEGIN");
    await actAs(owner, user.meron);
    const supplier = (await rows(owner, "INSERT INTO suppliers (legal_name, created_by) VALUES ($1,$2) RETURNING id", [`Race ${Date.now()} ${Math.random()}`, user.meron]))[0].id as string;
    await owner.query("INSERT INTO company_suppliers (company_id, supplier_id, created_by) VALUES ($1,$2,$3)", [ASKU, supplier, user.meron]);
    const bd = await newVerifiedVersion(owner, supplier);
    await actAs(owner, user.meron);
    const a = await mk(owner, user.meron, { amounts: [100], supplier, bank: bd }); await authorize(owner, a, await verify(owner, a, await submit(owner, a)));
    const r = await mk(owner, user.meron, { amounts: [100], supplier, bank: bd }); const rv = await submit(owner, r);
    await owner.query("COMMIT");
    return { bd, a, r, rv };
  }
  it("a verification waiting on a deactivation that commits is refused", async () => {
    const { bd, r, rv } = await committed();
    const other = new Client({ connectionString: urlFor(DB) }); await other.connect();
    try {
      await other.query("BEGIN"); await deactivate(other, user.meron, bd);
      await owner.query("BEGIN"); await actAs(owner, user.dawit);
      const verifying = owner.query("SELECT wf_verify($1,$2)", [r, rv]).then(() => "verified", (e) => String(e.message));
      await new Promise((res) => setTimeout(res, 300));
      await other.query("COMMIT");
      expect(await verifying).toMatch(/were deactivated/);
    } finally { await owner.query("ROLLBACK").catch(() => {}); await other.query("ROLLBACK").catch(() => {}); await other.end(); }
  }, 30_000);
  it("recording how a payment was sent: one waits for the other, and never goes through against inactive details", async () => {
    const { bd, a } = await committed();
    const other = new Client({ connectionString: urlFor(DB) }); await other.connect();
    try {
      // Deactivation first: the record waits, then is refused.
      await other.query("BEGIN"); await deactivate(other, user.dawit, bd);
      await owner.query("BEGIN"); await actAs(owner, user.meron);
      const recording = owner.query("SELECT record_execution($1,NULL,'FT-RACE')", [a]).then(() => "recorded", (e) => String(e.message));
      await new Promise((res) => setTimeout(res, 300));
      await other.query("COMMIT");
      expect(await recording).toMatch(/were deactivated; a Finance Manager must choose active details/);
      await owner.query("ROLLBACK");
      expect((await rows(owner, "SELECT bank_reference FROM payment_requests WHERE id=$1", [a]))[0].bank_reference).toBeNull();
    } finally { await owner.query("ROLLBACK").catch(() => {}); await other.query("ROLLBACK").catch(() => {}); await other.end(); }
    // The record first: the deactivation waits until the payment is recorded, then goes ahead; the payment keeps its details.
    const second = await committed();
    const o2 = new Client({ connectionString: urlFor(DB) }); await o2.connect();
    try {
      await owner.query("BEGIN"); await actAs(owner, user.meron); await fn(owner, "record_execution", second.a, null, "FT-FIRST");
      await o2.query("BEGIN");
      const deactivating = deactivate(o2, user.dawit, second.bd).then(() => "deactivated", (e) => String(e.message));
      await new Promise((res) => setTimeout(res, 300));
      await owner.query("COMMIT");
      expect(await deactivating).toBe("deactivated");
      await o2.query("COMMIT");
      expect(await state(owner, second.a)).toMatchObject({ s: "AUTHENTICATED", d: second.bd });
      expect((await rows(owner, "SELECT bank_reference FROM payment_requests WHERE id=$1", [second.a]))[0].bank_reference).toBe("FT-FIRST");
    } finally { await owner.query("ROLLBACK").catch(() => {}); await o2.query("ROLLBACK").catch(() => {}); await o2.end(); }
  }, 30_000);
});

describe("review fixes", () => {
  /** An authenticated request on BD_HAWASSA, with its version. */
  const authenticatedRequest = async (c: Client) => { const ids = await everyState(c); return { id: ids.authenticated, v: (await state(c, ids.authenticated)).v as number, ids }; };
  /** Hawassa also used by Berbero (Nardos enters, Fikru verifies). */
  const shareWithBerbero = (c: Client) => c.query("INSERT INTO company_suppliers (company_id, supplier_id, created_by) VALUES ($1,$2,$3)", [BERBERO, S_HAWASSA, user.nardos]);
  const recipients = async (c: Client, type: string) => {
    const ev = (await rows(c, "SELECT id, payload FROM notification_outbox WHERE event_type = $1 ORDER BY created_at DESC LIMIT 1", [type]))[0];
    return { payload: ev.payload, to: (await rows(c, "SELECT user_id FROM outbox_recipients($1)", [ev.id])).map((r) => r.user_id as string) };
  };

  it("H-1: a payment the bank already processed keeps its destination; recording how it was sent stays possible", async () => {
    await tx(async (c) => {
      const { id } = await authenticatedRequest(c);
      await actAs(c, user.meron); const sys = Number((await balance(c)).c); await enterFigure(c, AWASH, sys, [id]);
      expect((await rows(c, "SELECT bank_processed_at IS NOT NULL AS done FROM payment_requests WHERE id=$1", [id]))[0].done).toBe(true);
      await deactivate(c, user.dawit); const alt = await newVerifiedVersion(c);
      const v = (await state(c, id)).v;
      await actAs(c, user.dawit); expect(await fails(c, "SELECT wf_replace_destination($1,$2,$3,$4)", [id, v, alt, "Bank processed it"])).toMatch(/already sent \(its execution is recorded or the bank processed it\)/);
      expect((await state(c, id)).d).toBe(BD_HAWASSA);
      // It went out before or regardless of the deactivation: its reference can still be written down.
      await actAs(c, user.meron); await fn(c, "record_execution", id, null, "FT-PROCESSED");
    });
  });
  it("M-1: superseded but still active details do not block recording; deactivated ones block a first record", async () => {
    await tx(async (c) => {
      const { id } = await authenticatedRequest(c);
      await newVerifiedVersion(c);
      expect(await detail(c, BD_HAWASSA)).toMatchObject({ status: "SUPERSEDED", is_active: true });
      await actAs(c, user.meron); await fn(c, "record_execution", id, null, "FT-SUPERSEDED");
      expect((await rows(c, "SELECT bank_reference FROM payment_requests WHERE id=$1", [id]))[0].bank_reference).toBe("FT-SUPERSEDED");
    });
    await tx(async (c) => {
      const { id } = await authenticatedRequest(c);
      await newVerifiedVersion(c); await deactivate(c, user.dawit);
      expect(await detail(c, BD_HAWASSA)).toMatchObject({ status: "SUPERSEDED", is_active: false });
      await actAs(c, user.meron); expect(await fails(c, "SELECT record_execution($1,NULL,'FT-X')", [id])).toMatch(/were deactivated/);
    });
  });
  it("L-1: a recorded payment's reference can be corrected after deactivation, but not removed", async () => {
    await tx(async (c) => {
      const { id } = await authenticatedRequest(c);
      await actAs(c, user.meron); await fn(c, "record_execution", id, null, "FT-TYPO");
      await deactivate(c, user.dawit);
      await actAs(c, user.meron); await fn(c, "record_execution", id, null, "FT-FIXED");
      expect((await rows(c, "SELECT bank_reference FROM payment_requests WHERE id=$1", [id]))[0].bank_reference).toBe("FT-FIXED");
      expect(await fails(c, "SELECT record_execution($1,NULL,NULL)", [id])).toMatch(/corrected, not removed/);
    });
  });
  it("M-2: a company whose link to the supplier is inactive gives no right to deactivate or reactivate; an active link does", async () => {
    await tx(async (c) => {
      await shareWithBerbero(c); await deactivate(c, user.dawit);
      await c.query("UPDATE company_suppliers SET status = 'INACTIVE' WHERE company_id = $1 AND supplier_id = $2", [ASKU, S_HAWASSA]);
      await actAs(c, user.dawit); expect(await fails(c, "SELECT supplier_bank_detail_reactivate($1,$2)", [BD_HAWASSA, "Open again"])).toMatch(/only a Finance Manager/);
      await reactivate(c, user.fikru);   // Berbero still uses Hawassa
      expect((await detail(c, BD_HAWASSA)).is_active).toBe(true);
      await actAs(c, user.meron); expect(await fails(c, "SELECT supplier_bank_detail_deactivate($1,$2)", [BD_HAWASSA, "Closed account"])).toMatch(/only someone who manages this supplier/);
      await c.query("UPDATE company_suppliers SET status = 'BLOCKED' WHERE company_id = $1 AND supplier_id = $2", [BERBERO, S_HAWASSA]);
      await actAs(c, user.fikru); expect(await fails(c, "SELECT supplier_bank_detail_deactivate($1,$2)", [BD_HAWASSA, "Closed account"])).toMatch(/only someone who manages this supplier/);
    });
  });
  it("shared supplier: every actively linked company's Finance Managers and every open request's creator are told, without any account number", async () => {
    await tx(async (c) => {
      await shareWithBerbero(c);
      await actAs(c, user.nardos); await mk(c, user.nardos, { company: BERBERO, supplier: S_HAWASSA, bank: BD_HAWASSA, account: CBE, amounts: [500], dues: ["2026-12-31"] });
      await draft(c);
      await deactivate(c, user.dawit);
      const d = await recipients(c, "SUPPLIER_BANK_DETAILS_DEACTIVATED");
      expect(d.to).toEqual(expect.arrayContaining([user.dawit, user.yared, user.fikru, user.nardos, user.meron]));
      expect(d.to).not.toContain(user.kebede); expect(d.to).not.toContain(user.hana);
      expect(JSON.stringify(d.payload)).not.toMatch(/2210|account_number|last4|v1:/);
      // An inactive link no longer brings its Finance Managers in; the creators of open requests still are.
      await c.query("UPDATE company_suppliers SET status = 'INACTIVE' WHERE company_id = $1 AND supplier_id = $2", [ASKU, S_HAWASSA]);
      await reactivate(c, user.fikru);
      const r = await recipients(c, "SUPPLIER_BANK_DETAILS_REACTIVATED");
      expect(r.to).toEqual(expect.arrayContaining([user.fikru, user.nardos, user.meron]));
      expect(r.to).not.toContain(user.dawit);
      expect(JSON.stringify(r.payload)).not.toMatch(/2210|account_number|last4|v1:/);
    });
  });
  it("reactivation notice: the Finance Managers of the linked companies and the creators of open requests", async () => {
    await tx(async (c) => {
      await draft(c); await deactivate(c, user.meron); await reactivate(c, user.dawit);
      const r = await recipients(c, "SUPPLIER_BANK_DETAILS_REACTIVATED");
      expect(r.payload).toMatchObject({ detail_id: BD_HAWASSA, reason: "The supplier confirmed the account is open again" });
      expect(r.to).toEqual(expect.arrayContaining([user.dawit, user.yared, user.meron]));
      expect(r.to).not.toContain(user.kebede);
    });
  });
  it("a stale version is refused when replacing the destination or re-verifying it", async () => {
    await tx(async (c) => {
      const { id, v } = await authenticatedRequest(c); await deactivate(c, user.dawit); const alt = await newVerifiedVersion(c);
      await actAs(c, user.dawit); expect(await fails(c, "SELECT wf_replace_destination($1,$2,$3,$4)", [id, v - 1, alt, "Old screen"])).toMatch(/request changed/);
      const nv = await fn(c, "wf_replace_destination", id, v, alt, "Current screen") as number;
      await actAs(c, user.yared); expect(await fails(c, "SELECT wf_reverify_destination($1,$2)", [id, nv - 1])).toMatch(/request changed/);
    });
  });
  it("System Administrator and separation of duties: the admin may replace; the request's own verifier may re-verify; an Accountant may not", async () => {
    await tx(async (c) => {
      const { id, v } = await authenticatedRequest(c); await deactivate(c, user.dawit); const alt = await newVerifiedVersion(c);
      await actAs(c, user.admin); let nv = await fn(c, "wf_replace_destination", id, v, alt, "Admin chose the new account") as number;
      expect((await rows(c, "SELECT actor_role FROM approval_events WHERE request_id=$1 ORDER BY occurred_at DESC LIMIT 1", [id]))[0].actor_role).toBe("ADMIN");
      await actAs(c, user.admin); expect(await fails(c, "SELECT wf_reverify_destination($1,$2)", [id, nv])).toMatch(/another Finance Manager must verify/);
      await actAs(c, user.lidya); expect(await fails(c, "SELECT wf_reverify_destination($1,$2)", [id, nv])).toMatch(/permission/);
      // Dawit verified the request originally; he did not choose the new details, so he may re-verify them. Then neither he nor the admin may authorize.
      await actAs(c, user.dawit); nv = await fn(c, "wf_reverify_destination", id, nv) as number;
      await actAs(c, user.admin); expect(await fails(c, "SELECT wf_reauthorize_destination($1,$2)", [id, nv])).toMatch(/verification stage/);
      await actAs(c, user.lidya); expect(await fails(c, "SELECT wf_reauthorize_destination($1,$2)", [id, nv])).toMatch(/permission/);
      await actAs(c, user.kebede); await fn(c, "wf_reauthorize_destination", id, nv);
      expect((await state(c, id)).dr).toBeNull();
    });
    await tx(async (c) => {
      await deactivate(c, user.dawit); await reactivate(c, user.admin);   // the admin never entered these details
      expect((await detail(c, BD_HAWASSA)).is_active).toBe(true);
    });
  });
  it("L-4: re-authorization tells Treasury and the creator, without saying the amount was just deducted", async () => {
    await tx(async (c) => {
      const { id, v } = await authenticatedRequest(c); await deactivate(c, user.dawit); const alt = await newVerifiedVersion(c);
      await actAs(c, user.dawit); let nv = await fn(c, "wf_replace_destination", id, v, alt, "Supplier's new account") as number;
      await actAs(c, user.yared); nv = await fn(c, "wf_reverify_destination", id, nv) as number;
      await c.query("DELETE FROM notification_outbox");
      await actAs(c, user.kebede); await fn(c, "wf_reauthorize_destination", id, nv);
      const ev = (await rows(c, "SELECT id, event_type, request_id, payload FROM notification_outbox"))[0];
      expect(ev).toMatchObject({ event_type: "REQUEST_AUTHORIZED", payload: { destination_changed: true } });
      const to = (await rows(c, "SELECT user_id FROM outbox_recipients($1)", [ev.id])).map((r) => r.user_id);
      const treasury = (await rows(c, "SELECT x FROM company_role_users($1, 'TREASURY') x", [ASKU])).map((r) => r.x);
      expect(treasury.length).toBeGreaterThan(0);
      expect(to).toEqual(expect.arrayContaining([user.meron, ...treasury]));
      const mail = compose(ev as OutboxEvent, "https://x.test");
      expect(mail.subject).toMatch(/new supplier bank details are authorized/); expect(mail.text).not.toMatch(/now deducted/);
    });
  });
  it("L-3: a held payment marked paid by reconciliation keeps no hold, and the audit says why", async () => {
    await tx(async (c) => {
      const { id, v } = await authenticatedRequest(c); await deactivate(c, user.dawit); const alt = await newVerifiedVersion(c);
      await actAs(c, user.dawit); await fn(c, "wf_replace_destination", id, v, alt, "Supplier's new account");
      expect((await state(c, id)).dr).toBe("REVERIFY");
      await c.query("SELECT wf_mark_paid($1, $2)", [id, user.admin]);
      expect(await state(c, id)).toMatchObject({ s: "PAID", dr: null, d: alt });
      expect((await rows(c, "SELECT metadata FROM audit_events WHERE entity_id=$1 AND action = 'PAYMENT_DESTINATION_REVIEW_ENDED'", [id]))[0].metadata).toMatchObject({ review: "REVERIFY", reason: "marked paid by reconciliation" });
      // wf_mark_paid is called directly here, without a locked reconciliation week, which the integrity check rightly reports; nothing else may be.
      expect((await integrity(c)).filter((n) => n !== "paid payment without a matched line in a locked week")).toEqual([]);
    });
  });
});
