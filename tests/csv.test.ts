import { describe, expect, it } from "vitest";
import { toCsv } from "../src/lib/csv";

describe("CSV export", () => {
  const cols: [string, string][] = [["a", "Name"], ["b", "Amount"]];
  it("quotes commas, quotes and line breaks", () => {
    const out = toCsv(cols, [{ a: 'Acme, "Ltd"', b: 10 }, { a: "two\nlines", b: null }]);
    expect(out).toBe('\uFEFFName,Amount\r\n"Acme, ""Ltd""",10\r\n"two\nlines",\r\n');
  });
  it("neutralises spreadsheet formulas but leaves real negative numbers alone", () => {
    const out = toCsv(cols, [{ a: '=HYPERLINK("http://evil","click")', b: -250.5 }, { a: "+1+1", b: "@SUM(A1)" }, { a: "-cmd|' /C calc'!A0", b: "ok" }]);
    expect(out).toContain(`"'=HYPERLINK(""http://evil"",""click"")",-250.5`);
    expect(out).toContain("'+1+1,'@SUM(A1)");
    expect(out).toContain(`'-cmd|' /C calc'!A0,ok`);
  });
  it("writes dates in a standard form, in Addis Ababa time", () => { expect(toCsv([["d", "D"]], [{ d: new Date("2026-10-13T10:00:00Z") }])).toContain("2026-10-13T13:00:00+03:00"); });
});
