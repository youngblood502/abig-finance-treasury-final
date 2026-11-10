"use client";
import { usePathname } from "next/navigation";
import { Bell as BellIcon } from "lucide-react";
import { markAllNotificationsRead, openNotification } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ageSince } from "@/lib/format";
import type { Bell } from "@/lib/notifications";

/** The bell: what needs this person's attention. Opening one marks it read; everything shown came from their own notifications only. */
export function NotificationBell({ bell }: { bell: Bell }) {
  const path = usePathname();
  const count = bell.unread > 99 ? "99+" : String(bell.unread);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={bell.unread > 0 ? `Notifications, ${bell.unread} unread` : "Notifications"}>
          <BellIcon />
          {bell.unread > 0 && <span aria-hidden="true" className="absolute top-1 right-1 min-w-4 rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-destructive-foreground">{count}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(24rem,calc(100vw-2rem))]">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>Notifications</span>
          {bell.unread > 0 && (
            <form action={markAllNotificationsRead}>
              <input type="hidden" name="back" value={path} />
              <button type="submit" data-slot="text-button" className="cursor-pointer border-0 bg-transparent p-0 text-xs font-normal text-primary underline-offset-4 hover:underline">Mark all as read</button>
            </form>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {bell.items.length === 0 ? <p className="m-0 px-2 py-3 text-sm text-muted-foreground">Nothing needs your attention.</p>
          : bell.items.map((n) => (
            <form key={n.id} action={openNotification}>
              <input type="hidden" name="id" value={n.id} />
              <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
                <button type="submit" className="flex w-full items-start gap-2 text-left">
                  <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-primary"}`} />
                  <span className="min-w-0">
                    <span className={`block text-sm whitespace-normal ${n.read ? "text-muted-foreground" : "font-semibold"}`}>{n.title}</span>
                    <span className="block text-xs text-muted-foreground">{ageSince(new Date(n.created_at))}{n.read ? "" : " · unread"}</span>
                  </span>
                </button>
              </DropdownMenuItem>
            </form>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
