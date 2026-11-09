import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { actAs, ASKU, authorized, AWASH, CBE, fn, rows, S_ETHIO, S_HAWASSA, setupDb, user } from "./helpers";
import { protectAccountNumber } from "../src/lib/account-numbers";
import { protectIdNumber } from "../src/lib/payees";
import { compose, type OutboxEvent } from "../src/worker/mail";

// The notifications added in Phase 6 Task 2B.1. Each test runs in a transaction on the owner connection that is rolled back; the acting user is
// set with actAs, exactly as the application sets it, so the triggers and workflow functions run as they do in production.
const DAILYMART = "c0000000-0000-4000-8000-000000000004";
let owner: Client; let mon: string; let authUrl: string;
beforeAll(async () => {
  const d = await setupDb("abig_test_events"); owner = d.owner;
  await owner.query("ALTER ROLE abig_auth LOGIN PASSWORD 'auth'");
  const u = new URL(d.workerUrl); u.username = "abig_auth"; u.password = "auth"; authUrl = u.toString();
  mon = (await rows(owner, "SELECT week_monday(addis_day(clock_timestamp()))::text AS d"))[0].d;
});
afterAll(async () => { await owner?.end(); });

async function tx<T>(f: (c: Client) => Promise<T>): Promise<T> { await owner.query("BEGIN"); try { return await f(owner); } finally { await owner.query("ROLLBACK"); } }
const day = (offset: number) => { const d = new Date(mon + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const at = (c: Client, offset: number, time = "09:00") => c.query(`CREATE OR REPLACE FUNCTION treasury_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $f$ SELECT '${day(offset)}T${time}:00+03:00'::timestamptz $f$`);
const events = (c: Client, type: string) => rows(c, "SELECT * FROM notification_outbox WHERE event_type = $1 ORDER BY created_at, id", [type]) as Promise<OutboxEvent[]>;
const to = async (c: Client, id: string) => (await rows(c, "SELECT email FROM outbox_recipients($1)", [id])).map((r) => r.email.replace("@abig.test", ""));
/** Nothing secret: no encrypted value or amount, and none of the given numbers, in the stored payload or the composed email. */
const clean = (e: OutboxEvent, secrets: string[] = []) => {
  const all = JSON.stringify(e.payload) + JSON.stringify(compose(e, "https://x.test"));
  expect(all).not.toMatch(/v1:|ETB/);
  for (const s of secrets) expect(all).not.toContain(s);
};
const revision = async (c: Client, week: string) => Number((await rows(c, "SELECT revision r FROM treasury_weeks WHERE id = $1", [week]))[0].r);

describe("payment paid, and the reconciliation that pays it", () => {
  it("submitted goes to reviewers, returned and locked to the preparer, paid to the requester, each once", async () => {
    await tx(async (c) => {
      await at(c, 0, "08:30"); await actAs(c, user.meron); await c.query("SELECT * FROM record_opening_balance($1, 1000000, '{}')", [AWASH]);
      await at(c, 0, "10:00"); const { id } = await authorized(c, { amounts: [1000], method: "TRANSFER" });
      await at(c, 0, "11:00"); await actAs(c, user.meron); await c.query("SELECT * FROM record_balance_check($1, 999000, $2)", [AWASH, [id]]);
      const week = await fn(c, "start_reconciliation", AWASH, day(0), 999000, 0) as string;
      await fn(c, "match_payment", week, id, day(6), "FT-1");
      await fn(c, "submit_reconciliation", week, await revision(c, week), {}, null);

      let submitted = await events(c, "RECONCILIATION_SUBMITTED");
      expect(submitted).toHaveLength(1);
      expect(await to(c, submitted[0].id)).toEqual(["dawit", "yared"]);   // ASKU's Finance Managers; Meron prepared it
      expect(submitted[0].payload).toMatchObject({ week_id: week, account_label: "ASKU Awash current", path: `/treasury/week/${week}` });
      expect(compose(submitted[0], "https://x.test").subject).toMatch(/ASKU Awash current: the reconciliation for the week of .* is waiting for your review/);
      clean(submitted[0], ["1032"]);

      await actAs(c, user.dawit); await fn(c, "return_reconciliation", week, "Statement date is wrong");
      const returned = await events(c, "RECONCILIATION_RETURNED");
      expect(returned).toHaveLength(1);
      expect(await to(c, returned[0].id)).toEqual(["meron"]);
      expect(compose(returned[0], "https://x.test").text).toContain("Reason: Statement date is wrong");
      expect(await to(c, submitted[0].id)).toEqual([]);   // no longer waiting for review: an unsent reminder goes to nobody

      await actAs(c, user.meron); await fn(c, "submit_reconciliation", week, await revision(c, week), {}, null);
      submitted = (await events(c, "RECONCILIATION_SUBMITTED")).sort((x, y) => Number((x.payload as any).revision) - Number((y.payload as any).revision));
      expect(submitted).toHaveLength(2);
      expect(await to(c, submitted[1].id)).toEqual(["dawit", "yared"]);
      expect(await to(c, submitted[0].id)).toEqual([]);   // the earlier submission, if still unsent, is not sent as well

      expect(await events(c, "REQUEST_PAID")).toHaveLength(0);
      await actAs(c, user.dawit); await c.query("SELECT lock_week($1,$2)", [week, await revision(c, week)]);
      const locked = await events(c, "RECONCILIATION_LOCKED"), paid = await events(c, "REQUEST_PAID");
      expect(locked).toHaveLength(1); expect(await to(c, locked[0].id)).toEqual(["meron"]);
      expect(paid).toHaveLength(1); expect(paid[0].request_id).toBe(id);
      expect(await to(c, paid[0].id)).toEqual(["meron"]);   // the requester
      expect(compose(paid[0], "https://x.test")).toMatchObject({ subject: expect.stringMatching(/^PR-\d+ is paid$/), text: expect.stringContaining(`/requests/${id}`) });
      for (const e of [...locked, ...paid]) clean(e, ["1032"]);
      expect(await to(c, submitted[1].id)).toEqual([]);   // locked: not waiting for review any more

      // Locking again is refused, so nothing is repeated.
      await c.query("SAVEPOINT s"); await expect(c.query("SELECT lock_week($1,$2)", [week, await revision(c, week)])).rejects.toThrow(/locked/); await c.query("ROLLBACK TO s");
      expect(await events(c, "REQUEST_PAID")).toHaveLength(1); expect(await events(c, "RECONCILIATION_LOCKED")).toHaveLength(1);
    });
  });
});

describe("opening balance overdue", () => {
  it("is queued once Monday has ended without an opening, once per account and week, for those who may enter the balance", async () => {
    await tx(async (c) => {
      await at(c, 0, "20:00");
      expect(await fn(c, "enqueue_missing_openings")).toBe(0);   // still Monday
      await at(c, 1, "09:00");
      expect(await fn(c, "enqueue_missing_openings")).toBeGreaterThanOrEqual(2);
      const ev = await events(c, "ACCOUNT_OPENING_OVERDUE"), awash = ev.find((e) => (e.payload as any).account_id === AWASH)!, cbe = ev.find((e) => (e.payload as any).account_id === CBE)!;
      expect(awash.payload).toMatchObject({ account_label: "ASKU Awash current", week_start: day(0), path: `/treasury/${AWASH}` });
      expect(await to(c, awash.id)).toEqual(["lidya", "meron", "yared"]);              // ASKU's accountants
      expect(await to(c, cbe.id)).toEqual(["nardos", "samuel", "tigist"]);             // BEES and Berbero may enter CBE's balance; ASKU may not
      expect(compose(awash, "https://x.test").subject).toBe(`ASKU Awash current: the opening balance for the week of ${day(0)} has not been entered`);
      clean(awash, ["1032"]);

      await at(c, 2, "09:00");
      expect(await fn(c, "enqueue_missing_openings")).toBe(0);   // not again this week
      await actAs(c, user.meron); await c.query("SELECT * FROM record_opening_balance($1, 1000000, '{}')", [AWASH]);
      expect(await to(c, awash.id)).toEqual([]);                 // entered before it was sent: nobody is told
      expect(await rows(c, "SELECT has_function_privilege('abig_worker', 'enqueue_missing_openings()', 'EXECUTE') AS ok")).toEqual([{ ok: true }]);
    });
  });
});

describe("bank details waiting for verification", () => {
  it("a supplier's new details go to Finance Managers of companies that use the supplier, not to whoever entered them", async () => {
    await tx(async (c) => {
      const n = protectAccountNumber("100020003000");
      await actAs(c, user.meron); const byMeron = await fn(c, "supplier_bank_detail_add", S_HAWASSA, "Awash", n.last4, n.enc);
      await actAs(c, user.yared); const byYared = await fn(c, "supplier_bank_detail_add", S_HAWASSA, "Abay", "1111", protectAccountNumber("900011111111").enc);
      await actAs(c, user.nardos); const byNardos = await fn(c, "supplier_bank_detail_add", S_ETHIO, "Awash", "2222", protectAccountNumber("900022222222").enc);
      const all = await events(c, "SUPPLIER_BANK_DETAILS_PENDING"), of = (d: unknown) => all.find((e) => (e.payload as any).detail_id === d)!;
      expect(all).toHaveLength(3);
      const first = of(byMeron), second = of(byYared), ethio = of(byNardos);
      expect(await to(c, first.id)).toEqual(["dawit", "yared"]);
      expect(await to(c, second.id)).toEqual(["dawit"]);          // Yared entered it
      expect(await to(c, ethio.id)).toEqual(["fikru"]);           // only Berbero uses Ethio Chemicals
      expect(compose(first, "https://x.test").subject).toBe("Hawassa Packaging PLC: new bank details are waiting for verification");
      clean(first, ["3000", "100020003000"]);
      // Decided before it was sent, or the company stops using the supplier: nobody is told.
      await actAs(c, user.dawit); await c.query("UPDATE supplier_bank_details SET status = 'VERIFIED' WHERE id = $1", [byYared]);
      expect(await to(c, second.id)).toEqual([]);
      await c.query("UPDATE company_suppliers SET status = 'INACTIVE' WHERE company_id = $1 AND supplier_id = $2", [ASKU, S_HAWASSA]);
      expect(await to(c, first.id)).toEqual([]);
    });
  });
  it("a person's new details go to Finance Managers of the person's company, without the number, the last four or the ID number", async () => {
    await tx(async (c) => {
      await actAs(c, user.meron);
      const idn = protectIdNumber("AB-7654321", ASKU);
      const person = (await rows(c, "SELECT person_payee_create($1,'Almaz Test','0911000333',$2,$3,$4,'TRANSFER') AS id", [ASKU, idn.enc, idn.last4, idn.hash]))[0].id;
      const n = protectAccountNumber("5566778899004321");
      await fn(c, "person_detail_add", person, "BANK", "Dashen", n.last4, null, n.enc);
      await fn(c, "person_detail_add", person, "TELEBIRR", null, null, "0911000444");
      const ev = await events(c, "PERSON_DETAILS_PENDING");
      expect(ev).toHaveLength(2);
      for (const e of ev) { expect(await to(c, e.id)).toEqual(["dawit", "yared"]); clean(e, ["4321", "7654321", "0911000444", "911000444"]); }
      expect(compose(ev[0], "https://x.test")).toMatchObject({ subject: "Almaz Test: new payment details are waiting for verification", text: expect.stringContaining("https://x.test/payees") });
      await actAs(c, user.dawit); await fn(c, "person_detail_decide", (ev[0].payload as any).detail_id, true, null);
      expect(await to(c, ev[0].id)).toEqual([]);
    });
  });
  it("entries made without a signed-in user (seed data, scripts) do not notify", async () => {
    await tx(async (c) => {
      await c.query("SELECT set_config('app.user_id', '', true)");
      await c.query("INSERT INTO supplier_bank_details (supplier_id, bank_name, account_last4, created_by) VALUES ($1,'X','1234',$2)", [S_HAWASSA, user.meron]);
      expect(await events(c, "SUPPLIER_BANK_DETAILS_PENDING")).toHaveLength(0);
    });
  });
});

describe("account access", () => {
  it("granted and withdrawn go to the company that gained or lost it, once each; the owner's own link does not notify", async () => {
    await tx(async (c) => {
      await actAs(c, user.abebe);
      const access = (await rows(c, "INSERT INTO company_bank_account_access (account_id, company_id, permissions, granted_by) VALUES ($1,$2,'{USE}',$3) RETURNING id", [CBE, DAILYMART, user.abebe]))[0].id;
      const granted = await events(c, "ACCOUNT_ACCESS_GRANTED");
      expect(granted).toHaveLength(1);
      expect(await to(c, granted[0].id)).toEqual(["bereket"]);
      expect(compose(granted[0], "https://x.test").subject).toBe("Daily Mart can now use the account BEES CBE current");
      clean(granted[0], ["4417"]);
      await c.query("UPDATE company_bank_account_access SET revoked_at = now() WHERE id = $1", [access]);
      const withdrawn = await events(c, "ACCOUNT_ACCESS_WITHDRAWN");
      expect(withdrawn).toHaveLength(1); expect(await to(c, withdrawn[0].id)).toEqual(["bereket"]);
      await actAs(c, user.kebede); await fn(c, "register_bank_account", ASKU, "Zemen", "ASKU Zemen", "7788", null, 0);   // creates the owner's link
      expect(await events(c, "ACCOUNT_ACCESS_GRANTED")).toHaveLength(1);
    });
  });
});

describe("the user's own account", () => {
  const failSql = "UPDATE users SET failed_logins = failed_logins + 1, locked_until = CASE WHEN failed_logins + 1 >= 5 THEN now() + interval '15 minutes' END WHERE id = $1";
  it("locks after five failed sign-ins: the user is told once per lock", async () => {
    await tx(async (c) => {
      for (let i = 0; i < 4; i++) await c.query(failSql, [user.meron]);
      expect(await events(c, "USER_LOCKED")).toHaveLength(0);
      await c.query(failSql, [user.meron]);
      const ev = await events(c, "USER_LOCKED");
      expect(ev).toHaveLength(1); expect(await to(c, ev[0].id)).toEqual(["meron"]);
      expect(compose(ev[0], "https://x.test")).toMatchObject({ subject: "Your ABIG Finance account is locked after repeated failed sign-ins", text: expect.stringContaining("tell a system administrator") });
      await c.query("UPDATE users SET locked_until = now() + interval '20 minutes' WHERE id = $1", [user.meron]);   // still locked: not a new lock
      expect(await events(c, "USER_LOCKED")).toHaveLength(1);
      await c.query("UPDATE users SET locked_until = now() - interval '1 minute' WHERE id = $1", [user.meron]);    // expired, then fails again
      await c.query(failSql, [user.meron]);
      expect(await events(c, "USER_LOCKED")).toHaveLength(2);
    });
    // The sign-in role can still record failures; the notification is written for it.
    const a = new Client({ connectionString: authUrl }); await a.connect();
    try { await a.query("BEGIN"); for (let i = 0; i < 5; i++) await a.query(failSql, [user.lidya]); await a.query("ROLLBACK"); } finally { await a.end(); }
  });
  it("a reset password replaced by the user is reported to the user; the reset itself and ordinary changes are not", async () => {
    await tx(async (c) => {
      await c.query("UPDATE users SET password_hash = 'temp', must_change_password = true, failed_logins = 0, locked_until = NULL WHERE id = $1", [user.meron]);   // the administrator's reset
      expect(await events(c, "PASSWORD_RESET_COMPLETED")).toHaveLength(0);
      await c.query("UPDATE users SET password_hash = 'mine', must_change_password = false, password_changed_at = now(), failed_logins = 0, locked_until = NULL WHERE id = $1", [user.meron]);
      const ev = await events(c, "PASSWORD_RESET_COMPLETED");
      expect(ev).toHaveLength(1); expect(await to(c, ev[0].id)).toEqual(["meron"]);
      clean(ev[0]); expect(JSON.stringify(ev[0].payload)).not.toMatch(/mine|temp/);
      await c.query("UPDATE users SET password_hash = 'again', must_change_password = false WHERE id = $1", [user.meron]);   // an ordinary change later
      expect(await events(c, "PASSWORD_RESET_COMPLETED")).toHaveLength(1);
    });
  });
});

describe("existing events are unchanged", () => {
  it("a submitted request still goes to the company's Finance Managers other than the requester", async () => {
    await tx(async (c) => {
      const { id } = await authorized(c, { amounts: [500] });
      const sub = (await rows(c, "SELECT id FROM notification_outbox WHERE request_id = $1 AND event_type = 'REQUEST_SUBMITTED'", [id]))[0];
      expect(await to(c, sub.id)).toEqual(["dawit", "yared"]);
    });
  });
});
