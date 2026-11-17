import type { NavItem } from "@/lib/nav";
import { Brand } from "./brand";
import { SidebarNav } from "./sidebar-nav";

/** The desktop sidebar. On a phone the same links open from the header's menu button. */
export function Sidebar({ items }: { items: NavItem[] }) {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col gap-5 overflow-y-auto border-r bg-background p-4 md:flex">
      <Brand />
      <SidebarNav items={items} />
    </aside>
  );
}
