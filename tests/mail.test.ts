import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, Pool } from "pg";
import { SMTPServer } from "smtp-server";
import nodemailer from "nodemailer";
import { actAs, ASKU, authorized, fn, rows, S_HAWASSA, setupDb, user } from "./helpers";
import { compose, tick } from "../src/worker/mail";

let owner: Client; let workerUrl: string; let smtp: SMTPServer; let port: number; const inbox: { to: string; subject: string; text: string }[] = [];
beforeAll(async () => {
  const d = await setupDb("abig_test_mail"); owner = d.owner; workerUrl = d.workerUrl;
  smtp = new SMTPServer({ authOptional: true, disabledCommands: ["STARTTLS"], onData(stream, session, cb) { let raw = ""; stream.on("data", (c) => (raw += c)); stream.on("end", () => { raw = raw.replace(/=\r?\n/g, "").replace(/=3D/g, "="); inbox.push({ to: session.envelope.rcptTo[0].address, subject: /Subject: (.*)/.exec(raw)?.[1].trim() ?? "", text: raw }); cb(); }); } });
  await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", () => r())); port = (smtp.server.address() as any).port;
});
afterAll(async () => { smtp?.close(); await owner?.end(); });

describe("email delivery", () => {
  it("sends each event to the people allowed to act, with a link, and marks it delivered", async () => {
    await owner.query("BEGIN"); const a = await authorized(owner, { amounts: [1000] }); await owner.query("COMMIT");
    await actAs(owner, user.meron);
    const pool = new Pool({ connectionString: workerUrl });
    const send = async (m: any) => { await transport.sendMail({ from: "ABIG <x@y.test>", ...m }); };
    const transport = nodemailer.createTransport({ host: "127.0.0.1", port, secure: false, tls: { rejectUnauthorized: false } });
    expect(await tick(pool, send, "https://finance.example.com")).toBeGreaterThanOrEqual(3);
    const authorizedMail = inbox.filter((m) => /authorized and ready to be funded/.test(m.subject));
    expect(authorizedMail.map((m) => m.to).sort()).toEqual(["lidya@abig.test", "meron@abig.test", "yared@abig.test"]); // the company accountants (including the creator)
    expect(authorizedMail[0].text).toContain(`https://finance.example.com/requests/${a.id}`);
    expect(inbox.filter((m) => /waiting for verification/.test(m.subject)).map((m) => m.to).sort()).toEqual(["dawit@abig.test", "yared@abig.test"]);
    expect((await rows(owner, "SELECT count(*)::int AS n FROM notification_outbox WHERE request_id=$1 AND delivered_at IS NULL", [a.id]))[0].n).toBe(0);
    await pool.end();
  });
  it("keeps the event and backs off when the mail server is unreachable", async () => {
    await owner.query("BEGIN"); const a = await authorized(owner, { amounts: [1000] }); await owner.query("COMMIT");
    const pool = new Pool({ connectionString: workerUrl });
    await tick(pool, async () => { throw new Error("connect ECONNREFUSED"); }, "http://x");
    const left = await rows(owner, "SELECT attempts, last_error, available_at > now() AS later FROM notification_outbox WHERE request_id=$1 AND delivered_at IS NULL", [a.id]);
    expect(left.length).toBeGreaterThanOrEqual(3); expect(left[0]).toMatchObject({ attempts: 1, last_error: expect.stringContaining("ECONNREFUSED"), later: true });
    await pool.end();
  });
  it("composes readable messages", () => {
    const c = compose({ id: "1", event_type: "REQUEST_RETURNED", request_id: "r1", payload: { request_no: "PR-000009", reason: "Wrong invoice number" } }, "https://x.test/");
    expect(c.subject).toBe("PR-000009 was returned for correction"); expect(c.text).toContain("Reason: Wrong invoice number"); expect(c.text).toContain("https://x.test/requests/r1");
  });
});
