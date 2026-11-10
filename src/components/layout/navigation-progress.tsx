"use client";
import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { createProgress, isNavigatingSubmit, navigationTarget, type ProgressState } from "@/lib/nav-progress";

/** The bar itself: a thin line in the brand colour across the top of the screen. Nothing is drawn while no page is loading. */
export function ProgressBar({ visible, value }: ProgressState) {
  if (!visible) return null;
  return (
    <div data-slot="navigation-progress" className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]">
      <div role="progressbar" aria-label="Loading page" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}
        className="h-full origin-left bg-primary shadow-[0_0_6px_var(--color-primary)] motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out"
        style={{ transform: `scaleX(${value})` }} />
    </div>
  );
}

/**
 * Starts the bar when a link or a filter form leads to another page of the app, and completes it when the new address is shown. Clicks that
 * do not change the page (buttons, menus, server-action forms, #links, other sites, new tabs) leave it alone. If the page never arrives
 * (the navigation was cancelled or failed) the fail-safe in createProgress ends it.
 */
function Progress() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const [state, setState] = React.useState<ProgressState>({ visible: false, value: 0 });
  const progress = React.useRef<ReturnType<typeof createProgress> | null>(null);

  React.useEffect(() => {
    const p = createProgress(setState);
    progress.current = p;
    // Capture phase: this sees the click before next/link takes over the navigation.
    const onClick = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (a instanceof HTMLAnchorElement && navigationTarget(e, a, window.location)) p.start();
    };
    // Bubble phase: a form whose submission React took over (a server action) has been cancelled by now and is skipped.
    const onSubmit = (e: SubmitEvent) => {
      if (!e.defaultPrevented && e.target instanceof HTMLFormElement && isNavigatingSubmit(e.target, e.submitter, window.location)) p.start();
    };
    // Back to a page the browser kept in memory: nothing is loading any more.
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) p.cancel(); };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onPageShow);
      p.cancel(); progress.current = null;
    };
  }, []);

  // A new address means the new page is on screen.
  React.useEffect(() => { progress.current?.done(); }, [pathname, search]);

  return <ProgressBar {...state} />;
}

/** Placed once in the root layout, for signed-in and signed-out pages alike. */
export function NavigationProgress() {
  // useSearchParams needs a Suspense boundary; the bar draws nothing until it is needed, so the fallback is empty.
  return <React.Suspense fallback={null}><Progress /></React.Suspense>;
}
