import { toCsv } from "@/lib/csv";
import { withUser } from "@/lib/db";
import { denyApi } from "@/lib/rbac";
import { auditRows, cashRows, paymentRows, pendingRows } from "@/lib/reports";
import { currentUserId, requireMe } from "@/lib/session";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params; const url = new URL(req.url); const uid = await currentUserId();
  const denied = denyApi(await requireMe(), "/reports"); if (denied) return denied;
  const today = new Date().toISOString().slice(0, 10), from = DATE.test(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), to = DATE.test(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : today;
  const out = await withUser(uid, async (tx) => {
    if (kind === "pending") return toCsv([["request_no", "Request"], ["company_name", "Company"], ["supplier_name", "Supplier"], ["workflow_state", "Status"], ["priority", "Priority"], ["seq", "Installment"], ["due_date", "Due"], ["amount", "Amount ETB"], ["account_label", "Debit account"], ["bucket", "Aging"]], await pendingRows(tx));
    if (kind === "payments") return toCsv([["authenticated_at", "Paid at"], ["request_no", "Request"], ["company_name", "Company"], ["supplier_name", "Supplier"], ["account_label", "Debit account"], ["amount", "Amount ETB"], ["verified_by", "Verified by"], ["authenticated_by", "Authenticated by"]], await paymentRows(tx, from, to));
    if (kind === "cash") return toCsv([["account_label", "Account"], ["bank_name", "Bank"], ["current_balance", "Current ETB"], ["reserved_balance", "Reserved ETB"], ["available_balance", "Available ETB"], ["due_30_days", "Due in 30 days ETB"], ["balance_updated_at", "Balance updated"]], await cashRows(tx));
    if (kind === "audit") return toCsv([["occurred_at", "When"], ["actor", "Who"], ["company", "Company"], ["action", "What"], ["entity_type", "Entity"], ["entity_id", "Entity id"], ["metadata", "Details"]], await auditRows(tx, null, 5000));
    return null;
  });
  if (out === null) return new Response("Not found", { status: 404 });
  return new Response(out, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="abig-${kind}-${today}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
