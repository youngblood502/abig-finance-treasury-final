import { dtime } from "@/lib/format";
import type { HistoryEntry } from "@/lib/requests";
import { cn } from "@/lib/utils";

/** A request's audit history, oldest first. Returns, rejections and changes stand out, each with its reason. */
export function Timeline({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) return <p className="m-0 text-sm text-muted-foreground">Nothing has happened yet.</p>;
  return (
    <ol data-slot="timeline" className="m-0 list-none p-0">
      {entries.map((e) => (
        <li key={e.key} className="relative border-l-2 border-border pb-4 pl-4 last:pb-0">
          <span aria-hidden="true" className={cn("absolute top-1.5 -left-[5px] size-2 rounded-full", e.tone === "destructive" ? "bg-destructive" : e.tone === "warning" ? "bg-warning" : "bg-primary")} />
          <div className="text-sm font-semibold">{e.title}</div>
          {e.detail && <div className="text-sm">{e.detail}</div>}
          {e.reason && <div className="text-sm">Reason: {e.reason}</div>}
          <div className="text-xs text-muted-foreground">{e.who}{e.role ? ` (${e.role})` : ""}, {dtime(e.when)}</div>
        </li>
      ))}
    </ol>
  );
}
