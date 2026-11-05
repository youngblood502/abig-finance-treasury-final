import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { actAs, ASKU, authorized, AWASH, BD_HAWASSA, BERBERO, fails, fn, mk, rows, S_HAWASSA, setupDb, user } from "./helpers";
import { blindIndex, decryptSecret } from "../src/lib/crypto";
import { maskId, normalizeIdNumber, protectIdNumber, revealIdNumber } from "../src/lib/payees";
import { accountPlace, METHODS_FOR_KIND } from "../src/lib/format";

let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
let wallet: string, cash: string, person: string, bankDetail: string, teleDetail: string;
const ID = "ET-1234 5678";

async function tx<T>(f: (c: Client) => Promise<T>): Promise<T> {
  await owner.query("BEGIN");
  try { return await f(owner); } finally { await owner.query("ROLLBACK"); }
}
const addPerson = async (c: Client, company: string, name: string, phone: string, idNumber: string) => {
  const id = protectIdNumber(idNumber, company);
  return (await rows(c, "SELECT person_payee_create($1,$2,$3,$4,$5,$6,'TRANSFER') AS id", [company, name, phone, id.enc, id.last4, id.hash]))[0].id as string;
};
const addDetail = async (c: Client, p: string, kind: string, bank: string | null, last4: string | null, phone: string | null) =>
  (await rows(c, "SELECT person_detail_add($1,$2,$3,$4,$5) AS id", [p, kind, bank, last4, phone]))[0].id as string;
const state = async (c: Client, id: string) => (await rows(c, "SELECT workflow_state::text s, version v FROM payment_requests WHERE id=$1", [id]))[0];
const balance = async (c: Client, id: string) => { const r = (await rows(c, "SELECT current_balance c, reserved_balance r, available_balance a, shortfall_amount s FROM company_bank_accounts WHERE id=$1", [id]))[0]; return { current: Number(r.c), reserved: Number(r.r), available: Number(r.a), shortfall: Number(r.s) }; };
const asPerson = (method: string) => ({ person, detail: method === "TRANSFER" ? bankDetail : method === "TELEBIRR" ? teleDetail : null });
const accountFor = (method: string) => (method === "CASH" ? cash : method === "TELEBIRR" ? wallet : AWASH);

beforeAll(async () => {
  const d = await setupDb("abig_test_payees"); owner = d.owner; as = d.as;
  await owner.query("BEGIN");
  await actAs(owner, user.kebede);
  wallet = await fn(owner, "register_wallet_account", ASKU, "ASKU Telebirr", "0911 000 111", 0);
  cash = await fn(owner, "register_cash_account", ASKU, "ASKU petty cash", 0);
  await actAs(owner, user.meron);
  await owner.query("SELECT update_bank_balance($1, 500000)", [wallet]); await owner.query("SELECT update_bank_balance($1, 300000)", [cash]);
  person = await addPerson(owner, ASKU, "Almaz Bekele", "0911 234 567", ID);
  bankDetail = await addDetail(owner, person, "BANK", "CBE", "5521", null);
  teleDetail = await addDetail(owner, person, "TELEBIRR", null, null, "0911 234 567");
  await actAs(owner, user.dawit);
  await owner.query("SELECT person_detail_decide($1, true, NULL)", [bankDetail]); await owner.query("SELECT person_detail_decide($1, true, NULL)", [teleDetail]);
  await owner.query("COMMIT");
});
afterAll(async () => { await owner?.end(); });

describe.each(["SUPPLIER", "PERSON"])("%s payee", (payee) => {
  describe.each(["TRANSFER", "CHEQUE", "CASH", "TELEBIRR"])("paid by %s", (method) => {
    const opts = () => ({ amounts: [1000], method, account: accountFor(method), ...(payee === "PERSON" ? asPerson(method) : {}) });
    it("is created, approved and debited, and stays Authenticated", async () => {
      await tx(async (c) => {
        const before = await balance(c, accountFor(method));
        const { id } = await authorized(c, opts());
        expect((await state(c, id)).s).toBe("AUTHENTICATED");
        expect(await balance(c, accountFor(method))).toMatchObject({ current: before.current - 1000, reserved: 0 });
        expect((await rows(c, "SELECT payee_type::text p, supplier_id IS NULL AS no_supplier, person_payee_id IS NULL AS no_person FROM payment_requests WHERE id=$1", [id]))[0]).toEqual({ p: payee, no_supplier: payee === "PERSON", no_person: payee === "SUPPLIER" });
      });
    });
    it("is cancelled with its funds released", async () => {
      await tx(async (c) => {
        await actAs(c, user.meron); const id = await mk(c, user.meron, opts()); const v = await fn(c, "wf_submit", id);
        expect((await balance(c, accountFor(method))).reserved).toBe(1000);
        await fn(c, "wf_cancel", id, v, "Not needed");
        expect((await state(c, id)).s).toBe("CANCELLED"); expect((await balance(c, accountFor(method))).reserved).toBe(0);
      });
    });
  });
});

describe("separation of duties on person payees", () => {
  it("creator, verifier and authenticator must still be three different people", async () => {
    await tx(async (c) => {
      await actAs(c, user.yared); const id = await mk(c, user.yared, { amounts: [1000], ...asPerson("TRANSFER") }); const v1 = await fn(c, "wf_submit", id);
      expect(await fails(c, "SELECT wf_verify($1,$2)", [id, v1])).toMatch(/you created this request/);
      await actAs(c, user.dawit); const v2 = await fn(c, "wf_verify", id, v1);
      expect(await fails(c, "SELECT wf_authorize($1,$2)", [id, v2])).toMatch(/payment_request:authenticate/);
      await actAs(c, user.yared); expect(await fails(c, "SELECT wf_authorize($1,$2)", [id, v2])).toMatch(/you created this request/);
      await actAs(c, user.kebede); await fn(c, "wf_authorize", id, v2);
      expect((await state(c, id)).s).toBe("AUTHENTICATED");
    });
  });
});

describe("person payees", () => {
  it("need a name, a valid phone and an ID number, and a phone has one written form", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron);
      const e = protectIdNumber("A-99887766", ASKU);
      expect(await fails(c, "SELECT person_payee_create($1,' ','0911000222',$2,$3,$4,'CASH')", [ASKU, e.enc, e.last4, e.hash])).toMatch(/name is required/);
      expect(await fails(c, "SELECT person_payee_create($1,'X','12345',$2,$3,$4,'CASH')", [ASKU, e.enc, e.last4, e.hash])).toMatch(/Ethiopian mobile number/);
      expect(await fails(c, "SELECT person_payee_create($1,'X','0911000222',NULL,NULL,NULL,'CASH')", [ASKU])).toMatch(/ID number is required/);
      for (const [typed, stored] of [["0911 000 333", "+251911000333"], ["251-711-000-334", "+251711000334"], ["+251 911 000 335", "+251911000335"]]) {
        const id = await addPerson(c, ASKU, "P " + typed, typed, "ID" + typed);
        expect((await rows(c, "SELECT phone FROM person_payees WHERE id=$1", [id]))[0].phone).toBe(stored);
      }
    });
  });
  it("phone and ID number are unique per company, however they are typed", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron);
      await c.query("SAVEPOINT a"); await expect(addPerson(c, ASKU, "Other", "+251 911 234 567", "NEW-1234")).rejects.toThrow(/person_payees_phone_key/); await c.query("ROLLBACK TO a");
      await expect(addPerson(c, ASKU, "Other", "0922 000 000", "et 1234-5678")).rejects.toThrow(/person_payees_id_hash_key/); await c.query("ROLLBACK TO a");
    });
  });
  it("the same person can be entered by another company, which cannot see the first entry", async () => {
    await tx(async (c) => {
      await actAs(c, user.tigist);
      const other = await addPerson(c, BERBERO, "Almaz Bekele", "0911 234 567", ID);
      expect(other).not.toBe(person);
    });
    await as(user.tigist, async (c) => { expect(await rows(c, "SELECT 1 FROM person_payees WHERE id=$1", [person])).toHaveLength(0); expect(await rows(c, "SELECT 1 FROM person_payment_details WHERE person_id=$1", [person])).toHaveLength(0); });
    expect(blindIndex(normalizeIdNumber(ID), ASKU)).not.toBe(blindIndex(normalizeIdNumber(ID), BERBERO));
  });
  it("only those with the permission in that company add or change people", async () => {
    await tx(async (c) => {
      const e = protectIdNumber("A-55443322", ASKU);
      await actAs(c, user.kebede); expect(await fails(c, "SELECT person_payee_create($1,'X','0911000444',$2,$3,$4,'CASH')", [ASKU, e.enc, e.last4, e.hash])).toMatch(/may not add people/);
      await actAs(c, user.tigist); expect(await fails(c, "SELECT person_payee_create($1,'X','0911000444',$2,$3,$4,'CASH')", [ASKU, e.enc, e.last4, e.hash])).toMatch(/may not add people/);
      await actAs(c, user.kebede); expect(await fails(c, "SELECT person_payee_update($1,'X','0911234567','CASH',true)", [person])).toMatch(/may not change people/);
    });
    await as(user.meron, async (c) => {
      expect(await fails(c, "INSERT INTO person_payees (company_id, full_name, phone, id_number_enc, id_last4, id_hash, created_by) VALUES ($1,'X','+251911000555','v1:x','1234',repeat('a',64),$2)", [ASKU, user.meron])).toMatch(/permission denied/);
      expect(await fails(c, "UPDATE person_payees SET full_name = 'X' WHERE id = $1", [person])).toMatch(/permission denied/);
      expect(await fails(c, "DELETE FROM person_payees WHERE id = $1", [person])).toMatch(/permission denied/);
    });
    await expect(owner.query("DELETE FROM person_payees WHERE id = $1", [person])).rejects.toThrow(/append-only|cannot be/);
  });
  it("cannot be changed while a request holds funds, and every change is audited", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [100], ...asPerson("TRANSFER") }); const v = await fn(c, "wf_submit", id);
      expect(await fails(c, "SELECT person_payee_update($1,'New Name','0911234567','TRANSFER',true)", [person])).toMatch(/requests in progress/);
      await fn(c, "wf_cancel", id, v, "Not needed");
      await c.query("SELECT person_payee_update($1,'New Name','0911234567','CASH',true)", [person]);
      const row = (await rows(c, "SELECT full_name, preferred_method::text m FROM person_payees WHERE id=$1", [person]))[0]; expect(row).toEqual({ full_name: "New Name", m: "CASH" });
      expect((await rows(c, "SELECT metadata FROM audit_events WHERE action='PERSON_PAYEE_CHANGED' AND entity_id=$1", [person]))[0].metadata.name).toEqual(["Almaz Bekele", "New Name"]);
    });
  });
  it("an inactive person cannot be used", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [100], ...asPerson("TRANSFER") });
      await c.query("SELECT person_payee_update($1,'Almaz Bekele','0911234567','TRANSFER',false)", [person]);
      expect(await fails(c, "SELECT wf_submit($1)", [id])).toMatch(/not active for this company/);
    });
  });
});

describe("ID numbers", () => {
  it("are encrypted with the application key; the database never holds them readably", async () => {
    const r = (await rows(owner, "SELECT id_number_enc, id_last4, id_hash FROM person_payees WHERE id=$1", [person]))[0];
    expect(r.id_number_enc).toMatch(/^v1:/); expect(r.id_number_enc).not.toContain("5678"); expect(r.id_hash).not.toContain("5678");
    expect(decryptSecret(r.id_number_enc)).toBe("ET12345678"); expect(r.id_last4).toBe("5678");
    const again = protectIdNumber(ID, ASKU); expect(again.enc).not.toBe(r.id_number_enc); expect(again.hash).toBe(r.id_hash);   // same hash finds the duplicate; the encryption differs each time
  });
  it("refuses something too short to be an ID", () => { expect(() => protectIdNumber("12", ASKU)).toThrow(/full ID number/); });
  it("are masked in lists", () => { expect(maskId("5678")).toBe("••••5678"); });
  it("the application role can read neither the encrypted value nor its hash, for any user", async () => {
    await as(user.admin, async (c) => {
      expect(await fails(c, "SELECT id_number_enc FROM person_payees")).toMatch(/permission denied/);
      expect(await fails(c, "SELECT id_hash FROM person_payees")).toMatch(/permission denied/);
      expect(await fails(c, "SELECT * FROM person_payees")).toMatch(/permission denied/);
      expect((await rows(c, "SELECT id_last4 FROM person_payees WHERE id=$1", [person]))[0].id_last4).toBe("5678");
    });
  });
  it("are revealed on a request to those allowed, and every view is logged", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [100], ...asPerson("TRANSFER") }); await fn(c, "wf_submit", id);
      for (const u of [user.dawit, user.kebede, user.lidya]) {
        await actAs(c, u);
        expect(revealIdNumber(await fn(c, "reveal_person_id", id))).toBe("ET12345678");
      }
      const log = await rows(c, "SELECT actor_id, metadata FROM audit_events WHERE action='PERSON_ID_VIEWED' AND entity_id=$1 ORDER BY occurred_at", [person]);
      expect(log.map((l) => l.actor_id)).toEqual([user.dawit, user.kebede, user.lidya]); expect(log[0].metadata).toEqual({ request: id });
      expect(JSON.stringify(log)).not.toContain("5678");
    });
  });
  it("stay masked for group reporting, other companies, and someone else's draft, and those are not logged as views", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const draft = await mk(c, user.meron, { amounts: [100], ...asPerson("TRANSFER") });
      const sub = await mk(c, user.meron, { amounts: [100], ref: "SUB-1", ...asPerson("TRANSFER") }); await fn(c, "wf_submit", sub);
      await actAs(c, user.selam); expect(await fn(c, "reveal_person_id", sub)).toBeNull();
      await actAs(c, user.samuel); expect(await fn(c, "reveal_person_id", sub)).toBeNull();
      await actAs(c, user.dawit); expect(await fn(c, "reveal_person_id", draft)).toBeNull();
      expect(await rows(c, "SELECT 1 FROM audit_events WHERE action='PERSON_ID_VIEWED' AND entity_id=$1", [person])).toHaveLength(0);
    });
  });
  it("a supplier request has no ID to reveal", async () => {
    await tx(async (c) => { await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [100] }); expect(await fn(c, "reveal_person_id", id)).toBeNull(); });
  });
});

describe("independent verification of a person's bank and Telebirr details", () => {
  it("the person who entered them cannot verify them, even holding every role", async () => {
    await tx(async (c) => {
      await actAs(c, user.yared); const d = await addDetail(c, person, "BANK", "Awash", "1111", null);
      expect(await fails(c, "SELECT person_detail_decide($1,true,NULL)", [d])).toMatch(/someone other than the person who entered them/);
      await actAs(c, user.dawit); await c.query("SELECT person_detail_decide($1,true,NULL)", [d]);
      const row = (await rows(c, "SELECT status, verified_by FROM person_payment_details WHERE id=$1", [d]))[0]; expect(row).toEqual({ status: "VERIFIED", verified_by: user.dawit });
    });
  });
  it("needs a Finance Manager of that company", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const d = await addDetail(c, person, "TELEBIRR", null, null, "0922 111 222");
      await actAs(c, user.lidya); expect(await fails(c, "SELECT person_detail_decide($1,true,NULL)", [d])).toMatch(/only a Finance Manager/);
      await actAs(c, user.fikru); expect(await fails(c, "SELECT person_detail_decide($1,true,NULL)", [d])).toMatch(/not found/);
    });
  });
  it("a new version replaces only the same kind, and only once verified; until then the old one stays in use", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const d = await addDetail(c, person, "BANK", "Awash", "2222", null);
      const status = async (id: string) => (await rows(c, "SELECT status FROM person_payment_details WHERE id=$1", [id]))[0].status;
      expect(await status(d)).toBe("PENDING"); expect(await status(bankDetail)).toBe("VERIFIED");
      await actAs(c, user.dawit); await c.query("SELECT person_detail_decide($1,true,NULL)", [d]);
      expect(await status(d)).toBe("VERIFIED"); expect(await status(bankDetail)).toBe("SUPERSEDED"); expect(await status(teleDetail)).toBe("VERIFIED");
    });
  });
  it("unverified details cannot be paid to", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const p = await addPerson(c, ASKU, "Dawit Tesfaye", "0933 000 000", "NEW-ID-77");
      const d = await addDetail(c, p, "BANK", "CBE", "3333", null);
      const id = await mk(c, user.meron, { amounts: [100], person: p, detail: d });
      expect(await fails(c, "SELECT wf_submit($1)", [id])).toMatch(/verified bank details are required/);
      const t = await mk(c, user.meron, { amounts: [100], ref: "T", person: p, detail: null, method: "TELEBIRR", account: wallet });
      expect(await fails(c, "SELECT wf_submit($1)", [t])).toMatch(/verified Telebirr details are required/);
    });
  });
  it("details of the wrong kind for the method do not count", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [100], person, detail: teleDetail });   // a transfer aimed at Telebirr details
      expect(await fails(c, "SELECT wf_submit($1)", [id])).toMatch(/verified bank details are required/);
    });
  });
  it("a request already moving is stopped if its details are replaced before payment", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [100], ...asPerson("TRANSFER") }); const v1 = await fn(c, "wf_submit", id);
      await actAs(c, user.dawit); const v2 = await fn(c, "wf_verify", id, v1);
      await actAs(c, user.meron); const d = await addDetail(c, person, "BANK", "Awash", "4444", null);
      await actAs(c, user.yared); await c.query("SELECT person_detail_decide($1,true,NULL)", [d]);
      await actAs(c, user.kebede); expect(await fails(c, "SELECT wf_authorize($1,$2)", [id, v2])).toMatch(/verified bank details are required/);
    });
  });
  it("a rejection needs a reason; details cannot be edited or removed", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const d = await addDetail(c, person, "BANK", "Awash", "5555", null);
      await actAs(c, user.dawit); expect(await fails(c, "SELECT person_detail_decide($1,false,' ')", [d])).toMatch(/needs a reason/);
      await c.query("SELECT person_detail_decide($1,false,'Name does not match')", [d]);
      expect(await fails(c, "SELECT person_detail_decide($1,true,NULL)", [d])).toMatch(/only pending/);
      expect(await fails(c, "UPDATE person_payment_details SET account_last4 = '9999' WHERE id = $1", [d])).toMatch(/cannot be edited/);
      expect(await fails(c, "DELETE FROM person_payment_details WHERE id = $1", [d])).toMatch(/append-only|cannot be/);
    });
    await as(user.dawit, async (c) => { expect(await fails(c, "UPDATE person_payment_details SET status = 'VERIFIED' WHERE person_id = $1", [person])).toMatch(/permission denied/); });
  });
  it("needs a real bank and last four digits, or a real phone number", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron);
      expect(await fails(c, "SELECT person_detail_add($1,'BANK','',NULL,NULL)", [person])).toMatch(/enter the bank/);
      expect(await fails(c, "SELECT person_detail_add($1,'TELEBIRR',NULL,NULL,'123')", [person])).toMatch(/Ethiopian mobile/);
      expect(await fails(c, "SELECT person_detail_add($1,'PIGEON',NULL,NULL,NULL)", [person])).toMatch(/choose bank or Telebirr/);
    });
  });
});

describe("a request has either a supplier or a person, never both", () => {
  const insert = "INSERT INTO payment_requests (debtor_company_id, payee_type, supplier_id, person_payee_id, created_by, total_amount) VALUES ($1,$2::payee_type,$3,$4,$5,100)";
  it("refuses both, and refuses neither", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron);
      expect(await fails(c, insert, [ASKU, "SUPPLIER", S_HAWASSA, person, user.meron])).toMatch(/payment_requests_payee_chk/);
      expect(await fails(c, insert, [ASKU, "PERSON", S_HAWASSA, person, user.meron])).toMatch(/payment_requests_payee_chk/);
      expect(await fails(c, insert, [ASKU, "PERSON", null, null, user.meron])).toMatch(/payment_requests_payee_chk/);
      expect(await fails(c, insert, [ASKU, "SUPPLIER", null, null, user.meron])).toMatch(/payment_requests_payee_chk/);
    });
  });
  it("supplier details cannot sit on a person's request, nor a person added to a supplier's request later", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [100] });
      expect(await fails(c, "UPDATE payment_requests SET person_payee_id = $2 WHERE id = $1", [id, person])).toMatch(/payment_requests_payee_chk/);
      const p = await mk(c, user.meron, { amounts: [100], ...asPerson("TRANSFER") });
      expect(await fails(c, "UPDATE payment_requests SET supplier_bank_detail_id = $2 WHERE id = $1", [p, BD_HAWASSA])).toMatch(/payment_requests_payee_chk/);
    });
  });
  it("a person from another company cannot be paid", async () => {
    await tx(async (c) => {
      await actAs(c, user.tigist); const other = await addPerson(c, BERBERO, "Bizu", "0944 000 000", "BZ-100200");
      await actAs(c, user.meron);
      expect(await fails(c, insert, [ASKU, "PERSON", null, other, user.meron])).toMatch(/payment_requests_person_company_fkey/);
    });
    await as(user.meron, async (c) => { expect(await fails(c, insert, [ASKU, "PERSON", null, "a0000000-0000-4000-8000-000000000099", user.meron])).toMatch(/row-level security/); });
  });
  it("another person's details cannot be attached", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const other = await addPerson(c, ASKU, "Sara", "0955 000 000", "SR-300400"); const d = await addDetail(c, other, "BANK", "CBE", "6666", null);
      const id = await mk(c, user.meron, { amounts: [100], ...asPerson("CHEQUE") });
      expect(await fails(c, "UPDATE payment_requests SET person_payment_detail_id = $2 WHERE id = $1", [id, d])).toMatch(/payment_requests_person_detail_fkey/);
    });
  });
  it("an adjustment cannot turn a person's request into a supplier's", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [100], ...asPerson("TRANSFER") }); const v = await fn(c, "wf_submit", id);
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT wf_adjust($1,$2,$3::jsonb,'switch')", [id, v, JSON.stringify({ supplier_id: S_HAWASSA, supplier_bank_detail_id: BD_HAWASSA })])).toMatch(/payment_requests_payee_chk/);
    });
  });
  it("suppliers work as before: bank details still required and verified", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [100], bank: undefined }); await c.query("UPDATE payment_requests SET supplier_bank_detail_id = NULL WHERE id = $1", [id]);
      expect(await fails(c, "SELECT wf_submit($1)", [id])).toMatch(/verified supplier bank details are required/);
    });
  });
});

describe("account types", () => {
  it("each type holds only what it should", async () => {
    await tx(async (c) => {
      const ins = "INSERT INTO company_bank_accounts (account_kind, bank_id, account_label, account_last4, wallet_phone) VALUES ($1::account_kind,$2,'X',$3,$4)";
      const bank = (await rows(c, "SELECT id FROM banks LIMIT 1"))[0].id;
      for (const args of [["BANK", null, "1234", null], ["BANK", bank, null, null], ["BANK", bank, "1234", "+251911000000"], ["WALLET", null, null, null], ["WALLET", bank, null, "+251911000000"], ["CASH", bank, null, null], ["CASH", null, "1234", null], ["CASH", null, null, "+251911000000"]])
        expect(await fails(c, ins, args)).toMatch(/company_bank_accounts_kind_chk/);
    });
  });
  it("existing accounts are bank accounts and are shown as before", async () => {
    await as(user.meron, async (c) => { expect((await rows(c, "SELECT account_kind::text k, wallet_phone FROM company_bank_accounts WHERE id=$1", [AWASH]))[0]).toEqual({ k: "BANK", wallet_phone: null }); });
    expect(accountPlace({ account_kind: "BANK", bank_name: "CBE", account_last4: "4417" })).toBe("CBE ••••4417");
    expect(accountPlace({ account_kind: "WALLET", wallet_phone: "+251911000111" })).toBe("Telebirr +251911000111");
    expect(accountPlace({ account_kind: "CASH" })).toBe("Cash");
  });
  it("a Telebirr wallet is identified by its phone number, which is unique", async () => {
    await tx(async (c) => {
      expect((await rows(c, "SELECT wallet_phone FROM company_bank_accounts WHERE id=$1", [wallet]))[0].wallet_phone).toBe("+251911000111");
      await actAs(c, user.kebede);
      expect(await fails(c, "SELECT register_wallet_account($1,'Again','+251 911 000 111',0)", [ASKU])).toMatch(/company_bank_accounts_wallet_phone/);
      expect(await fails(c, "SELECT register_wallet_account($1,'Bad','123',0)", [ASKU])).toMatch(/Ethiopian mobile/);
    });
  });
  it("only someone who manages accounts registers them, and a bank account still needs its details", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron);
      expect(await fails(c, "SELECT register_cash_account($1,'X',0)", [ASKU])).toMatch(/may not register accounts/);
      expect(await fails(c, "SELECT register_wallet_account($1,'X','0966000000',0)", [ASKU])).toMatch(/may not register accounts/);
      await actAs(c, user.kebede);
      expect(await fails(c, "SELECT register_bank_account($1,'Zemen','X',NULL,NULL,0)", [ASKU])).toMatch(/last four digits/);
      expect(await fails(c, "SELECT register_cash_account($1,' ',0)", [ASKU])).toMatch(/account name is required/);
      expect(await fails(c, "SELECT register_cash_account($1,'X',-1)", [ASKU])).toMatch(/cannot be negative/);
      const extra = await fn(c, "register_cash_account", ASKU, "Second till", 0); expect(extra).toBeTruthy();   // more than one is allowed
    });
  });
  it("the application cannot change an account's type", async () => {
    await as(user.admin, async (c) => { expect(await fails(c, "UPDATE company_bank_accounts SET account_kind = 'CASH' WHERE id = $1", [AWASH])).toMatch(/permission denied/); });
  });
});

describe("cash and wallet balances work like bank balances", () => {
  it.each([["cash", () => cash], ["wallet", () => wallet]])("%s: count, history, reservation, buffer and debit", async (_n, acct) => {
    await tx(async (c) => {
      await actAs(c, user.meron); await c.query("SELECT update_bank_balance($1, 250000)", [acct()]);
      expect(await balance(c, acct())).toEqual({ current: 250000, reserved: 0, available: 250000, shortfall: 0 });
      expect((await rows(c, "SELECT new_balance FROM account_balance_history($1, 1)", [acct()]))[0].new_balance).toBe("250000.0000");
      await actAs(c, user.kebede); await c.query("SELECT set_account_policy($1, 50000)", [acct()]);
      await actAs(c, user.meron); const method = acct() === cash ? "CASH" : "TELEBIRR";
      const over = await mk(c, user.meron, { amounts: [200001], method, account: acct(), ...asPerson(method) });
      expect(await fails(c, "SELECT wf_submit($1)", [over])).toMatch(/more than the available balance \(ETB 200,000.00\)/);
      const { id } = await authorized(c, { amounts: [150000], method, account: acct(), ...asPerson(method) });
      expect((await state(c, id)).s).toBe("AUTHENTICATED"); expect(await balance(c, acct())).toMatchObject({ current: 100000, reserved: 0, available: 50000 });
    });
  });
  it("a cash count below what is reserved is a shortfall and blocks new submissions", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const a = await mk(c, user.meron, { amounts: [200000], method: "CASH", account: cash, ...asPerson("CASH") }); await fn(c, "wf_submit", a);
      await c.query("SELECT update_bank_balance($1, 150000)", [cash]); expect((await balance(c, cash)).shortfall).toBe(50000);
      const b = await mk(c, user.meron, { amounts: [1], ref: "B", method: "CASH", account: cash, ...asPerson("CASH") });
      expect(await fails(c, "SELECT wf_submit($1)", [b])).toMatch(/in shortfall/);
    });
  });
  it("only someone allowed to enter balances counts the cash", async () => {
    await as(user.dawit, async (c) => { expect(await fails(c, "SELECT update_bank_balance($1, 1)", [cash])).toMatch(/you may not update/); });
  });
  it("an authenticated cash payment is processed at once and stays Authenticated; others wait for the bank", async () => {
    await tx(async (c) => {
      const { id } = await authorized(c, { amounts: [1000], method: "CASH", account: cash, ...asPerson("CASH") });
      const r = (await rows(c, "SELECT workflow_state::text s, bank_processed_at, bank_processed_by, paid_at FROM payment_requests WHERE id=$1", [id]))[0];
      expect(r.s).toBe("AUTHENTICATED"); expect(r.bank_processed_at).toBeInstanceOf(Date); expect(r.bank_processed_by).toBe(user.kebede); expect(r.paid_at).toBeNull();
      const { id: t } = await authorized(c, { amounts: [1000] });
      expect((await rows(c, "SELECT bank_processed_at FROM payment_requests WHERE id=$1", [t]))[0].bank_processed_at).toBeNull();
    });
  });
});

describe("payment method and account compatibility", () => {
  const kinds = { BANK: () => AWASH, WALLET: () => wallet, CASH: () => cash };
  const message: Record<string, RegExp> = { CASH: /must come from a cash account/, TELEBIRR: /must come from a Telebirr wallet/, TRANSFER: /must come from a bank account/, CHEQUE: /must come from a bank account/ };
  for (const [kind, acct] of Object.entries(kinds)) for (const method of ["TRANSFER", "CHEQUE", "CASH", "TELEBIRR"]) {
    const ok = METHODS_FOR_KIND[kind].includes(method);
    it(`${method} from a ${kind} account is ${ok ? "allowed" : "refused"}`, async () => {
      await tx(async (c) => {
        await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [100], method, account: acct() });   // a draft may be saved either way
        if (ok) { await fn(c, "wf_submit", id); expect((await state(c, id)).s).toBe("RESERVED"); }
        else { expect(await fails(c, "SELECT wf_submit($1)", [id])).toMatch(message[method]); expect((await state(c, id)).s).toBe("DRAFT"); expect((await balance(c, acct())).reserved).toBe(0); }
      });
    });
  }
  it("cannot be bypassed by going around the workflow function", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [100], method: "CASH", account: AWASH });
      expect(await fails(c, "SELECT wf_set_state($1,'RESERVED')", [id])).toMatch(/must come from a cash account/);
      expect((await balance(c, AWASH)).reserved).toBe(0);
    });
  });
  it("cannot be changed afterwards to something that does not fit", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [100] }); await fn(c, "wf_submit", id);
      expect(await fails(c, "UPDATE payment_requests SET payment_method = 'CASH' WHERE id = $1", [id])).toMatch(/must come from a cash account/);
    });
  });
});

describe("invoice documents are optional", () => {
  it.each(["SUPPLIER", "PERSON"])("a %s request goes through with no document, reference or date", async (payee) => {
    await tx(async (c) => {
      const { id } = await authorized(c, { amounts: [100], noDocument: true, ref: null, ...(payee === "PERSON" ? asPerson("TRANSFER") : {}) });
      expect((await state(c, id)).s).toBe("AUTHENTICATED");
      expect(await rows(c, "SELECT 1 FROM attachments WHERE request_id=$1", [id])).toHaveLength(0);
    });
  });
  it("the duplicate check on a supplier's invoice reference stays, and several requests without one are fine", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron);
      const a = await mk(c, user.meron, { amounts: [100], noDocument: true, ref: "DUP-1" }); await fn(c, "wf_submit", a);
      const b = await mk(c, user.meron, { amounts: [100], noDocument: true, ref: "dup-1" });
      expect(await fails(c, "SELECT wf_submit($1)", [b])).toMatch(/payment_requests_invoice_once/);
      for (let i = 0; i < 2; i++) await fn(c, "wf_submit", await mk(c, user.meron, { amounts: [100], noDocument: true, ref: null }));
    });
  });
  it("the same check applies to a person's reference", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron);
      const a = await mk(c, user.meron, { amounts: [100], ref: "P-REF", ...asPerson("TRANSFER") }); await fn(c, "wf_submit", a);
      const b = await mk(c, user.meron, { amounts: [100], ref: "P-REF", ...asPerson("TRANSFER") });
      expect(await fails(c, "SELECT wf_submit($1)", [b])).toMatch(/payment_requests_person_invoice_once/);
    });
  });
  it("an attached document still works and stays append-only", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [100] }); await fn(c, "wf_submit", id);
      expect(await rows(c, "SELECT 1 FROM attachments WHERE request_id=$1", [id])).toHaveLength(1);
    });
  });
});

describe("integrity check", () => {
  const integrity = async (c: Client) => { const sql = readFileSync(join(__dirname, "../ops/verify-integrity.sql"), "utf8").replace(/^\\set.*$/m, ""); return Object.fromEntries((await c.query(sql)).rows.map((r) => [r.name, Number(r.violations)])); };
  it("is clean with people, wallets, cash and requests with no document", async () => {
    await tx(async (c) => {
      await authorized(c, { amounts: [100], method: "CASH", account: cash, noDocument: true, ref: null, ...asPerson("CASH") });
      await authorized(c, { amounts: [100], method: "TELEBIRR", account: wallet, ...asPerson("TELEBIRR") });
      expect(Object.entries(await integrity(c)).filter(([, v]) => v > 0)).toEqual([]);
    });
  });
  it("catches rows that break the Phase 2 rules", async () => {
    await tx(async (c) => {
      const { id: cashPay } = await authorized(c, { amounts: [100], method: "CASH", account: cash, ...asPerson("CASH") });
      const { id: bankPay } = await authorized(c, { amounts: [100] });
      await c.query("ALTER TABLE payment_requests DROP CONSTRAINT payment_requests_payee_chk");
      await c.query("SET LOCAL session_replication_role = replica");
      await c.query("UPDATE payment_requests SET bank_processed_at = NULL WHERE id = $1", [cashPay]);
      await c.query("UPDATE payment_requests SET payment_method = 'TELEBIRR', supplier_id = NULL WHERE id = $1", [bankPay]);
      const r = await integrity(c);
      expect(r["authenticated cash payment not marked as processed"]).toBe(1);
      expect(r["payment method that does not fit its account"]).toBe(1);
      expect(r["request without exactly one payee"]).toBe(1);
    });
  });
});
