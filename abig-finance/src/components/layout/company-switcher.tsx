"use client";
import { Building2 } from "lucide-react";
import { setCompany } from "@/app/actions";
import { ALL_COMPANIES, type CompanyOption } from "@/lib/company";

/** The list holds only the person's own companies; the server checks the choice again. Someone with one company just sees its name. */
export function CompanySwitcher({ companies, current }: { companies: CompanyOption[]; current: string | null }) {
  if (companies.length === 0) return null;
  if (companies.length === 1) return <span className="hidden max-w-56 truncate text-sm text-muted-foreground sm:inline">{companies[0].name}</span>;
  return (
    <form action={setCompany} className="flex min-w-0 items-center gap-2">
      <Building2 className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
      <label htmlFor="company-switcher" className="sr-only">Company</label>
      <select id="company-switcher" key={current ?? ALL_COMPANIES} name="company" defaultValue={current ?? ALL_COMPANIES} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="max-w-36 text-sm sm:max-w-64">
        <option value={ALL_COMPANIES}>All my companies</option>
        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </form>
  );
}
