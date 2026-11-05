import { addisDate, amount2 } from "@/lib/format";
import { toCsv } from "@/lib/csv";
import { withUser } from "@/lib/db";
import { denyApi } from "@/lib/rbac";
import { auditRows, cashRows, paymentRows, pendingRows } from "@/lib/reports";
import { currentUserId, requireMe } from "@/lib/session";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const money = (rows: any[], keys: string[]) => rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, amount2(r[k])])) }));

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params; const url = new URL(req.url); const uid = await currentUserId();
  const denied = denyApi(await requireMe(), "/reports"); if (denied) return denied;
  const today = addisDate(), from = DATE.test(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : addisDate(new Date(Date.now() - 30 * 864e5)), to = DATE.test(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : today;
  const out = await withUser(uid, async (tx) => {
    if (kind === "pending") return toCsv([["request_no", "Request"], ["company_name", "Company"], ["payee_name", "Payee"], ["workflow_state", "Status"], ["priority", "Priority"], ["seq", "Installment"], ["due_date", "Due"], ["amount", "Amount ETB"], ["account_label", "Debit account"], ["bucket", "Aging"]], money(await pendingRows(tx), ["amount"]));
    if (kind === "payments") return toCsv([["authenticated_at", "Authenticated at"], ["workflow_state", "Status"], ["payment_method", "Method"], ["request_no", "Request"], ["company_name", "Company"], ["payee_name", "Payee"], ["account_label", "Debit account"], ["amount", "Amount ETB"], ["verified_by", "Verified by"], ["authenticated_by", "Authenticated by"]], money(await paymentRows(tx, from, to), ["amount"]));
    if (kind === "cash") return toCsv([["account_label", "Account"], ["bank_name", "Bank"], ["current_balance", "Current ETB"], ["reserved_balance", "Reserved ETB"], ["min_buffer", "Minimum buffer ETB"], ["available_balance", "Available ETB"], ["shortfall_amount", "Shortfall ETB"], ["due_30_days", "Due in 30 days ETB"], ["balance_updated_at", "Balance updated"]], money(await cashRows(tx), ["current_balance", "reserved_balance", "min_buffer", "available_balance", "shortfall_amount", "due_30_days"]));
    if (kind === "audit") return toCsv([["occurred_at", "When"], ["actor", "Who"], ["company", "Company"], ["action", "What"], ["entity_type", "Entity"], ["entity_id", "Entity id"], ["metadata", "Details"]], await auditRows(tx, null, 5000));
    return null;
  });
  if (out === null) return new Response("Not found", { status: 404 });
  return new Response(out, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="abig-${kind}-${today}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
