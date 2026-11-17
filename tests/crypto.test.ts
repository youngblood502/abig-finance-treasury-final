import { describe, expect, it } from "vitest";
import { base32, decryptSecret, encryptSecret, hashPassword, newTotpSecret, passwordProblem, temporaryPassword, totpAt, unbase32, verifyPassword, verifyTotp } from "../src/lib/crypto";

describe("passwords", () => {
  it("hashes with a random salt and verifies only the right password", async () => {
    const a = await hashPassword("correct horse battery"), b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("correct horse batterz", a)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", "garbage")).toBe(false);
  });
  it("applies a sensible policy", () => {
    expect(passwordProblem("short")).toMatch(/12 characters/);
    expect(passwordProblem("aaaaaaaaaaaaaaaa")).toMatch(/different characters/);
    expect(passwordProblem("meron-is-great-123", "meron@abig.test")).toMatch(/easy to guess/);
    expect(passwordProblem("password123456")).toMatch(/easy to guess/);
    expect(passwordProblem("lamp river orange tunnel", "meron@abig.test")).toBeNull();
  });
  it("generates readable temporary passwords that pass the policy", () => {
    const t = temporaryPassword(); expect(t).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/); expect(passwordProblem(t)).toBeNull();
  });
});
describe("one-time codes", () => {
  it("matches the RFC 6238 test vector (SHA-1, 8 digits truncated to 6)", () => {
    const secret = base32(Buffer.from("12345678901234567890"));
    expect(totpAt(secret, Math.floor(59 / 30))).toBe("287082");           // RFC 6238 appendix B, T=59 -> 94287082
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe("081804");   // T=1111111109 -> 07081804
  });
  it("round-trips base32", () => { const b = Buffer.from([1, 2, 3, 250, 251, 252, 0, 9]); expect(unbase32(base32(b))).toEqual(b); });
  it("accepts the current and neighbouring step, rejects others, and refuses reuse", () => {
    const s = newTotpSecret(), now = 1_700_000_000_000, step = Math.floor(now / 30000);
    expect(verifyTotp(s, totpAt(s, step), null, now)).toBe(step);
    expect(verifyTotp(s, totpAt(s, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(s, totpAt(s, step + 5), null, now)).toBeNull();
    expect(verifyTotp(s, "12345", null, now)).toBeNull();
    expect(verifyTotp(s, totpAt(s, step), step, now)).toBeNull(); // already used
    expect(verifyTotp(s, totpAt(s, step - 1), step - 1, now)).toBeNull();
  });
});
describe("secret encryption", () => {
  it("round-trips and detects tampering", () => {
    const c = encryptSecret("JBSWY3DPEHPK3PXP"); expect(c).toMatch(/^v1:/); expect(c).not.toContain("JBSWY3DP");
    expect(decryptSecret(c)).toBe("JBSWY3DPEHPK3PXP");
    const raw = Buffer.from(c.slice(3), "base64"); raw[raw.length - 1] ^= 1;
    expect(() => decryptSecret("v1:" + raw.toString("base64"))).toThrow();
  });
});
