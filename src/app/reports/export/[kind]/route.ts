import { addisDate, amount2 } from "@/lib/format";
import { toCsv } from "@/lib/csv";
import { withUser } from "@/lib/db";
import { denyApi } from "@/lib/rbac";
import { auditRows, cashRows, outstandingRows, paymentRows, pendingRows, reportFilters, weekRows } from "@/lib/reports";
import { companyScope } from "@/lib/company-scope";
import { currentUserId, requireMe } from "@/lib/session";

const money = <T extends object>(rows: T[], keys: (keyof T & string)[]) => rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, r[k] === null ? null : amount2(r[k])])) }));
const NOT_SHOWN = "Not shown";
/** A value the database held back says so, as it does on the screen, and is not mistaken for an empty field. */
const shown = <T extends object>(rows: T[], keys: (keyof T & string)[]) => rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, r[k] ?? NOT_SHOWN])) }));

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params; const url = new URL(req.url); const uid = await currentUserId();
  const denied = denyApi(await requireMe(), "/reports"); if (denied) return denied;
  const f = reportFilters((k) => url.searchParams.get(k)), today = addisDate();
  const company = await companyScope(uid);
  const out = await withUser(uid, async (tx) => {
    if (kind === "pending") return toCsv([["request_no", "Request"], ["company_name", "Company"], ["payee_name", "Payee"], ["workflow_state", "Status"], ["priority", "Priority"], ["seq", "Installment"], ["due_date", "Due"], ["amount", "Amount ETB"], ["account_label", "Debit account"], ["bucket", "Aging"]], shown(money(await pendingRows(tx, company), ["amount"]), ["payee_name"]));
    if (kind === "payments") return toCsv([["authenticated_at", "Authenticated at"], ["workflow_state", "Status"], ["payment_method", "Method"], ["request_no", "Request"], ["company_name", "Company"], ["payee_name", "Payee"], ["account_label", "Debit account"], ["amount", "Amount ETB"], ["verified_by", "Verified by"], ["authenticated_by", "Authenticated by"]], shown(money(await paymentRows(tx, f, company), ["amount"]), ["payee_name", "verified_by", "authenticated_by"]));
    if (kind === "outstanding") return toCsv([["request_no", "Request"], ["company_name", "Company"], ["payee_name", "Payee"], ["account_label", "Account"], ["payment_method", "Method"], ["age_days", "Age in days"], ["amount", "Amount ETB"]], shown(money(await outstandingRows(tx, company), ["amount"]), ["payee_name"]));
    if (kind === "weeks") return toCsv([["week_start", "Week of"], ["account_label", "Account"], ["status", "Status"], ["deposits", "Statement deposits ETB"], ["implied_total", "Implied deposits ETB"], ["deposit_difference", "Deposit difference ETB"], ["adjust_total", "Adjustments ETB"], ["locked_by_name", "Locked by"]], (await weekRows(tx, f, company)).map((r) => (r.access === "FULL" ? money([r], ["deposits", "implied_total", "deposit_difference", "adjust_total"])[0] : { ...r, deposits: NOT_SHOWN, implied_total: NOT_SHOWN, deposit_difference: NOT_SHOWN, adjust_total: NOT_SHOWN, locked_by_name: NOT_SHOWN })));
    if (kind === "cash") return toCsv([["account_label", "Account"], ["bank_name", "Bank"], ["current_balance", "Current ETB"], ["reserved_balance", "Reserved ETB"], ["min_buffer", "Minimum buffer ETB"], ["available_balance", "Available ETB"], ["shortfall_amount", "Shortfall ETB"], ["due_30_days", "Due in 30 days, your companies, ETB"], ["balance_updated_at", "Balance updated"]], money(await cashRows(tx, company), ["current_balance", "reserved_balance", "min_buffer", "available_balance", "shortfall_amount", "due_30_days"]));
    if (kind === "audit") return toCsv([["occurred_at", "When"], ["actor", "Who"], ["company", "Company"], ["action", "What"], ["entity_type", "Entity"], ["entity_id", "Entity id"], ["metadata", "Details"]], shown(await auditRows(tx, f, 5000, company), ["actor", "entity_id", "metadata"]));
    return null;
  });
  if (out === null) return new Response("Not found", { status: 404 });
  return new Response(out, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="abig-${kind}-${today}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
