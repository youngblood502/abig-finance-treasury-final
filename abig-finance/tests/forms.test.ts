import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : []; });

describe("forms", () => {
  // Once React has loaded, a form post does not say which named button was pressed: a "Verify" button could be read as "Reject".
  // Each button must have its own action (formAction) instead.
  it("no submit button carries a name that an action could depend on", () => {
    const named = files(join(__dirname, "../src")).filter((f) => /<button[^>]*\sname=/.test(readFileSync(f, "utf8")));
    expect(named).toEqual([]);
  });
});
