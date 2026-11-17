import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isCurrentPath } from "../src/lib/nav";

const css = readFileSync(join(__dirname, "../src/app/theme.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const block = (selector: string) => {
  const body = css.split(selector + " {")[1].split("}")[0];
  return Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]));
};
const themes = { light: block(":root"), dark: block(':root[data-theme="dark"]') };

// WCAG relative luminance and contrast.
const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

// Every text colour on every surface it is used on: [text, background].
const TEXT = [
  ["foreground", "background"], ["foreground", "card"], ["card-foreground", "card"], ["popover-foreground", "popover"], ["foreground", "accent"], ["foreground", "muted"],
  ["muted-foreground", "background"], ["muted-foreground", "card"], ["muted-foreground", "muted"], ["muted-foreground", "accent"], ["muted-foreground", "popover"],
  ["primary-foreground", "primary"], ["secondary-foreground", "secondary"], ["accent-foreground", "accent"], ["destructive-foreground", "destructive"],
  ["primary", "background"], ["primary", "card"], ["primary", "accent"],                     // links, and the green chips and notices
  ["destructive", "background"], ["destructive", "card"], ["destructive", "destructive-soft"], ["warning", "warning-soft"], ["warning", "card"],
];
// Shapes that carry meaning need 3:1: input outlines and the focus ring.
const SHAPES = [["input", "background"], ["input", "card"], ["ring", "background"]];

describe("theme", () => {
  it("both themes define the same colours", () => { expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort()); expect(Object.keys(themes.light).length).toBeGreaterThan(20); });
  it("keeps the ABIG green in both themes", () => { expect(themes.light.brand).toBe("#7ac143"); expect(themes.dark.brand).toBe("#7ac143"); expect(themes.dark.primary).toBe("#7ac143"); expect(themes.light.primary).toBe("#2f7a33"); });
  describe.each(Object.entries(themes))("%s", (_name, t) => {
    it.each(TEXT)("%s on %s reads at 4.5:1 or better", (fg, bg) => { expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5); });
    it.each(SHAPES)("%s on %s stands out at 3:1 or better", (fg, bg) => { expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(3); });
  });
});

describe("the current page in the navigation", () => {
  it("the dashboard only on the dashboard", () => { expect(isCurrentPath("/", "/")).toBe(true); expect(isCurrentPath("/", "/requests")).toBe(false); });
  it("a section includes the pages below it", () => { expect(isCurrentPath("/requests", "/requests/new")).toBe(true); expect(isCurrentPath("/treasury", "/treasury/week/1")).toBe(true); });
  it("a similar name is not the same section", () => { expect(isCurrentPath("/requests", "/requests-old")).toBe(false); });
});
