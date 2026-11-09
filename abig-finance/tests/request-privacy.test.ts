import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { Tx } from "../src/lib/db";
import { listRequests, loadRequest, maskRequest, parseRequestFilters, requestDocument, requestHistory, stopReason } from "../src/lib/requests";
import { accountList } from "../src/lib/treasury-screens";
import { actAs, ASKU, authorized, AWASH, BERBERO, fn, mk, rows, setupDb, S_HAWASSA, user } from "./helpers";

// Selam has read-only group reporting for ASKU and BEES, and is a member of neither.
describe("a request as group reporting sees it", () => {
  let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
  let paid: string, returned: string, file: string, hawassa: string, tin: string, paidNo: string;
  const tx = (c: Client): Tx => ({ q: async (sql, p) => (await c.query(sql, p as unknown[])).rows });
  const none = parseRequestFilters({});

  beforeAll(async () => {
    const d = await setupDb("abig_test_request_privacy"); owner = d.owner; as = d.as;
    const s = (await rows(owner, "SELECT legal_name n, tin FROM suppliers WHERE id = $1", [S_HAWASSA]))[0]; hawassa = s.n; tin = s.tin;
    await owner.query("BEGIN");
    await actAs(owner, user.meron); await owner.query("SELECT record_opening_balance($1, 3000000)", [AWASH]);
    paid = (await authorized(owner, { amounts: [100000], method: "CHEQUE", ref: "INV-PRIVATE-77" })).id;
    await actAs(owner, user.meron); await owner.query("SELECT record_execution($1,'CHQ-PRIVATE-1','REF-PRIVATE-1')", [paid]);
    returned = await mk(owner, user.meron, { amounts: [2000], ref: "INV-PRIVATE-78" });
    await owner.query("UPDATE payment_requests SET description = 'Private note for the accountant' WHERE id = $1", [returned]);
    const v = await fn(owner, "wf_submit", returned);
    await actAs(owner, user.dawit); await fn(owner, "wf_return", returned, v, "Private reason for returning it");
    await actAs(owner, user.meron); await fn(owner, "wf_submit", returned);                                                     // a draft is not readable by group reporting, so it goes back in
    await owner.query("COMMIT");
    file = (await rows(owner, "SELECT id FROM attachments WHERE request_id = $1 LIMIT 1", [paid]))[0].id;
    paidNo = (await rows(owner, "SELECT request_no n FROM payment_requests WHERE id = $1", [paid]))[0].n;
  });
  afterAll(async () => { await owner?.end(); });

  it("the list shows the request with no payee", async () => {
    await as(user.selam, async (c) => {
      const r = (await listRequests(tx(c), none, null)).find((x) => x.id === paid)!;
      expect([r.request_no, r.company, Number(r.total_amount), r.method, r.payee]).toEqual([paidNo, "ASKU PLC", 100000, "CHEQUE", null]);
    });
  });
  it("searching cannot reach a payee or invoice, only the request number", async () => {
    await as(user.selam, async (c) => {
      expect(await listRequests(tx(c), parseRequestFilters({ q: hawassa.slice(0, 6) }), null)).toEqual([]);
      expect(await listRequests(tx(c), parseRequestFilters({ q: "INV-PRIVATE" }), null)).toEqual([]);
      expect((await listRequests(tx(c), parseRequestFilters({ q: paidNo }), null)).map((r) => r.id)).toEqual([paid]);
    });
  });
  it("the detail keeps the money and status, and nothing about who or why", async () => {
    await as(user.selam, async (c) => {
      const d = (await loadRequest(tx(c), paid))!;
      expect(d.restricted).toBe(true);
      expect([Number(d.r.total_amount), d.r.workflow_state, d.r.payment_method, d.r.company, d.installments.length]).toEqual([100000, "AUTHENTICATED", "CHEQUE", "ASKU PLC", 1]);
      expect([d.r.payee, d.r.tin, d.r.bank_name, d.r.account_last4, d.r.creator_name, d.r.invoice_ref, d.r.invoice_date, d.r.description, d.r.cheque_no, d.r.bank_reference]).toEqual(Array(10).fill(null));
      expect(d.files).toEqual([]); expect(d.adjustments).toEqual([]);
      expect(d.approvals.length).toBeGreaterThan(0); expect(d.approvals.every((a) => a.full_name === null && a.reason === null)).toBe(true);
      const seen = JSON.stringify(d);
      for (const s of [hawassa, tin, "INV-PRIVATE-77", "CHQ-PRIVATE-1", "REF-PRIVATE-1", "Meron", "Dawit", "Kebede"]) expect(seen).not.toContain(s);
    });
  });
  it("notes and return reasons stay with the company", async () => {
    await as(user.selam, async (c) => {
      const d = (await loadRequest(tx(c), returned))!;
      const seen = JSON.stringify([d, requestHistory(d.approvals, d.adjustments), stopReason(d.r.workflow_state, d.approvals)]);
      for (const s of ["Private note", "Private reason", "INV-PRIVATE-78"]) expect(seen).not.toContain(s);
    });
    await as(user.meron, async (c) => {
      const d = (await loadRequest(tx(c), returned))!;
      expect(JSON.stringify(d)).toContain("Private note"); expect(JSON.stringify(d)).toContain("Private reason");
    });
  });
  it("a document opens only for the company's members", async () => {
    await as(user.selam, async (c) => { expect(await requestDocument(tx(c), file)).toBeNull(); });
    await as(user.bereket, async (c) => { expect(await requestDocument(tx(c), file)).toBeNull(); });
    await as(user.meron, async (c) => { expect((await requestDocument(tx(c), file))!.filename).toBeTruthy(); });
    await as(user.dawit, async (c) => { expect(await requestDocument(tx(c), file)).not.toBeNull(); });
  });
  it("members and administrators see everything as before", async () => {
    for (const who of [user.meron, user.dawit, user.kebede, user.admin]) await as(who, async (c) => {
      const d = (await loadRequest(tx(c), paid))!;
      expect([d.restricted, d.r.payee, d.r.invoice_ref, d.r.cheque_no]).toEqual([false, hawassa, "INV-PRIVATE-77", "CHQ-PRIVATE-1"]);
      expect(d.approvals.some((a) => a.full_name !== null)).toBe(true); expect(d.files.length).toBeGreaterThan(0);
      expect((await listRequests(tx(c), parseRequestFilters({ q: "INV-PRIVATE-77" }), null)).map((r) => r.id)).toEqual([paid]);
    });
  });
  it("a company outside the grant stays invisible", async () => {
    await owner.query("BEGIN");
    const { id } = await authorized(owner, { company: BERBERO, amounts: [5000], method: "TRANSFER" });
    await owner.query("COMMIT");
    await as(user.selam, async (c) => { expect(await loadRequest(tx(c), id)).toBeNull(); expect((await listRequests(tx(c), none, null)).some((r) => r.id === id)).toBe(false); });
  });
  it("the mask covers every private field", () => {
    const r = { payee: "P", tin: "T", person_phone: "0911", telebirr_phone: "0922", id_last4: "1234", total_amount: "10", workflow_state: "PAID" } as unknown as Parameters<typeof maskRequest>[0];
    expect(maskRequest(r)).toMatchObject({ payee: null, tin: null, person_phone: null, telebirr_phone: null, id_last4: null, total_amount: "10", workflow_state: "PAID" });
  });
  it("the account log does not name who authenticated a payment", async () => {
    const log = (who: string) => as(who, async (c) => (await accountList(tx(c), ASKU)).find((a) => a.id === AWASH)!.history.find((h) => h.request_no === paidNo)!);
    expect((await log(user.selam)).updated_by_name).toBeNull();
    expect((await log(user.meron)).updated_by_name).toBeTruthy();
  });
});
