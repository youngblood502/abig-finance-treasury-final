import { Check, CircleX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ENDED_STATES, trackerSteps, trackerSummary } from "@/lib/tracker";
import { cn } from "@/lib/utils";

/** Where a payment stands: Draft, Reserved, Verified, Authenticated, Paid. Stacks downward on a phone. */
export function StatusTracker({ state, className }: { state: string; className?: string }) {
  const ended = ENDED_STATES.includes(state);
  return (
    <div data-slot="status-tracker" className={cn("flex flex-col gap-2", className)}>
      <ol aria-label={`Payment status: ${trackerSummary(state)}`} className="m-0 flex list-none flex-col gap-2 p-0 sm:flex-row sm:items-center">
        {trackerSteps(state).map((step, i) => (
          <li key={step.state} aria-current={step.status === "current" ? "step" : undefined} className="flex items-center gap-2 sm:flex-1">
            <span aria-hidden="true" className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
              step.status === "done" && "border-primary bg-primary text-primary-foreground",
              step.status === "current" && "border-primary bg-accent text-accent-foreground",
              step.status === "upcoming" && "border-input bg-background text-muted-foreground")}>
              {step.status === "done" ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn("text-sm", step.status === "upcoming" ? "text-muted-foreground" : "font-semibold text-foreground")}>
              {step.label}<span className="sr-only">{step.status === "done" ? ": done" : step.status === "current" ? ": current step" : ": not reached"}</span>
            </span>
            {i < 4 && <span aria-hidden="true" className={cn("hidden h-px flex-1 sm:block", step.status === "done" ? "bg-primary" : "bg-input")} />}
          </li>
        ))}
      </ol>
      {ended && <Badge variant="destructive"><CircleX className="size-3.5" aria-hidden="true" />{trackerSummary(state)}</Badge>}
    </div>
  );
}
