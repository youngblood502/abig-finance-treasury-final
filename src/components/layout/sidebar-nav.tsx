"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Banknote, BookUser, Building2, CalendarCheck, ChartColumn, CircleCheckBig, FileText, LayoutDashboard, Repeat, Settings, Truck, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { isCurrentPath, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboard, "/requests": FileText, "/approvals": CircleCheckBig, "/accounts": Banknote, "/treasury": CalendarCheck,
  "/recurring": Repeat, "/suppliers": Truck, "/payees": BookUser, "/reports": ChartColumn, "/admin": Settings,
};

/** Draws the items it is given: which ones a person may see is decided once, by navFor() in lib/rbac.ts. */
export function SidebarNav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map((item) => {
        const current = isCurrentPath(item.path, pathname), Icon = ICONS[item.path] ?? Building2;
        return (
          <Link key={item.path} href={item.path} onClick={onNavigate} aria-current={current ? "page" : undefined}
            className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium no-underline outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring",
              current ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent hover:text-accent-foreground")}>
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{item.label}</span>
            {item.count > 0 && <Badge variant={current ? "outline" : "secondary"} className={current ? "border-primary-foreground text-primary-foreground" : ""}>{item.count}</Badge>}
          </Link>
        );
      })}
    </nav>
  );
}
