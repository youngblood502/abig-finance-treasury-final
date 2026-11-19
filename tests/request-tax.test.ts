import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { actAs, ASKU, AWASH, BD_HAWASSA, fails, fn, key, mk, rows, setupDb, S_HAWASSA, user } from "./helpers";

// VAT and withholding on requests, in the database: the settings and who may change them, the snapshot each request records, what stays fixed,
// the reviewer's adjustment, and that only the net payment is ever reserved or debited.
const DB = "abig_test_request_tax";
let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
beforeAll(async () => { const d = await setupDb(DB); owner = d.owner; as = d.as; }, 120_000);
afterAll(async () => { await owner?.end(); });

/** Runs f in a transaction on the owner connection that is always rolled back. */
async function tx<T>(f: (c: Client) => Promise<T>): Promise<T> {
  await owner.query("BEGIN");
  try { return await f(owner); } finally { await owner.query("ROLLBACK"); }
}
const integrity = async (c: Client) => (await c.query(readFileSync(join(__dirname, "../ops/verify-integrity.sql"), "utf8").replace(/^\\set.*$/m, ""))).rows.filter((r) => Number(r.violations) > 0).map((r) => r.name);
const STD = async (c: Client) => (await rows(c, "SELECT id FROM tax_vat_rates WHERE name = 'Standard VAT'"))[0].id as string;
const ZERO = async (c: Client) => (await rows(c, "SELECT id FROM tax_vat_rates WHERE name = 'Non-taxable'"))[0].id as string;
const setThreshold = async (c: Client, threshold: string | null, pct = "3") => { await actAs(c, user.admin); if (threshold !== null) await c.query("SELECT admin_withholding_update($1::numeric,$2::numeric)", [pct, threshold]); };

interface TaxOpts { mode?: "BEFORE_VAT" | "TOTAL"; entered?: string; rate?: string; withholding?: boolean; dues?: string[]; amounts?: string[] }
/** A complete taxed draft from Meron on ASKU's Awash account; one installment of the calculated net unless amounts are given. */
async function draft(c: Client, o: TaxOpts = {}) {
  await actAs(c, user.meron);
  const id = (await rows(c, `INSERT INTO payment_requests (debtor_company_id, supplier_id, supplier_bank_detail_id, debit_account_id, created_by, invoice_ref, invoice_date, total_amount, amount_input_mode, entered_amount, vat_rate_id, withholding_applied)
     VALUES ($1,$2,$3,$4,$5,$6,'2026-10-01',1,$7,$8::numeric,$9,$10) RETURNING id`, [ASKU, S_HAWASSA, BD_HAWASSA, AWASH, user.meron, "INV-" + key().slice(0, 8), o.mode ?? "BEFORE_VAT", o.entered ?? "100000", o.rate ?? await STD(c), o.withholding ?? false]))[0].id as string;
  const net = (await rows(c, "SELECT total_amount::text n FROM payment_requests WHERE id=$1", [id]))[0].n as string;
  const amounts = o.amounts ?? [net];
  for (const [i, a] of amounts.entries()) await c.query("INSERT INTO payment_installments (request_id, seq, due_date, amount) VALUES ($1,$2,$3::date,$4::numeric)", [id, i + 1, o.dues?.[i] ?? "2026-12-31", a]);
  await c.query(`INSERT INTO attachments (request_id, kind, object_key, filename, mime_type, size_bytes, sha256, uploaded_by) VALUES ($1,'INVOICE',$2,'inv.pdf','application/pdf',1000,$3,$4)`, [id, key(), key(), user.meron]);
  return id;
}
const tax = async (c: Client, id: string) => (await rows(c, `SELECT workflow_state::text s, version v, amount_input_mode m, entered_amount::text e, vat_rate_name rn, vat_rate_percent::text rp, amount_before_vat::text b, vat_amount::text vat,
  gross_amount::text g, withholding_applied wa, withholding_rate_percent::text wp, withholding_threshold::text wt, withholding_amount::text w, total_amount::text n FROM payment_requests WHERE id=$1`, [id]))[0];
const account = async (c: Client) => (await rows(c, "SELECT current_balance::text c, reserved_balance::text r, available_balance::text a, shortfall_amount::text s FROM company_bank_accounts WHERE id=$1", [AWASH]))[0];
const submit = async (c: Client, id: string) => { await actAs(c, user.meron); return await fn(c, "wf_submit", id) as number; };

describe("tax settings", () => {
  it("start with Standard VAT at 15% as the default, Non-taxable at 0%, and 3% withholding with no threshold", async () => {
    await as(user.meron, async (c) => {
      expect((await rows(c, "SELECT kind, name, rate_percent::text p, is_default, threshold_amount FROM tax_options()"))).toEqual([
        { kind: "VAT", name: "Standard VAT", p: "15.00", is_default: true, threshold_amount: null }, { kind: "VAT", name: "Non-taxable", p: "0.00", is_default: false, threshold_amount: null },
        { kind: "WITHHOLDING", name: "Withholding tax", p: "3.00", is_default: false, threshold_amount: null }]);
    });
  });
  it("cannot be read or written directly by the application role; only a system administrator may change them", async () => {
    await as(user.meron, async (c) => { expect(await fails(c, "SELECT * FROM tax_vat_rates")).toMatch(/permission denied/); expect(await fails(c, "UPDATE tax_withholding_settings SET rate_percent = 1")).toMatch(/permission denied/); });
    for (const who of [user.meron, user.dawit, user.kebede, user.selam]) await as(who, async (c) => {
      expect(await fails(c, "SELECT admin_vat_rate_add('Reduced', 7.5)")).toMatch(/only a system administrator/);
      expect(await fails(c, "SELECT admin_withholding_update(5, 1000)")).toMatch(/only a system administrator/);
      expect(await fails(c, "SELECT * FROM admin_tax_settings()")).toMatch(/only a system administrator/);
    });
    await as(user.admin, async (c) => { expect((await rows(c, "SELECT * FROM admin_tax_settings()")).length).toBe(3); });
  });
  it("every change is audited with the previous and new values", async () => {
    await as(user.admin, async (c) => {
      const id = await fn(c, "admin_vat_rate_add", "Reduced VAT", "7.5") as string;
      await c.query("SELECT admin_vat_rate_update($1,'Reduced rate',8)", [id]);
      await c.query("SELECT admin_vat_rate_set_default($1)", [id]);
      const std = (await rows(c, "SELECT id FROM admin_tax_settings() WHERE name = 'Standard VAT'"))[0].id;
      await c.query("SELECT admin_vat_rate_set_active($1,false)", [std]);
      await c.query("SELECT admin_withholding_update(2.5, 10000)");
      // One transaction: every entry has the same time, so they are found by action.
      const audit = await rows(c, "SELECT action, entity_id, metadata, actor_id FROM audit_events WHERE action LIKE 'TAX_%'");
      const by = (a: string) => audit.find((x) => x.action === a)!;
      expect(audit.map((a) => a.action).sort()).toEqual(["TAX_VAT_DEFAULT_CHANGED", "TAX_VAT_RATE_ADDED", "TAX_VAT_RATE_DEACTIVATED", "TAX_VAT_RATE_UPDATED", "TAX_WITHHOLDING_UPDATED"]);
      expect(audit.every((a) => a.actor_id === user.admin)).toBe(true);
      expect(by("TAX_VAT_RATE_ADDED").metadata).toEqual({ new: { name: "Reduced VAT", rate_percent: 7.5 } });
      expect(by("TAX_VAT_RATE_UPDATED").metadata).toEqual({ previous: { name: "Reduced VAT", rate_percent: 7.5 }, new: { name: "Reduced rate", rate_percent: 8 } });
      expect(by("TAX_VAT_DEFAULT_CHANGED").metadata).toMatchObject({ previous: { name: "Standard VAT", rate_percent: 15 }, new: { name: "Reduced rate", rate_percent: 8 } });
      expect(by("TAX_VAT_RATE_DEACTIVATED").metadata).toMatchObject({ name: "Standard VAT", previous: { is_active: true }, new: { is_active: false } });
      expect(by("TAX_WITHHOLDING_UPDATED").metadata).toEqual({ previous: { rate_percent: 3, threshold_amount: null }, new: { rate_percent: 2.5, threshold_amount: 10000 } });
    });
  });
  it("refuses invalid changes: the default deactivated, an inactive default, a duplicate name, impossible percentages, a negative threshold", async () => {
    await as(user.admin, async (c) => {
      const std = (await rows(c, "SELECT id FROM admin_tax_settings() WHERE name = 'Standard VAT'"))[0].id, zero = (await rows(c, "SELECT id FROM admin_tax_settings() WHERE name = 'Non-taxable'"))[0].id;
      expect(await fails(c, "SELECT admin_vat_rate_set_active($1,false)", [std])).toMatch(/default VAT rate cannot be deactivated/);
      await c.query("SELECT admin_vat_rate_set_active($1,false)", [zero]);
      expect(await fails(c, "SELECT admin_vat_rate_set_default($1)", [zero])).toMatch(/only an active VAT rate/);
      expect(await fails(c, "SELECT admin_vat_rate_add('standard vat', 10)")).toMatch(/already exists/);
      for (const p of ["100", "-1", "1.234"]) expect(await fails(c, `SELECT admin_vat_rate_add('X${p}', ${p})`)).toMatch(/percentage/);
      expect(await fails(c, "SELECT admin_withholding_update(0, 1000)")).toMatch(/above 0/);
      expect(await fails(c, "SELECT admin_withholding_update(3, -1)")).toMatch(/threshold/);
      expect(await fails(c, "SELECT admin_withholding_update(3, 10.005)")).toMatch(/two decimal/);
      expect(await fails(c, "DELETE FROM tax_vat_rates")).toMatch(/permission denied/);
    });
    await tx(async (c) => { expect(await fails(c, "DELETE FROM tax_vat_rates")).toBeTruthy(); });   // even the owner: rates are never deleted
  });
});

describe("a request's tax snapshot", () => {
  it("records the inputs, the rate and the figures; total_amount is the net payment", async () => {
    await tx(async (c) => {
      await setThreshold(c, "10000");
      const id = await draft(c, { entered: "100000", withholding: true });
      expect(await tax(c, id)).toMatchObject({ s: "DRAFT", m: "BEFORE_VAT", e: "100000.0000", rn: "Standard VAT", rp: "15.00", b: "100000.0000", vat: "15000.0000", g: "115000.0000", wa: true, wp: "3.00", wt: "10000.0000", w: "3000.0000", n: "112000.0000" });
      const t = await draft(c, { mode: "TOTAL", entered: "115000" });
      expect(await tax(c, t)).toMatchObject({ m: "TOTAL", b: "100000.0000", vat: "15000.0000", g: "115000.0000", wa: false, w: "0.0000", n: "115000.0000" });
      const z = await draft(c, { mode: "TOTAL", entered: "5000", rate: await ZERO(c) });
      expect(await tax(c, z)).toMatchObject({ rn: "Non-taxable", b: "5000.0000", vat: "0.0000", g: "5000.0000", n: "5000.0000" });
    });
  });
  it("the figures cannot be forged: the database calculates them, and the application role cannot write them", async () => {
    await tx(async (c) => {
      const id = await draft(c);
      expect(await fails(c, "UPDATE payment_requests SET vat_amount = 1, gross_amount = 2, withholding_amount = 3 WHERE id = $1", [id])).toMatch(/calculated by the database/);
      expect(await fails(c, "UPDATE payment_requests SET total_amount = 4 WHERE id = $1", [id])).toMatch(/calculated by the database/);
      // On insert, whatever is sent for the figures is replaced by the calculation.
      await actAs(c, user.meron);
      const forged = (await rows(c, `INSERT INTO payment_requests (debtor_company_id, supplier_id, created_by, total_amount, amount_input_mode, entered_amount, vat_rate_id, withholding_applied, vat_amount, gross_amount, withholding_amount)
        VALUES ($1,$2,$3,1,'BEFORE_VAT',1000,$4,false,999,999,999) RETURNING id`, [ASKU, S_HAWASSA, user.meron, await STD(c)]))[0].id;
      expect(await tax(c, forged)).toMatchObject({ vat: "150.0000", g: "1150.0000", w: "0.0000", n: "1150.0000" });
      expect(await tax(c, id)).toMatchObject({ vat: "15000.0000", g: "115000.0000", w: "0.0000", n: "115000.0000" });
    });
    await as(user.meron, async (c) => {
      expect(await fails(c, "UPDATE payment_requests SET vat_amount = 1")).toMatch(/permission denied/);
      expect(await fails(c, "INSERT INTO payment_requests (debtor_company_id, created_by, total_amount, gross_amount) VALUES ($1,$2,1,1)", [ASKU, user.meron])).toMatch(/permission denied/);
    });
  });
  it("withholding below the threshold, or with no threshold set, is refused with a clear reason, never applied silently", async () => {
    await tx(async (c) => {
      await c.query("SAVEPOINT a");
      await expect(draft(c, { entered: "100000", withholding: true })).rejects.toThrow(/until a system administrator sets the withholding threshold/);
      await c.query("ROLLBACK TO a");
      await setThreshold(c, "10000");
      await expect(draft(c, { entered: "9999.99", withholding: true })).rejects.toThrow(/at least ETB 10,000.00; this amount before VAT is ETB 9,999.99/);
      await c.query("ROLLBACK TO a");
      await setThreshold(c, "10000");
      // A total of 11,000 including VAT is above the threshold, its amount before VAT (9,565.22) is not.
      await expect(draft(c, { mode: "TOTAL", entered: "11000", withholding: true })).rejects.toThrow(/this amount before VAT is ETB 9,565.22/);
      await c.query("ROLLBACK TO a");
    });
  });
  it("zero, negative and three-decimal amounts are refused", async () => {
    await tx(async (c) => {
      for (const entered of ["0", "-10", "10.005"]) { await c.query("SAVEPOINT a"); await expect(draft(c, { entered })).rejects.toThrow(/more than zero|two decimal/); await c.query("ROLLBACK TO a"); }
    });
  });
  it("only the net payment is reserved and debited; withholding never touches the balances", async () => {
    await tx(async (c) => {
      await setThreshold(c, "10000");
      const before = await account(c);
      const id = await draft(c, { entered: "100000", withholding: true });
      const v1 = await submit(c, id);
      const held = await account(c);
      expect(Number(held.r) - Number(before.r)).toBe(112000);
      expect(Number(before.a) - Number(held.a)).toBe(112000);
      expect(held.s).toBe(before.s);
      await actAs(c, user.dawit); const v2 = await fn(c, "wf_verify", id, v1);
      await actAs(c, user.kebede); await fn(c, "wf_authorize", id, v2);
      const after = await account(c);
      expect(Number(before.c) - Number(after.c)).toBe(112000);
      expect(after.r).toBe(before.r);
      expect((await rows(c, "SELECT previous_balance - new_balance AS d FROM bank_balance_history WHERE request_id = $1", [id]))[0].d).toBe("112000.0000");
      expect(await integrity(c)).toEqual([]);
    });
  });
});

describe("history is never recalculated from new settings", () => {
  it("a submitted request keeps its rates and figures when the settings change; new drafts take the new ones", async () => {
    await tx(async (c) => {
      await setThreshold(c, "10000");
      const old = await draft(c, { entered: "100000", withholding: true }); await submit(c, old);
      const snapshot = await tax(c, old);
      await actAs(c, user.admin);
      await c.query("SELECT admin_vat_rate_update($1,'Standard VAT',16)", [await STD(c)]);
      await c.query("SELECT admin_withholding_update(5, 50000)");
      expect(await tax(c, old)).toEqual(snapshot);
      const fresh = await draft(c, { entered: "100000", withholding: true });
      expect(await tax(c, fresh)).toMatchObject({ rp: "16.00", vat: "16000.0000", wp: "5.00", wt: "50000.0000", w: "5000.0000", n: "111000.0000" });
      expect(await integrity(c)).toEqual([]);
    });
  });
  it("a draft keeps its snapshot through system updates and takes the current settings when its creator saves it", async () => {
    await tx(async (c) => {
      const id = await draft(c, { entered: "1000" });
      await actAs(c, user.admin); await c.query("SELECT admin_vat_rate_update($1,'Standard VAT',16)", [await STD(c)]);
      await c.query("UPDATE payment_requests SET priority = 'HIGH' WHERE id = $1", [id]);
      expect(await tax(c, id)).toMatchObject({ rp: "15.00", vat: "150.0000" });
      await c.query("SELECT set_config('app.tax_refresh','on',true)"); await c.query("UPDATE payment_requests SET priority = 'NORMAL' WHERE id = $1", [id]); await c.query("SELECT set_config('app.tax_refresh','off',true)");
      expect(await tax(c, id)).toMatchObject({ rp: "16.00", vat: "160.0000", n: "1160.0000" });
    });
  });
  it("a deactivated rate cannot be chosen or submitted, but requests that recorded it keep it", async () => {
    await tx(async (c) => {
      await actAs(c, user.admin); const reduced = await fn(c, "admin_vat_rate_add", "Reduced VAT", "7.5") as string;
      const sent = await draft(c, { entered: "1000", rate: reduced }); await submit(c, sent);
      const waiting = await draft(c, { entered: "1000", rate: reduced });
      await actAs(c, user.admin); await c.query("SELECT admin_vat_rate_set_active($1,false)", [reduced]);
      expect(await tax(c, sent)).toMatchObject({ s: "RESERVED", rn: "Reduced VAT", rp: "7.50" });
      await actAs(c, user.meron); expect(await fails(c, "SELECT wf_submit($1)", [waiting])).toMatch(/VAT rate on this request \(Reduced VAT\) is no longer in use/);
      await c.query("SAVEPOINT a"); await expect(draft(c, { rate: reduced })).rejects.toThrow(/choose an active VAT rate/); await c.query("ROLLBACK TO a");
    });
  });
  it("after submission the tax figures change only through a reviewer's adjustment, and a breakdown cannot be removed", async () => {
    await tx(async (c) => {
      const id = await draft(c); await submit(c, id);
      await c.query("SELECT set_config('app.wf','on',true)");
      expect(await fails(c, "UPDATE payment_requests SET entered_amount = 5 WHERE id = $1", [id])).toMatch(/change only through a reviewer's adjustment/);
      expect(await fails(c, "UPDATE payment_requests SET total_amount = 5 WHERE id = $1", [id])).toMatch(/change only through a reviewer's adjustment/);
      expect(await fails(c, "UPDATE payment_requests SET amount_input_mode = NULL WHERE id = $1", [id])).toMatch(/cannot be removed/);
      await c.query("SELECT set_config('app.wf','off',true)");
    });
    await as(user.meron, async (c) => { expect((await c.query("UPDATE payment_requests SET entered_amount = 5 WHERE workflow_state <> 'DRAFT'")).rowCount).toBe(0); });   // not even visible to update
  });
  it("requests from before tax configuration keep no breakdown and work as before", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [600, 400] });
      expect(await tax(c, id)).toMatchObject({ m: null, e: null, b: null, vat: null, g: null, w: null, n: "1000.0000" });
      await submit(c, id);
      expect((await tax(c, id)).s).toBe("RESERVED");
    });
  });
});

describe("the reviewer's adjustment", () => {
  it("recalculates from the new amount with the request's own snapshot, resizes the reservation, and audits every figure", async () => {
    await tx(async (c) => {
      await setThreshold(c, "10000");
      const id = await draft(c, { entered: "100000", withholding: true }); const v = await submit(c, id);
      await actAs(c, user.admin); await c.query("SELECT admin_withholding_update(5, 500000)");   // after the request: must not apply to it
      const before = await account(c);
      await actAs(c, user.dawit); await fn(c, "wf_adjust", id, v, JSON.stringify({ entered_amount: "200000" }), "Invoice corrected");
      expect(await tax(c, id)).toMatchObject({ s: "RESERVED", e: "200000.0000", b: "200000.0000", vat: "30000.0000", g: "230000.0000", wp: "3.00", wt: "10000.0000", w: "6000.0000", n: "224000.0000" });
      expect((await rows(c, "SELECT amount::text a FROM payment_installments WHERE request_id = $1", [id]))[0].a).toBe("224000.0000");
      expect(Number((await account(c)).r) - Number(before.r)).toBe(112000);
      const h = await rows(c, "SELECT field, old_value, new_value, reason, actor_id, entity_type FROM adjustment_history WHERE request_id = $1 ORDER BY id", [id]);
      expect(Object.fromEntries(h.map((x) => [x.field + (x.entity_type === "INSTALLMENT" ? ":inst" : ""), [Number(x.old_value), Number(x.new_value)]]))).toEqual({
        entered_amount_before_vat: [100000, 200000], amount_before_vat: [100000, 200000], vat_amount: [15000, 30000], gross_amount: [115000, 230000], withholding_amount: [3000, 6000], total_amount: [112000, 224000], "amount:inst": [112000, 224000] });
      expect(h.every((x) => x.reason === "Invoice corrected" && x.actor_id === user.dawit)).toBe(true);
      expect(await integrity(c)).toEqual([]);
    });
  });
  it("can change the VAT rate (taking its current percentage) and turn withholding off or on; the total cannot be set directly", async () => {
    await tx(async (c) => {
      await setThreshold(c, "10000");
      const id = await draft(c, { entered: "100000" }); let v = await submit(c, id);
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT wf_adjust($1,$2,$3,'x y z')", [id, v, JSON.stringify({ total_amount: 1 })])).toMatch(/calculated from its tax breakdown/);
      v = await fn(c, "wf_adjust", id, v, JSON.stringify({ vat_rate_id: await ZERO(c), withholding_applied: true }), "Exempt supplier, withholding applies") as number;
      expect(await tax(c, id)).toMatchObject({ rn: "Non-taxable", rp: "0.00", vat: "0.0000", g: "100000.0000", wa: true, w: "3000.0000", n: "97000.0000" });
      const fields = (await rows(c, "SELECT field, old_value, new_value FROM adjustment_history WHERE request_id = $1 AND field IN ('vat_rate','withholding_applied') ORDER BY field", [id]));
      expect(fields).toEqual([{ field: "vat_rate", old_value: "Standard VAT (15.00%)", new_value: "Non-taxable (0.00%)" }, { field: "withholding_applied", old_value: "no", new_value: "yes" }]);
      expect(await fails(c, "SELECT wf_adjust($1,$2,$3,'x y z')", [id, v, JSON.stringify({ entered_amount: "5000" })])).toMatch(/at least ETB 10,000.00/);
    });
  });
  it("with several installments, the reviewer's amounts must add up to the new net", async () => {
    await tx(async (c) => {
      const id = await draft(c, { entered: "1000", amounts: ["575", "575"], dues: ["2026-12-01", "2026-12-31"] }); const v = await submit(c, id);
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT wf_adjust($1,$2,$3,'x y z')", [id, v, JSON.stringify({ entered_amount: "2000" })])).toMatch(/installments \(1150\.0000\) must add up to the request total \(2300\.00(00)?\)/);
      await fn(c, "wf_adjust", id, v, JSON.stringify({ entered_amount: "2000", installments: [{ seq: 1, amount: "1150" }, { seq: 2, amount: "1150" }] }), "Doubled");
      expect((await tax(c, id)).n).toBe("2300.0000");
    });
  });
  it("a request without a breakdown is adjusted by its total as before", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron); const id = await mk(c, user.meron, { amounts: [1000] }); const v = await submit(c, id);
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT wf_adjust($1,$2,$3,'x y z')", [id, v, JSON.stringify({ entered_amount: "5" })])).toMatch(/no tax breakdown/);
      await fn(c, "wf_adjust", id, v, JSON.stringify({ total_amount: 900, installments: [{ seq: 1, amount: 900 }] }), "Discount");
      expect(await tax(c, id)).toMatchObject({ m: null, n: "900.0000" });
    });
  });
});

describe("adjusting a request with one installment", () => {
  /** A submitted taxed request (100,000 before VAT, 15% VAT, no withholding: net 115,000) with one installment due 2026-12-31. */
  const submitted = async (c: Client) => { const id = await draft(c, { entered: "100000" }); const v = await submit(c, id); await actAs(c, user.dawit); return { id, v }; };
  const inst = async (c: Client, id: string) => (await rows(c, "SELECT amount::text a, due_date::text d FROM payment_installments WHERE request_id = $1", [id]));
  const history = async (c: Client, id: string) => (await rows(c, "SELECT entity_type || ':' || field AS f FROM adjustment_history WHERE request_id = $1 ORDER BY 1", [id])).map((x) => x.f);
  const adjust = (c: Client, id: string, v: number, changes: object, reason = "Invoice corrected") => fn(c, "wf_adjust", id, v, JSON.stringify(changes), reason);

  it("amount and due date changed together: the installment takes the new net and the new date", async () => {
    await tx(async (c) => {
      const { id, v } = await submitted(c);
      await adjust(c, id, v, { entered_amount: "200000", installments: [{ seq: 1, due_date: "2027-01-15" }] });
      expect((await tax(c, id)).n).toBe("230000.0000");
      expect(await inst(c, id)).toEqual([{ a: "230000.0000", d: "2027-01-15" }]);
      expect(await history(c, id)).toEqual(["INSTALLMENT:amount", "INSTALLMENT:due_date", "REQUEST:amount_before_vat", "REQUEST:entered_amount_before_vat", "REQUEST:gross_amount", "REQUEST:total_amount", "REQUEST:vat_amount"]);
      expect(await integrity(c)).toEqual([]);
    });
  });
  it("amount changed without the due date: the installment takes the new net and keeps its date", async () => {
    await tx(async (c) => {
      const { id, v } = await submitted(c);
      await adjust(c, id, v, { entered_amount: "50000" });
      expect(await inst(c, id)).toEqual([{ a: "57500.0000", d: "2026-12-31" }]);
      expect(await history(c, id)).toContain("INSTALLMENT:amount");
      expect(await history(c, id)).not.toContain("INSTALLMENT:due_date");
    });
  });
  it("due date changed without the amount: nothing else moves", async () => {
    await tx(async (c) => {
      const { id, v } = await submitted(c);
      const before = await tax(c, id);
      await adjust(c, id, v, { installments: [{ seq: 1, due_date: "2027-02-01" }] }, "Supplier agreed a later date");
      expect(await inst(c, id)).toEqual([{ a: "115000.0000", d: "2027-02-01" }]);
      expect(await tax(c, id)).toMatchObject({ s: "RESERVED", n: before.n, g: before.g, vat: before.vat });
      expect(await history(c, id)).toEqual(["INSTALLMENT:due_date"]);
    });
  });
  it("an explicit installment amount is kept: accepted when it equals the new net, refused when it does not", async () => {
    await tx(async (c) => {
      const { id, v } = await submitted(c);
      await adjust(c, id, v, { entered_amount: "200000", installments: [{ seq: 1, amount: "230000", due_date: "2027-01-15" }] });
      expect(await inst(c, id)).toEqual([{ a: "230000.0000", d: "2027-01-15" }]);
    });
    await tx(async (c) => {
      const { id, v } = await submitted(c);
      expect(await fails(c, "SELECT wf_adjust($1,$2,$3,'x y z')", [id, v, JSON.stringify({ entered_amount: "200000", installments: [{ seq: 1, amount: "200000" }] })]))
        .toMatch(/installments \(200000(\.0+)?\) must add up to the request total \(230000\.00(00)?\)/);
    });
  });
  it("several installments: a new net without new amounts is refused; amounts that add up are accepted, with new dates", async () => {
    await tx(async (c) => {
      const id = await draft(c, { entered: "1000", amounts: ["575", "575"], dues: ["2026-12-01", "2026-12-31"] }); const v = await submit(c, id);
      await actAs(c, user.dawit);
      expect(await fails(c, "SELECT wf_adjust($1,$2,$3,'x y z')", [id, v, JSON.stringify({ entered_amount: "2000", installments: [{ seq: 1, due_date: "2026-12-05" }] })])).toMatch(/must add up to the request total/);
      await adjust(c, id, v, { entered_amount: "2000", installments: [{ seq: 1, amount: "1000", due_date: "2026-12-05" }, { seq: 2, amount: "1300" }] });
      expect(await rows(c, "SELECT amount::text a, due_date::text d FROM payment_installments WHERE request_id = $1 ORDER BY seq", [id])).toEqual([{ a: "1000.0000", d: "2026-12-05" }, { a: "1300.0000", d: "2026-12-31" }]);
      expect((await tax(c, id)).n).toBe("2300.0000");
    });
  });
  it("a refused adjustment changes nothing: not the request, its installment, its history or the reservation", async () => {
    await tx(async (c) => {
      await setThreshold(c, "10000");
      const { id, v } = await submitted(c);
      const snapshot = async () => ({ r: await tax(c, id), i: await inst(c, id), h: await history(c, id), a: await account(c) });
      const before = await snapshot();
      // Withholding below the threshold, with a new date: refused by the calculation.
      expect(await fails(c, "SELECT wf_adjust($1,$2,$3,'x y z')", [id, v, JSON.stringify({ entered_amount: "5000", withholding_applied: true, installments: [{ seq: 1, due_date: "2027-03-01" }] })])).toMatch(/at least ETB 10,000.00/);
      expect(await snapshot()).toEqual(before);
      // An explicit amount that does not match: refused after the installment row was written, and rolled back with everything else.
      expect(await fails(c, "SELECT wf_adjust($1,$2,$3,'x y z')", [id, v, JSON.stringify({ entered_amount: "200000", installments: [{ seq: 1, amount: "1", due_date: "2027-03-01" }] })])).toMatch(/must add up/);
      expect(await snapshot()).toEqual(before);
      expect(await integrity(c)).toEqual([]);
    });
  });
});

describe("the two-decimal integrity check", () => {
  const CHECK = "request with a tax breakdown, or one of its installments, with an amount of more than two decimal places";
  it("ignores older requests' four-decimal values and reports a request with a tax breakdown", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron);
      const old = await mk(c, user.meron, { amounts: [1000] });
      await c.query("UPDATE payment_requests SET total_amount = 1000.1234 WHERE id = $1", [old]);
      await c.query("UPDATE payment_installments SET amount = 1000.1234 WHERE request_id = $1", [old]);
      expect(await integrity(c)).not.toContain(CHECK);
      const taxed = await draft(c, { entered: "1000" });
      await c.query("UPDATE payment_installments SET amount = 1150.0001 WHERE request_id = $1", [taxed]);
      expect(await integrity(c)).toContain(CHECK);
    });
  });
});
