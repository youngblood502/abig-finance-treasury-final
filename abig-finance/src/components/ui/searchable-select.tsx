"use client";
import * as React from "react";
import { Check } from "lucide-react";
import { filterOptions, type SelectOption } from "@/lib/table";
import { cn } from "@/lib/utils";

export interface SearchableSelectProps { label: string; name: string; options: SelectOption[]; value: string; onChange: (value: string) => void; placeholder?: string; emptyMessage?: string }

/** A picker that works with hundreds of entries: type to narrow the list, then use the arrows and Enter, or click. The chosen value is posted with the form. */
export function SearchableSelect({ label, name, options, value, onChange, placeholder = "Type to search", emptyMessage = "Nothing matches." }: SearchableSelectProps) {
  const listId = React.useId();
  const chosen = options.find((o) => o.value === value);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const shown = filterOptions(options, query);
  const pick = (o: SelectOption) => { if (o.disabled) return; onChange(o.value); setQuery(""); setOpen(false); };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && open) { e.preventDefault(); if (shown[active]) pick(shown[active]); }   // Enter chooses here, and never submits the form by accident
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
  };
  return (
    <div className="relative">
      <label className="f">{label}
        <input role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" autoComplete="off" placeholder={chosen ? undefined : placeholder}
          value={open ? query : chosen?.label ?? ""} onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
          onFocus={() => { setQuery(""); setOpen(true); setActive(0); }} onBlur={() => setOpen(false)} onKeyDown={onKey} />
      </label>
      <input type="hidden" name={name} value={value} />
      {open && (
        <ul id={listId} role="listbox" aria-label={label} className="absolute z-40 m-0 mt-1 max-h-64 w-full list-none overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {shown.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value} aria-disabled={o.disabled || undefined} onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setActive(i)}
              className={cn("flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm", i === active && !o.disabled && "bg-accent text-accent-foreground", o.disabled && "cursor-not-allowed text-muted-foreground")}>
              <span className="min-w-0">{o.label}{o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}</span>
              {o.value === value && <Check className="size-4 shrink-0" aria-hidden="true" />}
            </li>
          ))}
          {shown.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">{emptyMessage}</li>}
        </ul>
      )}
    </div>
  );
}
