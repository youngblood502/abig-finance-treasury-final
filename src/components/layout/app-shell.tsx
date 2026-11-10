import type { CompanyOption } from "@/lib/company";
import type { NavItem } from "@/lib/nav";
import type { Bell } from "@/lib/notifications";
import { DevBanner } from "./dev-banner";
import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { TableLabels } from "./table-labels";

export interface ShellProps { items: NavItem[]; name: string; details: string[]; companies: CompanyOption[]; company: string | null; devUsers: { id: string; full_name: string }[]; userId: string; bell?: Bell | null; children: React.ReactNode }

/** The frame around every signed-in page. min-w-0 lets a wide table scroll inside the page instead of stretching it. */
export function AppShell({ items, name, details, companies, company, devUsers, userId, bell = null, children }: ShellProps) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <Sidebar items={items} />
      <div className="flex min-w-0 flex-col">
        {devUsers.length > 0 && <DevBanner users={devUsers} current={userId} />}
        <Header items={items} name={name} details={details} companies={companies} company={company} bell={bell} />
        <main className="w-full max-w-[1150px] p-4 md:px-7 md:py-6">{children}</main>
        <TableLabels />
      </div>
    </div>
  );
}
