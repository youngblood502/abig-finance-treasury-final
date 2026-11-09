import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { formatAmountInput, plainAmount } from "../src/lib/amount";
import type { Tx } from "../src/lib/db";
import { STATE_LABEL, STATUS_SHORT, statusTone } from "../src/lib/format";
import { ageBucket, authenticateEffect, likePattern, listRequests, loadRequest, parseRequestFilters, requestActions, requestFormOptions, requestHistory, reviewQueue, stopReason, type ApprovalRow } from "../src/lib/requests";
import { filterOptions } from "../src/lib/table";
import { actAs, ASKU, authorized, AWASH, BERBERO, CBE, fails, fn, mk, rows, S_ETHIO_ID, setupDb, user } from "./helpers";

const event = (action: string, reason: string | null = null, at = 0): ApprovalRow => ({ id: String(at), action, actor_role: "FINANCE_MANAGER", reason, occurred_at: new Date(1800000000000 + at), full_name: "Dawit" });

describe("the filters from the URL", () => {
  it("keep valid values", () => {
    const account = "b0000000-0000-4000-8000-000000000001";
    expect(parseRequestFilters({ q: " PR-1 ", state: "PAID", method: "CHEQUE", account, from: "2026-11-01", to: "2026-11-30" })).toEqual({ q: "PR-1", state: "PAID", method: "CHEQUE", account, from: "2026-11-01", to: "2026-11-30" });
  });
  it("drop anything invalid before it reaches a query", () => {
    expect(parseRequestFilters({ state: "x' OR 1=1", method: "BITCOIN", account: "not-a-uuid", from: "yesterday", to: "2026-13" })).toEqual({ q: "", state: null, method: null, account: null, from: null, to: null });
  });
  it("cap a long search, and treat % and _ as plain text", () => {
    expect(parseRequestFilters({ q: "x".repeat(300) }).q).toHaveLength(100);
    expect(likePattern("50%_a\\b")).toBe("%50\\%\\_a\\\\b%");
  });
});

describe("what a person is offered on a request", () => {
  it("the creator of a draft may edit, submit and cancel, and approve nothing", () => { expect(requestActions("DRAFT", true, null, true)).toMatchObject({ edit: true, submit: true, cancel: true, verify: false, authenticate: false, adjust: false, reject: false }); });
  it("a verifier may verify, return and adjust, but never authenticate or reject", () => { expect(requestActions("RESERVED", false, "VERIFICATION", false)).toEqual({ edit: false, submit: false, cancel: false, verify: true, authenticate: false, returnForCorrection: true, reject: false, adjust: true, record: false }); });
  it("an authenticator may authenticate, return, reject and adjust, but never verify", () => { expect(requestActions("VERIFIED", false, "AUTHORIZATION", false)).toEqual({ edit: false, submit: false, cancel: false, verify: false, authenticate: true, returnForCorrection: true, reject: true, adjust: true, record: false }); });
  it("the creator can cancel while it holds money, not after it is debited", () => {
    expect(requestActions("VERIFIED", true, null, true).cancel).toBe(true);
    expect(requestActions("AUTHENTICATED", true, null, true)).toMatchObject({ cancel: false, record: true });
    expect(requestActions("PAID", true, null, true).record).toBe(false);
  });
  it("offers nothing on a finished request", () => { expect(Object.values(requestActions("REJECTED", true, null, true)).some(Boolean)).toBe(false); });
});

describe("the shared request display", () => {
  it("every status has one short label and a colour", () => { for (const s of Object.keys(STATE_LABEL)) { expect(STATUS_SHORT[s]).toBeTruthy(); expect(statusTone(s)).toBeTruthy(); } });
  it("authenticating shows the balance and the reservation falling by the amount", () => {
    expect(authenticateEffect("1500000", "400000", "400000")).toEqual([{ label: "Balance before", value: "ETB 1,500,000.00" }, { label: "Balance after", value: "ETB 1,100,000.00" }, { label: "Reserved before", value: "ETB 400,000.00" }, { label: "Reserved after", value: "ETB 0.00" }]);
  });
  it("shows the reason a request stopped, only while it applies", () => {
    expect(stopReason("DRAFT", [event("SUBMIT", null, 1), event("RETURN", "Wrong invoice", 2), event("INVALIDATE", "returned for correction", 3)])).toMatchObject({ title: "Returned for correction", reason: "Wrong invoice" });
    expect(stopReason("REJECTED", [event("REJECT", "Not delivered", 1)])).toMatchObject({ title: "Rejected", reason: "Not delivered" });
    expect(stopReason("CANCELLED", [event("CANCEL", "No longer needed", 1)])).toMatchObject({ title: "Cancelled" });
    expect(stopReason("DRAFT", [])).toBeNull();                                                                        // a new draft
    expect(stopReason("DRAFT", [event("RETURN", "x", 1), event("SUBMIT", null, 2)])).toBeNull();                        // resubmitted since
    expect(stopReason("RESERVED", [event("RETURN", "x", 1), event("SUBMIT", null, 2)])).toBeNull();
  });
  it("tells one history from both audit tables, oldest first, with money shown as money", () => {
    const h = requestHistory([event("SUBMIT", null, 0), event("RETURN", "Wrong", 2000)], [{ id: "1", field: "total_amount", old_value: "1000", new_value: "900", reason: "Corrected", occurred_at: new Date(1800000000000 + 1000), full_name: null }]);
    expect(h.map((e) => e.title)).toEqual(["Submitted", "Total changed", "Returned for correction"]);
    expect(h[1]).toMatchObject({ detail: "ETB 1,000.00 to ETB 900.00", reason: "Corrected", who: "Someone at the company" });
    expect(h[2]).toMatchObject({ reason: "Wrong", tone: "warning" });
    const inst = requestHistory([], [{ id: "2", field: "amount", old_value: "600000", new_value: "550000", reason: "Corrected", occurred_at: new Date(1800000000000), full_name: "Dawit" }]);
    expect(inst[0]).toMatchObject({ title: "Installment amount changed", detail: "ETB 600,000.00 to ETB 550,000.00" });
  });
  it("sorts waiting requests into age groups", () => {
    const now = new Date("2026-11-06T12:00:00Z"), ago = (d: number) => new Date(now.getTime() - d * 864e5);
    expect([ageBucket(ago(0.5), now), ageBucket(ago(2), now), ageBucket(ago(4), now)]).toEqual(["today", "recent", "old"]);
  });
});

describe("the form controls", () => {
  it("keeps an amount as a plain number with at most two decimals", () => {
    expect(plainAmount("1,250,000.505")).toBe("1250000.50"); expect(plainAmount("abc12")).toBe("12"); expect(plainAmount("007")).toBe("7"); expect(plainAmount("1.2.3")).toBe("1.23"); expect(plainAmount("")).toBe("");
  });
  it("shows it with separators, keeping what is still being typed", () => {
    expect(formatAmountInput("1250000.5")).toBe("1,250,000.5"); expect(formatAmountInput("1000.")).toBe("1,000."); expect(formatAmountInput("999")).toBe("999"); expect(formatAmountInput("")).toBe(""); expect(formatAmountInput(".5")).toBe("0.5");
  });
  it("narrows a long list by any word, in any order", () => {
    const list = [{ value: "1", label: "Hawassa Packaging PLC", hint: "Supplier" }, { value: "2", label: "Ethio Chemicals SC", hint: "Supplier" }];
    expect(filterOptions(list, "").length).toBe(2);
    expect(filterOptions(list, "plc hawassa").map((o) => o.value)).toEqual(["1"]);
    expect(filterOptions(list, "supplier ethio").map((o) => o.value)).toEqual(["2"]);
    expect(filterOptions(list, "nothing")).toEqual([]);
  });
});

describe("the request screens as the application role", () => {
  let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
  let draft: string, inReview: string, verified: string, paidCheque: string, berbero: string;
  const none = parseRequestFilters({});
  const tx = (c: Client): Tx => ({ q: async (sql, p) => (await c.query(sql, p as unknown[])).rows });

  beforeAll(async () => {
    const d = await setupDb("abig_test_requests"); owner = d.owner; as = d.as;
    await owner.query("BEGIN");
    await actAs(owner, user.meron);
    draft = await mk(owner, user.meron, { amounts: [1000], ref: "INV-DRAFT-100%" });
    inReview = await mk(owner, user.meron, { amounts: [2000], ref: "INV-REVIEW" }); await fn(owner, "wf_submit", inReview);
    verified = await mk(owner, user.meron, { amounts: [3000] }); const v = await fn(owner, "wf_submit", verified);
    await actAs(owner, user.dawit); await fn(owner, "wf_verify", verified, v);
    paidCheque = (await authorized(owner, { amounts: [4000], method: "CHEQUE" })).id;
    berbero = (await authorized(owner, { company: BERBERO, amounts: [5000], supplier: S_ETHIO_ID })).id;
    await owner.query("COMMIT");
  });
  afterAll(async () => { await owner?.end(); });

  it("lists what a person may see, and filters on the server", async () => {
    await as(user.meron, async (c) => {
      const t = tx(c);
      expect((await listRequests(t, none, null)).map((r) => r.id).sort()).toEqual([draft, inReview, verified, paidCheque].sort());
      expect((await listRequests(t, parseRequestFilters({ state: "RESERVED" }), null)).map((r) => r.id)).toEqual([inReview]);
      expect((await listRequests(t, parseRequestFilters({ method: "CHEQUE" }), null)).map((r) => r.id)).toEqual([paidCheque]);
      expect((await listRequests(t, parseRequestFilters({ q: "inv-review" }), null)).map((r) => r.id)).toEqual([inReview]);
      expect((await listRequests(t, parseRequestFilters({ q: "hawassa" }), null)).length).toBe(4);
      expect((await listRequests(t, parseRequestFilters({ account: AWASH }), null)).length).toBe(4);
      expect((await listRequests(t, parseRequestFilters({ account: CBE }), null))).toEqual([]);
      expect((await listRequests(t, parseRequestFilters({ from: "2099-01-01" }), null))).toEqual([]);
      expect((await listRequests(t, parseRequestFilters({ to: "2000-01-01" }), null))).toEqual([]);
    });
  });
  it("a search for % finds a literal %, not everything", async () => {
    await as(user.meron, async (c) => { expect((await listRequests(tx(c), parseRequestFilters({ q: "100%" }), null)).map((r) => r.id)).toEqual([draft]); });
  });
  it("cannot reach another company, by filter, search or forged company", async () => {
    await as(user.meron, async (c) => {
      const t = tx(c);
      expect(await listRequests(t, parseRequestFilters({ q: "ethio" }), null)).toEqual([]);
      expect(await listRequests(t, none, BERBERO)).toEqual([]);
      expect(await loadRequest(t, berbero)).toBeNull();
    });
    await as(user.bereket, async (c) => { expect(await listRequests(tx(c), none, ASKU)).toEqual([]); expect(await loadRequest(tx(c), paidCheque)).toBeNull(); });
  });
  it("a draft stays with its creator", async () => {
    await as(user.lidya, async (c) => { expect(await loadRequest(tx(c), draft)).toBeNull(); expect((await listRequests(tx(c), none, null)).map((r) => r.id)).not.toContain(draft); });
  });
  it("the new request form offers only companies where the person may create requests", async () => {
    await as(user.meron, async (c) => {
      const d = await requestFormOptions(tx(c));
      expect(new Set(d.payees.map((p) => p.company_id))).toEqual(new Set([ASKU]));
      expect(new Set(d.accounts.map((a) => a.company_id))).toEqual(new Set([ASKU]));
      expect(d.accounts.map((a) => a.id).sort()).toEqual([AWASH, CBE].sort());
    });
    await as(user.dawit, async (c) => { expect((await requestFormOptions(tx(c))).payees).toEqual([]); });
    await as(user.selam, async (c) => { expect((await requestFormOptions(tx(c))).accounts).toEqual([]); });
  });

  describe("verifier and authenticator stay separate", () => {
    it("the Finance Manager's queue holds only what awaits verification, and their detail page says the same", async () => {
      await as(user.dawit, async (c) => {
        expect((await reviewQueue(tx(c), null)).map((r) => [r.request_id, r.stage])).toEqual([[inReview, "VERIFICATION"]]);
        expect((await loadRequest(tx(c), inReview))!.stage).toBe("VERIFICATION");
        expect((await loadRequest(tx(c), verified))!.stage).toBeNull();
      });
    });
    it("the Owner's queue holds only what awaits authentication, with the balances for the dialog", async () => {
      await as(user.kebede, async (c) => {
        const q = await reviewQueue(tx(c), null);
        expect(q.map((r) => [r.request_id, r.stage])).toEqual([[verified, "AUTHORIZATION"]]);
        expect(q[0].current_balance).not.toBeNull(); expect(q[0].reserved_balance).not.toBeNull();
        expect((await loadRequest(tx(c), inReview))!.stage).toBeNull();
      });
    });
    it("the creator's queue is empty, and the database refuses them either way", async () => {
      await as(user.meron, async (c) => {
        expect(await reviewQueue(tx(c), null)).toEqual([]);
        expect((await loadRequest(tx(c), inReview))!.stage).toBeNull();
        const v = (await rows(c, "SELECT version FROM payment_requests WHERE id = $1", [inReview]))[0].version;
        expect(await fails(c, "SELECT wf_verify($1,$2)", [inReview, v])).toBeTruthy();
      });
    });
    it("someone who verified cannot authenticate the same request, even holding both roles", async () => {
      await as(user.yared, async (c) => {
        const v = (await rows(c, "SELECT version FROM payment_requests WHERE id = $1", [inReview]))[0].version;
        const after = await fn(c, "wf_verify", inReview, v);
        expect((await loadRequest(tx(c), inReview))!.stage).toBeNull();                 // nothing to offer
        expect(await fails(c, "SELECT wf_authorize($1,$2)", [inReview, after])).toMatch(/already acted at the verification stage/);
      });
    });
    it("a queue follows the chosen company, and cannot widen", async () => {
      await as(user.dawit, async (c) => { expect(await reviewQueue(tx(c), BERBERO)).toEqual([]); expect((await reviewQueue(tx(c), ASKU)).length).toBe(1); });
    });
  });

  describe("audit history and reasons", () => {
    it("a return shows its reason, and the history keeps every step", async () => {
      await as(user.dawit, async (c) => {
        const v = (await rows(c, "SELECT version FROM payment_requests WHERE id = $1", [inReview]))[0].version;
        await fn(c, "wf_return", inReview, v, "The invoice number is wrong");
        const d = (await loadRequest(tx(c), inReview));                                 // a returned draft is private to its creator again
        expect(d).toBeNull();
        await actAs(c, user.meron);
        const mine = (await loadRequest(tx(c), inReview))!;
        expect(stopReason(mine.r.workflow_state, mine.approvals)).toMatchObject({ reason: "The invoice number is wrong", who: "Dawit (ASKU finance manager)" });
        expect(requestHistory(mine.approvals, mine.adjustments).map((e) => e.title)).toEqual(["Submitted", "Returned for correction", "Earlier approvals cancelled"]);
      });
    });
    it("a rejection shows its reason to the creator", async () => {
      await as(user.kebede, async (c) => {
        const v = (await rows(c, "SELECT version FROM payment_requests WHERE id = $1", [verified]))[0].version;
        await fn(c, "wf_reject", verified, v, "Delivery not confirmed");
        await actAs(c, user.meron);
        const d = (await loadRequest(tx(c), verified))!;
        expect(stopReason(d.r.workflow_state, d.approvals)).toMatchObject({ title: "Rejected", reason: "Delivery not confirmed" });
      });
    });
    it("an adjustment appears in the history with its reason, and needs one", async () => {
      await as(user.dawit, async (c) => {
        const v = (await rows(c, "SELECT version FROM payment_requests WHERE id = $1", [inReview]))[0].version;
        expect(await fails(c, "SELECT wf_adjust($1,$2,$3::jsonb,'')", [inReview, v, JSON.stringify({ priority: "HIGH" })])).toMatch(/a reason is required/);
        await c.query("SELECT wf_adjust($1,$2,$3::jsonb,$4)", [inReview, v, JSON.stringify({ priority: "HIGH" }), "Supplier is waiting"]);
        const d = (await loadRequest(tx(c), inReview))!;
        expect(requestHistory(d.approvals, d.adjustments).find((e) => e.title === "Priority changed")).toMatchObject({ detail: "NORMAL to HIGH", reason: "Supplier is waiting" });
      });
    });
  });
});
