import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, types } from "pg";
import { actAs, ASKU, AWASH, fails, fn, rows, S_HAWASSA, setupDb, user } from "./helpers";
import { templateList } from "../src/lib/recurring";

// The application keeps a DATE as text (src/lib/db.ts); the loader is read the same way here.
types.setTypeParser(types.builtins.DATE, (v) => v);
// Recurring payments (Phase 6 Task 3C). Meron (ASKU accountant) keeps the templates; Drafts are created in her name by the worker function.
// Most tests run in a rolled-back transaction on the owner connection with the treasury clock set.
const SYSTEM = "00000000-0000-4000-8000-000000000000";
let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"]; let workerUrl: string;
beforeAll(async () => { const d = await setupDb("abig_test_recurring"); owner = d.owner; as = d.as; workerUrl = d.workerUrl; });
afterAll(async () => { await owner?.end(); });

async function tx<T>(f: (c: Client) => Promise<T>): Promise<T> { await owner.query("BEGIN"); try { return await f(owner); } finally { await owner.query("ROLLBACK"); } }
const clock = (c: Client, day: string) => c.query(`CREATE OR REPLACE FUNCTION treasury_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $f$ SELECT '${day}T09:00:00+03:00'::timestamptz $f$`);
const generate = async (c: Client) => Number(await fn(c, "generate_recurring_requests"));
const reserved = async (c: Client) => Number((await rows(c, "SELECT reserved_balance r FROM company_bank_accounts WHERE id = $1", [AWASH]))[0].r);
const tpl = (c: Client, t: string) => rows(c, "SELECT next_date::text nd, last_generated_on::text lg, last_error, is_active FROM recurring_payment_templates WHERE id = $1", [t]).then((r) => r[0]);
const drafts = (c: Client, t: string) => rows(c, `SELECT r.id, r.request_no, r.recurring_occurrence::text occ, r.workflow_state::text s, r.created_by, r.total_amount::numeric::text amt, r.amount_is_estimate,
  r.debit_account_id, r.supplier_id, r.supplier_bank_detail_id, (SELECT json_agg(json_build_object('due', i.due_date::text, 'amount', i.amount::numeric::text)) FROM payment_installments i WHERE i.request_id = r.id) inst
  FROM payment_requests r WHERE r.recurring_template_id = $1 ORDER BY r.recurring_occurrence`, [t]);
type Opts = { next?: string; end?: string | null; estimate?: boolean; frequency?: string; amount?: number; method?: string; account?: string; payee?: string; dueDays?: number; who?: string };
/** Saves a template as Meron (or `who`): Hawassa Packaging from ASKU's Awash account by transfer, monthly. */
const save = async (c: Client, o: Opts = {}, id: string | null = null) => {
  await actAs(c, o.who ?? user.meron);
  return fn(c, "recurring_template_save", id, ASKU, "Office rent", "SUPPLIER", o.payee ?? S_HAWASSA, o.account ?? AWASH, o.method ?? "TRANSFER", o.amount ?? 1000,
    o.estimate ?? false, o.frequency ?? "MONTHLY", o.next ?? "2027-01-31", o.end ?? null, o.dueDays ?? 0, "NORMAL", null) as Promise<string>;
};
const integrity = async (c: Client) => (await c.query(readFileSync(join(__dirname, "../ops/verify-integrity.sql"), "utf8").replace(/^\\set.*$/m, ""))).rows.filter((r) => Number(r.violations) > 0);

describe("three months of a monthly recurring payment", () => {
  it("creates three distinct Drafts, one per month, never twice, never submitted or reserved, and the integrity check passes", async () => {
    await tx(async (c) => {
      await clock(c, "2027-01-15");
      const t = await save(c, { next: "2027-01-31", dueDays: 5 });
      const before = await reserved(c);
      await clock(c, "2027-01-30"); expect(await generate(c)).toBe(0);
      await clock(c, "2027-01-31"); expect(await generate(c)).toBe(1); expect(await generate(c)).toBe(0);   // a second run, or a retry, makes nothing
      await clock(c, "2027-02-28"); expect(await generate(c)).toBe(1); expect(await generate(c)).toBe(0);   // 31 January's day, in a shorter month
      await clock(c, "2027-03-31"); expect(await generate(c)).toBe(1); expect(await generate(c)).toBe(0);
      const d = await drafts(c, t);
      expect(d.map((x) => x.occ)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
      expect(new Set(d.map((x) => x.request_no)).size).toBe(3);
      for (const x of d) expect(x).toMatchObject({ s: "DRAFT", created_by: user.meron, amt: "1000.0000", amount_is_estimate: false, debit_account_id: AWASH, supplier_id: S_HAWASSA });
      expect(d.map((x) => x.inst)).toEqual([[{ due: "2027-02-05", amount: "1000.0000" }], [{ due: "2027-03-05", amount: "1000.0000" }], [{ due: "2027-04-05", amount: "1000.0000" }]]);
      expect(d[0].supplier_bank_detail_id).not.toBeNull();   // the supplier's verified bank details, as the request form picks them
      expect(await tpl(c, t)).toMatchObject({ nd: "2027-04-30", lg: "2027-03-31", last_error: null });
      expect(await reserved(c)).toBe(before);
      expect(await rows(c, "SELECT 1 FROM approval_events WHERE request_id = ANY($1::uuid[])", [d.map((x) => x.id)])).toHaveLength(0);
      expect(await rows(c, "SELECT 1 FROM notification_outbox WHERE request_id = ANY($1::uuid[])", [d.map((x) => x.id)])).toHaveLength(0);   // no email
      const audit = await rows(c, "SELECT actor_id, metadata->>'occurrence' occ FROM audit_events WHERE action = 'RECURRING_DRAFT_CREATED' ORDER BY 2");
      expect(audit).toEqual(d.map((x) => ({ actor_id: SYSTEM, occ: x.occ })));
      expect(await integrity(c)).toEqual([]);
      // Meron sees them, each linked to its template and occurrence.
      await actAs(c, user.meron);
      const list = (await templateList({ q: async (s, p) => (await c.query(s, p as unknown[])).rows }, null)).find((x) => x.id === t)!;
      expect(list.generated.map((g) => g.recurring_occurrence)).toEqual(["2027-03-31", "2027-02-28", "2027-01-31"]);
    });
  });
});

describe("generation rules", () => {
  it("a run after a missed month creates each missed occurrence once", async () => {
    await tx(async (c) => {
      await clock(c, "2027-01-15"); const t = await save(c, { next: "2027-01-31" });
      await clock(c, "2027-03-31"); expect(await generate(c)).toBe(3); expect(await generate(c)).toBe(0);
      expect((await drafts(c, t)).map((x) => x.occ)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
    });
  });
  it("stops after the end date, and when turned off", async () => {
    await tx(async (c) => {
      await clock(c, "2027-01-15");
      const ending = await save(c, { next: "2027-01-31", end: "2027-02-28" });
      const off = await save(c, { next: "2027-01-31", frequency: "WEEKLY" });
      await clock(c, "2027-01-31"); expect(await generate(c)).toBe(2);
      await actAs(c, user.meron); await fn(c, "recurring_template_set_active", off, false);
      await clock(c, "2027-05-31"); expect(await generate(c)).toBe(1);   // only February from the ending one; nothing from the one turned off
      expect((await drafts(c, ending)).map((x) => x.occ)).toEqual(["2027-01-31", "2027-02-28"]);
      expect(await drafts(c, off)).toHaveLength(1);
      await actAs(c, user.meron); expect(await fails(c, "SELECT recurring_template_set_active($1, true)", [off])).toMatch(/next date of today or later/);
    });
  });
  it("creates nothing when the payee, account or creator is no longer valid, keeps the date, says why, and catches up once fixed", async () => {
    const q = (sql: string, p: unknown[]) => (c: Client) => c.query(sql, p);
    for (const [what, breakIt, fixIt, reason] of [
      ["supplier link inactive", q("UPDATE company_suppliers SET status = 'INACTIVE' WHERE company_id = $1 AND supplier_id = $2", [ASKU, S_HAWASSA]), q("UPDATE company_suppliers SET status = 'ACTIVE' WHERE company_id = $1 AND supplier_id = $2", [ASKU, S_HAWASSA]), /supplier is not active/],
      ["account deactivated", q("UPDATE company_bank_accounts SET is_active = false WHERE id = $1", [AWASH]), q("UPDATE company_bank_accounts SET is_active = true WHERE id = $1", [AWASH]), /debit account is not available/],
      ["creator deactivated", q("UPDATE users SET is_active = false WHERE id = $1", [user.meron]), q("UPDATE users SET is_active = true WHERE id = $1", [user.meron]), /can no longer create payment requests/],
    ] as const) await tx(async (c) => {
      await clock(c, "2027-01-15"); const t = await save(c, { next: "2027-01-31" });
      await breakIt(c);
      await clock(c, "2027-01-31"); expect({ what, n: await generate(c) }).toEqual({ what, n: 0 });
      expect({ what, ...(await tpl(c, t)) }).toMatchObject({ what, nd: "2027-01-31", last_error: expect.stringMatching(reason) });
      expect(await drafts(c, t)).toHaveLength(0);
      await fixIt(c);
      await clock(c, "2027-02-01"); expect(await generate(c)).toBe(1);
      expect({ what, ...(await tpl(c, t)) }).toMatchObject({ what, nd: "2027-02-28", last_error: null });
    });
  });
});

describe("estimated amounts", () => {
  it("must be confirmed by the Draft's creator before it can be submitted or scheduled", async () => {
    await tx(async (c) => {
      await clock(c, "2027-01-15"); const t = await save(c, { next: "2027-01-31", estimate: true, dueDays: 20 });
      await clock(c, "2027-01-31"); await generate(c);
      const [d] = await drafts(c, t);
      expect(d.amount_is_estimate).toBe(true);
      await actAs(c, user.meron);
      expect(await fails(c, "SELECT wf_submit($1)", [d.id])).toMatch(/estimate from a recurring payment: confirm it/);
      expect(await fails(c, "SELECT wf_schedule($1,'2027-02-10'::date)", [d.id])).toMatch(/estimate from a recurring payment: confirm it/);
      await actAs(c, user.lidya); expect(await fails(c, "SELECT confirm_request_amount($1)", [d.id])).toMatch(/request not found|only the creator/);
      await actAs(c, user.meron); await fn(c, "confirm_request_amount", d.id);
      expect(await fails(c, "SELECT confirm_request_amount($1)", [d.id])).toMatch(/already confirmed/);
      await fn(c, "wf_submit", d.id);
      expect((await rows(c, "SELECT workflow_state::text s, amount_confirmed_by FROM payment_requests WHERE id = $1", [d.id]))[0]).toEqual({ s: "RESERVED", amount_confirmed_by: user.meron });
      expect((await rows(c, "SELECT metadata FROM audit_events WHERE action = 'REQUEST_AMOUNT_CONFIRMED' AND entity_id = $1", [d.id]))[0].metadata).toMatchObject({ amount: 1000, template: t });
    });
  });
  it("a fixed amount needs no confirmation", async () => {
    await tx(async (c) => {
      await clock(c, "2027-01-15"); const t = await save(c, { next: "2027-01-31" });
      await clock(c, "2027-01-31"); await generate(c);
      const [d] = await drafts(c, t);
      await actAs(c, user.meron); expect(await fails(c, "SELECT confirm_request_amount($1)", [d.id])).toMatch(/not an estimate/);
      await fn(c, "wf_submit", d.id);
    });
  });
});

describe("who may keep templates", () => {
  it("only Accountants with recurring_payment:manage in the company, with valid details; changes are audited", async () => {
    await tx(async (c) => {
      await clock(c, "2027-01-15");
      const attempt = "SELECT recurring_template_save(NULL,$1,'X','SUPPLIER',$2,$3,'TRANSFER',100,false,'MONTHLY','2027-01-31'::date,NULL,0,'NORMAL',NULL)";
      for (const who of [user.dawit, user.kebede, user.tigist, user.selam]) { await actAs(c, who); expect({ who, err: await fails(c, attempt, [ASKU, S_HAWASSA, AWASH]) }).toMatchObject({ who, err: expect.stringMatching(/may not manage recurring payments/) }); }
      await actAs(c, user.meron);
      const bad = (sql: string, p: unknown[] = [ASKU, S_HAWASSA, AWASH]) => fails(c, sql, p);
      expect(await bad("SELECT recurring_template_save(NULL,$1,'X','SUPPLIER',$2,$3,'TRANSFER',100,false,'MONTHLY','2027-01-14'::date,NULL,0,'NORMAL',NULL)")).toMatch(/today or later/);
      expect(await bad("SELECT recurring_template_save(NULL,$1,'X','SUPPLIER',$2,$3,'TRANSFER',100,false,'MONTHLY','2027-01-31'::date,'2027-01-01'::date,0,'NORMAL',NULL)")).toMatch(/end date cannot be before/);
      expect(await bad("SELECT recurring_template_save(NULL,$1,'X','SUPPLIER',$2,$3,'CASH',100,false,'MONTHLY','2027-01-31'::date,NULL,0,'NORMAL',NULL)")).toMatch(/cash payment must come from a cash account/);
      expect(await bad("SELECT recurring_template_save(NULL,$1,'X','SUPPLIER',$2,$3,'TRANSFER',0,false,'MONTHLY','2027-01-31'::date,NULL,0,'NORMAL',NULL)")).toMatch(/check/i);
      expect(await bad("SELECT recurring_template_save(NULL,$1,'X','SUPPLIER',$2,$3,'TRANSFER',100,false,'MONTHLY','2027-01-31'::date,NULL,0,'NORMAL',NULL)", [ASKU, "d0000000-0000-4000-8000-000000000002", AWASH])).toMatch(/supplier is not active/);
      const t = await save(c, { next: "2027-01-31" });
      await save(c, { next: "2027-01-31", amount: 1200, estimate: true }, t);
      await actAs(c, user.lidya); await save(c, { next: "2027-01-31", amount: 1250, who: user.lidya }, t);   // another ASKU accountant may change it; Drafts stay in Meron's name
      expect((await rows(c, "SELECT created_by, amount::numeric::text a FROM recurring_payment_templates WHERE id = $1", [t]))[0]).toEqual({ created_by: user.meron, a: "1250.00" });
      const audit = await rows(c, "SELECT action, actor_id, metadata->'before'->>'amount' before FROM audit_events WHERE entity_id = $1 ORDER BY occurred_at, action", [t]);
      expect(audit.map((a) => a.action)).toEqual(["RECURRING_TEMPLATE_CREATED", "RECURRING_TEMPLATE_UPDATED", "RECURRING_TEMPLATE_UPDATED"]);
      await actAs(c, user.dawit); expect(await fails(c, "SELECT recurring_template_set_active($1,false)", [t])).toMatch(/may not manage/);
    });
  });
  it("Finance Managers of the company see templates; other companies and group reporting do not; nobody writes the table directly", async () => {
    await clock(owner, "2027-01-15").then(() => owner.query("BEGIN"));
    let t = "";
    try { t = await save(owner, { next: "2027-01-31" }); await owner.query("COMMIT"); } catch (e) { await owner.query("ROLLBACK"); throw e; }
    await owner.query("CREATE OR REPLACE FUNCTION treasury_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $f$ SELECT clock_timestamp() $f$");
    for (const [who, sees] of [[user.meron, true], [user.dawit, true], [user.kebede, true], [user.tigist, false], [user.selam, false], [user.bereket, false]] as const)
      await as(who, async (c) => { expect({ who, sees: (await rows(c, "SELECT id FROM recurring_payment_templates WHERE id = $1", [t])).length === 1 }).toEqual({ who, sees }); });
    await as(user.meron, async (c) => {
      expect(await fails(c, "UPDATE recurring_payment_templates SET amount = 1 WHERE id = $1", [t])).toMatch(/permission denied/);
      expect(await fails(c, "INSERT INTO recurring_payment_templates (company_id) VALUES ($1)", [ASKU])).toMatch(/permission denied/);
      expect(await fails(c, "SELECT generate_recurring_requests()")).toMatch(/permission denied/);
    });
    await owner.query("DELETE FROM audit_events WHERE entity_id = $1", [t]).catch(() => {});
    await owner.query("UPDATE recurring_payment_templates SET is_active = false WHERE id = $1", [t]);
  });
});

describe("overlapping runs", () => {
  it("two workers at once create a due occurrence exactly once (committed, real clock)", async () => {
    const today = (await rows(owner, "SELECT addis_day(clock_timestamp())::text d"))[0].d;
    await owner.query("BEGIN");
    let t = "";
    try { t = await save(owner, { next: today }); await owner.query("COMMIT"); } catch (e) { await owner.query("ROLLBACK"); throw e; }
    const run = async () => { const w = new Client({ connectionString: workerUrl }); await w.connect(); try { return Number((await w.query("SELECT generate_recurring_requests() n")).rows[0].n); } finally { await w.end(); } };
    const [a, b] = await Promise.all([run(), run()]);
    expect(a + b).toBe(1);
    expect((await drafts(owner, t)).map((x) => x.occ)).toEqual([today]);
    expect(await run()).toBe(0);
    expect(await integrity(owner)).toEqual([]);
  });
});
