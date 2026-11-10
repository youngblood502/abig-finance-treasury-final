import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, use } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createProgress, isNavigatingSubmit, navigationTarget, type ProgressState } from "@/lib/nav-progress";
import { BrandSplash, PageSkeleton } from "@/components/layout/page-loading";
import { ProgressBar } from "@/components/layout/navigation-progress";
import { SubmitButton } from "@/components/ui/submit-button";

// The page-loading experience: the branded screen while the app opens, the bar while the next page loads, and the outlines while a page's
// data loads. The frame's sign-in logic is tested in signed-in-frame.test.ts.

// The root layout, with the signed-in frame replaced: it either never finishes (a slow database) or is ready at once.
const frame = vi.hoisted(() => ({ mode: "pending" as "pending" | "ready" }));
vi.mock("@/components/layout/signed-in-frame", () => ({
  SignedInFrame: ({ children }: { children: React.ReactNode }) => {
    if (frame.mode === "pending") use(new Promise<never>(() => {}));
    return createElement("div", { "data-frame": "ready" }, children);
  },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const loc = { href: "http://app.test/requests?status=open", origin: "http://app.test" };
const click = (over: Partial<Parameters<typeof navigationTarget>[0]> = {}) => ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, ...over });
const anchor = (href: string, attrs: Record<string, string> = {}) => ({
  href: new URL(href, loc.href).href, target: attrs.target ?? "",
  hasAttribute: (n: string) => n in attrs, getAttribute: (n: string) => (n === "href" ? href : attrs[n] ?? null),
});
const form = (attrs: Record<string, string> = {}) => ({ method: attrs.method ?? "get", action: "", target: attrs.target ?? "", hasAttribute: (n: string) => n in attrs, getAttribute: (n: string) => attrs[n] ?? null });
const submitter = (attrs: Record<string, string> = {}) => ({ getAttribute: (n: string) => attrs[n] ?? null });

afterEach(() => { vi.useRealTimers(); frame.mode = "pending"; });

describe("initial loading", () => {
  it("the document arrives with the branded loading screen while the frame is still loading, never a blank page", async () => {
    const { default: RootLayout } = await import("@/app/layout");
    const html = renderToStaticMarkup(createElement(RootLayout, null, createElement("p", null, "page")));
    expect(html).toContain('data-slot="brand-splash"');
    expect(html).toContain('src="/abig-logo.png"'); expect(html).toContain("ABIG Finance Management"); expect(html).toContain("Loading your workspace…");
    expect(html).not.toContain('data-frame="ready"');
  });

  it("does not hold back a frame that is ready: no loading screen is shown", async () => {
    frame.mode = "ready";
    const { default: RootLayout } = await import("@/app/layout");
    const html = renderToStaticMarkup(createElement(RootLayout, null, createElement("p", null, "page")));
    expect(html).toContain('data-frame="ready"'); expect(html).toContain("<p>page</p>");
    expect(html).not.toContain('data-slot="brand-splash"');
  });

  it("the loading screen is accessible, uses the brand logo and colours, holds no data, and calms down for reduced motion", () => {
    const html = renderToStaticMarkup(createElement(BrandSplash));
    expect(html).toContain('role="status"'); expect(html).toContain('alt="ABIG"');
    expect(html).toContain("bg-background"); expect(html).toContain("text-primary");
    expect(html).toContain("motion-safe:animate-spin"); expect(html).not.toMatch(/ animate-spin/);
  });

  it("the page outline is announced as loading and keeps the page header's height", () => {
    for (const variant of ["list", "detail"] as const) {
      const html = renderToStaticMarkup(createElement(PageSkeleton, { variant }));
      expect(html).toContain('aria-busy="true"'); expect(html).toContain("Loading page…"); expect(html).toContain("h-8 w-56");
    }
  });
});

describe("which interactions start the bar", () => {
  it("a link to another page of the app", () => {
    expect(navigationTarget(click(), anchor("/accounts"), loc)).toBe("http://app.test/accounts");
    expect(navigationTarget(click(), anchor("/requests?status=paid"), loc)).toBe("http://app.test/requests?status=paid");   // another filter
    expect(navigationTarget(click(), anchor("http://app.test/reports"), loc)).toBe("http://app.test/reports");
  });

  it("not a click that does not load a page of the app here", () => {
    expect(navigationTarget(click(), anchor("/requests?status=open"), loc)).toBeNull();                 // the page already shown
    expect(navigationTarget(click(), anchor("/requests?status=open#row-3"), loc)).toBeNull();           // a fragment of it
    expect(navigationTarget(click(), anchor("#main"), loc)).toBeNull();
    expect(navigationTarget(click(), anchor("https://example.com/"), loc)).toBeNull();                  // another site
    expect(navigationTarget(click(), anchor("mailto:finance@abig.test"), loc)).toBeNull();
    expect(navigationTarget(click(), anchor("/accounts", { target: "_blank" }), loc)).toBeNull();       // a new tab
    expect(navigationTarget(click(), anchor("/reports/export/requests", { download: "" }), loc)).toBeNull();
    expect(navigationTarget(click({ ctrlKey: true }), anchor("/accounts"), loc)).toBeNull();            // ctrl/cmd-click opens a tab
    expect(navigationTarget(click({ metaKey: true }), anchor("/accounts"), loc)).toBeNull();
    expect(navigationTarget(click({ button: 1 }), anchor("/accounts"), loc)).toBeNull();                // middle button
    expect(navigationTarget(click({ defaultPrevented: true }), anchor("/accounts"), loc)).toBeNull();
  });

  it("a filter form (GET) loads a page; a server-action form does not, its own button shows the progress", () => {
    expect(isNavigatingSubmit(form({ method: "get" }), null, loc)).toBe(true);
    expect(isNavigatingSubmit(form({ method: "get", action: "/reports" }), null, loc)).toBe(true);
    expect(isNavigatingSubmit(form({ method: "post" }), null, loc)).toBe(false);
    expect(isNavigatingSubmit(form({ action: "javascript:throw new Error('React form unexpectedly submitted.')" }), null, loc)).toBe(false);
    expect(isNavigatingSubmit(form(), submitter({ formaction: "javascript:void 0" }), loc)).toBe(false);
    expect(isNavigatingSubmit(form({ method: "get", target: "_blank" }), null, loc)).toBe(false);
    expect(isNavigatingSubmit(form({ method: "get", action: "https://example.com/search" }), null, loc)).toBe(false);
  });
});

describe("the bar's progress", () => {
  const make = (opts = {}) => { const seen: ProgressState[] = []; const p = createProgress((s) => seen.push(s), opts); return { p, seen }; };

  it("starts at once and completes when the page arrives, then goes away", () => {
    vi.useFakeTimers();
    const { p } = make();
    p.start();
    expect(p.state).toEqual({ visible: true, value: 0.08 });   // visible immediately, no delay
    vi.advanceTimersByTime(600); expect(p.state.value).toBeGreaterThan(0.08);
    p.done(); expect(p.state).toEqual({ visible: true, value: 1 });
    vi.advanceTimersByTime(250); expect(p.state).toEqual({ visible: false, value: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("on a slow page it keeps moving but never claims to be finished", () => {
    vi.useFakeTimers();
    const { p } = make();
    p.start();
    let last = p.state.value;
    for (let s = 0; s < 12; s++) { vi.advanceTimersByTime(1000); expect(p.state.value).toBeGreaterThanOrEqual(last); last = p.state.value; }
    expect(p.state.visible).toBe(true); expect(p.state.value).toBeLessThanOrEqual(0.9);
  });

  it("a navigation that never completes (cancelled or failed) ends by itself, leaving nothing running", () => {
    vi.useFakeTimers();
    const { p } = make({ failsafeMs: 15_000 });
    p.start();
    vi.advanceTimersByTime(15_000); expect(p.state.value).toBe(1);
    vi.advanceTimersByTime(250); expect(p.state.visible).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a second click while loading carries on with the same bar; cancel hides it and clears every timer", () => {
    vi.useFakeTimers();
    const { p, seen } = make();
    p.start(); vi.advanceTimersByTime(500); const at = p.state.value;
    p.start(); expect(p.state.value).toBe(at);                // not reset to the start
    expect(seen.filter((s) => s.value === 0.08)).toHaveLength(1);
    p.cancel(); expect(p.state).toEqual({ visible: false, value: 0 }); expect(vi.getTimerCount()).toBe(0);
  });

  it("an address change with no navigation in progress (a server action's redirect) shows nothing", () => {
    vi.useFakeTimers();
    const { p, seen } = make();
    p.done(); p.cancel();
    expect(seen).toEqual([]); expect(vi.getTimerCount()).toBe(0);
  });

  it("draws nothing while idle and an accessible progress bar while loading", () => {
    expect(renderToStaticMarkup(createElement(ProgressBar, { visible: false, value: 0 }))).toBe("");
    const html = renderToStaticMarkup(createElement(ProgressBar, { visible: true, value: 0.4 }));
    expect(html).toContain('role="progressbar"'); expect(html).toContain('aria-valuenow="40"'); expect(html).toContain("scaleX(0.4)");
    expect(html).toContain("pointer-events-none");   // never blocks a click
  });
});

describe("works with the submit buttons' loading states", () => {
  it("a submit button keeps its own loading state; the bar ignores the server-action form it submits", () => {
    const html = renderToStaticMarkup(createElement(SubmitButton, { pending: true }, "Approve"));
    expect(html).toContain("Approving…"); expect(html).toContain('aria-busy="true"');
    expect(isNavigatingSubmit(form({ method: "post" }), submitter(), loc)).toBe(false);
  });
});
