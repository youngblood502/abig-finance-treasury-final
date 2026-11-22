import { logoUrl } from "@/lib/logo-url";

/**
 * A company's own logo, from the authorized logo route, or, when it has none, its code in a box. Never another company's logo and never the
 * group's: a company without a logo is shown by its code.
 */
export function CompanyMark({ companyId, code, logo, size = 56, className = "" }: { companyId: string; code: string; logo: { sha256: string } | null; size?: number; className?: string }) {
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl(companyId, logo.sha256)} alt="" width={size} height={size} className={`company-mark shrink-0 object-contain ${className}`} style={{ width: size, height: size }} />;
  }
  const fontSize = Math.max(8, Math.min(size * 0.3, (size - 8) / Math.max(code.length, 1) * 1.6));
  return (
    <span aria-hidden="true" data-fallback="company-code" className={`company-mark inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border-2 border-primary font-bold leading-none text-primary ${className}`}
      style={{ width: size, height: size, fontSize }}>{code.toUpperCase()}</span>
  );
}
