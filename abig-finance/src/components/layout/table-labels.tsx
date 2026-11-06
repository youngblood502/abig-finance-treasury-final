"use client";
import { useEffect } from "react";

/** Copies each column's heading onto its cells, so a stacked row can name its values (see the phone rules in legacy.css). */
function label(root: Element) {
  root.querySelectorAll("table:not(.no-stack)").forEach((table) => {
    const headings = [...table.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
    if (headings.length === 0) return;
    table.querySelectorAll("tbody tr").forEach((row) => {
      let column = 0;
      row.querySelectorAll<HTMLTableCellElement>(":scope > td, :scope > th").forEach((cell) => {
        if (cell.colSpan === 1) cell.dataset.label = headings[column] ?? ""; else delete cell.dataset.label;
        column += cell.colSpan;
      });
    });
  });
}

/** The screens built before Phase 4 keep their tables. This lets them stack on a phone until Phase 5 replaces them with the Data Table. */
export function TableLabels() {
  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    label(main);
    const watcher = new MutationObserver(() => label(main));
    watcher.observe(main, { childList: true, subtree: true });
    return () => watcher.disconnect();
  }, []);
  return null;
}
