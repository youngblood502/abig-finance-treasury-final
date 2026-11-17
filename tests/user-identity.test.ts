import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { Tx } from "../src/lib/db";
import { activity } from "../src/lib/admin";
import { translate, WorkflowError } from "../src/lib/errors";
import { actAs, fails, fn, rows, setupDb, urlFor, user } from "./helpers";

// A system administrator corrects a person's name and the email address they sign in with: admin_update_user_identity().
const SYSTEM = "00000000-0000-4000-8000-000000000000";
let owner: Client; let as: Awaited<ReturnType<typeof setupDb>>["as"];
const tx = (c: Client): Tx => ({ q: async (sql, p) => (await c.query(sql, p as unknown[])).rows });
const person = async (c: Client, id: string) => (await rows(c, "SELECT email, full_name FROM users WHERE id = $1", [id]))[0];
const audits = (c: Client, id: string) => rows(c, "SELECT action, actor_id, entity_type, metadata FROM audit_events WHERE entity_id = $1 AND action LIKE 'USER\\_%CHANGED' ORDER BY occurred_at, action", [id]);
/** As the owner, acting as a person, in a transaction that is rolled back: for what the application role cannot read (sessions, credentials). */
async function privileged<T>(actor: string, run: (c: Client) => Promise<T>): Promise<T> {
  await owner.query("BEGIN");
  try { await actAs(owner, actor); return await run(owner); } finally { await owner.query("ROLLBACK"); }
}
/** Everything about a person that this feature must leave alone. */
const untouched = async (c: Client, id: string) => ({
  account: (await rows(c, "SELECT password_hash, is_active, is_system_admin, must_change_password, totp_enabled, totp_secret_enc, totp_last_step, failed_logins, locked_until, password_changed_at, created_at FROM users WHERE id = $1", [id]))[0],
  memberships: await rows(c, "SELECT m.id, m.company_id, m.revoked_at, m.valid_from, m.valid_to, (SELECT array_agg(mr.role_id ORDER BY mr.role_id) FROM membership_roles mr WHERE mr.membership_id = m.id) AS roles FROM company_memberships m WHERE m.user_id = $1 ORDER BY m.id", [id]),
  grants: await rows(c, "SELECT id, company_id, permission, revoked_at FROM group_permission_grants WHERE user_id = $1 ORDER BY id", [id]),
});

beforeAll(async () => {
  const d = await setupDb("abig_test_user_identity"); owner = d.owner; as = d.as;
  // Meron has a password, two-step sign-in and two sessions; the administrator has one session.
  await owner.query("UPDATE users SET password_hash = 'scrypt$x$y$z$salt$hash', totp_enabled = true, totp_secret_enc = 'v1:secret', totp_last_step = 7, password_changed_at = now() WHERE id = $1", [user.meron]);
  await owner.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('m1', $1, now() + interval '1 hour'), ('m2', $1, now() + interval '1 hour'), ('a1', $2, now() + interval '1 hour'), ('l1', $3, now() + interval '1 hour')", [user.meron, user.admin, user.lidya]);
});
afterAll(async () => { await owner?.end(); });

describe("changing a person's name", () => {
  it("is saved, trimmed, and audited with the administrator and both values", async () => {
    await as(user.admin, async (c) => {
      expect(await fn(c, "admin_update_user_identity", user.meron, "  Meron   Tadesse ", "meron@abig.test")).toBe("NAME");
      expect(await person(c, user.meron)).toEqual({ email: "meron@abig.test", full_name: "Meron Tadesse" });
      expect(await audits(c, user.meron)).toEqual([{ action: "USER_NAME_CHANGED", actor_id: user.admin, entity_type: "USER", metadata: { previous: "Meron (ASKU accountant)", new: "Meron Tadesse" } }]);
    });
  });
  it("does not sign the person out or write to the sign-in log", async () => {
    await privileged(user.admin, async (c) => {
      await fn(c, "admin_update_user_identity", user.meron, "Meron Tadesse", "meron@abig.test");
      expect((await rows(c, "SELECT token_hash FROM sessions WHERE user_id = $1 ORDER BY 1", [user.meron])).map((r) => r.token_hash)).toEqual(["m1", "m2"]);
      expect(await rows(c, "SELECT 1 FROM auth_events WHERE user_id = $1", [user.meron])).toEqual([]);
    });
  });
  it("may be the same as another person's: two people can share a real name, and only the email address tells them apart", async () => {
    await as(user.admin, async (c) => {
      expect(await fn(c, "admin_update_user_identity", user.meron, "  Lidya (ASKU accountant) ", "meron@abig.test")).toBe("NAME");
      expect(await person(c, user.meron)).toEqual({ email: "meron@abig.test", full_name: "Lidya (ASKU accountant)" });
      expect(await person(c, user.lidya)).toEqual({ email: "lidya@abig.test", full_name: "Lidya (ASKU accountant)" });
      // Changing only the capitals is a change, and audited.
      expect(await fn(c, "admin_update_user_identity", user.meron, "LIDYA (ASKU accountant)", "meron@abig.test")).toBe("NAME");
    });
  });
  it("is required, and not too long", async () => {
    await as(user.admin, async (c) => {
      for (const name of ["", "   ", null]) expect(await fails(c, "SELECT admin_update_user_identity($1,$2,$3)", [user.meron, name, "meron@abig.test"])).toMatch(/the name is required/);
      expect(await fails(c, "SELECT admin_update_user_identity($1,$2,$3)", [user.meron, "x".repeat(121), "meron@abig.test"])).toMatch(/too long/);
    });
  });
});

describe("changing a person's email address", () => {
  it("is saved in lower case and audited with the administrator and both values", async () => {
    await as(user.admin, async (c) => {
      expect(await fn(c, "admin_update_user_identity", user.meron, "Meron (ASKU accountant)", "  Meron.Tadesse@ABIG.Test ")).toBe("EMAIL");
      expect(await person(c, user.meron)).toEqual({ email: "meron.tadesse@abig.test", full_name: "Meron (ASKU accountant)" });
      expect(await audits(c, user.meron)).toEqual([{ action: "USER_EMAIL_CHANGED", actor_id: user.admin, entity_type: "USER", metadata: { previous: "meron@abig.test", new: "meron.tadesse@abig.test", signed_out: true } }]);
      const seen = (await activity(tx(c))).changes.find((e) => e.action === "USER_EMAIL_CHANGED");
      expect(seen).toMatchObject({ actor: "System Admin", metadata: { previous: "meron@abig.test", new: "meron.tadesse@abig.test" } });
    });
  });
  it("treats the same address in other capitals as no change at all", async () => {
    await as(user.admin, async (c) => {
      expect(await fn(c, "admin_update_user_identity", user.meron, "Meron (ASKU accountant)", "MERON@Abig.TEST")).toBe("UNCHANGED");
      expect(await audits(c, user.meron)).toEqual([]);
    });
  });
  it("refuses an address another person has, whatever the capitals", async () => {
    await as(user.admin, async (c) => {
      for (const email of ["lidya@abig.test", "LIDYA@ABIG.TEST", " Lidya@Abig.Test "]) expect(await fails(c, "SELECT admin_update_user_identity($1,$2,$3)", [user.meron, "Meron (ASKU accountant)", email])).toMatch(/another person already has that email address/);
      expect(await person(c, user.meron)).toMatchObject({ email: "meron@abig.test" });
    });
  });
  it("is required and must look like an email address", async () => {
    await as(user.admin, async (c) => {
      for (const email of ["", "  ", null]) expect(await fails(c, "SELECT admin_update_user_identity($1,$2,$3)", [user.meron, "Meron (ASKU accountant)", email])).toMatch(/the email address is required/);
      for (const email of ["meron", "meron@", "@abig.test", "meron@abig", "me ron@abig.test", "meron@abig.test@x", `${"x".repeat(250)}@abig.test`]) expect(await fails(c, "SELECT admin_update_user_identity($1,$2,$3)", [user.meron, "Meron (ASKU accountant)", email])).toMatch(/enter a valid email address/);
    });
  });
  it("signs the person out everywhere, at once, and writes it to the sign-in log", async () => {
    await privileged(user.admin, async (c) => {
      expect(await fn(c, "admin_update_user_identity", user.meron, "Meron Tadesse", "meron.tadesse@abig.test")).toBe("BOTH");
      expect(await rows(c, "SELECT 1 FROM sessions WHERE user_id = $1", [user.meron])).toEqual([]);
      // Nobody else's session is touched.
      expect((await rows(c, "SELECT token_hash FROM sessions ORDER BY 1")).map((r) => r.token_hash)).toEqual(["a1", "l1"]);
      expect(await rows(c, "SELECT event, email, detail FROM auth_events WHERE user_id = $1 ORDER BY event", [user.meron])).toEqual([
        { event: "EMAIL_CHANGED", email: "meron.tadesse@abig.test", detail: "changed by an administrator; previous address meron@abig.test" },
        { event: "SESSIONS_REVOKED", email: "meron.tadesse@abig.test", detail: "email address changed" }]);
      // Sign-in looks the person up by address: the new one finds them, the old one finds nobody.
      expect((await rows(c, "SELECT id FROM users WHERE email = 'meron.tadesse@abig.test'"))[0].id).toBe(user.meron);
      expect(await rows(c, "SELECT id FROM users WHERE email = 'meron@abig.test'")).toEqual([]);
    });
  });
  it("keeps the session of an administrator who changes their own address", async () => {
    await privileged(user.admin, async (c) => {
      expect(await fn(c, "admin_update_user_identity", user.admin, "System Admin", "root@abig.test")).toBe("EMAIL");
      expect(await rows(c, "SELECT token_hash FROM sessions WHERE user_id = $1", [user.admin])).toEqual([{ token_hash: "a1" }]);
      expect((await audits(c, user.admin))[0].metadata).toEqual({ previous: "admin@abig.test", new: "root@abig.test", signed_out: false });
    });
  });
});

describe("what stays the same", () => {
  it("password, two-step sign-in, status, administrator rights, company access, roles and group reporting", async () => {
    for (const id of [user.meron, user.abebe, user.hana]) {
      await privileged(user.admin, async (c) => {
        const before = await untouched(c, id);
        expect(before.memberships.length).toBeGreaterThan(0);
        expect(await fn(c, "admin_update_user_identity", id, `Renamed ${id.slice(-2)}`, `renamed${id.slice(-2)}@abig.test`)).toBe("BOTH");
        expect(await untouched(c, id)).toEqual(before);
      });
    }
  });
  it("a deactivated or locked person stays deactivated or locked", async () => {
    await privileged(user.admin, async (c) => {
      await c.query("UPDATE users SET is_active = false, locked_until = now() + interval '10 minutes', failed_logins = 5, must_change_password = true WHERE id = $1", [user.lidya]);
      const before = await untouched(c, user.lidya);
      await fn(c, "admin_update_user_identity", user.lidya, "Lidya B", "lidya.b@abig.test");
      expect(await untouched(c, user.lidya)).toEqual(before);
    });
  });
});

describe("who may change a name or an email address", () => {
  it("only a system administrator: accountants, finance managers and owners are refused", async () => {
    for (const who of [user.meron, user.dawit, user.hana, user.abebe, user.kebede]) {
      await as(who, async (c) => {
        expect(await fails(c, "SELECT admin_update_user_identity($1,$2,$3)", [user.lidya, "Changed", "changed@abig.test"])).toMatch(/only a system administrator/);
        expect(await fails(c, "SELECT admin_update_user_identity($1,$2,$3)", [who, "Changed", "changed@abig.test"])).toMatch(/only a system administrator/);   // not even their own
      });
    }
    await as(null, async (c) => { expect(await fails(c, "SELECT admin_update_user_identity($1,$2,$3)", [user.lidya, "Changed", "changed@abig.test"])).toMatch(/only a system administrator/); });
  });
  it("a deactivated administrator is refused", async () => {
    await privileged(user.admin, async (c) => {
      await c.query("UPDATE users SET is_active = false WHERE id = $1", [user.admin]);
      expect(await fails(c, "SELECT admin_update_user_identity($1,$2,$3)", [user.lidya, "Changed", "changed@abig.test"])).toMatch(/only a system administrator/);
    });
  });
  it("there is no way around the audited function: the application role cannot write either column", async () => {
    for (const who of [user.admin, user.meron]) {
      await as(who, async (c) => {
        expect(await fails(c, "UPDATE users SET email = 'changed@abig.test' WHERE id = $1", [user.lidya])).toMatch(/permission denied/);
        expect(await fails(c, "UPDATE users SET full_name = 'Changed' WHERE id = $1", [user.lidya])).toMatch(/permission denied/);
      });
    }
    expect((await rows(owner, "SELECT has_function_privilege('abig_app', 'admin_update_user_identity(uuid,text,text)', 'EXECUTE') AS app, has_function_privilege('abig_worker', 'admin_update_user_identity(uuid,text,text)', 'EXECUTE') AS worker, has_function_privilege('abig_auth', 'admin_update_user_identity(uuid,text,text)', 'EXECUTE') AS auth"))[0]).toEqual({ app: true, worker: false, auth: false });
  });
  it("the System user and an unknown person are refused", async () => {
    await as(user.admin, async (c) => {
      expect(await fails(c, "SELECT admin_update_user_identity($1,$2,$3)", [SYSTEM, "Changed", "changed@abig.test"])).toMatch(/System user/);
      expect(await fails(c, "SELECT admin_update_user_identity($1,$2,$3)", ["a0000000-0000-4000-8000-000000009999", "Changed", "changed@abig.test"])).toMatch(/person not found/);
    });
  });
});

describe("the rules hold for every route", () => {
  it("a new person may share a name, but cannot have an empty or too long name, a malformed address or someone else's address", async () => {
    await privileged(user.admin, async (c) => {
      await c.query("INSERT INTO users (email, full_name) VALUES ('second.admin@abig.test', ' System   Admin ')");
      expect((await rows(c, "SELECT full_name FROM users WHERE email = 'second.admin@abig.test'"))[0].full_name).toBe("System Admin");
      expect(await fails(c, "INSERT INTO users (email, full_name) VALUES ('new@abig.test', '  ')")).toMatch(/the name is required/);
      expect(await fails(c, `INSERT INTO users (email, full_name) VALUES ('new@abig.test', '${"x".repeat(121)}')`)).toMatch(/too long/);
      expect(await fails(c, "INSERT INTO users (email, full_name) VALUES ('not-an-address', 'New Person')")).toMatch(/enter a valid email address/);
      expect(await fails(c, "INSERT INTO users (email, full_name) VALUES ('MERON@abig.test', 'New Person')")).toMatch(/users_email_check/);
      expect(await fails(c, "INSERT INTO users (email, full_name) VALUES ('meron@abig.test', 'New Person')")).toMatch(/users_email_key/);
      await c.query("INSERT INTO users (email, full_name) VALUES ('new@abig.test', '  New   Person ')");
      expect((await rows(c, "SELECT full_name FROM users WHERE email = 'new@abig.test'"))[0].full_name).toBe("New Person");
    });
  });
  it("two administrators giving two people the same address at the same moment: one is refused", async () => {
    const a = new Client({ connectionString: urlFor("abig_test_user_identity") }); await a.connect();
    try {
      await a.query("BEGIN"); await actAs(a, user.admin); await fn(a, "admin_update_user_identity", user.tigist, "Tigist (Berbero accountant)", "shared@abig.test");
      await owner.query("BEGIN"); await actAs(owner, user.admin);
      const second = owner.query("SELECT admin_update_user_identity($1,$2,$3)", [user.samuel, "Samuel (BEES accountant)", "SHARED@abig.test"]).then(() => "saved", (e) => String(e.constraint ?? e.message));
      await new Promise((r) => setTimeout(r, 300));
      await a.query("COMMIT");
      expect(await second).toBe("users_email_key");
    } finally {
      await owner.query("ROLLBACK").catch(() => {}); await a.query("ROLLBACK").catch(() => {});
      await a.query("UPDATE users SET email = 'tigist@abig.test' WHERE id = $1", [user.tigist]); await a.end();
    }
  });
  it("the application shows its own message for a duplicate address", () => {
    const run = () => translate({ code: "23505", message: "duplicate key value violates unique constraint \"users_email_key\"", constraint: "users_email_key" });
    expect(run).toThrow(WorkflowError); expect(run).toThrow("Another person already has that email address.");
  });
});
