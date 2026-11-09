import { describe, expect, it } from "vitest";
import { types } from "pg";
import { addisDate, addisIso, amount2, dstr, dtime, etb, STATE_LABEL, TIME_ZONE } from "../src/lib/format";
import "../src/lib/db";

describe("ETB amounts", () => {
  it("always show two decimals and thousands separators", () => {
    expect(etb(1250)).toBe("ETB 1,250.00");
    expect(etb("1250.5")).toBe("ETB 1,250.50");
    expect(etb("1234567.8900")).toBe("ETB 1,234,567.89");
    expect(etb(0)).toBe("ETB 0.00");
    expect(etb(null)).toBe("ETB 0.00");
    expect(etb(-200000)).toBe("ETB -200,000.00");
  });
  it("round the four decimals the database keeps", () => { expect(etb("10.1250")).toBe("ETB 10.13"); expect(etb("10.1240")).toBe("ETB 10.12"); });
  it("have two decimals in files too", () => { expect(amount2("1000.0000")).toBe("1000.00"); expect(amount2(null)).toBe("0.00"); expect(amount2("-5.5")).toBe("-5.50"); });
});

describe("Africa/Addis_Ababa time", () => {
  it("is the zone in use", () => { expect(TIME_ZONE).toBe("Africa/Addis_Ababa"); });
  it("is three hours ahead of UTC", () => {
    expect(dtime(new Date("2026-11-05T10:15:00Z"))).toBe("2026-11-05 13:15 EAT");
    expect(addisIso(new Date("2026-11-05T10:15:30Z"))).toBe("2026-11-05T13:15:30+03:00");
  });
  it("rolls over to the next day at 21:00 UTC", () => {
    expect(dtime(new Date("2026-11-05T21:30:00Z"))).toBe("2026-11-06 00:30 EAT");
    expect(dstr(new Date("2026-11-05T21:30:00Z"))).toBe("2026-11-06");
    expect(addisDate(new Date("2026-12-31T22:00:00Z"))).toBe("2027-01-01");
  });
  it("shows midnight as 00, not 24", () => { expect(dtime(new Date("2026-11-05T21:00:00Z"))).toBe("2026-11-06 00:00 EAT"); });
  it("does not depend on the machine's own time zone", () => {
    const tz = process.env.TZ;
    try { process.env.TZ = "America/New_York"; expect(dtime(new Date("2026-11-05T10:15:00Z"))).toBe("2026-11-05 13:15 EAT"); }
    finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
  });
  it("leaves calendar days alone: a due date from the database stays that day", () => {
    expect(types.getTypeParser(types.builtins.DATE)("2026-11-01")).toBe("2026-11-01");
    expect(dstr("2026-11-01")).toBe("2026-11-01");
    expect(dstr(null)).toBe("");
  });
});

describe("status labels", () => {
  it("Authenticated says it is not yet paid; every status has a label", () => {
    expect(STATE_LABEL.AUTHENTICATED).toBe("Authenticated, not yet paid");
    expect(STATE_LABEL.PAID).toBe("Paid"); expect(STATE_LABEL.CANCELLED).toBe("Cancelled"); expect(STATE_LABEL.REJECTED).toBe("Rejected");
    expect(STATE_LABEL.AUTHENTICATED).not.toMatch(/completed/);
  });
});
