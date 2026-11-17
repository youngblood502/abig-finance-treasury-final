// The slim bar at the top of the screen while the next page loads. This file holds the decisions (is this click a page navigation? how far
// along is the bar?) without React or the DOM, so they can be tested; components/layout/navigation-progress.tsx wires them to the page.

export interface LocationLike { href: string; origin: string }
export interface ClickLike { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }
export interface AnchorLike { href: string; target?: string; hasAttribute(name: string): boolean; getAttribute(name: string): string | null }

/** The address without its #fragment: moving to a fragment on the same page is not a page load. */
const withoutHash = (u: URL) => u.origin + u.pathname + u.search;

/**
 * The page a click on this link will load inside the app, or null when it is not a page navigation the app performs:
 * another site, a new tab or window, a download, a mailto:/tel: link, a jump to a #fragment, or the page already shown.
 */
export function navigationTarget(e: ClickLike, a: AnchorLike, loc: LocationLike): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return null;
  const raw = a.getAttribute("href");
  if (!raw || raw.startsWith("#")) return null;
  let to: URL; let from: URL;
  try { to = new URL(a.href || raw, loc.href); from = new URL(loc.href); } catch { return null; }
  if (to.protocol !== "http:" && to.protocol !== "https:") return null;
  if (to.origin !== loc.origin) return null;
  if (withoutHash(to) === withoutHash(from)) return null;
  return withoutHash(to);
}

export interface FormLike { method: string; action: string; target?: string; hasAttribute(name: string): boolean; getAttribute(name: string): string | null }
export interface SubmitterLike { getAttribute(name: string): string | null }

/**
 * True when submitting this form loads another page (a GET form such as the filters on the request list). Forms that run a server action
 * are not page navigations: their own button already shows "Saving…" and the like, so the bar stays away.
 */
export function isNavigatingSubmit(form: FormLike, submitter: SubmitterLike | null, loc: LocationLike): boolean {
  const method = (submitter?.getAttribute("formmethod") ?? form.getAttribute("method") ?? form.method ?? "get").toLowerCase();
  if (method !== "get") return false;
  const target = submitter?.getAttribute("formtarget") ?? form.getAttribute("target") ?? form.target ?? "";
  if (target && target !== "_self") return false;
  const action = submitter?.getAttribute("formaction") ?? form.getAttribute("action") ?? "";
  // A server action renders as a javascript: URL; a GET form without an action submits to the page it is on.
  if (action.startsWith("javascript:")) return false;
  try { return new URL(action || loc.href, loc.href).origin === loc.origin; } catch { return false; }
}

export interface ProgressState { visible: boolean; value: number }
type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void };
export interface ProgressOptions {
  /** How often the bar creeps forward while waiting. */
  trickleMs?: number;
  /** After this long without the page arriving (a cancelled or failed navigation) the bar finishes and goes away by itself. */
  failsafeMs?: number;
  /** How long the full bar stays before it fades out. */
  finishMs?: number;
  timers?: Timers;
}

/**
 * The bar's progress. start() shows it at once and lets it creep towards 90%, never reaching the end on its own; done() fills it and hides
 * it; cancel() hides it straight away. A fail-safe timer ends a navigation that never completes, so the bar cannot stay stuck.
 */
export function createProgress(onChange: (s: ProgressState) => void, opts: ProgressOptions = {}) {
  const { trickleMs = 250, failsafeMs = 15_000, finishMs = 250 } = opts;
  const timers: Timers = opts.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) };
  let state: ProgressState = { visible: false, value: 0 };
  let trickle: unknown = null, failsafe: unknown = null, finish: unknown = null;
  const emit = (s: ProgressState) => { state = s; onChange(s); };
  const stop = () => {
    for (const t of [trickle, failsafe, finish]) if (t !== null) timers.clear(t);
    trickle = failsafe = finish = null;
  };
  const tick = () => {
    // Moves a share of the remaining distance to 90%: quick at first, then slower, so a slow page still looks alive without looking finished.
    emit({ visible: true, value: Math.min(0.9, state.value + (0.9 - state.value) * 0.12) });
    trickle = timers.set(tick, trickleMs);
  };
  const api = {
    get state() { return state; },
    get active() { return state.visible && state.value < 1; },
    start() {
      if (api.active) {   // a second click while a page is loading: carry on with the same bar, with a fresh fail-safe
        if (failsafe !== null) timers.clear(failsafe);
        failsafe = timers.set(api.done, failsafeMs);
        return;
      }
      stop();
      emit({ visible: true, value: 0.08 });
      trickle = timers.set(tick, trickleMs);
      failsafe = timers.set(api.done, failsafeMs);
    },
    done() {
      if (!state.visible) return;
      stop();
      emit({ visible: true, value: 1 });
      finish = timers.set(() => { finish = null; emit({ visible: false, value: 0 }); }, finishMs);
    },
    cancel() { stop(); if (state.visible) emit({ visible: false, value: 0 }); },
  };
  return api;
}
