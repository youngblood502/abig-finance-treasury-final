import { withUser } from "@/lib/db";
import { currentUserId, requireMe } from "@/lib/session";
import { denyApi } from "@/lib/rbac";
import { requestDocument } from "@/lib/requests";
import { getObject } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  // Role first (who may open payment documents at all), then row-level security (which ones).
  const denied = denyApi(await requireMe(), "/requests"); if (denied) return denied;
  // Row-level security hides attachments the user may not see, so "not visible" and "does not exist" look the same.
  const file = await withUser(await currentUserId(), (tx) => requestDocument(tx, id));
  if (!file) return new Response("Not found", { status: 404 });
  const body = await getObject(file.object_key);
  return new Response(new Uint8Array(body), { headers: {
    "Content-Type": file.mime_type,
    "Content-Disposition": `attachment; filename="${file.filename.replace(/[^\w.\- ]/g, "_")}"`,
    "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
}
