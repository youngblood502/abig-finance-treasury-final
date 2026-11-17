"use client";
import * as React from "react";
import { formatAmountInput, plainAmount } from "@/lib/amount";

export interface AmountInputProps { name: string; label: string; value?: string; defaultValue?: string | number; onChange?: (plain: string) => void; required?: boolean; id?: string }

/**
 * Shows thousands separators while typing, and sends the plain number. The visible field has no name, so the form posts exactly what a number field would.
 * Use `value` to control it, or `defaultValue` to leave it alone.
 */
export function AmountInput({ name, label, value, defaultValue, onChange, required, id }: AmountInputProps) {
  const [inner, setInner] = React.useState(() => plainAmount(String(defaultValue ?? "")));
  const plain = value ?? inner;
  return (
    <label className="f">{label}
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="text-xs font-semibold text-muted-foreground">ETB</span>
        <input id={id} type="text" inputMode="decimal" autoComplete="off" required={required} className="text-right tabular-nums" value={formatAmountInput(plain)}
          onChange={(e) => { const next = plainAmount(e.target.value); setInner(next); onChange?.(next); }} />
      </span>
      <input type="hidden" name={name} value={plain} />
    </label>
  );
}
