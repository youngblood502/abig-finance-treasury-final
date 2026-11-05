import { withUser } from "@/lib/db";
import { currentUserId, requireMe } from "@/lib/session";
import { denyApi } from "@/lib/rbac";
import { getObject } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  // Role first (who may open payment documents at all), then row-level security (which ones).
  const denied = denyApi(await requireMe(), "/requests"); if (denied) return denied;
  // Row-level security hides attachments the user may not see, so "not visible" and "does not exist" look the same.
  const rows = await withUser(await currentUserId(), (tx) => tx.q<{ object_key: string; filename: string; mime_type: string }>("SELECT object_key, filename, mime_type FROM attachments WHERE id = $1", [id]));
  if (rows.length === 0) return new Response("Not found", { status: 404 });
  const body = await getObject(rows[0].object_key);
  return new Response(new Uint8Array(body), { headers: {
    "Content-Type": rows[0].mime_type,
    "Content-Disposition": `attachment; filename="${rows[0].filename.replace(/[^\w.\- ]/g, "_")}"`,
    "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
}
