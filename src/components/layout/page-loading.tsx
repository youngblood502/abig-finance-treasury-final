import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// What the screen shows while it waits. No data and no client code: these are sent with the very first bytes of a page.

/**
 * The branded screen while the app opens: the logo, its name and a spinner. It fades in after a moment, so a page that is ready almost at
 * once replaces it before it is noticed instead of flashing it.
 */
export function BrandSplash() {
  return (
    <div data-slot="brand-splash" role="status" aria-live="polite"
      className="grid min-h-dvh place-items-center bg-background p-6 text-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300 motion-safe:[animation-delay:150ms] motion-safe:[animation-fill-mode:backwards]">
      <div className="flex flex-col items-center gap-4 text-center">
        {/* The logo keeps its white plate, as in the sidebar, because it is drawn for a light background. */}
        <span className="rounded-xl bg-white p-3 shadow-sm"><img src="/abig-logo.png" alt="ABIG" width={108} height={56} className="block h-14 w-auto" /></span>
        <div>
          <p className="m-0 text-base font-semibold">ABIG Finance Management</p>
          <p className="m-0 mt-1 text-sm text-muted-foreground">Loading your workspace…</p>
        </div>
        <LoaderCircle className="size-6 text-primary motion-safe:animate-spin" aria-hidden="true" />
      </div>
    </div>
  );
}

const Bone = ({ className }: { className?: string }) => <div className={cn("rounded-md bg-muted motion-safe:animate-pulse", className)} />;

/** The page title and its line of purpose, the same height as PageHeader, so nothing jumps when the page arrives. */
function HeaderBones() {
  return (
    <div className="mb-5">
      <Bone className="h-8 w-56 max-w-full" />
      <Bone className="mt-2 h-4 w-96 max-w-full" />
    </div>
  );
}

function TableBones({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-4 flex flex-wrap gap-3"><Bone className="h-9 w-48" /><Bone className="h-9 w-32" /><Bone className="h-9 w-32" /></div>
      <div className="grid gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="grid grid-cols-[2fr_1fr_1fr] gap-4 sm:grid-cols-[2fr_1fr_1fr_1fr]">
            <Bone className="h-5" /><Bone className="h-5" /><Bone className="h-5" /><Bone className="hidden h-5 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The page area while a page's data loads: the sidebar and header stay where they are and only the page itself is drawn in outline.
 * "list" for overviews and lists (tiles, then a table); "detail" for one record (its summary beside its history).
 */
export function PageSkeleton({ variant = "list", label = "Loading page…" }: { variant?: "list" | "detail"; label?: string }) {
  return (
    <div data-slot="page-skeleton" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        <HeaderBones />
        {variant === "list" ? (
          <>
            <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
              {Array.from({ length: 3 }, (_, i) => <div key={i} className="flex flex-col gap-2 rounded-xl border bg-card p-4"><Bone className="h-4 w-24" /><Bone className="h-6 w-32" /></div>)}
            </div>
            <TableBones />
          </>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="grid gap-4">
              <div className="grid gap-3 rounded-xl border bg-card p-4">{Array.from({ length: 5 }, (_, i) => <Bone key={i} className="h-5" />)}</div>
              <TableBones rows={3} />
            </div>
            <div className="grid content-start gap-3 rounded-xl border bg-card p-4">{Array.from({ length: 4 }, (_, i) => <Bone key={i} className="h-12" />)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
