// How money, dates and times are shown everywhere: ETB with two decimals, and always Ethiopian time, whatever the server's clock is set to.
export const TIME_ZONE = "Africa/Addis_Ababa";

const parts = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d).map((p) => [p.type, p.value]));

/** The calendar day in Addis Ababa, YYYY-MM-DD. */
export const addisDate = (d: Date = new Date()) => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; };
/** A full timestamp in Addis Ababa with its offset, for files. Ethiopia has one offset all year. */
export const addisIso = (d: Date) => { const p = parts(d); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+03:00`; };

export const etb = (v: unknown) => "ETB " + Number(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** A plain amount with two decimals, for files. */
export const amount2 = (v: unknown) => Number(v ?? 0).toFixed(2);
// Date columns reach here as text (see db.ts); only real timestamps need converting.
export const dstr = (v: unknown) => (v instanceof Date ? addisDate(v) : String(v ?? "").slice(0, 10));
export const dtime = (v: unknown) => { if (!(v instanceof Date)) return String(v ?? ""); const p = parts(v); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} EAT`; };
export const STATE_LABEL: Record<string, string> = {
  DRAFT: "Draft", SCHEDULED: "Scheduled", RESERVED: "Funds reserved, waiting for verification", VERIFIED: "Verified, waiting for authentication",
  AUTHENTICATED: "Authenticated, not yet paid", PAID: "Paid", REJECTED: "Rejected", CANCELLED: "Cancelled",
};
export const PAYMENT_METHODS: Record<string, string> = { TRANSFER: "Transfer", CHEQUE: "Cheque", CASH: "Cash", TELEBIRR: "Telebirr" };
/** The methods each kind of account can pay with. The database enforces the same rule. */
export const METHODS_FOR_KIND: Record<string, string[]> = { BANK: ["TRANSFER", "CHEQUE"], WALLET: ["TELEBIRR"], CASH: ["CASH"] };
export const ENTRY_KINDS: Record<string, string> = { OPENING: "Opening balance", CHECK: "Balance check", PAYMENT: "Payment", CANCEL_RELEASE: "Cancellation", RECONCILIATION_ADJUSTMENT: "Reconciliation adjustment" };
export const ANOMALIES: Record<string, string> = { NEGATIVE_DEPOSIT: "Money left that the system does not know about", LARGE_DEPOSIT: "Large deposit", OPENING_CHANGED: "Balance changed between weeks" };
export const WEEK_STATUS: Record<string, string> = { OPEN: "Open", RECONCILING: "Being reconciled", LOCKED: "Locked" };
export const ACCOUNT_KINDS: Record<string, string> = { BANK: "Bank account", WALLET: "Telebirr wallet", CASH: "Cash" };
/** Where an account's money is: its bank and last four digits, its wallet phone, or plain cash. */
export const accountPlace = (a: { account_kind?: string; bank_name?: string | null; account_last4?: string | null; wallet_phone?: string | null }) =>
  a.account_kind === "CASH" ? "Cash" : a.account_kind === "WALLET" ? `Telebirr ${a.wallet_phone}` : `${a.bank_name} ••••${a.account_last4}`;
