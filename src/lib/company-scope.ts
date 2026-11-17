import { cache } from "react";
import { cookies } from "next/headers";
import { MY_COMPANIES_SQL, resolveCompany, type CompanyOption } from "./company";
import { withUser } from "./db";

export const COMPANY_COOKIE = "abig_company";

/** Asked once per page render, whether from the layout or the page. */
export const myCompanies = cache((userId: string) => withUser(userId, (tx) => tx.q<CompanyOption>(MY_COMPANIES_SQL)));

/** The company this person's lists follow, or null for all of theirs. Checked on every request. */
export async function companyScope(userId: string): Promise<string | null> {
  return resolveCompany((await cookies()).get(COMPANY_COOKIE)?.value, await myCompanies(userId));
}
