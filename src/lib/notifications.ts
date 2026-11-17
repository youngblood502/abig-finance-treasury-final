import type { Tx } from "./db";
import { notificationLink, notificationTitle, type OutboxEvent } from "./notification-text";

// The in-app bell. Row-level security returns only the signed-in person's own notifications; marking them read goes through
// mark_notification_read and mark_all_notifications_read, which change only that person's rows.

export interface BellItem { id: string; title: string; link: string; created_at: Date; read: boolean }
export interface Bell { unread: number; items: BellItem[] }

export const BELL_LIMIT = 15;
export async function loadBell(tx: Tx, limit = BELL_LIMIT): Promise<Bell> {
  const unread = Number((await tx.q<{ n: string }>("SELECT count(*) AS n FROM user_notifications WHERE read_at IS NULL"))[0].n);
  const rows = await tx.q<{ id: string; event_type: string; request_id: string | null; payload: OutboxEvent["payload"]; created_at: Date; read_at: Date | null }>(
    "SELECT id, event_type, request_id, payload, created_at, read_at FROM user_notifications ORDER BY created_at DESC, id LIMIT $1", [limit]);
  return { unread, items: rows.map((r) => ({ id: r.id, title: notificationTitle(r), link: notificationLink(r), created_at: r.created_at, read: r.read_at !== null })) };
}
