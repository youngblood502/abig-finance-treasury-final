import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { actAs, ASKU, fails, fn, key, mk, rows, S_HAWASSA, setupDb, user } from "./helpers";

let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"]; let workerUrl: string;
beforeAll(async () => { const d = await setupDb("abig_test_p3"); owner = d.owner; as = d.as; workerUrl = d.workerUrl; });
afterAll(async () => { await owner?.end(); });

const sub = (c: Client, id: string) => fn(c, "wf_submit", id) as Promise<number>;
const state = async (c: Client, id: string) => (await rows(c, "SELECT workflow_state s, version v FROM payment_requests WHERE id=$1", [id]))[0];
const actions = async (c: Client, id: string) => (await rows(c, "SELECT action, stage FROM approval_events WHERE request_id=$1 ORDER BY occurred_at, action", [id])).map((r) => r.action);
const sorted = (xs: string[]) => [...xs].sort();
/** Draft -> submitted as meron (or `creator`); returns [id, version]. */
async function submitted(c: Client, creator = user.meron): Promise<[string, number]> {
  await actAs(c, creator); const id = await mk(c, creator); return [id, await sub(c, id)];
}

describe("approval flow and separation of duties", () => {
  it("runs Inputter -> Verifier -> Authenticator and records every step", async () => {
    await as(user.meron, async (c) => {
      const [id, v1] = await submitted(c);
      await actAs(c, user.dawit); const v2 = await fn(c, "wf_verify", id, v1);
      expect((await state(c, id)).s).toBe("VERIFIED");
      await actAs(c, user.kebede); const v3 = await fn(c, "wf_authorize", id, v2);
      expect(await state(c, id)).toEqual({ s: "AUTHENTICATED", v: v3 });
      expect(await actions(c, id)).toEqual(["SUBMIT", "VERIFY", "AUTHORIZE"]);
      const who = await rows(c, "SELECT actor_id, actor_role FROM approval_events WHERE request_id=$1 ORDER BY occurred_at", [id]);
      expect(who.map((w) => w.actor_id)).toEqual([user.meron, user.dawit, user.kebede]);
    });
  });
  it("the creator can never verify or authorize their own request, even holding every role", async () => {
    await as(user.yared, async (c) => {
      const [id, v1] = await submitted(c, user.yared);
      expect(await fails(c, "SELECT wf_verify($1,$2)", [id, v1])).toMatch(/you created this request/);
      await actAs(c, user.dawit); const v2 = await fn(c, "wf_verify", id, v1);
      await actAs(c, user.yared);
      expect(await fails(c, "SELECT wf_authorize($1,$2)", [id, v2])).toMatch(/you created this request/);
    });
  });
  it("the verifier cannot also authorize, even if they hold both roles", async () => {
    await as(user.meron, async (c) => {
      const [id, v1] = await submitted(c);
      await actAs(c, user.yared); const v2 = await fn(c, "wf_verify", id, v1);
      expect(await fails(c, "SELECT wf_authorize($1,$2)", [id, v2])).toMatch(/already acted at the verification stage/);
      await actAs(c, user.kebede); await fn(c, "wf_authorize", id, v2);
    });
  });
  it("needs the right role in the debtor company; outsiders cannot even tell the request exists", async () => {
    await as(user.meron, async (c) => {
      const [id, v1] = await submitted(c);
      await actAs(c, user.lidya); expect(await fails(c, "SELECT wf_verify($1,$2)", [id, v1])).toMatch(/payment_request:verify/);
      await actAs(c, user.dawit); const v2 = await fn(c, "wf_verify", id, v1);
      expect(await fails(c, "SELECT wf_authorize($1,$2)", [id, v2])).toMatch(/payment_request:authenticate/);
      for (const u of [user.hana, user.bereket, user.selam]) {
        await actAs(c, u);
        expect(await fails(c, "SELECT wf_authorize($1,$2)", [id, v2])).toMatch(/not found|payment_request:authenticate/);
      }
    });
  });
  it("refuses to approve stale data or the wrong state", async () => {
    await as(user.meron, async (c) => {
      const [id, v1] = await submitted(c);
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT wf_verify($1,$2)", [id, v1 - 1])).toMatch(/request changed/);
      await actAs(c, user.kebede);
      expect(await fails(c, "SELECT wf_authorize($1,$2)", [id, v1])).toMatch(/not waiting for authentication/);
      await actAs(c, user.dawit); const v2 = await fn(c, "wf_verify", id, v1);
      expect(await fails(c, "SELECT wf_verify($1,$2)", [id, v2])).toMatch(/not waiting for verification/);
    });
  });
  it("the app role cannot change the workflow state directly", async () => {
    await as(user.meron, async (c) => {
      await actAs(c, user.meron); const id = await mk(c, user.meron);
      expect(await fails(c, "UPDATE payment_requests SET workflow_state='AUTHENTICATED' WHERE id=$1", [id])).toMatch(/permission denied/);
    });
  });
});

describe("return, reject and cancel", () => {
  it("a returned request is corrected by its creator and resubmitted for a fresh review", async () => {
    await as(user.meron, async (c) => {
      const [id, v1] = await submitted(c);
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT wf_return($1,$2,'')", [id, v1])).toMatch(/reason is required/);
      const v2 = await fn(c, "wf_return", id, v1, "Invoice number is unclear");
      await actAs(c, user.meron); expect((await state(c, id)).s).toBe("DRAFT");
      await actAs(c, user.meron);
      await c.query("UPDATE payment_requests SET description='clarified' WHERE id=$1", [id]);
      const v3 = await sub(c, id); expect(v3).toBeGreaterThan(v2);
      await actAs(c, user.dawit); await fn(c, "wf_verify", id, v3);
      expect(await actions(c, id)).toEqual(expect.arrayContaining(["RETURN", "INVALIDATE", "VERIFY"]));
    });
  });
  it("an authenticator can return a verified request", async () => {
    await as(user.meron, async (c) => {
      const [id, v1] = await submitted(c);
      await actAs(c, user.dawit); const v2 = await fn(c, "wf_verify", id, v1);
      await actAs(c, user.kebede); await fn(c, "wf_return", id, v2, "Check the supplier terms");
      await actAs(c, user.meron); expect((await state(c, id)).s).toBe("DRAFT");
    });
  });
  it("only an authenticator can reject, and only a verified request, with a reason", async () => {
    await as(user.meron, async (c) => {
      const [id, v1] = await submitted(c);
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT wf_reject($1,$2,'Not valid')", [id, v1])).toMatch(/payment_request:authenticate/);
      const v2 = await fn(c, "wf_verify", id, v1);
      await actAs(c, user.kebede);
      expect(await fails(c, "SELECT wf_reject($1,$2,' ')", [id, v2])).toMatch(/reason is required/);
      const v3 = await fn(c, "wf_reject", id, v2, "Duplicate of another payment");
      expect((await state(c, id)).s).toBe("REJECTED");
      expect(await fails(c, "SELECT wf_authorize($1,$2)", [id, v3])).toMatch(/not waiting for authentication/);
    });
  });
  it("the creator can cancel before authorization; nobody else can; authorized requests are not cancelled here", async () => {
    await as(user.meron, async (c) => {
      const [id, v1] = await submitted(c);
      await actAs(c, user.dawit); expect(await fails(c, "SELECT wf_cancel($1,$2,'No longer needed')", [id, v1])).toMatch(/payment_request:create|only the creator/);
      await actAs(c, user.meron); await fn(c, "wf_cancel", id, v1, "No longer needed");
      expect((await state(c, id)).s).toBe("CANCELLED");
      const [id2, w1] = await submitted(c);
      await actAs(c, user.dawit); const w2 = await fn(c, "wf_verify", id2, w1);
      await actAs(c, user.kebede); const w3 = await fn(c, "wf_authorize", id2, w2);
      await actAs(c, user.meron); expect(await fails(c, "SELECT wf_cancel($1,$2,'Changed my mind')", [id2, w3])).toMatch(/no longer be cancelled/);
    });
  });
});

describe("adjustments and the reapproval matrix", () => {
  it("an amount change by the authenticator restarts at verification and is fully recorded", async () => {
    await as(user.meron, async (c) => {
      const [id, v1] = await submitted(c);
      await actAs(c, user.dawit); const v2 = await fn(c, "wf_verify", id, v1);
      await actAs(c, user.yared); // holds the authenticator role too
      const v3 = await fn(c, "wf_adjust", id, v2, JSON.stringify({ total_amount: 1200, installments: [{ seq: 1, amount: 800 }] }), "Invoice corrected by supplier");
      expect(await state(c, id)).toEqual({ s: "RESERVED", v: v3 });
      const h = await rows(c, "SELECT entity_type, field, old_value, new_value, actor_role, workflow_stage, request_version FROM adjustment_history WHERE request_id=$1 ORDER BY field", [id]);
      expect(h.map((x) => [x.entity_type, x.field, Number(x.old_value), Number(x.new_value)])).toEqual([["INSTALLMENT", "amount", 600, 800], ["REQUEST", "total_amount", 1000, 1200]]);
      expect(h[0].actor_role).toBe("OWNER"); expect(h[0].request_version).toBe(v3);
      expect(await actions(c, id)).toEqual(expect.arrayContaining(["ADJUST", "INVALIDATE"]));
      expect(await fails(c, "SELECT wf_authorize($1,$2)", [id, v3])).toMatch(/not waiting for authentication/);
      expect(await fails(c, "SELECT wf_verify($1,$2)", [id, v3])).toMatch(/already acted at the authentication stage/); // the adjuster cannot re-verify
      await actAs(c, user.dawit); const v4 = await fn(c, "wf_verify", id, v3);
      await actAs(c, user.kebede); await fn(c, "wf_authorize", id, v4);
    });
  });
  it("a due-date-only change keeps the approvals and asks treasury to reconfirm", async () => {
    await as(user.meron, async (c) => {
      const [id, v1] = await submitted(c);
      await actAs(c, user.dawit); const v2 = await fn(c, "wf_verify", id, v1);
      await actAs(c, user.kebede);
      const v3 = await fn(c, "wf_adjust", id, v2, JSON.stringify({ installments: [{ seq: 2, due_date: "2026-12-20" }] }), "Supplier agreed a later date");
      expect((await state(c, id)).s).toBe("VERIFIED");
      expect((await rows(c, "SELECT field FROM adjustment_history WHERE request_id=$1", [id])).map((r) => r.field)).toEqual(["due_date"]);
      await fn(c, "wf_authorize", id, v3);
    });
  });
  it("a changed bank detail must be verified and restarts verification; a superseded one blocks approval", async () => {
    await as(user.meron, async (c) => {
      const [id, v1] = await submitted(c);
      const nb = (await rows(c, "INSERT INTO supplier_bank_details (supplier_id, bank_name, account_last4, created_by) VALUES ($1,'Dashen','7777',$2) RETURNING id", [S_HAWASSA, user.meron]))[0].id;
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT wf_adjust($1,$2,$3,'Supplier changed bank')", [id, v1, JSON.stringify({ supplier_bank_detail_id: nb })])).toMatch(/verified supplier bank details/); // still pending
      await c.query("UPDATE supplier_bank_details SET status='VERIFIED' WHERE id=$1", [nb]); // old detail is now superseded
      expect(await fails(c, "SELECT wf_verify($1,$2)", [id, v1])).toMatch(/verified supplier bank details/);
      const v2 = await fn(c, "wf_adjust", id, v1, JSON.stringify({ supplier_bank_detail_id: nb }), "Supplier changed bank");
      expect((await state(c, id)).s).toBe("RESERVED");
      await fn(c, "wf_verify", id, v2);
    });
  });
  it("needs a reason, the right role for the stage, supported fields, a real change and consistent totals", async () => {
    await as(user.meron, async (c) => {
      const [id, v1] = await submitted(c);
      const A = (changes: object, reason = "Valid reason") => fails(c, "SELECT wf_adjust($1,$2,$3,$4)", [id, v1, JSON.stringify(changes), reason]);
      await actAs(c, user.meron); expect(await A({ priority: "HIGH" })).toMatch(/payment_request:verify/); // the creator cannot adjust
      await actAs(c, user.dawit);
      expect(await A({ priority: "HIGH" }, "x")).toMatch(/reason is required/);
      expect(await A({ created_by: user.dawit })).toMatch(/cannot be adjusted/);
      expect(await A({ priority: "NORMAL" })).toMatch(/nothing was changed/);
      expect(await A({ total_amount: 1200 })).toMatch(/add up/);
      const v2 = await fn(c, "wf_adjust", id, v1, JSON.stringify({ priority: "URGENT" }), "Supplier is chasing");
      expect((await state(c, id)).s).toBe("RESERVED"); expect(v2).toBe(v1 + 1);
      const v3 = await fn(c, "wf_verify", id, v2);
      await actAs(c, user.dawit); // a verifier cannot adjust once it is at the authorization stage
      expect(await fails(c, "SELECT wf_adjust($1,$2,$3,'Late change')", [id, v3, JSON.stringify({ priority: "LOW" })])).toMatch(/payment_request:authenticate/);
    });
  });
});

describe("queue, history and visibility", () => {
  it("shows each person only what they can act on", async () => {
    await as(user.meron, async (c) => {
      const [mine, m1] = await submitted(c);
      const [yours, y1] = await submitted(c, user.yared);
      const ids = async (u: string) => { await actAs(c, u); return (await rows(c, "SELECT request_id, stage FROM app_actionable_requests()")).map((r) => r.request_id); };
      expect(await ids(user.dawit)).toEqual(expect.arrayContaining([mine, yours]));
      expect(await ids(user.meron)).not.toContain(mine);
      expect(await ids(user.yared)).not.toContain(yours);
      expect(await ids(user.yared)).toContain(mine);
      expect(await ids(user.kebede)).not.toContain(mine);
      await actAs(c, user.yared); const m2 = await fn(c, "wf_verify", mine, m1);
      expect(await ids(user.yared)).not.toContain(mine); // verified it, so cannot authorize it
      expect(await ids(user.kebede)).toContain(mine);
      void y1; void m2;
    });
  });
  it("approval and adjustment history is visible to the company and group reporters, append-only, and hidden from others", async () => {
    await as(user.meron, async (c) => {
      const [id] = await submitted(c);
      for (const [u, n] of [[user.dawit, 1], [user.selam, 1], [user.hana, 0], [user.bereket, 0]] as const) {
        await actAs(c, u); expect(await rows(c, "SELECT 1 FROM approval_events WHERE request_id=$1", [id])).toHaveLength(n);
      }
      await actAs(c, user.selam); expect(await fails(c, "SELECT wf_verify($1,1)", [id])).toMatch(/payment_request:verify|not found/);
      await actAs(c, user.dawit);
      expect(await fails(c, "UPDATE approval_events SET reason='x' WHERE request_id=$1", [id])).toMatch(/permission denied/);
      expect(await fails(c, "DELETE FROM adjustment_history", [])).toMatch(/permission denied/);
      expect(await fails(c, "INSERT INTO approval_events (request_id, request_version, stage, action, actor_id, actor_role, correlation_id) VALUES ($1,1,'VERIFICATION','VERIFY',$2,'VERIFIER',gen_random_uuid())", [id, user.dawit])).toMatch(/permission denied/);
    });
  });
});

describe("notification outbox", () => {
  const events = async (c: Client, id: string) => (await rows(c, "SELECT id, event_type FROM notification_outbox WHERE request_id=$1 ORDER BY created_at, event_type", [id]));
  const to = async (c: Client, eventId: string) => (await rows(c, "SELECT email FROM outbox_recipients($1)", [eventId])).map((r) => r.email);
  it("is written with each action, in the same transaction, and a refused action writes nothing", async () => {
    await owner.query("BEGIN");
    try {
      const [id, v1] = await submitted(owner);
      expect((await events(owner, id)).map((e) => e.event_type)).toEqual(["REQUEST_SUBMITTED"]);
      await actAs(owner, user.lidya); await fails(owner, "SELECT wf_verify($1,$2)", [id, v1]);
      expect(await events(owner, id)).toHaveLength(1);
      await actAs(owner, user.dawit); const v2 = await fn(owner, "wf_verify", id, v1);
      await actAs(owner, user.kebede); await fn(owner, "wf_authorize", id, v2);
      expect((await events(owner, id)).map((e) => e.event_type).sort()).toEqual(["REQUEST_AUTHORIZED", "REQUEST_SUBMITTED", "REQUEST_VERIFIED"]);
    } finally { await owner.query("ROLLBACK"); }
  });
  it("resolves recipients by role at delivery time, excluding people who may not act and anyone whose access was revoked", async () => {
    await owner.query("BEGIN");
    try {
      const [id, v1] = await submitted(owner);
      const e1 = (await events(owner, id))[0].id;
      expect(await to(owner, e1)).toEqual(["dawit@abig.test", "yared@abig.test"]); // verifiers, not the creator
      await owner.query("UPDATE company_memberships SET revoked_at = now() WHERE user_id=$1", [user.dawit]);
      expect(await to(owner, e1)).toEqual(["yared@abig.test"]); // revoked access is respected
      await owner.query("UPDATE company_memberships SET revoked_at = NULL WHERE user_id=$1", [user.dawit]);
      await actAs(owner, user.dawit); const v2 = await fn(owner, "wf_verify", id, v1);
      const e2 = (await events(owner, id)).find((e) => e.event_type === "REQUEST_VERIFIED")!.id;
      expect(await to(owner, e2)).toEqual(["kebede@abig.test", "yared@abig.test"]); // authenticators, not the creator or the verifier
      await actAs(owner, user.kebede); await fn(owner, "wf_authorize", id, v2);
      const e3 = (await events(owner, id)).find((e) => e.event_type === "REQUEST_AUTHORIZED")!.id;
      expect(await to(owner, e3)).toEqual(["lidya@abig.test", "meron@abig.test", "yared@abig.test"]); // the company accountants (including the creator)
    } finally { await owner.query("ROLLBACK"); }
  });
  it("a due-date change notifies treasury", async () => {
    await owner.query("BEGIN");
    try {
      const [id, v1] = await submitted(owner);
      await actAs(owner, user.dawit); const v2 = await fn(owner, "wf_verify", id, v1);
      await actAs(owner, user.kebede);
      await fn(owner, "wf_adjust", id, v2, JSON.stringify({ installments: [{ seq: 1, due_date: "2026-11-30" }] }), "Supplier agreed a later date");
      const ev = (await events(owner, id)).find((e) => e.event_type === "REQUEST_RESCHEDULE_NEEDED")!;
      expect(await to(owner, ev.id)).toContain("lidya@abig.test");
    } finally { await owner.query("ROLLBACK"); }
  });
  it("workers claim without overlap, back off on failure, give up after repeated failures, and the app role cannot touch the outbox", async () => {
    const reqId = (await rows(owner, `INSERT INTO payment_requests (debtor_company_id, supplier_id, created_by, total_amount) VALUES ($1,$2,$3,10) RETURNING id`, [ASKU, S_HAWASSA, user.meron]))[0].id;
    const ids = (await rows(owner, `INSERT INTO notification_outbox (event_type, request_id) SELECT 'REQUEST_SUBMITTED', $1 FROM generate_series(1,3) RETURNING id`, [reqId])).map((r) => r.id);
    const w = async () => { const c = new Client({ connectionString: workerUrl }); await c.connect(); return c; };
    const a = await w(), b = await w();
    try {
      await a.query("BEGIN"); await b.query("BEGIN");
      const claimedA = await rows(a, "SELECT id, lease_token FROM outbox_claim(2)"), ca = claimedA.map((r) => r.id);
      const cb = (await rows(b, "SELECT id FROM outbox_claim(2)")).map((r) => r.id);
      expect(ca).toHaveLength(2); expect(cb).toHaveLength(1);
      expect(new Set([...ca, ...cb]).size).toBe(3);
      await a.query("COMMIT"); await b.query("COMMIT");
      expect(await rows(a, "SELECT id FROM outbox_claim(5)")).toHaveLength(0); // leased
      await a.query("SELECT outbox_fail($1,$2,'smtp timeout')", [ca[0], claimedA[0].lease_token]);
      // The other one is sent to one recipient, then finished.
      expect((await rows(a, "SELECT outbox_begin_delivery($1,$2,$3,'dawit@abig.test') AS s", [ca[1], claimedA[1].lease_token, user.dawit]))[0].s).toBe("SEND");
      await a.query("SELECT outbox_record_delivery($1,$2,$3,NULL)", [ca[1], claimedA[1].lease_token, user.dawit]);
      expect((await rows(a, "SELECT outbox_finish($1,$2) AS s", [ca[1], claimedA[1].lease_token]))[0].s).toBe("DELIVERED");
      const f = (await rows(owner, "SELECT attempts, last_error, available_at > now() AS later, dead_at, delivered_at FROM notification_outbox WHERE id=$1", [ca[0]]))[0];
      expect(f).toMatchObject({ attempts: 1, last_error: "smtp timeout", later: true, dead_at: null });
      expect((await rows(owner, "SELECT delivered_at FROM notification_outbox WHERE id=$1", [ca[1]]))[0].delivered_at).not.toBeNull();
      await owner.query("UPDATE notification_outbox SET attempts = 7, available_at = now() WHERE id=$1", [ca[0]]);
      const again = (await rows(a, "SELECT id, lease_token, attempts FROM outbox_claim(5)")).find((r) => r.id === ca[0])!;
      expect(again.attempts).toBe(8);
      expect((await rows(a, "SELECT outbox_fail($1,$2,'still failing') AS s", [ca[0], again.lease_token]))[0].s).toBe("DEAD");
      expect((await rows(owner, "SELECT dead_at FROM notification_outbox WHERE id=$1", [ca[0]]))[0].dead_at).not.toBeNull();
    } finally { await a.end(); await b.end(); await owner.query("DELETE FROM notification_outbox WHERE id = ANY($1)", [ids]); }
    await as(user.dawit, async (c) => {
      expect(await fails(c, "SELECT outbox_claim(1)")).toMatch(/permission denied/);
      expect(await fails(c, "SELECT * FROM notification_outbox")).toMatch(/permission denied/);
    });
  });
});
