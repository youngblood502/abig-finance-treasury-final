import Link from "next/link";

/** The logo keeps its white plate, because it is drawn for a light background. */
export function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link href="/" onClick={onNavigate} className="flex items-center gap-2 rounded-md no-underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
      <span className="rounded-md bg-white p-1"><img src="/abig-logo.png" alt="ABIG" width={54} height={28} className="block h-7 w-auto" /></span>
      <span className="text-xs font-medium text-muted-foreground">Finance Management</span>
    </Link>
  );
}
