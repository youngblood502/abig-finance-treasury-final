import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { actAs, ASKU, AWASH, BD_HAWASSA, fn, mk, rows, setupDb, user } from "./helpers";
import { protectAccountNumber } from "../src/lib/account-numbers";

// The five server actions for supplier bank-detail deactivation, called as the application calls them: the real actions, the real session
// lookup (the development "acting as" cookie) and the real database functions, as abig_app on the test server. Only Next.js's request
// helpers are replaced: cookies() returns the acting person, redirect() is captured so the message it carries can be read.
const DB = "abig_test_supplier_bank_actions";
const env = vi.hoisted(() => ({ appUrl: "", actingAs: "" }));
class Redirected extends Error { constructor(public url: string) { super("redirect " + url); } }
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n === "abig_dev_user" && env.actingAs ? { value: env.actingAs } : undefined), set: () => {}, delete: () => {} }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Redirected(url); }, notFound: () => { throw new Redirected("/404"); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/db")>();
  const { Client: PgClient } = await import("pg");
  return {
    ...real,
    // The same transaction shape as the real withUser, on the test server's scratch database.
    withUser: async <T,>(userId: string, run: (tx: import("../src/lib/db").Tx) => Promise<T>): Promise<T> => {
      const c = new PgClient({ connectionString: env.appUrl }); await c.connect();
      try {
        await c.query("BEGIN"); await c.query("SELECT set_config('app.user_id', $1, true)", [userId]);
        const out = await run({ q: async (sql, params) => (await c.query(sql, params as unknown[])).rows });
        await c.query("COMMIT"); return out;
      } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { await c.end(); }
    },
  };
});
const actions = await import("../src/app/actions");

let owner: Client;
/** Calls an action as `who` with these form fields; returns the message or error it redirects with. */
async function call(who: string, action: (f: FormData) => Promise<unknown>, fields: Record<string, string>) {
  env.actingAs = who; const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v);
  try { await action(f); } catch (e) { if (e instanceof Redirected) { const q = new URL(e.url, "http://x").searchParams; return { msg: q.get("msg"), err: q.get("err") }; } throw e; }
  throw new Error("the action did not redirect");
}
const active = async (id: string) => (await rows(owner, "SELECT is_active FROM supplier_bank_details WHERE id=$1", [id]))[0].is_active as boolean;
/** A committed supplier of its own with verified details, a reserved request on them, the details deactivated, and newer verified details. */
async function reservedOnDeactivated() {
  await owner.query("BEGIN");
  await actAs(owner, user.meron);
  const supplier = (await rows(owner, "INSERT INTO suppliers (legal_name, created_by) VALUES ($1,$2) RETURNING id", [`Actions ${Math.random()}`, user.meron]))[0].id as string;
  await owner.query("INSERT INTO company_suppliers (company_id, supplier_id, created_by) VALUES ($1,$2,$3)", [ASKU, supplier, user.meron]);
  const add = async (digits: string) => { await actAs(owner, user.meron); const n = protectAccountNumber(digits); const id = await fn(owner, "supplier_bank_detail_add", supplier, "CBE", n.last4, n.enc) as string;
    await actAs(owner, user.dawit); await owner.query("UPDATE supplier_bank_details SET status = 'VERIFIED' WHERE id = $1", [id]); return id; };
  const old = await add("1111 2222 3333");
  await actAs(owner, user.meron); const id = await mk(owner, user.meron, { amounts: [100], supplier, bank: old, account: AWASH, dues: ["2026-12-31"] });
  const v = await fn(owner, "wf_submit", id) as number;
  await actAs(owner, user.dawit); await fn(owner, "supplier_bank_detail_deactivate", old, "Closed by the bank");
  const alt = await add("4444 5555 6666");
  await owner.query("COMMIT");
  return { id, v, old, alt };
}

beforeAll(async () => { const d = await setupDb(DB); owner = d.owner; env.appUrl = d.appUrl; }, 60_000);
afterAll(async () => { await owner?.end(); });

describe("deactivating and reactivating through the actions", { timeout: 60_000 }, () => {
  it("validates the reason, enforces who may act, and only a Finance Manager of a company using the supplier reactivates", async () => {
    expect(await call(user.dawit, actions.deactivateBankDetail, { id: BD_HAWASSA, reason: "" })).toMatchObject({ err: expect.stringMatching(/explain why/) });
    expect(await call(user.kebede, actions.deactivateBankDetail, { id: BD_HAWASSA, reason: "Closed account" })).toMatchObject({ err: "You do not have permission to do that." });
    expect(await active(BD_HAWASSA)).toBe(true);
    expect(await call(user.dawit, actions.deactivateBankDetail, { id: BD_HAWASSA, reason: "Closed account" })).toMatchObject({ msg: expect.stringMatching(/^Bank details deactivated/), err: null });
    expect(await active(BD_HAWASSA)).toBe(false);
    // An Accountant is stopped by the application; a Finance Manager of a company that does not use the supplier is stopped by the database.
    expect(await call(user.meron, actions.reactivateBankDetail, { id: BD_HAWASSA, note: "Open again" })).toMatchObject({ err: "You do not have permission to do that." });
    expect(await call(user.fikru, actions.reactivateBankDetail, { id: BD_HAWASSA, note: "Open again" })).toMatchObject({ err: expect.stringMatching(/only a Finance Manager/) });
    expect(await call(user.dawit, actions.reactivateBankDetail, { id: BD_HAWASSA, note: "" })).toMatchObject({ err: expect.stringMatching(/explain why/) });
    expect(await active(BD_HAWASSA)).toBe(false);
    expect(await call(user.dawit, actions.reactivateBankDetail, { id: BD_HAWASSA, note: "Open again" })).toMatchObject({ msg: "Bank details reactivated.", err: null });
    expect(await active(BD_HAWASSA)).toBe(true);
  });
});

describe("moving a request on to active details through the action", { timeout: 60_000 }, () => {
  it("reads the request's state on the server: a forged state in the form changes nothing about the path taken", async () => {
    const r = await reservedOnDeactivated();
    // The form claims AUTHENTICATED; the request is RESERVED, so the reviewer's adjustment is used and it goes back to verification.
    expect(await call(user.dawit, actions.useActiveBankDetails, { id: r.id, version: String(r.v), detail: r.alt, reason: "Supplier's new account", state: "AUTHENTICATED" }))
      .toMatchObject({ msg: expect.stringMatching(/goes back to verification/), err: null });
    expect((await rows(owner, "SELECT workflow_state::text s, supplier_bank_detail_id d, destination_review dr FROM payment_requests WHERE id=$1", [r.id]))[0]).toEqual({ s: "RESERVED", d: r.alt, dr: null });
    expect(await rows(owner, "SELECT old_value, new_value FROM adjustment_history WHERE request_id=$1", [r.id])).toEqual([{ old_value: r.old, new_value: r.alt }]);
  });
  it("refuses an Accountant, another company's Finance Manager and an unknown request", async () => {
    const r = await reservedOnDeactivated();
    const fields = { id: r.id, version: String(r.v), detail: r.alt, reason: "Supplier's new account" };
    expect(await call(user.meron, actions.useActiveBankDetails, fields)).toMatchObject({ err: "You do not have permission to do that." });
    expect(await call(user.fikru, actions.useActiveBankDetails, fields)).toMatchObject({ err: "Request not found." });   // row-level security: not visible
    expect(await call(user.dawit, actions.useActiveBankDetails, { ...fields, id: "a0000000-0000-4000-8000-00000000ffff" })).toMatchObject({ err: "Request not found." });
    expect(await call(user.dawit, actions.useActiveBankDetails, { ...fields, id: "not-a-uuid" })).toMatchObject({ err: "Request not found." });
    expect((await rows(owner, "SELECT supplier_bank_detail_id d FROM payment_requests WHERE id=$1", [r.id]))[0].d).toBe(r.old);
  });
  it("re-verification and re-authorization need their own permissions, whatever the screen shows", async () => {
    const r = await reservedOnDeactivated();
    expect(await call(user.meron, actions.reverifyDestination, { id: r.id, version: String(r.v) })).toMatchObject({ err: "You do not have permission to do that." });
    expect(await call(user.dawit, actions.reauthorizeDestination, { id: r.id, version: String(r.v) })).toMatchObject({ err: "You do not have permission to do that." });
    // Allowed people reach the database, which refuses because nothing is held on a reserved request.
    expect(await call(user.yared, actions.reverifyDestination, { id: r.id, version: String(r.v) })).toMatchObject({ err: expect.stringMatching(/no new bank details are waiting/) });
    expect(await call(user.kebede, actions.reauthorizeDestination, { id: r.id, version: String(r.v) })).toMatchObject({ err: expect.stringMatching(/no verified new bank details/) });
  });
});
