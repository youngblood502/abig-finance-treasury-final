"use client";
import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tableView, type TableRow } from "@/lib/table";
import { cn } from "@/lib/utils";

export interface DataColumn { key: string; header: string; align?: "left" | "right"; sortable?: boolean; /** On a phone, this cell is the card's title. */ primary?: boolean }
/** Cells may be any content, so a server component can pass links and chips. `sort`, `search` and `filters` hold the plain values behind them. */
export interface DataRow extends TableRow { id: string; cells: Record<string, React.ReactNode> }
export interface DataFilter { key: string; label: string; options: { value: string; label: string }[] }

export interface DataTableProps {
  caption: string; columns: DataColumn[]; rows: DataRow[]; filters?: DataFilter[]; searchable?: boolean; pageSize?: number;
  totals?: Record<string, React.ReactNode>; emptyMessage?: string;
}

/** A table on a wider screen, stacked cards on a phone. Sorts, searches, filters and pages the rows it was given, in the browser. */
export function DataTable({ caption, columns, rows, filters = [], searchable = false, pageSize = 25, totals, emptyMessage = "Nothing here yet." }: DataTableProps) {
  const [query, setQuery] = React.useState("");
  const [chosen, setChosen] = React.useState<Record<string, string>>({});
  const [sort, setSort] = React.useState<{ key: string | null; descending: boolean }>({ key: null, descending: false });
  const [page, setPage] = React.useState(1);
  const view = tableView(rows, { query, filters: chosen, sortKey: sort.key, descending: sort.descending, page, pageSize });
  const toggleSort = (key: string) => { setSort((s) => (s.key === key ? { key, descending: !s.descending } : { key, descending: false })); setPage(1); };
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const narrowed = query.trim() !== "" || Object.values(chosen).some(Boolean);
  const message = view.total === 0 ? (narrowed ? "Nothing matches." : emptyMessage) : null;

  return (
    <div data-slot="data-table" className="flex flex-col gap-3">
      {(searchable || filters.length > 0) && (
        <div className="flex flex-wrap items-end gap-2">
          {searchable && <label className="f min-w-48 flex-1">Search<input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></label>}
          {filters.map((f) => (
            <label key={f.key} className="f">{f.label}
              <select value={chosen[f.key] ?? ""} onChange={(e) => { setChosen((c) => ({ ...c, [f.key]: e.target.value })); setPage(1); }}>
                <option value="">All</option>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}

      <div className="hidden overflow-x-auto md:block">
        <table className="no-stack">
          <caption className="sr-only">{caption}</caption>
          <thead><tr>{columns.map((c) => {
            const on = sort.key === c.key;
            return (
              <th key={c.key} scope="col" className={cn(c.align === "right" && "n")} aria-sort={on ? (sort.descending ? "descending" : "ascending") : undefined}>
                {c.sortable ? (
                  <Button type="button" variant="ghost" size="sm" className={cn("-mx-2 h-7 px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase", c.align === "right" && "ml-auto")} onClick={() => toggleSort(c.key)}>
                    {c.header}{on ? (sort.descending ? <ArrowDown /> : <ArrowUp />) : <ArrowUpDown />}
                  </Button>
                ) : c.header}
              </th>
            );
          })}</tr></thead>
          <tbody>
            {view.rows.map((r) => <tr key={r.id}>{columns.map((c) => <td key={c.key} className={cn(c.align === "right" && "n")}>{r.cells[c.key]}</td>)}</tr>)}
            {message && <tr><td colSpan={columns.length} className="text-muted-foreground">{message}</td></tr>}
          </tbody>
          {totals && view.total > 0 && <tfoot><tr>{columns.map((c) => <td key={c.key} className={cn("font-semibold", c.align === "right" && "n")}>{totals[c.key]}</td>)}</tr></tfoot>}
        </table>
      </div>

      <div className="flex flex-col gap-2 md:hidden">
        {view.rows.map((r) => (
          <dl key={r.id} className="m-0 rounded-lg border bg-background p-3">
            <div className="mb-1 font-semibold">{r.cells[primary.key]}</div>
            {columns.filter((c) => c.key !== primary.key && r.cells[c.key] !== undefined && r.cells[c.key] !== null && r.cells[c.key] !== "").map((c) => (
              <div key={c.key} className="flex items-baseline justify-between gap-3 py-0.5">
                <dt className="text-xs font-semibold text-muted-foreground">{c.header}</dt><dd className="m-0 min-w-0 text-right text-sm">{r.cells[c.key]}</dd>
              </div>
            ))}
          </dl>
        ))}
        {message && <p className="m-0 rounded-lg border bg-background p-3 text-sm text-muted-foreground">{message}</p>}
        {totals && view.total > 0 && (
          <dl className="m-0 rounded-lg border bg-accent p-3 text-accent-foreground">
            {columns.filter((c) => totals[c.key] !== undefined).map((c) => <div key={c.key} className="flex justify-between gap-3 py-0.5 text-sm font-semibold"><dt>{c.primary ? "" : c.header}</dt><dd className="m-0">{totals[c.key]}</dd></div>)}
          </dl>
        )}
      </div>

      {view.pages > 1 && (
        <nav aria-label={`${caption}: pages`} className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>Page {view.page} of {view.pages} ({view.total})</span>
          <span className="flex gap-1">
            <Button type="button" variant="outline" size="icon" aria-label="Previous page" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}><ChevronLeft /></Button>
            <Button type="button" variant="outline" size="icon" aria-label="Next page" disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)}><ChevronRight /></Button>
          </span>
        </nav>
      )}
    </div>
  );
}
