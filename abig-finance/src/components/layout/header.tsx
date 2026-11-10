import type { CompanyOption } from "@/lib/company";
import type { NavItem } from "@/lib/nav";
import { CompanySwitcher } from "./company-switcher";
import { MobileNav } from "./mobile-nav";
import { NotificationBell } from "./notification-bell";
import type { Bell } from "@/lib/notifications";
import { UserMenu } from "./user-menu";

export function Header({ items, name, details, companies, company, bell = null }: { items: NavItem[]; name: string; details: string[]; companies: CompanyOption[]; company: string | null; bell?: Bell | null }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background px-3 md:px-7">
      {items.length > 0 && <MobileNav items={items} />}
      {companies.length < 2 && <span className="text-sm font-semibold md:hidden">ABIG Finance</span>}
      <CompanySwitcher companies={companies} current={company} />
      <div className="ml-auto flex shrink-0 items-center gap-1">{bell && <NotificationBell bell={bell} />}<UserMenu name={name} details={details} /></div>
    </header>
  );
}
