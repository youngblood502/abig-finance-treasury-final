// What the screens need to know about company logos, without the server-only validation code (company-logo.ts).
export const LOGO_MAX_BYTES = 1024 * 1024, LOGO_MIN_PX = 64, LOGO_MAX_PX = 2000;

/** The logo's address for the browser: the authorized route, with the file's hash so a new logo is never served from an old cache. */
export const logoUrl = (companyId: string, sha256: string) => `/companies/${companyId}/logo?v=${sha256.slice(0, 16)}`;
