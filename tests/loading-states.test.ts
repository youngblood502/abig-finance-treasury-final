import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { claimSubmission, createSubmitLock, lockFor, pendingLabel } from "@/lib/submit-lock";
import { fetchCsv } from "@/lib/download";
import { SubmitButton } from "@/components/ui/submit-button";
import { ExportButton } from "@/components/ui/export-button";

// The client side of duplicate-click protection: the form lock, the loading text, the buttons' loading state and the CSV download.
// The server side (each action really runs once) is in duplicate-actions.test.ts.

const DISABLED = / disabled=""/;   // the attribute, not the disabled: style classes
const form = (valid = true) => ({ checkValidity: () => valid });
afterEach(() => { vi.useRealTimers(); });

describe("the form submission lock", () => {
  it("lets the first click through and cancels a second click or Enter until the submission finishes", () => {
    const f = form();
    expect(claimSubmission(f)).toBe("proceed");
    expect(claimSubmission(f)).toBe("blocked");   // double click
    expect(claimSubmission(f)).toBe("blocked");   // Enter pressed again
    lockFor(f).release();                          // the action finished (success or error)
    expect(claimSubmission(f)).toBe("proceed");   // the button works again
  });

  it("one lock per form: every submit button of a form shares it, other forms are not affected", () => {
    const a = form(), b = form();
    expect(claimSubmission(a)).toBe("proceed");
    expect(claimSubmission(a)).toBe("blocked");
    expect(claimSubmission(b)).toBe("proceed");
    expect(lockFor(a)).toBe(lockFor(a));
  });

  it("does not lock a form with a missing required field, so it can be corrected and sent", () => {
    const f = form(false);
    expect(claimSubmission(f)).toBe("invalid");
    expect(lockFor(f).held).toBe(false);
    expect(claimSubmission(f, { noValidate: true })).toBe("proceed");   // a formNoValidate button (Save draft) skips the check
  });

  it("releases itself after the safety time, so a submission that never started cannot block the form for good", () => {
    vi.useFakeTimers();
    const lock = createSubmitLock(30_000);
    expect(lock.tryAcquire()).toBe(true);
    vi.advanceTimersByTime(29_999); expect(lock.tryAcquire()).toBe(false);
    vi.advanceTimersByTime(1); expect(lock.held).toBe(false);
    expect(lock.tryAcquire()).toBe(true);
    lock.release(); expect(lock.held).toBe(false);
  });

  it("never unlocks while the submission is running, however long it takes; only its end does", () => {
    vi.useFakeTimers();
    const lock = createSubmitLock(30_000);
    lock.tryAcquire(); const g = lock.generation;
    lock.hold(g);                                     // React reports the submission as pending
    vi.advanceTimersByTime(10 * 60_000);              // a slow upload: ten minutes
    expect(lock.held).toBe(true); expect(lock.tryAcquire()).toBe(false);
    lock.release(g); expect(lock.held).toBe(false);   // the action finished (success or error)
  });

  it("a late release from an earlier submission cannot unlock a newer one", () => {
    const lock = createSubmitLock();
    lock.tryAcquire(); const first = lock.generation; lock.release(first);
    lock.tryAcquire(); const second = lock.generation;
    lock.release(first);                              // the first click's 'never started' timer firing late
    expect(lock.held).toBe(true);
    lock.hold(first); lock.release(second); expect(lock.held).toBe(false);
  });

  it("a release clears the safety timer, so it cannot release a later submission early", () => {
    vi.useFakeTimers();
    const lock = createSubmitLock(1_000);
    lock.tryAcquire(); vi.advanceTimersByTime(900); lock.release();
    lock.tryAcquire(); vi.advanceTimersByTime(200);   // the first timer would have fired here
    expect(lock.held).toBe(true);
  });
});

describe("loading text", () => {
  it.each([
    ["Save", "Saving…"], ["Save changes", "Saving…"], ["Submit for verification", "Submitting…"], ["Verify", "Verifying…"],
    ["Authenticate", "Authenticating…"], ["Approve", "Approving…"], ["Reject", "Rejecting…"], ["Return to creator", "Returning…"],
    ["Record payment", "Recording…"], ["Reverse", "Reversing…"], ["Schedule payment", "Scheduling…"], ["Cancel schedule", "Cancelling…"],
    ["Create template", "Creating…"], ["Add supplier", "Adding…"], ["Enter balance", "Saving…"], ["Lock week", "Locking…"],
    ["Mark all read", "Marking…"], ["Save and submit (reserve funds)", "Submitting…"], ["Save and schedule", "Scheduling…"], ["Save as draft", "Saving…"], ["Sign in", "Signing in…"], ["Download CSV", "Preparing…"], ["Deactivate", "Deactivating…"],
  ])("%s → %s", (label, text) => { expect(pendingLabel(label)).toBe(text); });

  it("falls back to Processing… for a label it does not know or that is not plain text", () => {
    expect(pendingLabel("Go")).toBe("Processing…");
    expect(pendingLabel(createElement("span", null, "Save"))).toBe("Processing…");
    expect(pendingLabel(["Save", " all"])).toBe("Saving…");
  });
});

describe("SubmitButton", () => {
  const html = (props: Record<string, unknown>, label = "Approve") => renderToStaticMarkup(createElement(SubmitButton, props as never, label));

  it("is an enabled submit button with its label when idle", () => {
    const h = html({});
    expect(h).toContain('type="submit"'); expect(h).not.toMatch(DISABLED); expect(h).not.toContain("aria-busy");
    expect(h).toContain(">Approve<"); expect(h).not.toContain("animate-spin");
  });

  it("while pending it is disabled, busy, and shows a spinner and the loading text", () => {
    const h = html({ pending: true });
    expect(h).toMatch(DISABLED); expect(h).toContain('aria-busy="true"'); expect(h).toContain("animate-spin");
    expect(h).toContain("Approving…"); expect(h).not.toContain(">Approve<");
  });

  it("uses the loading text it is given", () => {
    expect(html({ pending: true, pendingText: "Sending to the bank…" }, "Pay")).toContain("Sending to the bank…");
  });

  it("stays disabled when the page disables it, pending or not", () => {
    expect(html({ disabled: true })).toMatch(DISABLED);
  });

  it("keeps the design-system styling, or the page's own with plain", () => {
    expect(html({})).toContain('data-slot="button"');
    const plain = html({ plain: true, className: "sec" });
    expect(plain).not.toContain('data-slot="button"'); expect(plain).toContain('class="sec"');
  });
});

describe("CSV exports", () => {
  const response = (body: string, init: ResponseInit) => async () => new Response(body, init);

  it("the button is enabled with its label until pressed", () => {
    const h = renderToStaticMarkup(createElement(ExportButton, { href: "/reports/export/requests" }));
    expect(h).toContain("Download CSV"); expect(h).not.toMatch(DISABLED); expect(h).not.toContain("Preparing…");
  });

  it("returns the file and its name", async () => {
    const r = await fetchCsv("/x", response("a,b\n1,2\n", { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="requests-2026-11-10.csv"' } }) as never);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.filename).toBe("requests-2026-11-10.csv"); expect(await r.blob.text()).toBe("a,b\n1,2\n"); }
  });

  it("explains a refusal, a sign-in page, a server error and a lost connection", async () => {
    expect(await fetchCsv("/x", response("", { status: 403 }) as never)).toEqual({ ok: false, error: "You do not have access to this report." });
    expect(await fetchCsv("/x", response("<html>", { status: 200, headers: { "Content-Type": "text/html" } }) as never)).toMatchObject({ ok: false, error: expect.stringMatching(/session has ended/) });
    expect(await fetchCsv("/x", response("", { status: 500 }) as never)).toMatchObject({ ok: false, error: expect.stringMatching(/error 500/) });
    expect(await fetchCsv("/x", (async () => { throw new TypeError("fetch failed"); }) as never)).toMatchObject({ ok: false, error: expect.stringMatching(/connection/) });
  });
});
