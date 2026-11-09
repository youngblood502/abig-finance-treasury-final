import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { actAs, ASKU, authorized, AWASH, BD_HAWASSA, BERBERO, CBE, fails, fn, rows, S_HAWASSA, setupDb, user } from "./helpers";
import { isNumberKind, normalizeAccountNumber, protectAccountNumber, revealNumber } from "../src/lib/account-numbers";
import { decryptSecret } from "../src/lib/crypto";
import { protectIdNumber } from "../src/lib/payees";
import { personList, supplierList } from "../src/lib/payee-screens";
import { listRequests, loadRequest, parseRequestFilters } from "../src/lib/requests";
import { accountDetail, accountList, treasuryOverview } from "../src/lib/treasury-screens";
import { accountRows, cashByCompany } from "../src/lib/dashboard";
import { auditRows, cashRows, outstandingRows, paymentRows, pendingRows } from "../src/lib/reports";
import { compose } from "../src/worker/mail";

// Full account numbers: encrypted by the application, unreadable to the application role, and handed out one at a time by the reveal functions.
//   BEES CBE (shared): Samuel and Abebe (BEES) are FULL, Tigist (Berbero) TICK, Meron (ASKU) NONE, Selam (group reporting) NONE, Bereket no link.
//   ASKU Awash: Meron FULL. Ruth is an ASKU member whose custom role can only view suppliers and people.
const NUM = { cbe: "1000 1234 5678 4417", awash: "0130-0456-7103-2", supplier: "1000987654322219", person: "5566778899001234" };
const plain = (n: string) => normalizeAccountNumber(n);
const RUTH = "a0000000-0000-4000-8000-000000000015";
let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
let supplierBank: string, personId: string, personBank: string, telebirr: string, bareAccount: string;
const tx = (c: Client) => ({ q: async (sql: string, p?: unknown[]) => (await c.query(sql, p as unknown[])).rows });
const reveal = async (c: Client, f: string, id: string) => (await rows(c, `SELECT ${f}($1) AS v`, [id]))[0].v as string | null;
const audits = async (c: Client, action: string) => Number((await rows(c, "SELECT count(*) n FROM audit_events WHERE action = $1 AND actor_id = app_user_id()", [action]))[0].n);
/** Nothing secret in it: none of the full numbers and no ciphertext. */
const clean = (v: unknown) => { const s = JSON.stringify(v); for (const n of Object.values(NUM)) expect(s).not.toContain(plain(n)); expect(s).not.toMatch(/v1:[A-Za-z0-9+/=]{8,}/); };

beforeAll(async () => {
  const d = await setupDb("abig_test_numbers"); owner = d.owner; as = d.as;
  await owner.query("BEGIN");
  // Two existing accounts receive a full number, as an administrator would enter it later; everything else stays last-four-only.
  await owner.query("UPDATE company_bank_accounts SET account_number_enc = $2 WHERE id = $1", [CBE, protectAccountNumber(NUM.cbe).enc]);
  await owner.query("UPDATE company_bank_accounts SET account_number_enc = $2 WHERE id = $1", [AWASH, protectAccountNumber(NUM.awash).enc]);
  await actAs(owner, user.admin);
  bareAccount = await fn(owner, "register_bank_account", ASKU, "Zemen", "ASKU Zemen (last four only)", "7788", null, 0) as string;
  // A supplier's new number is a new version, entered by an accountant and verified by someone else.
  await actAs(owner, user.meron);
  const s = protectAccountNumber(NUM.supplier);
  supplierBank = await fn(owner, "supplier_bank_detail_add", S_HAWASSA, "CBE", s.last4, s.enc) as string;
  await actAs(owner, user.dawit); await owner.query("UPDATE supplier_bank_details SET status = 'VERIFIED' WHERE id = $1", [supplierBank]);
  await actAs(owner, user.meron);
  const idn = protectIdNumber("AB-1234567", ASKU);
  personId = (await rows(owner, "SELECT person_payee_create($1,'Almaz Test','0911000333',$2,$3,$4,'TRANSFER') AS id", [ASKU, idn.enc, idn.last4, idn.hash]))[0].id;
  const p = protectAccountNumber(NUM.person);
  personBank = await fn(owner, "person_detail_add", personId, "BANK", "Dashen", p.last4, null, p.enc) as string;
  telebirr = await fn(owner, "person_detail_add", personId, "TELEBIRR", null, null, "0911000444") as string;
  await actAs(owner, user.dawit); await fn(owner, "person_detail_decide", personBank, true, null);
  // Ruth: an ASKU member who may look at suppliers and people, nothing more.
  await owner.query("INSERT INTO users (id, email, full_name) VALUES ($1, 'ruth@abig.test', 'Ruth (ASKU viewer)')", [RUTH]);
  const role = (await rows(owner, "INSERT INTO roles (code, name, is_system) VALUES ('VIEWER', 'Viewer', false) RETURNING id"))[0].id;
  await owner.query("INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code IN ('supplier:view','payee:view')", [role]);
  const m = (await rows(owner, "INSERT INTO company_memberships (company_id, user_id) VALUES ($1,$2) RETURNING id", [ASKU, RUTH]))[0].id;
  await owner.query("INSERT INTO membership_roles (membership_id, role_id) VALUES ($1,$2)", [m, role]);
  await owner.query("COMMIT");
});
afterAll(async () => { await owner?.end(); });

describe("entering a number", () => {
  it("keeps only digits, needs the whole number, and derives the last four", () => {
    const n = protectAccountNumber(" 1000-1234 5678 ");
    expect(n.last4).toBe("5678");
    expect(n.enc).toMatch(/^v1:/);
    expect(decryptSecret(n.enc)).toBe("100012345678");
    for (const bad of ["1234", "12345", "ABC123456789", "1".repeat(31), ""]) expect(() => protectAccountNumber(bad)).toThrow(/full account number/);
  });
  it("is stored encrypted with the last four beside it, as text, on all three tables", async () => {
    const types = await rows(owner, "SELECT table_name t, data_type d FROM information_schema.columns WHERE column_name = 'account_number_enc' ORDER BY 1");
    expect(types).toEqual([{ t: "company_bank_accounts", d: "text" }, { t: "person_payment_details", d: "text" }, { t: "supplier_bank_details", d: "text" }]);
    const sb = (await rows(owner, "SELECT account_last4, account_number_enc, status, version FROM supplier_bank_details WHERE id = $1", [supplierBank]))[0];
    expect([sb.account_last4, sb.status, sb.version]).toEqual(["2219", "VERIFIED", 2]);
    expect(decryptSecret(sb.account_number_enc)).toBe(NUM.supplier);
    expect((await rows(owner, "SELECT status FROM supplier_bank_details WHERE id = $1", [BD_HAWASSA]))[0].status).toBe("SUPERSEDED");
    const pb = (await rows(owner, "SELECT account_last4, account_number_enc FROM person_payment_details WHERE id = $1", [personBank]))[0];
    expect(pb.account_last4).toBe("1234"); expect(decryptSecret(pb.account_number_enc)).toBe(NUM.person);
  });
  it("refuses anything that is not ciphertext, and a number on a Telebirr detail or a cash account", async () => {
    await owner.query("BEGIN");
    try {
      expect(await fails(owner, "UPDATE company_bank_accounts SET account_number_enc = '1000123456784417' WHERE id = $1", [CBE])).toMatch(/number_enc_chk/);
      expect(await fails(owner, "UPDATE supplier_bank_details SET account_number_enc = 'plain' WHERE id = $1", [BD_HAWASSA])).toMatch(/number_enc_chk|cannot be edited/);
      expect(await fails(owner, "UPDATE person_payment_details SET account_number_enc = 'v1:abc' WHERE id = $1", [telebirr])).toMatch(/number_enc_chk|cannot be edited/);
      await actAs(owner, user.meron);  // a Telebirr detail never stores a number, even if one is passed
      const t = await fn(owner, "person_detail_add", personId, "TELEBIRR", null, null, "0911000555", "v1:abc");
      expect((await rows(owner, "SELECT account_number_enc FROM person_payment_details WHERE id = $1", [t]))[0].account_number_enc).toBeNull();
    } finally { await owner.query("ROLLBACK"); }
  });
  it("leaves existing records with their last four digits and no invented number", async () => {
    const r = await rows(owner, "SELECT id, account_last4, account_number_enc FROM company_bank_accounts WHERE id = $1", [bareAccount]);
    expect(r).toEqual([{ id: bareAccount, account_last4: "7788", account_number_enc: null }]);
    expect((await rows(owner, "SELECT account_last4, account_number_enc FROM supplier_bank_details WHERE id = $1", [BD_HAWASSA]))[0]).toEqual({ account_last4: "2210", account_number_enc: null });
  });
});

describe("a new supplier or person number is a new version that someone else verifies", () => {
  it("supplier: only an Inputter enters it, it starts pending, and the person who entered it cannot verify it", async () => {
    await as(user.yared, async (c) => {  // Yared holds all three roles, so only separation of duties stops him
      const n = protectAccountNumber("300040005000");
      const id = await fn(c, "supplier_bank_detail_add", S_HAWASSA, "Awash", n.last4, n.enc);
      expect(await fails(c, "UPDATE supplier_bank_details SET status = 'VERIFIED' WHERE id = $1", [id])).toMatch(/someone other than/);
    });
    await as(user.dawit, async (c) => { expect(await fails(c, "SELECT supplier_bank_detail_add($1,'CBE','1111','v1:x')", [S_HAWASSA])).toMatch(/may not enter bank details/); });
    await as(user.selam, async (c) => { expect(await fails(c, "SELECT supplier_bank_detail_add($1,'CBE','1111','v1:x')", [S_HAWASSA])).toMatch(/may not enter bank details/); });
    await as(null, async (c) => { expect(await fails(c, "SELECT supplier_bank_detail_add($1,'CBE','1111','v1:x')", [S_HAWASSA])).toMatch(/may not enter bank details/); });
    await as(user.meron, async (c) => {
      const n = protectAccountNumber("200030004000");
      const id = await fn(c, "supplier_bank_detail_add", S_HAWASSA, "Awash", n.last4, n.enc);
      expect((await rows(c, "SELECT version, status, account_last4, created_by FROM supplier_bank_details WHERE id = $1", [id]))[0]).toEqual({ version: 3, status: "PENDING", account_last4: "4000", created_by: user.meron });
      expect(await fails(c, "SELECT supplier_bank_detail_add($1,'Awash','40','v1:x')", [S_HAWASSA])).toMatch(/last four digits/);
    });
  });
  it("person: a Finance Manager verifies it, and the earlier bank detail is replaced", async () => {
    await as(user.meron, async (c) => {
      const n = protectAccountNumber("700080009000");
      const id = await fn(c, "person_detail_add", personId, "BANK", "Awash", n.last4, null, n.enc);
      expect(await fails(c, "SELECT person_detail_decide($1, true, NULL)", [id])).toMatch(/only a Finance Manager/);
      await actAs(c, user.dawit); await fn(c, "person_detail_decide", id, true, null);
      expect((await rows(c, "SELECT id, status FROM person_payment_details WHERE person_id = $1 AND kind = 'BANK' ORDER BY version", [personId])).map((r) => r.status)).toEqual(["SUPERSEDED", "VERIFIED"]);
    });
  });
});

describe("the application role cannot read or plant the ciphertext directly", () => {
  it("for anyone, including administrators and FULL users", async () => {
    for (const who of [user.admin, user.samuel, user.meron, user.selam, user.tigist]) await as(who, async (c) => {
      expect(await fails(c, "SELECT account_number_enc FROM company_bank_accounts")).toMatch(/permission denied/);
      expect(await fails(c, "SELECT * FROM company_bank_accounts")).toMatch(/permission denied/);
      expect(await fails(c, "SELECT account_number_enc FROM supplier_bank_details")).toMatch(/permission denied/);
      expect(await fails(c, "SELECT account_number_enc FROM person_payment_details")).toMatch(/permission denied/);
      expect(await fails(c, "SELECT * FROM person_payment_details")).toMatch(/permission denied/);
      expect(await fails(c, "UPDATE company_bank_accounts SET account_number_enc = 'v1:x'")).toMatch(/permission denied/);
      expect(await fails(c, "INSERT INTO supplier_bank_details (supplier_id, bank_name, account_last4, account_number_enc, created_by) VALUES ($1,'X','1111','v1:x',$2)", [S_HAWASSA, who])).toMatch(/permission denied/);
    });
  });
  it("still reads every other column, so the screens work as before", async () => {
    await as(user.samuel, async (c) => {
      expect((await rows(c, "SELECT account_last4, current_balance FROM company_bank_accounts WHERE id = $1", [CBE]))[0].account_last4).toBe("4417");
    });
    await as(user.meron, async (c) => {
      expect((await rows(c, "SELECT account_last4, status FROM person_payment_details WHERE id = $1", [personBank]))[0]).toEqual({ account_last4: "1234", status: "VERIFIED" });
      // The last-four-only direct entry the policy allowed before still works, and has no number.
      const id = (await rows(c, "INSERT INTO supplier_bank_details (supplier_id, bank_name, account_last4, created_by) VALUES ($1,'Abay','9999',$2) RETURNING id", [S_HAWASSA, user.meron]))[0].id;
      expect(await fn(c, "supplier_account_state", id)).toBe("NOT_RECORDED");
    });
  });
  it("the reveal helpers are not callable on their own", async () => {
    await as(user.samuel, async (c) => {
      for (const f of ["app_can_reveal_account", "app_supplier_reveal_company", "app_person_reveal_company"]) expect(await fails(c, `SELECT ${f}($1)`, [CBE])).toMatch(/permission denied/);
    });
  });
});

describe("company account numbers: FULL access only", () => {
  it("FULL users and administrators get the number, and each reveal is audited", async () => {
    for (const [who, account, num] of [[user.samuel, CBE, NUM.cbe], [user.abebe, CBE, NUM.cbe], [user.admin, CBE, NUM.cbe], [user.meron, AWASH, NUM.awash]] as const) await as(who, async (c) => {
      expect(await fn(c, "account_number_state", account)).toBe("RECORDED");
      expect(await audits(c, "ACCOUNT_NUMBER_VIEWED")).toBe(0);
      expect(await revealNumber(tx(c), "account", account)).toBe(plain(num));
      expect(await revealNumber(tx(c), "account", account)).toBe(plain(num));
      expect(await audits(c, "ACCOUNT_NUMBER_VIEWED")).toBe(2);
      const a = (await rows(c, "SELECT entity_type, entity_id, company_id FROM audit_events WHERE action = 'ACCOUNT_NUMBER_VIEWED' AND actor_id = $1 LIMIT 1", [who]))[0];
      expect([a.entity_type, a.entity_id]).toEqual(["BANK_ACCOUNT", account]);
    });
  });
  it("TICK, NONE, group reporting, no link and signed out get NULL, no ciphertext and no audit", async () => {
    for (const [who, account] of [[user.tigist, CBE], [user.meron, CBE], [user.selam, CBE], [user.selam, AWASH], [user.bereket, CBE], [user.hana, CBE]] as const) await as(who, async (c) => {
      expect(await fn(c, "account_number_state", account)).toBe("MASKED");
      expect(await reveal(c, "reveal_account_number", account)).toBeNull();
      expect(await revealNumber(tx(c), "account", account)).toBeNull();
      expect(await audits(c, "ACCOUNT_NUMBER_VIEWED")).toBe(0);
    });
    await as(null, async (c) => { expect(await reveal(c, "reveal_account_number", CBE)).toBeNull(); expect(await fn(c, "account_number_state", CBE)).toBe("MASKED"); });
  });
  it("an account with only its last four digits says so to FULL users and reveals nothing", async () => {
    await as(user.meron, async (c) => {
      expect(await fn(c, "account_number_state", bareAccount)).toBe("NOT_RECORDED");
      expect(await reveal(c, "reveal_account_number", bareAccount)).toBeNull();
      expect(await audits(c, "ACCOUNT_NUMBER_VIEWED")).toBe(0);
    });
  });
  it("a new account registered with its number can be revealed, and the registration says a number was given", async () => {
    await as(user.admin, async (c) => {
      const n = protectAccountNumber("9988776655");
      const id = await fn(c, "register_bank_account", ASKU, "Dashen", "ASKU Dashen", n.last4, n.enc, 0);
      expect(await revealNumber(tx(c), "account", id)).toBe("9988776655");
      expect((await rows(c, "SELECT metadata FROM audit_events WHERE action = 'BANK_ACCOUNT_REGISTERED' AND entity_id = $1", [id]))[0].metadata).toMatchObject({ full_number: true });
    });
  });
});

describe("supplier numbers: a member of a company using the supplier, with verify, authenticate or supplier:manage", () => {
  it("is shown to ASKU's accountant, Finance Manager and owner, and to administrators, with an audit each time", async () => {
    for (const who of [user.meron, user.dawit, user.kebede, user.admin]) await as(who, async (c) => {
      expect(await fn(c, "supplier_account_state", supplierBank)).toBe("RECORDED");
      expect(await revealNumber(tx(c), "supplier", supplierBank)).toBe(NUM.supplier);
      expect(await audits(c, "SUPPLIER_ACCOUNT_NUMBER_VIEWED")).toBe(1);
      expect((await rows(c, "SELECT entity_id, metadata FROM audit_events WHERE action = 'SUPPLIER_ACCOUNT_NUMBER_VIEWED' AND actor_id = app_user_id()"))[0]).toMatchObject({ entity_id: S_HAWASSA, metadata: { detail: supplierBank, version: 2 } });
    });
  });
  it("is not shown to another company, a group reporter, a member without the authority, or anyone signed out", async () => {
    for (const who of [user.tigist, user.fikru, user.selam, user.bereket, RUTH]) await as(who, async (c) => {
      expect(await fn(c, "supplier_account_state", supplierBank)).toBe("MASKED");
      expect(await reveal(c, "reveal_supplier_account", supplierBank)).toBeNull();
      expect(await audits(c, "SUPPLIER_ACCOUNT_NUMBER_VIEWED")).toBe(0);
    });
    await as(null, async (c) => { expect(await reveal(c, "reveal_supplier_account", supplierBank)).toBeNull(); });
  });
  it("an old last-four-only version says so to those allowed", async () => {
    await as(user.dawit, async (c) => { expect(await fn(c, "supplier_account_state", BD_HAWASSA)).toBe("NOT_RECORDED"); expect(await reveal(c, "reveal_supplier_account", BD_HAWASSA)).toBeNull(); });
  });
});

describe("person numbers: payee:view_identity in the person's company", () => {
  it("is shown to ASKU members who hold it, with an audit", async () => {
    for (const who of [user.meron, user.dawit, user.kebede]) await as(who, async (c) => {
      expect(await fn(c, "person_account_state", personBank)).toBe("RECORDED");
      expect(await revealNumber(tx(c), "person", personBank)).toBe(NUM.person);
      expect(await audits(c, "PERSON_ACCOUNT_NUMBER_VIEWED")).toBe(1);
      expect((await rows(c, "SELECT entity_id, metadata FROM audit_events WHERE action = 'PERSON_ACCOUNT_NUMBER_VIEWED' AND actor_id = app_user_id()"))[0]).toMatchObject({ entity_id: personId, metadata: { detail: personBank } });
    });
  });
  it("is not shown without it, to another company, to group reporting, or for a Telebirr detail", async () => {
    for (const who of [RUTH, user.tigist, user.selam, user.bereket]) await as(who, async (c) => {
      expect(await fn(c, "person_account_state", personBank)).toBe("MASKED");
      expect(await reveal(c, "reveal_person_account", personBank)).toBeNull();
      expect(await audits(c, "PERSON_ACCOUNT_NUMBER_VIEWED")).toBe(0);
    });
    await as(user.meron, async (c) => { expect(await fn(c, "person_account_state", telebirr)).toBe("MASKED"); expect(await reveal(c, "reveal_person_account", telebirr)).toBeNull(); });
  });
  it("the server action's kind check refuses anything else", () => {
    expect(["account", "supplier", "person"].every(isNumberKind)).toBe(true);
    for (const k of ["toString", "constructor", "accounts", "", null, 1]) expect(isNumberKind(k)).toBe(false);
  });
});

describe("full numbers never travel with page data, lists, reports, CSV sources or emails", () => {
  it("account lists, the account page, the dashboard and the treasury overview, even for FULL users", async () => {
    for (const who of [user.samuel, user.meron, user.admin]) await as(who, async (c) => {
      const t = tx(c);
      const accounts = await accountList(t, null);
      clean(accounts); clean(await accountDetail(t, CBE)); clean(await treasuryOverview(t, null)); clean(await accountRows(t, null)); clean(await cashByCompany(t, null));
      expect(accounts.find((a) => a.id === CBE)?.number_state).toBe(who === user.meron ? "MASKED" : "RECORDED");
    });
  });
  it("supplier and person lists, with the state but not the number", async () => {
    await as(user.meron, async (c) => {
      const suppliers = await supplierList(tx(c), null), people = await personList(tx(c), null);
      clean(suppliers); clean(people);
      expect(suppliers.flatMap((s) => s.versions).find((v) => v.id === supplierBank)?.number_state).toBe("RECORDED");
      expect(people.flatMap((p) => p.versions).find((v) => v.id === personBank)?.number_state).toBe("RECORDED");
    });
  });
  it("request lists and details; a group reporter does not even get the ids or states", async () => {
    let id = "";
    await owner.query("BEGIN");
    try {
      // A request paying the supplier's new verified version from ASKU's Awash account (both have full numbers).
      id = (await authorized(owner, { amounts: [1000], bank: supplierBank })).id;
      await owner.query("COMMIT");
    } catch (e) { await owner.query("ROLLBACK"); throw e; }
    await as(user.dawit, async (c) => {
      const d = await loadRequest(tx(c), id);
      clean(d); clean(await listRequests(tx(c), parseRequestFilters({}), null));
      expect([d!.r.bank_number_state, d!.r.debit_number_state, d!.r.supplier_bank_detail_id]).toEqual(["RECORDED", "RECORDED", supplierBank]);
    });
    await as(user.selam, async (c) => {
      const d = await loadRequest(tx(c), id);
      clean(d);
      expect(d!.restricted).toBe(true);
      expect([d!.r.supplier_bank_detail_id, d!.r.bank_number_state, d!.r.debit_number_state]).toEqual([null, null, "MASKED"]);
    });
    // The emails this request produced, as the worker would compose them.
    const events = await rows(owner, "SELECT * FROM notification_outbox WHERE request_id = $1", [id]);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) { clean(e.payload); clean(compose(e as never, "https://finance.example.com")); }
  });
  it("every report and the audit trail (the CSV exports read these)", async () => {
    for (const who of [user.dawit, user.admin]) await as(who, async (c) => {
      const t = tx(c), f = { from: "2026-01-01", to: "2027-12-31", q: null, method: null, state: null };
      await revealNumber(t, "account", AWASH); await revealNumber(t, "supplier", supplierBank);
      clean(await pendingRows(t)); clean(await paymentRows(t, f)); clean(await outstandingRows(t)); clean(await cashRows(t)); clean(await auditRows(t, { q: null }));
    });
  });
});

describe("existing last-four-only records remain usable", () => {
  it("a request to a last-four-only supplier (Ethio Chemicals) still goes all the way to authenticated", async () => {
    await owner.query("BEGIN");
    try {
      const a = await authorized(owner, { company: BERBERO, amounts: [500] });
      expect((await rows(owner, "SELECT workflow_state::text s FROM payment_requests WHERE id = $1", [a.id]))[0].s).toBe("AUTHENTICATED");
      await actAs(owner, user.fikru);
      const d = await loadRequest(tx(owner), a.id);
      expect([d!.r.account_last4, d!.r.bank_number_state]).toEqual(["5532", "NOT_RECORDED"]);
    } finally { await owner.query("ROLLBACK"); }
    await as(user.meron, async (c) => {
      const accounts = await accountList(tx(c), null);
      expect(accounts.find((a) => a.id === bareAccount)).toMatchObject({ account_last4: "7788", number_state: "NOT_RECORDED" });
    });
  });
});

describe("the integrity check", () => {
  const check = async () => (await owner.query(readFileSync(join(__dirname, "../ops/verify-integrity.sql"), "utf8").replace(/^\\set.*$/m, ""))).rows.filter((r) => Number(r.violations) > 0).map((r) => r.name);
  it("is clean", async () => { expect(await check()).toEqual([]); });
  it("notices if the application role can read encrypted numbers again", async () => {
    await owner.query("BEGIN");
    try { await owner.query("GRANT SELECT (account_number_enc) ON company_bank_accounts TO abig_app"); expect(await check()).toEqual(["application role can read or write encrypted account numbers directly"]); }
    finally { await owner.query("ROLLBACK"); }
  });
});

describe("entering the full number of an existing account", () => {
  const snapshot = async (c: Client, id: string) => ({
    account: (await rows(c, "SELECT id, account_label, account_kind::text k, bank_id, is_active, current_balance, reserved_balance, min_buffer FROM company_bank_accounts WHERE id = $1", [id]))[0],
    access: await rows(c, "SELECT id, company_id, is_owner, permissions, revoked_at FROM company_bank_account_access WHERE account_id = $1 ORDER BY id", [id]),
    history: await rows(c, "SELECT id, new_balance FROM bank_balance_history WHERE account_id = $1 ORDER BY id", [id]),
    requests: await rows(c, "SELECT id, workflow_state::text s, total_amount FROM payment_requests WHERE debit_account_id = $1 ORDER BY id", [id]),
  });
  it("the owner's manager sets it on a last-four-only account; everything else about the account stays", async () => {
    await owner.query("BEGIN");
    try {
      await authorized(owner, { amounts: [700], bank: supplierBank });  // a payment held against the account, so its records are not empty
      await owner.query("UPDATE company_bank_accounts SET account_number_enc = NULL WHERE id = $1", [AWASH]);
      const before = await snapshot(owner, AWASH);
      expect(before.requests.length).toBeGreaterThan(0);
      await actAs(owner, user.kebede);
      expect(await fn(owner, "account_number_state", AWASH)).toBe("NOT_RECORDED");
      const n = protectAccountNumber("0130 0456 7103 2");
      await owner.query("SELECT set_account_number($1,$2,$3)", [AWASH, n.last4, n.enc]);
      expect(await snapshot(owner, AWASH)).toEqual(before);
      expect((await rows(owner, "SELECT account_last4 FROM company_bank_accounts WHERE id = $1", [AWASH]))[0].account_last4).toBe("1032");
      expect(await fn(owner, "account_number_state", AWASH)).toBe("RECORDED");
      expect(await revealNumber(tx(owner), "account", AWASH)).toBe("0130045671032");
      const audit = (await rows(owner, "SELECT company_id, metadata FROM audit_events WHERE action = 'ACCOUNT_NUMBER_SET' AND entity_id = $1", [AWASH]))[0];
      expect(audit).toEqual({ company_id: ASKU, metadata: { previous_last4: "1032", last4: "1032", had_full_number: false } });
      clean(audit);
    } finally { await owner.query("ROLLBACK"); }
  });
  it("a different last four must be confirmed, then both the number and the last four change", async () => {
    await as(user.kebede, async (c) => {
      const n = protectAccountNumber("0130045679999");
      expect(await fails(c, "SELECT set_account_number($1,$2,$3)", [AWASH, n.last4, n.enc])).toMatch(/ends in 9999, but this account is recorded as ending in 1032/);
      await c.query("SELECT set_account_number($1,$2,$3,true)", [AWASH, n.last4, n.enc]);
      expect((await rows(c, "SELECT account_last4 FROM company_bank_accounts WHERE id = $1", [AWASH]))[0].account_last4).toBe("9999");
      expect(await revealNumber(tx(c), "account", AWASH)).toBe("0130045679999");
      expect((await rows(c, "SELECT metadata FROM audit_events WHERE action = 'ACCOUNT_NUMBER_SET' AND entity_id = $1", [AWASH]))[0].metadata).toEqual({ previous_last4: "1032", last4: "9999", had_full_number: true });
    });
    await as(user.admin, async (c) => { const n = protectAccountNumber("1000555566664417"); await c.query("SELECT set_account_number($1,$2,$3)", [CBE, n.last4, n.enc]); });
  });
  it("is refused to everyone else, for a cash account, and without a proper encrypted number", async () => {
    const n = protectAccountNumber("0130045671032");
    for (const [who, account] of [[user.meron, AWASH], [user.dawit, AWASH], [user.abebe, AWASH], [user.hana, CBE], [user.tigist, CBE], [user.selam, AWASH], [RUTH, AWASH], [null, AWASH]] as const) await as(who, async (c) => {
      expect(await fails(c, "SELECT set_account_number($1,$2,$3,true)", [account, n.last4, n.enc])).toMatch(/only a manager of the company that owns this account/);
    });
    await as(user.kebede, async (c) => {
      const cash = await fn(c, "register_cash_account", ASKU, "ASKU till", 0);
      expect(await fails(c, "SELECT set_account_number($1,$2,$3,true)", [cash, n.last4, n.enc])).toMatch(/only a bank account/);
      expect(await fails(c, "SELECT set_account_number($1,'1032','0130045671032')", [AWASH])).toMatch(/full account number is required/);
      expect(await fails(c, "SELECT set_account_number($1,'12',$2)", [AWASH, n.enc])).toMatch(/full account number is required/);
      await c.query("SELECT set_account_number($1,$2,$3)", [AWASH, n.last4, n.enc]);
      // Ordinary queries still cannot reach it, even for the manager who just set it.
      expect(await fails(c, "SELECT account_number_enc FROM company_bank_accounts WHERE id = $1", [AWASH])).toMatch(/permission denied/);
      clean(await accountList(tx(c), null));
    });
  });
});

describe("supplier reveal needs a live link: ACTIVE, with the supplier active", () => {
  const BEES = "c0000000-0000-4000-8000-000000000003";
  const rolledBack = async (body: (c: Client) => Promise<void>) => { await owner.query("BEGIN"); try { await body(owner); } finally { await owner.query("ROLLBACK"); } };
  const outcome = async (c: Client) => {
    const out: Record<string, string> = {};
    for (const who of [user.meron, user.dawit, user.kebede, user.admin]) { await actAs(c, who); out[who] = (await reveal(c, "reveal_supplier_account", supplierBank)) ? "shown" : await fn(c, "supplier_account_state", supplierBank); }
    return out;
  };
  const all = (v: string) => ({ [user.meron]: v, [user.dawit]: v, [user.kebede]: v, [user.admin]: v });
  it("an ACTIVE link reveals", async () => { await rolledBack(async (c) => { expect(await outcome(c)).toEqual(all("shown")); }); });
  for (const status of ["INACTIVE", "BLOCKED"]) it(`an ${status} link does not, for anyone, administrators included, and nothing is audited`, async () => {
    await rolledBack(async (c) => {
      await c.query("UPDATE company_suppliers SET status = $1 WHERE company_id = $2 AND supplier_id = $3", [status, ASKU, S_HAWASSA]);
      expect(await outcome(c)).toEqual(all("MASKED"));
      expect(Number((await rows(c, "SELECT count(*) n FROM audit_events WHERE action = 'SUPPLIER_ACCOUNT_NUMBER_VIEWED'"))[0].n)).toBe(0);
    });
  });
  it("a deactivated supplier does not", async () => {
    await rolledBack(async (c) => { await c.query("UPDATE suppliers SET is_active = false WHERE id = $1", [S_HAWASSA]); expect(await outcome(c)).toEqual(all("MASKED")); });
  });
  it("another company's live link does not help a company whose own link is inactive", async () => {
    await rolledBack(async (c) => {
      await c.query("UPDATE company_suppliers SET status = 'INACTIVE' WHERE company_id = $1 AND supplier_id = $2", [ASKU, S_HAWASSA]);
      await c.query("INSERT INTO company_suppliers (company_id, supplier_id, created_by) VALUES ($1,$2,$3)", [BEES, S_HAWASSA, user.abebe]);
      for (const who of [user.meron, user.dawit, user.kebede]) { await actAs(c, who); expect(await reveal(c, "reveal_supplier_account", supplierBank)).toBeNull(); }
      await actAs(c, user.abebe); expect(await reveal(c, "reveal_supplier_account", supplierBank)).toMatch(/^v1:/);
    });
  });
  it("entering and verifying supplier bank details are unchanged by the link's status", async () => {
    await rolledBack(async (c) => {
      await c.query("UPDATE company_suppliers SET status = 'INACTIVE' WHERE company_id = $1 AND supplier_id = $2", [ASKU, S_HAWASSA]);
      await actAs(c, user.meron); const n = protectAccountNumber("600070008000");
      const id = await fn(c, "supplier_bank_detail_add", S_HAWASSA, "Awash", n.last4, n.enc);
      await actAs(c, user.dawit); await c.query("UPDATE supplier_bank_details SET status = 'VERIFIED' WHERE id = $1", [id]);
      expect((await rows(c, "SELECT status FROM supplier_bank_details WHERE id = $1", [id]))[0].status).toBe("VERIFIED");
    });
  });
});
