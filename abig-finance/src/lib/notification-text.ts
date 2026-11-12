import { dstr, etb } from "./format";

// What each notification says: the email subject and body, and the same title and link for the in-app bell. No sending happens here.
export interface OutboxEvent { id: string; event_type: string; request_id: string | null; lease_token?: string | null; payload: { path?: string; week_start?: string; supplier_name?: string; person_name?: string; company_name?: string; request_no?: string; reason?: string; overdue_amount?: number | string; account_label?: string; balance?: number | string; reserved?: number | string; shortfall_amount?: number | string } }

const SUBJECTS: Record<string, (e: OutboxEvent) => string> = {
  REQUEST_SUBMITTED: (e) => `${e.payload.request_no} is waiting for verification`,
  REQUEST_RESTARTED: (e) => `${e.payload.request_no} changed and needs verification again`,
  REQUEST_VERIFIED: (e) => `${e.payload.request_no} is waiting for authorization`,
  REQUEST_AUTHORIZED: (e) => `${e.payload.request_no} is authenticated and ready to be paid`,
  REQUEST_RESCHEDULE_NEEDED: (e) => `${e.payload.request_no}: a due date was changed`,
  REQUEST_RETURNED: (e) => `${e.payload.request_no} was returned for correction`,
  REQUEST_REJECTED: (e) => `${e.payload.request_no} was rejected`,
  REQUEST_ADJUSTED: (e) => `${e.payload.request_no} was adjusted`,
  REQUEST_CANCELLED: (e) => `${e.payload.request_no} was cancelled`,
  REQUEST_OVERDUE: (e) => `${e.payload.request_no} has overdue payments`,
  ACCOUNT_SHORTFALL: (e) => `${e.payload.account_label} is in shortfall by ${etb(e.payload.shortfall_amount)}`,
  REQUEST_PAID: (e) => `${e.payload.request_no} is paid`,
  REQUEST_SCHEDULE_BLOCKED: (e) => `${e.payload.request_no} was not submitted on its scheduled date`,
  RECONCILIATION_SUBMITTED: (e) => `${e.payload.account_label}: the reconciliation for the week of ${dstr(e.payload.week_start)} is waiting for your review`,
  RECONCILIATION_RETURNED: (e) => `${e.payload.account_label}: the reconciliation for the week of ${dstr(e.payload.week_start)} was returned for changes`,
  RECONCILIATION_LOCKED: (e) => `${e.payload.account_label}: the reconciliation for the week of ${dstr(e.payload.week_start)} is locked`,
  ACCOUNT_OPENING_OVERDUE: (e) => `${e.payload.account_label}: the opening balance for the week of ${dstr(e.payload.week_start)} has not been entered`,
  SUPPLIER_BANK_DETAILS_PENDING: (e) => `${e.payload.supplier_name}: new bank details are waiting for verification`,
  PERSON_DETAILS_PENDING: (e) => `${e.payload.person_name}: new payment details are waiting for verification`,
  ACCOUNT_ACCESS_GRANTED: (e) => `${e.payload.company_name} can now use the account ${e.payload.account_label}`,
  ACCOUNT_ACCESS_WITHDRAWN: (e) => `${e.payload.company_name} can no longer use the account ${e.payload.account_label}`,
  ACCOUNT_DEACTIVATED: (e) => `${e.payload.account_label} was deactivated`,
  ACCOUNT_REACTIVATED: (e) => `${e.payload.account_label} was reactivated`,
  USER_LOCKED: () => "Your ABIG Finance account is locked after repeated failed sign-ins",
  PASSWORD_RESET_COMPLETED: () => "Your ABIG Finance password was changed",
};
/** Extra lines for some events. */
const NOTES: Record<string, string[]> = {
  REQUEST_AUTHORIZED: ["The amount is now deducted from the account's system balance. It is marked Paid when the weekly reconciliation matches it to the bank statement."],
  REQUEST_SCHEDULE_BLOCKED: ["It stays Scheduled and nothing is reserved. It is tried again automatically; you can also change it or cancel it. You are not told again."],
  REQUEST_RESCHEDULE_NEEDED: ["Only the due date changed: the request keeps its approvals and its reserved funds, and nothing else is needed."],
  USER_LOCKED: ["It unlocks by itself after a few minutes. If it was not you trying to sign in, tell a system administrator."],
  PASSWORD_RESET_COMPLETED: ["You replaced the temporary password an administrator gave you. If this was not you, tell a system administrator now."],
  ACCOUNT_OPENING_OVERDUE: ["Balance checks on this account are refused until the week's opening balance is entered."],
  ACCOUNT_DEACTIVATED: ["No new payment request, reservation, approval or scheduled submission can use it. Requests that already hold or used funds on it were left as they were: nothing was cancelled or released. Review them on the account and decide what happens to each."],
  ACCOUNT_REACTIVATED: ["It can be used again. Nothing waiting on it was submitted, approved, released or rescheduled automatically; scheduled requests that were waiting on it must be scheduled again."],
};
export function compose(e: OutboxEvent, appUrl: string): { subject: string; text: string } {
  const subject = (SUBJECTS[e.event_type] ?? (() => `Update on ${e.payload.request_no}`))(e);
  const lines = ["Hello,", "", subject + "."];
  if (e.payload.reason) lines.push("", `Reason: ${e.payload.reason}`);
  if (e.payload.overdue_amount) lines.push("", `Overdue amount: ${etb(e.payload.overdue_amount)}`);
  if (e.event_type === "ACCOUNT_SHORTFALL") lines.push("", `Balance: ${etb(e.payload.balance)}`, `Reserved: ${etb(e.payload.reserved)}`, "New submissions on this account are blocked until the shortfall is cleared.");
  if (NOTES[e.event_type]) lines.push("", ...NOTES[e.event_type]);
  lines.push("", `Open it: ${appUrl.replace(/\/$/, "")}${e.request_id ? `/requests/${e.request_id}` : e.payload.path ?? "/accounts"}`, "", "ABIG Finance");
  return { subject, text: lines.join("\n") };
}

/** The one-line title the bell shows: the same words as the email subject. */
export const notificationTitle = (e: Pick<OutboxEvent, "event_type" | "payload">) => (SUBJECTS[e.event_type] ?? (() => `Update on ${e.payload.request_no ?? "a payment request"}`))(e as OutboxEvent);
/** Where the notification leads: the request, or the page its payload names. */
export const notificationLink = (e: Pick<OutboxEvent, "request_id" | "payload">) => (e.request_id ? `/requests/${e.request_id}` : e.payload.path ?? "/");
