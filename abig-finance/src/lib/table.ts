/** What the Data Table does to its rows: search, filter, sort, then page. Kept apart from the component so it can be tested. */
export interface TableRow { search?: string; filters?: Record<string, string>; sort?: Record<string, string | number> }
export interface TableQuery { query: string; filters: Record<string, string>; sortKey: string | null; descending: boolean; page: number; pageSize: number }

const compare = (a: string | number | undefined, b: string | number | undefined) => {
  if (a === undefined || a === "") return b === undefined || b === "" ? 0 : 1;   // empty values go last in either direction
  if (b === undefined || b === "") return -1;
  return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
};

export interface SelectOption { value: string; label: string; hint?: string; disabled?: boolean }
/** What a Searchable Select shows: every option, or those whose label or hint contains each typed word, in any order. */
export const filterOptions = (options: SelectOption[], query: string) => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.length === 0 ? options : options.filter((o) => { const text = `${o.label} ${o.hint ?? ""}`.toLowerCase(); return words.every((w) => text.includes(w)); });
};

export function tableView<T extends TableRow>(rows: T[], q: TableQuery) {
  const needle = q.query.trim().toLowerCase();
  const found = rows.filter((r) => (!needle || (r.search ?? "").toLowerCase().includes(needle)) && Object.entries(q.filters).every(([k, v]) => !v || r.filters?.[k] === v));
  const sorted = q.sortKey === null ? found : found.map((row, i) => ({ row, i })).sort((x, y) => {
    const a = x.row.sort?.[q.sortKey!], b = y.row.sort?.[q.sortKey!];
    const empty = a === undefined || a === "" || b === undefined || b === "";
    return (q.descending && !empty ? -compare(a, b) : compare(a, b)) || x.i - y.i;
  }).map((s) => s.row);
  const pages = Math.max(1, Math.ceil(sorted.length / q.pageSize));
  const page = Math.min(Math.max(q.page, 1), pages);
  return { rows: sorted.slice((page - 1) * q.pageSize, page * q.pageSize), total: sorted.length, page, pages };
}
