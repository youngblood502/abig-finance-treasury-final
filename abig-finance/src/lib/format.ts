export const etb = (v: unknown) => "ETB " + Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
export const dstr = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));
export const dtime = (v: unknown) => (v instanceof Date ? v.toISOString().replace("T", " ").slice(0, 16) + " UTC" : String(v ?? ""));
export const STATE_LABEL: Record<string, string> = {
  DRAFT: "Draft", SCHEDULED: "Scheduled", RESERVED: "Funds reserved, waiting for verification", VERIFIED: "Verified, waiting for authentication",
  AUTHENTICATED: "Authenticated, payment completed", REJECTED: "Rejected",
};
