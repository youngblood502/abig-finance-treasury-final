import * as React from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const tile = cva("flex min-w-0 flex-col gap-1 rounded-xl border p-4 text-card-foreground no-underline outline-none", {
  variants: { tone: { default: "bg-card", warning: "border-warning bg-warning-soft", destructive: "border-destructive bg-destructive-soft" } },
  defaultVariants: { tone: "default" },
});

export interface StatTileProps extends VariantProps<typeof tile> { label: string; value: React.ReactNode; hint?: string; href?: string }

/** One figure with its label. With `href` the whole tile opens the list behind the figure. */
export function StatTile({ label, value, hint, href, tone }: StatTileProps) {
  const body = (
    <>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-xl font-bold tabular-nums break-words">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </>
  );
  return href
    ? <Link data-slot="stat-tile" href={href} className={cn(tile({ tone }), "transition-colors hover:border-primary focus-visible:ring-[3px] focus-visible:ring-ring")}>{body}</Link>
    : <div data-slot="stat-tile" className={tile({ tone })}>{body}</div>;
}

/** Lays tiles out in as many columns as fit. */
export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div data-slot="stat-grid" className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">{children}</div>;
}
