import { currentLogo } from "@/lib/company-logo";
import { withUser } from "@/lib/db";
import { canAccess } from "@/lib/rbac";
import { currentUserId, requireMe } from "@/lib/session";
import { getObject } from "@/lib/storage";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

/**
 * A company's current logo, for its payment vouchers and the administration screen. Signed-in people who use payment requests or
 * administration only; row-level security then decides which companies (the ones the person can already see). Anything else, including a
 * company without a logo, reads as not found. The file comes from private storage, never from a public path.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return notFound();
  const me = await requireMe();
  if (!canAccess(me, "/requests") && !canAccess(me, "/admin")) return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  const logo = await withUser(await currentUserId(), (tx) => currentLogo(tx, id));
  if (!logo) return notFound();
  let body: Buffer;
  try { body = await getObject(logo.object_key); } catch { return notFound(); }
  // The address carries the file's hash (logoUrl): a matching request may be cached privately; any other is checked again every time.
  const v = new URL(req.url).searchParams.get("v");
  const current = v !== null && logo.sha256.startsWith(v) && v.length >= 16;
  return new Response(new Uint8Array(body), { headers: {
    "Content-Type": logo.mime_type,
    "Content-Length": String(body.length),
    "Content-Disposition": `inline; filename="company-logo.${logo.mime_type === "image/png" ? "png" : "jpg"}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": current ? "private, max-age=86400, immutable" : "private, no-cache",
    ETag: `"${logo.sha256}"`,
  } });
}
