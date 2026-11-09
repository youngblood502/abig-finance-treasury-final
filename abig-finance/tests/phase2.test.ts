import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { actAs, ASKU, BD_ADDIS, BD_HAWASSA, fails, rows, S_ADDIS, S_ETHIO, S_HAWASSA, setupDb, user } from "./helpers";

let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
beforeAll(async () => { const d = await setupDb("abig_test_p2"); owner = d.owner; as = d.as; });
afterAll(async () => { await owner?.end(); });

const key = () => (randomUUID() + randomUUID()).replace(/-/g, "").slice(0, 64);
const ATT = "INSERT INTO attachments (request_id, kind, object_key, filename, mime_type, size_bytes, sha256, uploaded_by, supersedes_id) VALUES ($1,$2,$3,'inv.pdf',$4,$5,$6,$7,$8) RETURNING id";
const addAtt = (c: Client, id: string, o: { kind?: string; mime?: string; size?: number; key?: string; by?: string; sup?: string | null } = {}) =>
  c.query(ATT, [id, o.kind ?? "INVOICE", o.key ?? key(), o.mime ?? "application/pdf", o.size ?? 1000, key(), o.by ?? user.meron, o.sup ?? null]);
async function draft(c: Client, o: { ref?: string; total?: number; supplier?: string; bank?: string } = {}) {
  const r = await rows(c, `INSERT INTO payment_requests (debtor_company_id, supplier_id, supplier_bank_detail_id, debit_account_id, created_by, invoice_ref, invoice_date, total_amount)
    VALUES ($1,$2,$3,'b0000000-0000-4000-8000-000000000002',$4,$5,'2026-10-01',$6) RETURNING id`, [ASKU, o.supplier ?? S_HAWASSA, o.bank ?? BD_HAWASSA, user.meron, o.ref ?? "INV-1", o.total ?? 1000]);
  return r[0].id as string;
}
const inst = (c: Client, id: string, seq: number, amt: number) =>
  c.query("INSERT INTO payment_installments (request_id, seq, due_date, amount) VALUES ($1,$2,'2026-11-01',$3)", [id, seq, amt]);
async function ready(c: Client, ref = "INV-1") { const id = await draft(c, { ref }); await inst(c, id, 1, 600); await inst(c, id, 2, 400); await addAtt(c, id); return id; }
const submit = (c: Client, id: string) => c.query("SELECT wf_submit($1)", [id]);

describe("suppliers and bank details", () => {
  it("supplier master is visible to members of any company, not to outsiders", async () => {
    await as(user.bereket, async (c) => { expect(await rows(c, "SELECT 1 FROM suppliers")).toHaveLength(3); });
    await as(null, async (c) => { expect(await rows(c, "SELECT 1 FROM suppliers")).toHaveLength(0); });
  });
  it("only inputters create suppliers", async () => {
    const q = "INSERT INTO suppliers (legal_name, tin, created_by) VALUES ('New Co','0099999999',$1)";
    await as(user.meron, async (c) => { await c.query(q, [user.meron]); });
    await as(user.hana, async (c) => { expect(await fails(c, q, [user.hana])).toMatch(/row-level security/); });
  });
  it("the full account number is not readable; only the masked tail is", async () => {
    await as(user.meron, async (c) => {
      expect(await fails(c, "SELECT account_number_enc FROM supplier_bank_details")).toMatch(/permission denied/);
      expect((await rows(c, "SELECT account_last4 FROM supplier_bank_details WHERE id=$1", [BD_HAWASSA]))[0].account_last4).toBe("2210");
    });
  });
  it("a change is a new pending version; verifying it supersedes the old one", async () => {
    await as(user.meron, async (c) => {
      const n = (await rows(c, "INSERT INTO supplier_bank_details (supplier_id, bank_name, account_last4, created_by) VALUES ($1,'Dashen','7777',$2) RETURNING id, version, status", [S_HAWASSA, user.meron]))[0];
      expect(n.version).toBe(2); expect(n.status).toBe("PENDING");
      const own = await c.query("UPDATE supplier_bank_details SET status='VERIFIED' WHERE id=$1", [n.id]);
      expect(own.rowCount).toBe(0); // an inputter is not a verifier
      await actAs(c, user.dawit);
      await c.query("UPDATE supplier_bank_details SET status='VERIFIED' WHERE id=$1", [n.id]);
      const st = await rows(c, "SELECT version, status FROM supplier_bank_details WHERE supplier_id=$1 ORDER BY version", [S_HAWASSA]);
      expect(st.map((r) => r.status)).toEqual(["SUPERSEDED", "VERIFIED"]);
      expect(await fails(c, "UPDATE supplier_bank_details SET bank_name='Hacked' WHERE id=$1", [n.id])).toMatch(/permission denied/);
      expect(await fails(c, "UPDATE supplier_bank_details SET status='PENDING' WHERE id=$1", [n.id])).toMatch(/only a pending/);
    });
  });
  it("whoever entered the bank details cannot verify them", async () => {
    await owner.query("BEGIN");
    try {
      const id = (await rows(owner, "INSERT INTO supplier_bank_details (supplier_id, bank_name, account_last4, created_by) VALUES ($1,'X','1111',$2) RETURNING id", [S_ETHIO, user.dawit]))[0].id;
      await actAs(owner, user.dawit);
      await owner.query("SAVEPOINT s");
      await expect(owner.query("UPDATE supplier_bank_details SET status='VERIFIED' WHERE id=$1", [id])).rejects.toThrow(/someone other than/);
    } finally { await owner.query("ROLLBACK"); }
  });
  it("a rejection needs a reason", async () => {
    await as(user.meron, async (c) => {
      const id = (await rows(c, "INSERT INTO supplier_bank_details (supplier_id, bank_name, account_last4, created_by) VALUES ($1,'X','2222',$2) RETURNING id", [S_ETHIO, user.meron]))[0].id;
      await actAs(c, user.dawit);
      expect(await fails(c, "UPDATE supplier_bank_details SET status='REJECTED' WHERE id=$1", [id])).toMatch(/needs a reason/);
      await c.query("UPDATE supplier_bank_details SET status='REJECTED', rejection_reason='Name mismatch' WHERE id=$1", [id]);
    });
  });
});

describe("request creation", () => {
  it("an inputter creates a draft with a generated number; version starts at 1", async () => {
    await as(user.meron, async (c) => {
      const id = await draft(c);
      const r = (await rows(c, "SELECT request_no, version, workflow_state FROM payment_requests WHERE id=$1", [id]))[0];
      expect(r.request_no).toMatch(/^PR-\d{6}$/); expect(r.version).toBe(1); expect(r.workflow_state).toBe("DRAFT");
    });
  });
  it("blocks other companies, non-inputters, forged creators and suppliers not active for the company", async () => {
    const q = "INSERT INTO payment_requests (debtor_company_id, supplier_id, created_by, total_amount) VALUES ($1,$2,$3,10)";
    await as(user.bereket, async (c) => { expect(await fails(c, q, [ASKU, S_HAWASSA, user.bereket])).toMatch(/row-level security/); });
    await as(user.selam, async (c) => { expect(await fails(c, q, [ASKU, S_HAWASSA, user.selam])).toMatch(/row-level security/); });
    await as(user.meron, async (c) => {
      expect(await fails(c, q, [ASKU, S_HAWASSA, user.lidya])).toMatch(/row-level security/);
      expect(await fails(c, q, [ASKU, S_ETHIO, user.meron])).toMatch(/row-level security/);
    });
  });
  it("creator, debtor company and number are immutable", async () => {
    await as(user.meron, async (c) => {
      const id = await draft(c);
      expect(await fails(c, "UPDATE payment_requests SET created_by=$2 WHERE id=$1", [id, user.lidya])).toMatch(/permission denied/);
      expect(await fails(c, "UPDATE payment_requests SET debtor_company_id=$2 WHERE id=$1", [id, "c0000000-0000-4000-8000-000000000002"])).toMatch(/permission denied/);
      await c.query("UPDATE payment_requests SET description='edited', priority='HIGH' WHERE id=$1", [id]);
      expect((await rows(c, "SELECT version FROM payment_requests WHERE id=$1", [id]))[0].version).toBe(2);
    });
  });
  it("drafts are private to their creator", async () => {
    await as(user.meron, async (c) => {
      const id = await draft(c);
      expect(await rows(c, "SELECT 1 FROM payment_requests WHERE id=$1", [id])).toHaveLength(1);
      await actAs(c, user.dawit); expect(await rows(c, "SELECT 1 FROM payment_requests WHERE id=$1", [id])).toHaveLength(0);
      await actAs(c, user.selam); expect(await rows(c, "SELECT 1 FROM payment_requests WHERE id=$1", [id])).toHaveLength(0);
    });
  });
  it("installments must use the request currency", async () => {
    await as(user.meron, async (c) => {
      const id = await draft(c);
      expect(await fails(c, "INSERT INTO payment_installments (request_id, seq, due_date, amount, currency) VALUES ($1,1,'2026-11-01',10,'USD')", [id])).toMatch(/currency must match|check constraint/);
    });
  });
});

describe("submission rules", () => {
  it("rejects incomplete requests with a clear reason", async () => {
    await as(user.meron, async (c) => {
      const none = await draft(c, { ref: "A" });
      expect(await fails(c, "SELECT wf_submit($1)", [none])).toMatch(/at least one installment/);
      const off = await draft(c, { ref: "B" }); await inst(c, off, 1, 900); await addAtt(c, off);
      expect(await fails(c, "SELECT wf_submit($1)", [off])).toMatch(/add up/);
      const noInv = await draft(c, { ref: "C" }); await inst(c, noInv, 1, 1000);
      await submit(c, noInv);   // the document became optional in treasury Phase 2
      const unverified = await draft(c, { ref: "D", supplier: S_ADDIS, bank: BD_ADDIS }); await inst(c, unverified, 1, 1000); await addAtt(c, unverified);
      expect(await fails(c, "SELECT wf_submit($1)", [unverified])).toMatch(/verified supplier bank details/);
    });
  });
  it("submits a complete request, records history, and makes it visible to the right people only", async () => {
    await as(user.meron, async (c) => {
      const id = await ready(c); await submit(c, id);
      const ev = await rows(c, "SELECT from_state, to_state FROM request_events WHERE request_id=$1 ORDER BY occurred_at, to_state", [id]);
      expect(ev.map((e) => e.to_state).sort()).toEqual(["DRAFT", "RESERVED"]);
      expect(await fails(c, "INSERT INTO request_events (request_id, to_state, version) VALUES ($1,'AUTHENTICATED',9)", [id])).toMatch(/permission denied/);
      for (const [u, n] of [[user.dawit, 1], [user.selam, 1], [user.hana, 0], [user.bereket, 0]] as const) {
        await actAs(c, u); expect(await rows(c, "SELECT 1 FROM payment_requests WHERE id=$1", [id])).toHaveLength(n);
      }
    });
  });
  it("locks the request, installments and attachments after submission", async () => {
    await as(user.meron, async (c) => {
      const id = await ready(c); await submit(c, id);
      expect((await c.query("UPDATE payment_requests SET total_amount=5 WHERE id=$1", [id])).rowCount).toBe(0);
      expect(await fails(c, "INSERT INTO payment_installments (request_id, seq, due_date, amount) VALUES ($1,3,'2026-12-01',1)", [id])).toMatch(/locked after submission|row-level security/);
      expect((await c.query("DELETE FROM payment_installments WHERE request_id=$1", [id])).rowCount).toBe(0);
      expect(await rows(c, "SELECT 1 FROM payment_installments WHERE request_id=$1", [id])).toHaveLength(2);
      expect(await fails(c, ATT, [id, "SUPPORTING", key(), "application/pdf", 10, key(), user.meron, null])).toMatch(/drafts?|row-level security/);
    });
    await owner.query("BEGIN");
    try {
      const id = await ready(owner); await actAs(owner, user.meron); await owner.query("SELECT wf_submit($1)", [id]);
      await expect(owner.query("UPDATE payment_requests SET description='x' WHERE id=$1", [id])).rejects.toThrow(/locked after submission/);
    } finally { await owner.query("ROLLBACK"); }
  });
  it("the same supplier invoice cannot be submitted twice", async () => {
    await as(user.meron, async (c) => {
      const a = await ready(c, "INV-DUP"); await submit(c, a);
      const b = await ready(c, "inv-dup");
      expect(await fails(c, "SELECT wf_submit($1)", [b])).toMatch(/duplicate key/);
    });
  });
  it("a replaced invoice is allowed", async () => {
    await as(user.meron, async (c) => {
      const id = await draft(c, { ref: "REPL" }); await inst(c, id, 1, 1000);
      const first = (await addAtt(c, id)).rows[0].id; await addAtt(c, id, { sup: first });
      await submit(c, id);
    });
  });
});

describe("private attachments", () => {
  it("rejects bad types, oversize files, short keys and other users' uploads", async () => {
    await as(user.meron, async (c) => {
      const id = await draft(c);
      expect(await fails(c, ATT, [id, "INVOICE", key(), "application/zip", 10, key(), user.meron, null])).toMatch(/check constraint/);
      expect(await fails(c, ATT, [id, "INVOICE", key(), "application/pdf", 20_000_000, key(), user.meron, null])).toMatch(/check constraint/);
      expect(await fails(c, ATT, [id, "INVOICE", "short", "application/pdf", 10, key(), user.meron, null])).toMatch(/check constraint/);
      expect(await fails(c, ATT, [id, "INVOICE", key(), "application/pdf", 10, key(), user.lidya, null])).toMatch(/row-level security/);
    });
  });
  it("other companies cannot see an attachment; non-creators cannot add to a draft", async () => {
    await as(user.meron, async (c) => {
      const id = await ready(c); await submit(c, id);
      await actAs(c, user.dawit); expect(await rows(c, "SELECT 1 FROM attachments WHERE request_id=$1", [id])).toHaveLength(1);
      await actAs(c, user.hana); expect(await rows(c, "SELECT 1 FROM attachments WHERE request_id=$1", [id])).toHaveLength(0);
    });
    await as(user.meron, async (c) => {
      const id = await draft(c);
      await actAs(c, user.bereket);
      expect(await fails(c, ATT, [id, "INVOICE", key(), "application/pdf", 10, key(), user.bereket, null])).toMatch(/row-level security/);
    });
  });
  it("attachment records are append-only", async () => {
    await as(user.meron, async (c) => {
      const id = await draft(c); await addAtt(c, id);
      expect(await fails(c, "UPDATE attachments SET filename='x' WHERE request_id=$1", [id])).toMatch(/permission denied/);
      expect(await fails(c, "DELETE FROM attachments WHERE request_id=$1", [id])).toMatch(/permission denied/);
    });
    await owner.query("BEGIN");
    try {
      const id = await draft(owner); await addAtt(owner, id);
      await expect(owner.query("DELETE FROM attachments WHERE request_id=$1", [id])).rejects.toThrow(/append-only/);
    } finally { await owner.query("ROLLBACK"); }
  });
});
