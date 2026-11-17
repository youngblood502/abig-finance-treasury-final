import { addisIso } from "./format";

// CSV with protection against spreadsheet formula injection: a cell that starts with = + - @ is prefixed so Excel treats it as text.
const cell = (v: unknown) => {
  let s = v instanceof Date ? addisIso(v) : v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s) && isNaN(Number(s))) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(columns: [key: string, title: string][], rows: Record<string, unknown>[]): string {
  return "\uFEFF" + [columns.map(([, t]) => cell(t)).join(","), ...rows.map((r) => columns.map(([k]) => cell(r[k])).join(","))].join("\r\n") + "\r\n";
}
