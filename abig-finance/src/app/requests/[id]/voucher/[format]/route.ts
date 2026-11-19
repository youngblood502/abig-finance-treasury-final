import { withUser } from "@/lib/db";
import { denyApi } from "@/lib/rbac";
import { currentUserId, requireMe } from "@/lib/session";
import { loadVoucher, voucherFilename } from "@/lib/voucher";
import { voucherPdf } from "@/lib/voucher-pdf";
import { voucherXlsx } from "@/lib/voucher-xlsx";

const TYPES = { pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } as const;

/**
 * The payment voucher as a PDF or Excel file. The same access as the request's detail page: the role first, then row-level security, so another
 * company's request reads as not found. Read only: nothing is written, no status changes and no workflow step runs.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; format: string }> }) {
  const { id, format } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(format in TYPES)) return new Response("Not found", { status: 404 });
  const denied = denyApi(await requireMe(), "/requests"); if (denied) return denied;
  const v = await withUser(await currentUserId(), (tx) => loadVoucher(tx, id));
  if (!v) return new Response("Not found", { status: 404 });
  const ext = format as keyof typeof TYPES;
  const body = ext === "pdf" ? await voucherPdf(v) : await voucherXlsx(v);
  return new Response(new Uint8Array(body), { headers: {
    "Content-Type": TYPES[ext], "Content-Disposition": `attachment; filename="${voucherFilename(v, ext)}"`,
    "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
}
