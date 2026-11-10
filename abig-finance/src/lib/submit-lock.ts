// Duplicate-click and repeated-Enter protection for forms, on the client. A form's buttons are disabled while React reports the submission as
// pending, but there is a moment between the first click (or Enter) and that report. The lock covers it: the first submission takes the form's
// lock and any further click or Enter is cancelled until the submission has finished. This is only the first line of defence: every action is
// still checked again on the server (version checks, state checks, row locks, unique constraints).

export interface SubmitLock {
  readonly held: boolean;
  /** Which submission holds the lock: a new number every time it is taken. */
  readonly generation: number;
  tryAcquire(): boolean;
  /** The submission has really started: from now on only release() frees the lock, never the safety timer. */
  hold(generation: number): void;
  /** Frees the lock, but only for the submission that holds it, so a late timer from an earlier one cannot free a newer one. */
  release(generation?: number): void;
}

/**
 * A lock that releases itself after `safetyMs` unless the submission is confirmed as started (hold), so a submission that never starts cannot
 * leave a form locked for good, and one that is still running is never unlocked by the timer.
 */
export function createSubmitLock(safetyMs = 30_000, timers: { set: typeof setTimeout; clear: typeof clearTimeout } = { set: setTimeout, clear: clearTimeout }): SubmitLock {
  let held = false; let generation = 0; let timer: ReturnType<typeof setTimeout> | null = null;
  const stopTimer = () => { if (timer !== null) { timers.clear(timer); timer = null; } };
  return {
    get held() { return held; },
    get generation() { return generation; },
    tryAcquire() {
      if (held) return false;
      held = true; generation += 1;
      const mine = generation;
      timer = timers.set(() => { if (generation === mine) { held = false; timer = null; } }, safetyMs);
      return true;
    },
    hold(g) { if (held && g === generation) stopTimer(); },
    release(g) {
      if (g !== undefined && g !== generation) return;
      held = false; stopTimer();
    },
  };
}

const locks = new WeakMap<object, SubmitLock>();
/** The one lock for a form element: every submit button in the form shares it. */
export function lockFor(form: object): SubmitLock {
  let l = locks.get(form);
  if (!l) { l = createSubmitLock(); locks.set(form, l); }
  return l;
}

// What a button says while its action runs, from the verb its label starts with: "Save" → "Saving…", "Cancel schedule" → "Cancelling…".
const WHOLE: [RegExp, string][] = [[/^\s*submit/i, "Submitting…"], [/^\s*schedul/i, "Scheduling…"], [/^\s*sign in\b/i, "Signing in…"], [/^\s*set (it )?up\b/i, "Setting up…"], [/^\s*sign out\b/i, "Signing out…"]];
const VERBS: Record<string, string> = {
  save: "Saving…", enter: "Saving…", change: "Saving…", allow: "Saving…", set: "Saving…", create: "Creating…", add: "Adding…", register: "Registering…",
  verify: "Verifying…", authenticate: "Authenticating…", approve: "Approving…", reject: "Rejecting…", return: "Returning…", cancel: "Cancelling…",
  record: "Recording…", reverse: "Reversing…", match: "Matching…", start: "Starting…", lock: "Locking…", unlock: "Unlocking…", undo: "Undoing…",
  remove: "Removing…", grant: "Granting…", withdraw: "Withdrawing…", link: "Linking…", send: "Sending…", confirm: "Confirming…", reset: "Resetting…",
  reactivate: "Reactivating…", deactivate: "Deactivating…", turn: "Updating…", make: "Updating…", mark: "Marking…", apply: "Applying…", switch: "Switching…",
  export: "Preparing…", download: "Preparing…", open: "Opening…", delete: "Deleting…", update: "Updating…", pay: "Processing…",
};
/** The loading text for a button label, or `fallback` when the label is not plain text or its verb is unknown. */
export function pendingLabel(label: unknown, fallback = "Processing…"): string {
  const text = typeof label === "string" ? label : Array.isArray(label) && label.every((x) => typeof x === "string") ? label.join("") : null;
  if (!text) return fallback;
  const main = text.replace(/^\s*save and\s+/i, "");   // "Save and submit" says what it really does: "Submitting…"
  for (const [re, out] of WHOLE) if (re.test(main)) return out;
  return VERBS[text.trim().split(/\s+/)[0]?.toLowerCase() ?? ""] ?? fallback;
}

/**
 * What a submit click (or Enter, which the browser turns into a click on the form's first submit button) may do:
 *   "proceed"  it is the first: the form's lock is now held until the submission finishes;
 *   "blocked"  a submission from this form is already on its way: cancel the click;
 *   "invalid"  a required field is missing: the browser shows it and sends nothing, so nothing is locked.
 */
export function claimSubmission(form: { checkValidity(): boolean }, opts: { noValidate?: boolean } = {}): "proceed" | "blocked" | "invalid" {
  if (!opts.noValidate && !form.checkValidity()) return "invalid";
  return lockFor(form).tryAcquire() ? "proceed" : "blocked";
}
