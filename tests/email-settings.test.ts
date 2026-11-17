import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, Pool } from "pg";
import { SMTPServer } from "smtp-server";
import type { Tx } from "../src/lib/db";
import { activity, emailSettings, systemSettings } from "../src/lib/admin";
import { decryptMailSecret, decryptSecret, encryptMailSecret, mailKeyProblem } from "../src/lib/crypto";
import { emailSettingsProblem, resolveMail, sendTestEmail, type EmailSettingsRow } from "../src/lib/mail-settings";
import { makeSender, tick } from "../src/worker/mail";
import { actAs, ASKU, fails, rows, S_HAWASSA, setupDb, user } from "./helpers";

// Email settings managed by a system administrator: stored once, password encrypted, used by the website's test email and by the worker.
const SMTP_USER = "mailer@abig.test", SMTP_PASS = "  c0rrect horse; battery=staple  ";   // spaces and punctuation must survive
const SAVE = "SELECT admin_save_email_settings($1,$2,$3,$4,$5,$6,$7,$8)";
interface Got { to: string; from: string; subject: string; user: string | null }
let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"]; let workerUrl: string; let request: string;
let secure: SMTPServer, plain: SMTPServer, securePort: number, plainPort: number; const inbox: Got[] = []; const pools: Pool[] = [];
const tx = (c: Client): Tx => ({ q: async (sql, p) => (await c.query(sql, p as unknown[])).rows });
const stored = async (c: Client = owner) => (await rows(c, "SELECT * FROM email_settings"))[0];
const emailAudit = (c: Client = owner) => rows(c, "SELECT action, actor_id, entity_type, metadata FROM audit_events WHERE action LIKE 'EMAIL\\_%' ORDER BY occurred_at");
/** Valid settings for the test mail server; each test overrides what it is about. */
const args = (o: Partial<{ host: string | null; port: number | null; username: string | null; password: string | null; security: string | null; verify: boolean | null; name: string | null; from: string | null }> = {}) => {
  const v = { host: "127.0.0.1", port: securePort, username: SMTP_USER, password: encryptMailSecret(SMTP_PASS), security: "STARTTLS", verify: false, name: "ABIG Finance", from: "no-reply@abig.test", ...o };
  return [v.host, v.port, v.username, v.password, v.security, v.verify, v.name, v.from];
};
/** Saves for real (committed), as the administrator, so the worker's own connection sees it. */
const commit = async (sql: string, p: unknown[] = []) => { await owner.query("BEGIN"); try { await actAs(owner, user.admin); await owner.query(sql, p); await owner.query("COMMIT"); } catch (e) { await owner.query("ROLLBACK"); throw e; } };
const reset = async () => { await owner.query("DELETE FROM email_settings"); await owner.query("DELETE FROM notification_outbox"); inbox.length = 0; };
const workerPool = () => { const p = new Pool({ connectionString: workerUrl, max: 2 }); pools.push(p); return p; };
const event = async () => (await rows(owner, "INSERT INTO notification_outbox (event_type, request_id, payload) VALUES ('REQUEST_SUBMITTED',$1,$2) RETURNING id", [request, { request_no: "PR-TEST" }]))[0].id as string;
const outcome = async (id: string) => (await rows(owner, "SELECT outcome, attempts, last_error FROM notification_outbox WHERE id = $1", [id]))[0];
const listen = (s: SMTPServer) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.server.address() as { port: number }).port)));
const collect = (list: Got[]) => (stream: NodeJS.ReadableStream, session: any, cb: () => void) => {
  let raw = ""; stream.on("data", (c) => (raw += c)); stream.on("end", () => { list.push({ to: session.envelope.rcptTo[0].address, from: /^From: (.*)$/m.exec(raw)?.[1].trim() ?? "", subject: /^Subject: (.*)$/m.exec(raw)?.[1].trim() ?? "", user: session.user ?? null }); cb(); });
};

beforeAll(async () => {
  const d = await setupDb("abig_test_email_settings"); owner = d.owner; as = d.as; workerUrl = d.workerUrl;
  request = (await rows(owner, "INSERT INTO payment_requests (debtor_company_id, supplier_id, created_by, total_amount) VALUES ($1,$2,$3,10) RETURNING id", [ASKU, S_HAWASSA, user.meron]))[0].id;
  // A mail server that demands a login, and takes one only after STARTTLS (its certificate is self-signed); and a plain one that needs no login.
  secure = new SMTPServer({ authMethods: ["PLAIN", "LOGIN"], onAuth(a, _s, cb) { if (a.username === SMTP_USER && a.password === SMTP_PASS) cb(null, { user: a.username }); else cb(new Error("Invalid username or password")); }, onData: collect(inbox) });
  plain = new SMTPServer({ authOptional: true, disabledCommands: ["STARTTLS", "AUTH"], onData: collect(inbox) });
  for (const s of [secure, plain]) s.on("error", () => {});
  securePort = await listen(secure); plainPort = await listen(plain);
});
afterAll(async () => { for (const p of pools) await p.end(); secure?.close(); plain?.close(); await owner?.end(); });

describe("who may see or change the email settings", () => {
  it("accountants, finance managers, owners and signed-out callers are refused by every function", async () => {
    for (const who of [user.meron, user.dawit, user.hana, user.abebe, user.kebede, null]) {
      await as(who, async (c) => {
        expect(await fails(c, "SELECT * FROM admin_email_settings()")).toMatch(/only a system administrator/);
        expect(await fails(c, "SELECT * FROM admin_email_transport()")).toMatch(/only a system administrator/);
        expect(await fails(c, SAVE, args())).toMatch(/only a system administrator/);
        expect(await fails(c, "SELECT admin_clear_email_settings()")).toMatch(/only a system administrator/);
        expect(await fails(c, "SELECT admin_record_email_test('x@abig.test','SAVED',NULL)")).toMatch(/only a system administrator/);
      });
    }
  });
  it("nobody reads or writes the table directly, not even an administrator, and the worker's function is the worker's alone", async () => {
    for (const who of [user.admin, user.meron]) {
      await as(who, async (c) => {
        for (const sql of ["SELECT * FROM email_settings", "SELECT smtp_password_enc FROM email_settings", "DELETE FROM email_settings", "UPDATE email_settings SET smtp_host = 'evil.example'",
          "INSERT INTO email_settings (smtp_host, smtp_port, security, sender_name, sender_email, updated_by) VALUES ('h', 25, 'NONE', 'n', 'a@b.test', app_user_id())", "SELECT * FROM worker_email_settings()"]) expect(await fails(c, sql)).toMatch(/permission denied/);
      });
    }
    const w = new Client({ connectionString: workerUrl }); await w.connect();
    try {
      await w.query("BEGIN");
      for (const sql of ["SELECT * FROM email_settings", "SELECT * FROM admin_email_settings()", "SELECT * FROM admin_email_transport()", "SELECT admin_clear_email_settings()", "SELECT admin_record_email_test('x@abig.test','SAVED',NULL)"]) expect(await fails(w, sql)).toMatch(/permission denied/);
      expect(await fails(w, SAVE, args())).toMatch(/permission denied/);
      expect((await w.query("SELECT * FROM worker_email_settings()")).rows).toEqual([]);
    } finally { await w.query("ROLLBACK"); await w.end(); }
    const f = ["admin_email_settings()", "admin_save_email_settings(text,integer,text,text,text,boolean,text,text)", "admin_clear_email_settings()", "admin_email_transport()", "admin_record_email_test(text,text,text)", "worker_email_settings()"];
    for (const name of f) {
      const r = (await rows(owner, `SELECT has_function_privilege('abig_app', $1, 'EXECUTE') AS app, has_function_privilege('abig_worker', $1, 'EXECUTE') AS worker, has_function_privilege('abig_auth', $1, 'EXECUTE') AS auth,
        EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid = to_regprocedure($1))) a WHERE a.grantee = 0) AS public`, [name]))[0];
      expect({ name, ...r }).toEqual({ name, app: name !== "worker_email_settings()", worker: name === "worker_email_settings()", auth: false, public: false });
    }
  });
});

describe("validation before saving", () => {
  const ok = { host: "smtp.example.com", port: "587", username: "mailer", password: "secret", security: "STARTTLS", senderName: "ABIG Finance", senderEmail: "no-reply@example.com" };
  it("the application explains what is wrong with each field", () => {
    expect(emailSettingsProblem(ok, false)).toBeNull();
    expect(emailSettingsProblem({ ...ok, username: "", password: "", security: "NONE" }, false)).toBeNull();
    const bad: [Partial<typeof ok>, RegExp][] = [
      [{ host: "" }, /SMTP host/], [{ host: "smtp://mail.example.com" }, /SMTP host/], [{ host: "mail server" }, /SMTP host/], [{ host: "user:pw@host" }, /SMTP host/],
      [{ port: "" }, /port/], [{ port: "0" }, /port/], [{ port: "65536" }, /port/], [{ port: "58x" }, /port/], [{ port: "-1" }, /port/],
      [{ security: "SSLv3" }, /secured/], [{ security: "constructor" }, /secured/],
      [{ username: "", password: "secret" }, /needs an SMTP user name/], [{ password: "" }, /Enter the SMTP password/], [{ security: "NONE" }, /unencrypted/],
      [{ username: "a\nb" }, /user name is not valid/], [{ senderName: "" }, /sender name/], [{ senderName: "Evil\r\nBcc: x@y.test" }, /sender name/], [{ senderName: "A <b>" }, /sender name/],
      [{ senderEmail: "" }, /sender email/], [{ senderEmail: "nobody" }, /valid sender email/], [{ senderEmail: "a@b.test\nBcc: x@y.test" }, /valid sender email/],
    ];
    for (const [change, message] of bad) expect(emailSettingsProblem({ ...ok, ...change }, false)).toMatch(message);
    // With a password already saved, the password field may stay empty.
    expect(emailSettingsProblem({ ...ok, password: "" }, true)).toBeNull();
  });
  it("the database refuses the same things, whoever calls it", async () => {
    await as(user.admin, async (c) => {
      const bad: [Parameters<typeof args>[0], RegExp][] = [
        [{ host: "" }, /SMTP host is required/], [{ host: null }, /SMTP host is required/], [{ host: "smtp://mail.example.com" }, /server name or address/], [{ host: "mail server" }, /server name or address/],
        [{ port: 0 }, /1 to 65535/], [{ port: 65536 }, /1 to 65535/], [{ port: null }, /1 to 65535/], [{ security: "SSLv3" }, /how the connection is secured/], [{ security: null }, /how the connection is secured/],
        [{ username: null }, /a password needs an SMTP user name/], [{ password: null }, /enter the SMTP password/], [{ security: "NONE" }, /unencrypted connection/],
        [{ name: "" }, /sender name is required/], [{ name: "A <b>" }, /sender name/], [{ name: "x".repeat(101) }, /sender name/], [{ from: "" }, /sender email address is required/], [{ from: "nobody" }, /valid sender email/],
        [{ password: SMTP_PASS }, /must be encrypted/], [{ password: "v1:short" }, /must be encrypted/], [{ password: "plain-text-password-that-is-quite-long-0123456789" }, /must be encrypted/],
      ];
      for (const [change, message] of bad) expect(await fails(c, SAVE, args(change))).toMatch(message);
      expect(await rows(c, "SELECT * FROM admin_email_settings()")).toEqual([]);   // nothing was saved along the way
      // A line break in the sender name cannot add a header to every email: it is stored as a space.
      await c.query(SAVE, args({ name: "Evil\r\nBcc: x@y.test" }));
      expect((await rows(c, "SELECT sender_name FROM admin_email_settings()"))[0].sender_name).toBe("Evil Bcc: x@y.test");
    });
  });
  it("the table itself refuses a second row, a plain password, and a password without TLS", async () => {
    await owner.query("BEGIN");
    try {
      const insert = "INSERT INTO email_settings (id, smtp_host, smtp_port, smtp_username, smtp_password_enc, security, sender_name, sender_email, updated_by) VALUES ($1,'h.test',25,$2,$3,$4,'n','a@b.test',$5)";
      expect(await fails(owner, insert, [true, "u", "plain password", "TLS", user.admin])).toMatch(/smtp_password_enc_check/);
      expect(await fails(owner, insert, [true, "u", encryptMailSecret("x"), "NONE", user.admin])).toMatch(/email_settings_password_needs_tls/);
      expect(await fails(owner, insert, [true, "u", null, "TLS", user.admin])).toMatch(/email_settings_login_chk/);
      expect(await fails(owner, insert, [false, null, null, "NONE", user.admin])).toMatch(/email_settings_id_check/);
      await owner.query(insert, [true, null, null, "NONE", user.admin]);
      expect(await fails(owner, insert, [true, null, null, "NONE", user.admin])).toMatch(/email_settings_pkey/);
    } finally { await owner.query("ROLLBACK"); }
  });
});

describe("the password at rest", () => {
  it("is stored encrypted, differently each time, and readable only with the server's key", async () => {
    await owner.query("BEGIN");
    try {
      await actAs(owner, user.admin); await owner.query(SAVE, args());
      const row = await stored();
      expect(row.smtp_password_enc).toMatch(/^v1:[A-Za-z0-9+/]+=*$/);
      expect(JSON.stringify(row)).not.toContain(SMTP_PASS); expect(JSON.stringify(row)).not.toContain(SMTP_PASS.trim());
      expect(Buffer.from(row.smtp_password_enc.slice(3), "base64").toString("latin1")).not.toContain("c0rrect");
      expect(decryptMailSecret(row.smtp_password_enc)).toBe(SMTP_PASS);
      expect(encryptMailSecret(SMTP_PASS)).not.toBe(encryptMailSecret(SMTP_PASS));
      // Another key cannot read it, and a changed ciphertext is refused rather than decrypted to something else.
      const kept = process.env.MAIL_ENCRYPTION_KEY;
      try { process.env.MAIL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64"); expect(() => decryptMailSecret(row.smtp_password_enc)).toThrow(); }
      finally { if (kept === undefined) delete process.env.MAIL_ENCRYPTION_KEY; else process.env.MAIL_ENCRYPTION_KEY = kept; }
      // It has its own key: the key that protects two-step secrets, ID numbers and account numbers cannot read it, so the worker never needs that one.
      expect(() => decryptSecret(row.smtp_password_enc)).toThrow();
      const raw = Buffer.from(row.smtp_password_enc.slice(3), "base64"); raw[raw.length - 1] ^= 1;
      expect(() => decryptMailSecret("v1:" + raw.toString("base64"))).toThrow();
    } finally { await owner.query("ROLLBACK"); }
  });
  it("cannot be saved in production without a valid MAIL_ENCRYPTION_KEY", () => {
    const good = Buffer.alloc(32, 3).toString("base64");
    expect(mailKeyProblem({ NODE_ENV: "production", MAIL_ENCRYPTION_KEY: good })).toBeNull();
    expect(mailKeyProblem({ NODE_ENV: "development" })).toBeNull();   // development uses its own fixed key
    expect(mailKeyProblem({ NODE_ENV: "production" })).toMatch(/MAIL_ENCRYPTION_KEY is not set/);
    expect(mailKeyProblem({ NODE_ENV: "production", APP_ENCRYPTION_KEY: good })).toMatch(/MAIL_ENCRYPTION_KEY is not set/);   // the other key is never used instead
    expect(mailKeyProblem({ NODE_ENV: "production", MAIL_ENCRYPTION_KEY: "too-short" })).toMatch(/not 32 bytes/);
  });
  it("is never handed to the screen: it shows only that a password is saved", async () => {
    await as(user.admin, async (c) => {
      expect(await emailSettings(tx(c))).toBeNull();
      await c.query(SAVE, args());
      const shown = await emailSettings(tx(c));
      expect(shown).toMatchObject({ smtp_host: "127.0.0.1", smtp_port: securePort, smtp_username: SMTP_USER, password_set: true, security: "STARTTLS", tls_verify: false, sender_name: "ABIG Finance", sender_email: "no-reply@abig.test", updated_by_name: "System Admin" });
      expect(Object.keys(shown!).filter((k) => /pass|enc|secret/i.test(k))).toEqual(["password_set"]);
      expect(JSON.stringify(shown)).not.toMatch(/v1:|c0rrect/);
      expect(systemSettings({}, true).find((s) => s.label === "Email sending")?.value).toBe("Configured in Administration");
      expect(systemSettings({ SMTP_URL: "smtp://u:p@h" }).find((s) => s.label === "Email sending")?.value).toBe("Configured");
    });
  });
});

describe("updating the settings", () => {
  it("keeps the saved password when none is entered, replaces it when one is, and removes it with the user name", async () => {
    await owner.query("BEGIN");
    try {
      await actAs(owner, user.admin);
      await owner.query(SAVE, args({ host: "Mail.Example.COM", from: " No-Reply@ABIG.Test ", name: "  ABIG   Finance " }));
      const first = await stored();
      expect(first).toMatchObject({ smtp_host: "mail.example.com", sender_email: "no-reply@abig.test", sender_name: "ABIG Finance", updated_by: user.admin });

      await owner.query(SAVE, args({ host: "smtp2.example.com", port: 465, security: "TLS", verify: true, password: null }));
      const second = await stored();
      expect(second).toMatchObject({ smtp_host: "smtp2.example.com", smtp_port: 465, security: "TLS", tls_verify: true, smtp_password_enc: first.smtp_password_enc });
      expect(decryptMailSecret(second.smtp_password_enc)).toBe(SMTP_PASS);

      await owner.query(SAVE, args({ host: "smtp2.example.com", port: 465, security: "TLS", verify: true, password: encryptMailSecret("a new password") }));
      const third = await stored();
      expect(third.smtp_password_enc).not.toBe(first.smtp_password_enc); expect(decryptMailSecret(third.smtp_password_enc)).toBe("a new password");

      await owner.query(SAVE, args({ host: "smtp2.example.com", port: 25, security: "NONE", verify: true, username: "", password: null }));
      expect(await stored()).toMatchObject({ smtp_username: null, smtp_password_enc: null, security: "NONE" });
      expect((await rows(owner, "SELECT count(*)::int AS n FROM email_settings"))[0].n).toBe(1);

      // The audit trail: who, what changed with previous and new values, and the password only as a word.
      const log = await emailAudit();
      expect(log.map((e) => [e.action, e.actor_id, e.entity_type, e.metadata.password])).toEqual([["EMAIL_SETTINGS_CREATED", user.admin, "EMAIL_SETTINGS", "set"], ["EMAIL_SETTINGS_UPDATED", user.admin, "EMAIL_SETTINGS", "unchanged"],
        ["EMAIL_SETTINGS_UPDATED", user.admin, "EMAIL_SETTINGS", "changed"], ["EMAIL_SETTINGS_UPDATED", user.admin, "EMAIL_SETTINGS", "removed"]]);
      expect(log[1].metadata.changes).toEqual({ smtp_host: ["mail.example.com", "smtp2.example.com"], smtp_port: [securePort, 465], security: ["STARTTLS", "TLS"], tls_verify: [false, true] });
      expect(log[2].metadata.changes).toEqual({});
      expect(log[3].metadata.changes).toEqual({ smtp_port: [465, 25], security: ["TLS", "NONE"], smtp_username: [SMTP_USER, null] });
      const text = JSON.stringify(log);
      for (const secret of [SMTP_PASS, SMTP_PASS.trim(), "a new password", first.smtp_password_enc, third.smtp_password_enc, "v1:"]) expect(text).not.toContain(secret);
      expect((await activity(tx(owner))).changes.some((e) => e.action === "EMAIL_SETTINGS_UPDATED" && e.actor === "System Admin")).toBe(true);
    } finally { await owner.query("ROLLBACK"); }
  });
  it("removing them is audited without the password, and there is nothing to remove twice", async () => {
    await as(user.admin, async (c) => {
      await c.query(SAVE, args()); await c.query("SELECT admin_clear_email_settings()");
      expect(await rows(c, "SELECT * FROM admin_email_settings()")).toEqual([]); expect(await rows(c, "SELECT * FROM admin_email_transport()")).toEqual([]);
      const last = (await emailAudit(c)).at(-1)!;
      expect(last).toMatchObject({ action: "EMAIL_SETTINGS_CLEARED", actor_id: user.admin, metadata: { smtp_host: "127.0.0.1", smtp_username: SMTP_USER, password: "removed" } });
      expect(JSON.stringify(last)).not.toMatch(/v1:|c0rrect/);
      expect(await fails(c, "SELECT admin_clear_email_settings()")).toMatch(/no email settings are saved/);
    });
  });
});

describe("sending with the saved settings", () => {
  it("the worker delivers notifications through them: logged in, encrypted, from the saved sender", async () => {
    await reset(); await commit(SAVE, args({ name: "ABIG Treasury", from: "treasury@abig.test" }));
    const id = await event(); const pool = workerPool();
    expect(await tick(pool, makeSender(pool, {}, 0), "https://x.test")).toBe(1);
    expect(await outcome(id)).toMatchObject({ outcome: "DELIVERED", last_error: null });
    expect(inbox.map((m) => m.to).sort()).toEqual(["dawit@abig.test", "yared@abig.test"]);
    for (const m of inbox) expect(m).toMatchObject({ from: "ABIG Treasury <treasury@abig.test>", user: SMTP_USER, subject: expect.stringContaining("PR-TEST") });
  }, 60_000);
  it("a failure is kept for retry as before, and a change on the screen is picked up without a restart", async () => {
    await reset(); await commit(SAVE, args({ verify: true }));   // the test server's certificate is self-signed, so checking it must fail
    const id = await event(); const pool = workerPool(); const send = makeSender(pool, {}, 0);
    expect(await tick(pool, send, "https://x.test")).toBe(1);
    expect(inbox).toEqual([]);
    const failed = await outcome(id);
    expect(failed).toMatchObject({ outcome: null, attempts: 1 }); expect(failed.last_error).toMatch(/self[- ]signed|certificate/i); expect(failed.last_error).not.toContain("c0rrect");
    expect(await rows(owner, "SELECT email, status FROM notification_deliveries WHERE event_id = $1 ORDER BY email", [id])).toEqual([{ email: "dawit@abig.test", status: "FAILED" }, { email: "yared@abig.test", status: "FAILED" }]);

    await commit(SAVE, args({ verify: false, password: null }));   // without entering the password again
    await owner.query("UPDATE notification_outbox SET available_at = now() - interval '1 second' WHERE id = $1", [id]);
    expect(await tick(pool, send, "https://x.test")).toBe(1);      // the same sender: no restart
    expect(await outcome(id)).toMatchObject({ outcome: "DELIVERED", attempts: 2 });
    expect(inbox.map((m) => m.to).sort()).toEqual(["dawit@abig.test", "yared@abig.test"]);
  }, 60_000);
  it("a wrong saved password fails the delivery; it does not fall back to another mail server", async () => {
    await reset(); await commit(SAVE, args({ password: encryptMailSecret("not the password") }));
    const id = await event(); const pool = workerPool();
    expect(await tick(pool, makeSender(pool, { SMTP_URL: `smtp://127.0.0.1:${plainPort}` }, 0), "https://x.test")).toBe(1);
    expect(inbox).toEqual([]);
    expect((await outcome(id)).last_error).toMatch(/Invalid login|535|Invalid username or password/);
  }, 60_000);
});

describe("when nothing is saved", () => {
  it("the worker uses the environment exactly as before", async () => {
    await reset();
    const id = await event(); const pool = workerPool();
    expect(await tick(pool, makeSender(pool, { SMTP_URL: `smtp://127.0.0.1:${plainPort}`, MAIL_FROM: "Deployment <deploy@abig.test>" }, 0), "https://x.test")).toBe(1);
    expect(await outcome(id)).toMatchObject({ outcome: "DELIVERED" });
    expect(inbox.map((m) => [m.to, m.from, m.user]).sort()).toEqual([["dawit@abig.test", "Deployment <deploy@abig.test>", null], ["yared@abig.test", "Deployment <deploy@abig.test>", null]]);
  }, 60_000);
  it("saved settings take over from the environment, and removing them gives it back", async () => {
    await reset(); const pool = workerPool(); const send = makeSender(pool, { SMTP_URL: `smtp://127.0.0.1:${plainPort}`, MAIL_FROM: "Deployment <deploy@abig.test>" }, 0);
    await commit(SAVE, args({ name: "Saved Sender", from: "saved@abig.test" }));
    await send({ to: "one@abig.test", subject: "one", text: "1" });
    await commit("SELECT admin_clear_email_settings()");
    await send({ to: "two@abig.test", subject: "two", text: "2" });
    expect(inbox.map((m) => [m.to, m.from, m.user])).toEqual([["one@abig.test", "Saved Sender <saved@abig.test>", SMTP_USER], ["two@abig.test", "Deployment <deploy@abig.test>", null]]);
  }, 60_000);
  it("without a pool, or with neither saved settings nor SMTP_URL, nothing is sent to any server", async () => {
    await reset();
    expect(resolveMail(null, {})).toMatchObject({ source: "NONE", options: null, from: "ABIG Finance <no-reply@localhost>" });
    expect(resolveMail(null, { SMTP_URL: "smtps://u:p@mail.example.com:465", MAIL_FROM: "X <x@y.test>" })).toMatchObject({ source: "ENVIRONMENT", from: "X <x@y.test>", options: { url: "smtps://u:p@mail.example.com:465", connectionTimeout: 30_000, greetingTimeout: 30_000, socketTimeout: 60_000 } });
    await makeSender(undefined, {})({ to: "x@abig.test", subject: "printed", text: "" });
    const pool = workerPool(); await makeSender(pool, {}, 0)({ to: "x@abig.test", subject: "printed", text: "" });
    expect(inbox).toEqual([]);
  });
});

describe("the test email", () => {
  const transport = (c: Client) => rows(c, "SELECT * FROM admin_email_transport()").then((r) => (r[0] ?? null) as EmailSettingsRow | null);
  it("goes through the saved settings and reports success", async () => {
    await reset();
    await as(user.admin, async (c) => {
      await c.query(SAVE, args({ name: "ABIG Finance", from: "no-reply@abig.test" }));
      const r = await sendTestEmail(await transport(c), "admin@abig.test", {});
      expect(r).toEqual({ ok: true, source: "SAVED", error: null });
      expect(inbox).toEqual([{ to: "admin@abig.test", from: "ABIG Finance <no-reply@abig.test>", subject: "ABIG Finance test email", user: SMTP_USER }]);
      await c.query("SELECT admin_record_email_test($1,$2,$3)", [" Admin@ABIG.test ", r.source, r.error]);
      expect((await emailAudit(c)).at(-1)).toMatchObject({ action: "EMAIL_TEST_SENT", actor_id: user.admin, metadata: { to: "admin@abig.test", settings: "SAVED" } });
    });
  }, 60_000);
  it("reports clearly why it failed: wrong password, unreachable server, certificate, unreadable password", async () => {
    await reset();
    await as(user.admin, async (c) => {
      await c.query(SAVE, args({ password: encryptMailSecret("not the password") }));
      const wrong = await sendTestEmail(await transport(c), "admin@abig.test", {});
      expect(wrong).toMatchObject({ ok: false, source: "SAVED" }); expect(wrong.error).toMatch(/Invalid login|535|Invalid username or password/); expect(wrong.error).not.toContain("not the password");
      await c.query("SELECT admin_record_email_test($1,$2,$3)", ["admin@abig.test", wrong.source, wrong.error]);
      const logged = (await emailAudit(c)).at(-1)!;
      expect(logged).toMatchObject({ action: "EMAIL_TEST_FAILED", metadata: { to: "admin@abig.test", settings: "SAVED", error: wrong.error } }); expect(JSON.stringify(logged)).not.toMatch(/v1:|not the password/);

      await c.query(SAVE, args({ verify: true }));
      expect((await sendTestEmail(await transport(c), "admin@abig.test", {})).error).toMatch(/self[- ]signed|certificate/i);

      const closed = new SMTPServer({}); const port = await listen(closed); await new Promise<void>((r) => closed.close(() => r()));
      await c.query(SAVE, args({ port, password: null }));
      const down = await sendTestEmail(await transport(c), "admin@abig.test", {});
      expect(down.ok).toBe(false); expect(down.error).toMatch(/ECONNREFUSED|connect/i);

      const row = await transport(c); const kept = process.env.MAIL_ENCRYPTION_KEY;
      try { process.env.MAIL_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64"); expect(await sendTestEmail(row, "admin@abig.test", {})).toMatchObject({ ok: false, source: "SAVED", error: expect.stringContaining("could not be read with this server's encryption key") }); }
      finally { if (kept === undefined) delete process.env.MAIL_ENCRYPTION_KEY; else process.env.MAIL_ENCRYPTION_KEY = kept; }
      expect(inbox).toEqual([]);
      expect(await fails(c, "SELECT admin_record_email_test('x@abig.test','ELSEWHERE',NULL)")).toMatch(/unknown email settings source/);
    });
  }, 90_000);
  it("uses the environment when nothing is saved, and says so when there is no mail server at all", async () => {
    await reset();
    await as(user.admin, async (c) => {
      expect(await transport(c)).toBeNull();
      expect(await sendTestEmail(null, "admin@abig.test", {})).toEqual({ ok: false, source: "NONE", error: "No mail server is set. Save the email settings first." });
      expect(await sendTestEmail(null, "admin@abig.test", { SMTP_URL: `smtp://127.0.0.1:${plainPort}`, MAIL_FROM: "Deployment <deploy@abig.test>" })).toEqual({ ok: true, source: "ENVIRONMENT", error: null });
      expect(inbox).toEqual([{ to: "admin@abig.test", from: "Deployment <deploy@abig.test>", subject: "ABIG Finance test email", user: null }]);
    });
  }, 60_000);
});
