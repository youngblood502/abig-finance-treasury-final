import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Tabs that are links, so each tab has its own address and the server decides what it holds. */
export function TabLinks({ label, active, tabs }: { label: string; active: string; tabs: { key: string; href: string; title: string }[] }) {
  return (
    <nav aria-label={label} className="mb-3 flex flex-wrap gap-2">
      {tabs.map((t) => <Button key={t.key} asChild size="sm" variant={t.key === active ? "default" : "outline"}><Link href={t.href} aria-current={t.key === active ? "page" : undefined}>{t.title}</Link></Button>)}
    </nav>
  );
}
