export interface CompanyOption { id: string; name: string }
export const ALL_COMPANIES = "all";

/** The companies a person works in or reports on. A company that only shares a bank account with theirs is not one of them. */
export const MY_COMPANIES_SQL = `SELECT c.id, c.legal_name AS name FROM companies c
  WHERE c.is_active AND (c.id IN (SELECT app_readable_companies()) OR app_is_admin()) ORDER BY c.legal_name`;

/**
 * Which company the lists should follow: an id, or null for everything the person may see.
 * The value comes from a cookie, so it counts only if it is one of the person's own companies. It can only narrow what they
 * see: row-level security decides what is visible either way.
 */
export const resolveCompany = (value: string | undefined, companies: CompanyOption[]): string | null =>
  companies.length > 1 && companies.some((c) => c.id === value) ? value! : null;

/** SQL condition: the account is linked to the chosen company, or no company is chosen. `param` is a placeholder such as $1. */
export const accountInCompany = (idColumn: string, param: string) =>
  `(${param}::uuid IS NULL OR ${idColumn} IN (SELECT g.account_id FROM company_bank_account_access g WHERE g.company_id = ${param}::uuid AND g.revoked_at IS NULL))`;
