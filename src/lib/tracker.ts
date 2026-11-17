import { STATE_LABEL } from "./format";

export type StepStatus = "done" | "current" | "upcoming";
export interface TrackerStep { state: string; label: string; status: StepStatus }

const STEPS: [string, string][] = [["DRAFT", "Draft"], ["RESERVED", "Reserved"], ["VERIFIED", "Verified"], ["AUTHENTICATED", "Authenticated"], ["PAID", "Paid"]];
/** Requests that left the path: the tracker shows where they ended instead of a next step. */
export const ENDED_STATES = ["REJECTED", "CANCELLED"];

/** The steps of a payment. A scheduled request waits in the first step. Paid is the end, so nothing stays current after it. */
export function trackerSteps(state: string): TrackerStep[] {
  if (ENDED_STATES.includes(state)) return STEPS.map(([s, label]) => ({ state: s, label, status: "upcoming" }));
  const at = STEPS.findIndex(([s]) => s === (state === "SCHEDULED" ? "DRAFT" : state));
  return STEPS.map(([s, label], i) => ({
    state: s, label: s === "DRAFT" && state === "SCHEDULED" ? "Scheduled" : label,
    status: state === "PAID" || i < at ? "done" : i === at ? "current" : "upcoming",
  }));
}
export const trackerSummary = (state: string) => STATE_LABEL[state] ?? state;
