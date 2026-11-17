import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { actAs, ASKU, AWASH, BD_HAWASSA, CBE, enterFigure, fails, fn, rows, S_ADDIS, S_HAWASSA, setupDb, user } from "./helpers";
import { protectAccountNumber } from "../src/lib/account-numbers";
import { decryptSecret } from "../src/lib/crypto";
import { protectIdNumber } from "../src/lib/payees";

// One-time payees, registered suppliers without bank details, and optional phone numbers.
// Workflow paths run on the owner connection with actAs (the SQL functions check who is acting); visibility and grants run as abig_app through `as`.

let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
let cash: string;
const NUMBER = "1000 2233 4455";

async function tx<T>(f: (c: Client) => Promise<T>): Promise<T> {
  await owner.query("BEGIN");
  try { return await f(owner); } finally { await owner.query("ROLLBACK"); }
}
const count = async (c: Client, sql: string, p: unknown[] = []) => Number((await rows(c, sql, p))[0].n);
const balance = async (c: Client, id: string) => { const r = (await rows(c, "SELECT current_balance c, reserved_balance r FROM company_bank_accounts WHERE id=$1", [id]))[0]; return { current: Number(r.c), reserved: Number(r.r) }; };
const state = async (c: Client, id: string) => (await rows(c, "SELECT workflow_state::text s, version v FROM payment_requests WHERE id=$1", [id]))[0] as { s: string; v: number };

interface OneTime { name?: string; phone?: string | null; bank?: string | null; number?: string | null; method?: string; account?: string; amount?: number; company?: string; creator?: string }
/** Enters a one-time payee and a draft request that pays it, as `creator` (default Meron). */
async function oneTimeDraft(c: Client, o: OneTime = {}) {
  const creator = o.creator ?? user.meron, company = o.company ?? ASKU, amount = o.amount ?? 1000;
  await actAs(c, creator);
  const n = o.number === null ? null : protectAccountNumber(o.number ?? NUMBER);
  const bank = o.bank === undefined ? "CBE" : o.bank;
  const payee = await fn(c, "one_time_payee_create", company, o.name ?? "Tesfaye Girma", o.phone === undefined ? "0912 345 678" : o.phone, bank, bank ? n?.last4 ?? null : null, bank ? n?.enc ?? null : null) as string;
  const id = (await rows(c, `INSERT INTO payment_requests (debtor_company_id, payee_type, one_time_payee_id, debit_account_id, created_by, total_amount, payment_method)
    VALUES ($1,'ONE_TIME',$2,$3,$4,$5,$6::payment_method) RETURNING id`, [company, payee, o.account ?? AWASH, creator, amount, o.method ?? "TRANSFER"]))[0].id as string;
  await c.query("INSERT INTO payment_installments (request_id, seq, due_date, amount) VALUES ($1,1,'2026-12-01',$2)", [id, amount]);
  return { id, payee };
}
/** A supplier with no bank details at all, linked to ASKU, entered by Meron. */
async function bareSupplier(c: Client, name = "Kality Stationery") {
  await actAs(c, user.meron);
  const id = (await rows(c, "INSERT INTO suppliers (legal_name, created_by) VALUES ($1,$2) RETURNING id", [name, user.meron]))[0].id as string;
  await c.query("INSERT INTO company_suppliers (company_id, supplier_id, created_by) VALUES ($1,$2,$3)", [ASKU, id, user.meron]);
  return id;
}
async function supplierDraft(c: Client, supplier: string, o: { method: string; account: string; bank?: string | null }) {
  await actAs(c, user.meron);
  const id = (await rows(c, `INSERT INTO payment_requests (debtor_company_id, supplier_id, supplier_bank_detail_id, debit_account_id, created_by, total_amount, payment_method)
    VALUES ($1,$2,$3,$4,$5,1000,$6::payment_method) RETURNING id`, [ASKU, supplier, o.bank ?? null, o.account, user.meron, o.method]))[0].id as string;
  await c.query("INSERT INTO payment_installments (request_id, seq, due_date, amount) VALUES ($1,1,'2026-12-01',1000)", [id]);
  return id;
}
/** Submit (Meron), verify (Dawit), authenticate (Kebede). */
async function approve(c: Client, id: string) {
  await actAs(c, user.meron); const v1 = await fn(c, "wf_submit", id);
  await actAs(c, user.dawit); const v2 = await fn(c, "wf_verify", id, v1);
  await actAs(c, user.kebede); return fn(c, "wf_authorize", id, v2);
}

beforeAll(async () => {
  const d = await setupDb("abig_test_one_time"); owner = d.owner; as = d.as;
  await owner.query("BEGIN");
  await actAs(owner, user.kebede); cash = await fn(owner, "register_cash_account", ASKU, "ASKU petty cash", 0);
  await actAs(owner, user.meron); await enterFigure(owner, cash, 300000);
  await owner.query("COMMIT");
});
afterAll(async () => { await owner?.end(); });

describe("registered payees keep working", () => {
  it("a registered supplier with verified bank details is paid by transfer as before", async () => {
    await tx(async (c) => {
      const id = await supplierDraft(c, S_HAWASSA, { method: "TRANSFER", account: AWASH, bank: BD_HAWASSA });
      await approve(c, id);
      expect((await state(c, id)).s).toBe("AUTHENTICATED");
      expect((await rows(c, "SELECT payee_type::text t, one_time_payee_id FROM payment_requests WHERE id=$1", [id]))[0]).toEqual({ t: "SUPPLIER", one_time_payee_id: null });
    });
  });
  it("a registered person is paid by cash as before", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron);
      const pid = protectIdNumber("ET-77 88 99", ASKU);
      const person = await fn(c, "person_payee_create", ASKU, "Almaz Bekele", "0911 234 567", pid.enc, pid.last4, pid.hash, "CASH");
      const id = (await rows(c, "INSERT INTO payment_requests (debtor_company_id, payee_type, person_payee_id, debit_account_id, created_by, total_amount, payment_method) VALUES ($1,'PERSON',$2,$3,$4,500,'CASH') RETURNING id", [ASKU, person, cash, user.meron]))[0].id;
      await c.query("INSERT INTO payment_installments (request_id, seq, due_date, amount) VALUES ($1,1,'2026-12-01',500)", [id]);
      await approve(c, id);
      expect((await state(c, id)).s).toBe("AUTHENTICATED");
    });
  });
});

describe("one-time payees", () => {
  it("a one-time cash payment goes through the normal workflow and creates no supplier or person", async () => {
    await tx(async (c) => {
      const before = { suppliers: await count(c, "SELECT count(*) n FROM suppliers"), people: await count(c, "SELECT count(*) n FROM person_payees"), links: await count(c, "SELECT count(*) n FROM company_suppliers") };
      const cashBefore = await balance(c, cash);
      const { id } = await oneTimeDraft(c, { method: "CASH", account: cash, bank: null, number: null, phone: null });
      await actAs(c, user.meron); const v1 = await fn(c, "wf_submit", id);
      expect(await balance(c, cash)).toEqual({ current: cashBefore.current, reserved: cashBefore.reserved + 1000 });   // reserved exactly as any request
      await actAs(c, user.dawit); const v2 = await fn(c, "wf_verify", id, v1);
      await actAs(c, user.kebede); await fn(c, "wf_authorize", id, v2);
      expect((await state(c, id)).s).toBe("AUTHENTICATED");
      expect(await balance(c, cash)).toEqual({ current: cashBefore.current - 1000, reserved: cashBefore.reserved });
      expect(await count(c, "SELECT count(*) n FROM suppliers")).toBe(before.suppliers);
      expect(await count(c, "SELECT count(*) n FROM person_payees")).toBe(before.people);
      expect(await count(c, "SELECT count(*) n FROM company_suppliers")).toBe(before.links);
      expect((await rows(c, "SELECT payee_type::text t, supplier_id, person_payee_id FROM payment_requests WHERE id=$1", [id]))[0]).toEqual({ t: "ONE_TIME", supplier_id: null, person_payee_id: null });
    });
  });
  it("a missing or blank payee name is refused", async () => {
    await as(user.meron, async (c) => {
      for (const name of ["", "   ", null]) expect(await fails(c, "SELECT one_time_payee_create($1,$2,NULL,NULL,NULL,NULL)", [ASKU, name])).toMatch(/payee name is required/);
      // Nor can the details be written directly, or a one-time request be saved without them.
      expect(await fails(c, "INSERT INTO one_time_payees (company_id, full_name, created_by) VALUES ($1,'X',$2)", [ASKU, user.meron])).toMatch(/permission denied/);
      expect(await fails(c, "INSERT INTO payment_requests (debtor_company_id, payee_type, debit_account_id, created_by, total_amount) VALUES ($1,'ONE_TIME',$2,$3,10)", [ASKU, AWASH, user.meron])).toMatch(/row-level security|payee_chk/);
    });
  });
  it("bank details entered on the request are stored encrypted, masked in lists, and revealed only to those who handle it, with an audit entry", async () => {
    await tx(async (c) => {
      const { id, payee } = await oneTimeDraft(c, { bank: "Dashen", number: NUMBER });
      const row = (await rows(c, "SELECT bank_name, account_last4, account_number_enc FROM one_time_payees WHERE id=$1", [payee]))[0];
      expect(row.bank_name).toBe("Dashen"); expect(row.account_last4).toBe("4455");
      expect(row.account_number_enc).toMatch(/^v1:/); expect(row.account_number_enc).not.toContain("4455");
      await actAs(c, user.meron); await fn(c, "wf_submit", id);
    });
    // The same through the application role: the encrypted column cannot be read, and reveal is limited to creator, Verifier and Authorizer.
    await as(user.meron, async (c) => {
      const { id, payee } = await oneTimeDraft(c, { bank: "Dashen", number: NUMBER });
      expect(await fails(c, "SELECT account_number_enc FROM one_time_payees")).toMatch(/permission denied/);
      expect((await rows(c, "SELECT account_last4 FROM one_time_payees WHERE id=$1", [payee]))[0].account_last4).toBe("4455");
      expect(decryptSecret(await fn(c, "reveal_one_time_account", payee))).toBe("100022334455");     // the creator
      await fn(c, "wf_submit", id);
      await actAs(c, user.dawit);
      expect(await fn(c, "one_time_account_state", payee)).toBe("RECORDED");
      expect(decryptSecret(await fn(c, "reveal_one_time_account", payee))).toBe("100022334455");     // the Verifier
      await actAs(c, user.lidya);                                                                    // another Accountant: sees the request, not the number
      expect(await fn(c, "one_time_account_state", payee)).toBe("MASKED");
      expect(await fn(c, "reveal_one_time_account", payee)).toBeNull();
      await actAs(c, user.selam);                                                                    // group reporting: not even the payee
      expect(await rows(c, "SELECT 1 FROM one_time_payees WHERE id=$1", [payee])).toHaveLength(0);
      expect(await fn(c, "reveal_one_time_account", payee)).toBeNull();
      await actAs(c, user.bereket);                                                                  // another company
      expect(await rows(c, "SELECT 1 FROM one_time_payees WHERE id=$1", [payee])).toHaveLength(0);
    });
    await tx(async (c) => {
      const { id, payee } = await oneTimeDraft(c);
      await actAs(c, user.meron); await fn(c, "wf_submit", id);
      await actAs(c, user.dawit); await fn(c, "reveal_one_time_account", payee);
      expect(await rows(c, "SELECT actor_id FROM audit_events WHERE action = 'ONE_TIME_ACCOUNT_NUMBER_VIEWED' AND entity_id = $1", [payee])).toEqual([{ actor_id: user.dawit }]);
    });
  });
  it("bank details are all or nothing", async () => {
    await as(user.meron, async (c) => {
      const n = protectAccountNumber(NUMBER);
      expect(await fails(c, "SELECT one_time_payee_create($1,'A',NULL,'CBE',NULL,NULL)", [ASKU])).toMatch(/both the bank and the full account number/);
      expect(await fails(c, "SELECT one_time_payee_create($1,'A',NULL,NULL,$2,$3)", [ASKU, n.last4, n.enc])).toMatch(/both the bank and the full account number/);
    });
  });
  it("a one-time payee can only be used by its creator, in its own company, on one request", async () => {
    await tx(async (c) => {
      await actAs(c, user.lidya); const theirs = await fn(c, "one_time_payee_create", ASKU, "Someone", null, null, null, null);
      await actAs(c, user.meron);
      expect(await fails(c, "INSERT INTO payment_requests (debtor_company_id, payee_type, one_time_payee_id, debit_account_id, created_by, total_amount, payment_method) VALUES ($1,'ONE_TIME',$2,$3,$4,10,'CASH')", [ASKU, theirs, cash, user.meron])).toMatch(/entered by the person who creates the request/);
      const { payee } = await oneTimeDraft(c, { method: "CASH", account: cash });
      expect(await fails(c, "INSERT INTO payment_requests (debtor_company_id, payee_type, one_time_payee_id, debit_account_id, created_by, total_amount, payment_method) VALUES ($1,'ONE_TIME',$2,$3,$4,10,'CASH')", [ASKU, payee, cash, user.meron])).toMatch(/one_time_payee_once/);
    });
  });
  it("only those who may create requests in the company can enter a one-time payee", async () => {
    await as(user.bereket, async (c) => { expect(await fails(c, "SELECT one_time_payee_create($1,'A',NULL,NULL,NULL,NULL)", [ASKU])).toMatch(/may not create payment requests/); });
    await as(user.selam, async (c) => { expect(await fails(c, "SELECT one_time_payee_create($1,'A',NULL,NULL,NULL,NULL)", [ASKU])).toMatch(/may not create payment requests/); });
  });
  it("Verifiers and Authorizers see the payee's name and destination; a draft stays private to its creator", async () => {
    await as(user.meron, async (c) => {
      const { id, payee } = await oneTimeDraft(c, { name: "Hirut Alemu", bank: "Awash", number: "5555 6666 7777" });
      await actAs(c, user.dawit);
      expect(await rows(c, "SELECT 1 FROM one_time_payees WHERE id=$1", [payee])).toHaveLength(0);   // someone else's draft
      await actAs(c, user.meron); const v1 = await fn(c, "wf_submit", id);
      for (const who of [user.dawit, user.kebede]) {
        await actAs(c, who);
        expect((await rows(c, "SELECT full_name, phone, bank_name, account_last4 FROM one_time_payees WHERE id=$1", [payee]))[0]).toEqual({ full_name: "Hirut Alemu", phone: "+251912345678", bank_name: "Awash", account_last4: "7777" });
      }
      await actAs(c, user.dawit); await fn(c, "wf_verify", id, v1);
    });
  });
  it("separation of duties is unchanged: the creator cannot verify, the Verifier cannot authenticate", async () => {
    await tx(async (c) => {
      const { id } = await oneTimeDraft(c);
      await actAs(c, user.meron); const v1 = await fn(c, "wf_submit", id);
      await owner.query("SAVEPOINT s1");
      await expect(c.query("SELECT wf_verify($1,$2)", [id, v1])).rejects.toThrow();
      await owner.query("ROLLBACK TO s1");
      await actAs(c, user.dawit); const v2 = await fn(c, "wf_verify", id, v1);
      await owner.query("SAVEPOINT s2");
      await expect(c.query("SELECT wf_authorize($1,$2)", [id, v2])).rejects.toThrow();
      await owner.query("ROLLBACK TO s2");
    });
  });
  it("the payee details are kept with the request: corrections add a version, nothing is overwritten, and every change is audited", async () => {
    await tx(async (c) => {
      const { id, payee: first } = await oneTimeDraft(c, { name: "Tesfaye Girma", bank: "CBE", number: NUMBER });
      await actAs(c, user.meron);
      // Same details: nothing changes. A new name with the account number left empty keeps the same bank details.
      expect(await fn(c, "one_time_payee_revise", id, "Tesfaye Girma", "0912 345 678", "CBE", null, null)).toBe(first);
      const second = await fn(c, "one_time_payee_revise", id, "Tesfaye Girma Bekele", "0912 345 678", "CBE", null, null);
      expect(second).not.toBe(first);
      const both = await rows(c, "SELECT id, full_name, account_last4, account_number_enc FROM one_time_payees WHERE id = ANY($1::uuid[]) ORDER BY created_at, full_name", [[first, second]]);
      expect(both.map((r) => r.full_name).sort()).toEqual(["Tesfaye Girma", "Tesfaye Girma Bekele"]);
      expect(both[0].account_number_enc).toBe(both[1].account_number_enc);
      expect((await rows(c, "SELECT one_time_payee_id FROM payment_requests WHERE id=$1", [id]))[0].one_time_payee_id).toBe(second);
      // A different bank needs the number again.
      expect(await fails(c, "SELECT one_time_payee_revise($1,'X',NULL,'Dashen',NULL,NULL)", [id])).toMatch(/full account number for the new bank/);
      const audit = await rows(c, "SELECT metadata FROM audit_events WHERE action = 'REQUEST_ONE_TIME_PAYEE_SET' AND entity_id = $1 ORDER BY occurred_at, (metadata->>'previous') NULLS FIRST", [id]);
      expect(audit.map((a) => a.metadata.name)).toEqual(["Tesfaye Girma", "Tesfaye Girma Bekele"]);
      expect(audit[1].metadata).toMatchObject({ previous: first, bank: "CBE", account_last4: "4455" });
      expect(await rows(c, "SELECT 1 FROM audit_events WHERE action = 'ONE_TIME_PAYEE_ENTERED' AND entity_id = ANY($1::uuid[])", [[first, second]])).toHaveLength(2);
      expect((await fn(c, "request_snapshot", id)).one_time_payee_id).toBe(second);
      // Entered details can never be edited or deleted, and once submitted the request's payee is frozen.
      await owner.query("SAVEPOINT a");
      await expect(c.query("UPDATE one_time_payees SET full_name = 'Changed' WHERE id = $1", [first])).rejects.toThrow(/append-only/);
      await owner.query("ROLLBACK TO a"); await owner.query("SAVEPOINT b");
      await expect(c.query("DELETE FROM one_time_payees WHERE id = $1", [first])).rejects.toThrow(/append-only/);
      await owner.query("ROLLBACK TO b");
      await fn(c, "wf_submit", id);
      expect(await fails(c, "SELECT one_time_payee_revise($1,'Late change',NULL,NULL,NULL,NULL)", [id])).toMatch(/can no longer be edited/);
    });
    await as(user.meron, async (c) => {
      const { id } = await oneTimeDraft(c, { method: "CASH", account: cash });
      await fn(c, "wf_submit", id);
      await actAs(c, user.lidya);
      expect(await fails(c, "SELECT one_time_payee_revise($1,'Someone else',NULL,NULL,NULL,NULL)", [id])).toMatch(/can no longer be edited/);
    });
  });
  it("review adjustments cannot change a one-time request's payee", async () => {
    await tx(async (c) => {
      const { id } = await oneTimeDraft(c);
      await actAs(c, user.meron); const v1 = await fn(c, "wf_submit", id);
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT wf_adjust($1,$2,$3::jsonb,'switch')", [id, v1, JSON.stringify({ supplier_id: S_HAWASSA, supplier_bank_detail_id: BD_HAWASSA })])).toMatch(/payment_requests_payee_chk/);
    });
  });
});

describe("destination details are mandatory at submission, and re-checked at verification and authentication", () => {
  it("a one-time transfer without bank details can be saved as a draft but not submitted, and nothing is reserved", async () => {
    await tx(async (c) => {
      const before = await balance(c, AWASH);
      const { id } = await oneTimeDraft(c, { bank: null, number: null });
      await actAs(c, user.meron);
      expect(await fails(c, "SELECT wf_submit($1)", [id])).toMatch(/bank and full account number are required for a bank transfer/);
      expect((await state(c, id)).s).toBe("DRAFT");
      expect(await balance(c, AWASH)).toEqual(before);
      // The same payee with cash or cheque needs no bank details.
      await c.query("UPDATE payment_requests SET payment_method = 'CHEQUE' WHERE id = $1", [id]);
      await fn(c, "wf_submit", id);
      expect((await state(c, id)).s).toBe("RESERVED");
    });
  });
  it("a one-time Telebirr payment needs an Ethiopian mobile number", async () => {
    await tx(async (c) => {
      await actAs(c, user.kebede); const wallet = await fn(c, "register_wallet_account", ASKU, "ASKU Telebirr", "0911 000 111", 0);
      await actAs(c, user.meron); await enterFigure(c, wallet, 100000);
      const none = await oneTimeDraft(c, { method: "TELEBIRR", account: wallet, phone: null, bank: null, number: null });
      expect(await fails(c, "SELECT wf_submit($1)", [none.id])).toMatch(/Ethiopian mobile number is required for a Telebirr/);
      const landline = await oneTimeDraft(c, { method: "TELEBIRR", account: wallet, phone: "011 551 2345", bank: null, number: null });
      expect(await fails(c, "SELECT wf_submit($1)", [landline.id])).toMatch(/Ethiopian mobile number is required for a Telebirr/);
      const ok = await oneTimeDraft(c, { method: "TELEBIRR", account: wallet, phone: "0912 345 678", bank: null, number: null });
      await approve(c, ok.id);
      expect((await state(c, ok.id)).s).toBe("AUTHENTICATED");
    });
  });
  it("a one-time transfer with bank details is approved and debited", async () => {
    await tx(async (c) => {
      const before = await balance(c, AWASH);
      const { id } = await oneTimeDraft(c, { amount: 2500 });
      await approve(c, id);
      expect((await state(c, id)).s).toBe("AUTHENTICATED");
      expect(await balance(c, AWASH)).toEqual({ current: before.current - 2500, reserved: before.reserved });
    });
  });
  it("a registered supplier with no bank account can be registered and paid by cash or cheque", async () => {
    await tx(async (c) => {
      const supplier = await bareSupplier(c);
      expect(await count(c, "SELECT count(*) n FROM supplier_bank_details WHERE supplier_id = $1", [supplier])).toBe(0);
      const byCash = await supplierDraft(c, supplier, { method: "CASH", account: cash });
      await approve(c, byCash);
      expect((await state(c, byCash)).s).toBe("AUTHENTICATED");
      const byCheque = await supplierDraft(c, supplier, { method: "CHEQUE", account: AWASH });
      await approve(c, byCheque);
      expect((await state(c, byCheque)).s).toBe("AUTHENTICATED");
    });
  });
  it("the same supplier's bank transfer is saved as a draft but refused at submission until verified bank details exist", async () => {
    await tx(async (c) => {
      const supplier = await bareSupplier(c);
      const before = await balance(c, AWASH);
      const id = await supplierDraft(c, supplier, { method: "TRANSFER", account: AWASH });
      expect((await state(c, id)).s).toBe("DRAFT");
      expect(await fails(c, "SELECT wf_submit($1)", [id])).toMatch(/verified supplier bank details are required for a bank transfer/);
      expect(await balance(c, AWASH)).toEqual(before);
      // Entered by Meron, still pending: not enough, and it cannot be attached.
      const d = (await rows(c, "INSERT INTO supplier_bank_details (supplier_id, bank_name, account_last4, created_by) VALUES ($1,'CBE','9090',$2) RETURNING id", [supplier, user.meron]))[0].id;
      await c.query("UPDATE payment_requests SET supplier_bank_detail_id = $2 WHERE id = $1", [id, d]);
      expect(await fails(c, "SELECT wf_submit($1)", [id])).toMatch(/verified supplier bank details are required/);
      // Meron cannot verify her own entry; Dawit can. Then the transfer is submitted.
      expect(await fails(c, "UPDATE supplier_bank_details SET status='VERIFIED' WHERE id=$1", [d])).toMatch(/someone other than/);
      await actAs(c, user.dawit); await c.query("UPDATE supplier_bank_details SET status='VERIFIED' WHERE id=$1", [d]);
      await actAs(c, user.meron); await fn(c, "wf_submit", id);
      expect((await state(c, id)).s).toBe("RESERVED");
    });
  });
  it("bank details are re-checked at authentication: details replaced after verification stop the transfer", async () => {
    await tx(async (c) => {
      const id = await supplierDraft(c, S_HAWASSA, { method: "TRANSFER", account: AWASH, bank: BD_HAWASSA });
      await actAs(c, user.meron); const v1 = await fn(c, "wf_submit", id);
      await actAs(c, user.dawit); const v2 = await fn(c, "wf_verify", id, v1);
      await actAs(c, user.meron);
      const nd = (await rows(c, "INSERT INTO supplier_bank_details (supplier_id, bank_name, account_last4, created_by) VALUES ($1,'Dashen','1212',$2) RETURNING id", [S_HAWASSA, user.meron]))[0].id;
      await actAs(c, user.dawit); await c.query("UPDATE supplier_bank_details SET status='VERIFIED' WHERE id=$1", [nd]);   // the old version is superseded
      await actAs(c, user.kebede);
      expect(await fails(c, "SELECT wf_authorize($1,$2)", [id, v2])).toMatch(/verified supplier bank details are required/);
    });
  });
  it("an unrelated or unverified bank detail is never accepted, whatever the method", async () => {
    await tx(async (c) => {
      const supplier = await bareSupplier(c);
      expect(await fails(c, "SELECT wf_submit($1)", [await supplierDraft(c, supplier, { method: "CASH", account: cash, bank: BD_HAWASSA })])).toMatch(/verified supplier bank details are required/);   // another supplier's
      const pending = "e0000000-0000-4000-8000-000000000003";   // Addis Hardware Traders, never verified
      expect(await fails(c, "SELECT wf_submit($1)", [await supplierDraft(c, S_ADDIS, { method: "CHEQUE", account: AWASH, bank: pending })])).toMatch(/verified supplier bank details are required/);
    });
  });
  it("supplier Telebirr payments keep needing verified supplier bank details", async () => {
    await tx(async (c) => {
      await actAs(c, user.kebede); const wallet = await fn(c, "register_wallet_account", ASKU, "ASKU Telebirr 2", "0911 000 222", 0);
      await actAs(c, user.meron); await enterFigure(c, wallet, 100000);
      const id = await supplierDraft(c, await bareSupplier(c), { method: "TELEBIRR", account: wallet });
      expect(await fails(c, "SELECT wf_submit($1)", [id])).toMatch(/verified supplier bank details are required for a Telebirr payment/);
    });
  });
});

describe("integrity check", () => {
  it("one-time requests and bank-less supplier requests are not reported as violations", async () => {
    await tx(async (c) => {
      await approve(c, (await oneTimeDraft(c)).id);
      await approve(c, await supplierDraft(c, await bareSupplier(c), { method: "CASH", account: cash }));
      const sql = readFileSync(join(__dirname, "../ops/verify-integrity.sql"), "utf8").replace(/^\\set.*$/m, "");
      expect((await c.query(sql)).rows.filter((r) => Number(r.violations) > 0)).toEqual([]);
    });
  });
});

describe("shared accounts", () => {
  it("a one-time payment from a shared account shows its payee to the account owner, under the existing visibility rule", async () => {
    await tx(async (c) => {
      const { id } = await oneTimeDraft(c, { name: "Shared Line Payee", account: CBE, amount: 700 });
      await approve(c, id);
      await actAs(c, user.abebe);   // BEES owns the account: full access
      const own = (await rows(c, "SELECT payee FROM outstanding_payments($1) WHERE id = $2", [CBE, id]))[0];
      expect(own?.payee).toBe("Shared Line Payee");
      await actAs(c, user.tigist);  // Berbero shares the account but is not ASKU: never ASKU's payee
      const other = (await rows(c, "SELECT payee FROM outstanding_payments($1) WHERE id = $2", [CBE, id]))[0];
      expect(other?.payee ?? null).toBeNull();
    });
  });
});

describe("optional phone numbers", () => {
  it("suppliers: empty means none, a number is normalised, a bad one is refused", async () => {
    await as(user.meron, async (c) => {
      const add = async (phone: string | null) => (await rows(c, "INSERT INTO suppliers (legal_name, phone, created_by) VALUES ($1,$2,$3) RETURNING phone", [`S ${Math.random()}`, phone, user.meron]))[0].phone;
      expect(await add(null)).toBeNull();
      expect(await add("")).toBeNull();
      expect(await add("   ")).toBeNull();
      expect(await add("0911 234 567")).toBe("+251911234567");
      expect(await add("011-551-2345")).toBe("+251115512345");
      expect(await add("+44 20 7946 0958")).toBe("+442079460958");
      for (const bad of ["abc", "12", "+251 91 23", "0911 234 5678 99"]) expect(await fails(c, "INSERT INTO suppliers (legal_name, phone, created_by) VALUES ('Bad',$1,$2)", [bad, user.meron])).toMatch(/valid phone number/);
    });
  });
  it("existing suppliers keep no phone; it can be set and cleared, with an audit entry", async () => {
    await as(user.meron, async (c) => {
      expect(await rows(c, "SELECT phone FROM suppliers WHERE id = $1", [S_HAWASSA])).toEqual([{ phone: null }]);
      await c.query("SELECT supplier_set_phone($1,'0922 111 222')", [S_HAWASSA]);
      expect((await rows(c, "SELECT phone FROM suppliers WHERE id = $1", [S_HAWASSA]))[0].phone).toBe("+251922111222");
      await c.query("SELECT supplier_set_phone($1,'')", [S_HAWASSA]);
      expect((await rows(c, "SELECT phone FROM suppliers WHERE id = $1", [S_HAWASSA]))[0].phone).toBeNull();
      await c.query("SELECT supplier_set_phone($1,'0922 111 222')", [S_HAWASSA]); await c.query("SELECT supplier_set_phone($1,NULL)", [S_HAWASSA]);
      expect((await rows(c, "SELECT phone FROM suppliers WHERE id = $1", [S_HAWASSA]))[0].phone).toBeNull();
      expect(await fails(c, "SELECT supplier_set_phone($1,'not a phone')", [S_HAWASSA])).toMatch(/valid phone number/);
      expect(await fails(c, "UPDATE suppliers SET phone = '+251911111111' WHERE id = $1", [S_HAWASSA])).toMatch(/permission denied/);
      await actAs(c, user.selam);
      expect(await fails(c, "SELECT supplier_set_phone($1,'0911 000 000')", [S_HAWASSA])).toMatch(/may not change suppliers/);
    });
    await tx(async (c) => {
      await actAs(c, user.meron); await c.query("SELECT supplier_set_phone($1,'0922 111 222')", [S_HAWASSA]);
      expect((await rows(c, "SELECT metadata FROM audit_events WHERE action = 'SUPPLIER_PHONE_CHANGED' AND entity_id = $1", [S_HAWASSA]))[0].metadata).toEqual({ phone: [null, "+251922111222"] });
    });
  });
  it("people: the phone is optional on create and edit; several people may have none; a given one is still checked", async () => {
    await as(user.meron, async (c) => {
      const mk = async (name: string, phone: string | null, idNo: string) => { const id = protectIdNumber(idNo, ASKU); return fn(c, "person_payee_create", ASKU, name, phone, id.enc, id.last4, id.hash, "CASH"); };
      const a = await mk("No Phone One", null, "NP-000001"), b = await mk("No Phone Two", "", "NP-000002");
      expect(await rows(c, "SELECT phone FROM person_payees WHERE id = ANY($1::uuid[])", [[a, b]])).toEqual([{ phone: null }, { phone: null }]);
      const p = await mk("With Phone", "0911 765 432", "NP-000003");
      expect((await rows(c, "SELECT phone FROM person_payees WHERE id=$1", [p]))[0].phone).toBe("+251911765432");
      await c.query("SELECT person_payee_update($1,'With Phone','',NULL,true)", [p]);
      expect((await rows(c, "SELECT phone FROM person_payees WHERE id=$1", [p]))[0].phone).toBeNull();
      await c.query("SELECT person_payee_update($1,'No Phone One',NULL,NULL,true)", [a]);
      expect((await rows(c, "SELECT phone FROM person_payees WHERE id=$1", [a]))[0].phone).toBeNull();
      expect(await fails(c, "SELECT person_payee_update($1,'No Phone One','12345',NULL,true)", [a])).toMatch(/Ethiopian mobile number/);
    });
  });
  it("adding or clearing a person's phone still counts as a change while their requests hold funds", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron);
      const pid = protectIdNumber("HF-123456", ASKU);
      const person = await fn(c, "person_payee_create", ASKU, "Held Funds", null, pid.enc, pid.last4, pid.hash, "CASH");
      const id = (await rows(c, "INSERT INTO payment_requests (debtor_company_id, payee_type, person_payee_id, debit_account_id, created_by, total_amount, payment_method) VALUES ($1,'PERSON',$2,$3,$4,100,'CASH') RETURNING id", [ASKU, person, cash, user.meron]))[0].id;
      await c.query("INSERT INTO payment_installments (request_id, seq, due_date, amount) VALUES ($1,1,'2026-12-01',100)", [id]);
      await fn(c, "wf_submit", id);
      expect(await fails(c, "SELECT person_payee_update($1,'Held Funds','0911 222 333',NULL,true)", [person])).toMatch(/requests in progress/);
    });
  });
});

describe("existing data moves forward unchanged", () => {
  it("phones stay as they were, suppliers get no phone, and existing requests are untouched", async () => {
    const d = await setupDb("abig_test_one_time_migration", { before: "20261116000000_one_time_payee_type" });
    try {
      await d.owner.query("BEGIN");
      await actAs(d.owner, user.meron);
      const pid = protectIdNumber("MG-000111", ASKU);
      const person = await fn(d.owner, "person_payee_create", ASKU, "Before Migration", "0911 999 888", pid.enc, pid.last4, pid.hash, "CASH");
      const req = (await rows(d.owner, "INSERT INTO payment_requests (debtor_company_id, supplier_id, supplier_bank_detail_id, debit_account_id, created_by, total_amount) VALUES ($1,$2,$3,$4,$5,10) RETURNING id", [ASKU, S_HAWASSA, BD_HAWASSA, AWASH, user.meron]))[0].id;
      await d.owner.query("COMMIT");
      const snapshot = async () => (await rows(d.owner, "SELECT r.payee_type::text t, r.supplier_id, r.supplier_bank_detail_id, r.total_amount, r.workflow_state::text s, r.version FROM payment_requests r WHERE r.id=$1", [req]))[0];
      const beforeReq = await snapshot();
      await d.migrateRest();
      expect((await rows(d.owner, "SELECT phone FROM person_payees WHERE id=$1", [person]))[0].phone).toBe("+251911999888");
      expect(await count(d.owner, "SELECT count(*) n FROM suppliers WHERE phone IS NOT NULL")).toBe(0);
      expect(await count(d.owner, "SELECT count(*) n FROM suppliers")).toBe(3);
      expect(await snapshot()).toEqual(beforeReq);
      expect(await count(d.owner, "SELECT count(*) n FROM one_time_payees")).toBe(0);
    } finally { await d.owner.end(); }
  }, 60_000);   // builds its own scratch database
});
