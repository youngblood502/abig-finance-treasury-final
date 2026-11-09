"use client";
import { useEffect, useState, useTransition } from "react";
import { Eye, EyeOff } from "lucide-react";
import { revealAccountNumber } from "@/app/reveal-actions";
import { Button } from "@/components/ui/button";
import type { NumberKind, NumberState } from "@/lib/account-numbers";
import { accountPlace } from "@/lib/format";
import { cn } from "@/lib/utils";

/** How long a revealed number stays on screen before it is hidden again. */
export const HIDE_AFTER_MS = 30_000;
export const maskNumber = (last4: string | null | undefined) => `••••${last4 ?? ""}`;

/**
 * Shows ••••1234 with an eye button. The full number is fetched only when the button is pressed, never with the page, and the database decides and
 * audits each time. Pressing again, or waiting 30 seconds, hides it and drops it from memory.
 */
export function RevealNumber({ kind, id, last4, className }: { kind: NumberKind; id: string; last4: string | null; className?: string }) {
  const [shown, setShown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (shown === null) return;
    const t = setTimeout(() => setShown(null), HIDE_AFTER_MS);
    return () => clearTimeout(t);
  }, [shown]);

  const toggle = () => {
    if (shown !== null) { setShown(null); return; }
    setError(null);
    start(async () => {
      const r = await revealAccountNumber(kind, id);
      if ("number" in r) setShown(r.number); else setError(r.error);
    });
  };

  return (
    <span className={cn("inline-flex items-center gap-1 align-middle whitespace-nowrap", className)}>
      <span className="font-mono tabular-nums" data-revealed={shown !== null || undefined}>{shown ?? maskNumber(last4)}</span>
      <Button type="button" variant="ghost" size="icon" onClick={toggle} disabled={pending} aria-pressed={shown !== null}
        aria-label={shown !== null ? "Hide the full account number" : "Show the full account number"} title={shown !== null ? "Hide" : "Show full number"}
        className="size-7 text-muted-foreground">
        {shown !== null ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </Button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

/**
 * The masked number as the database allows it for this person: the eye button when a full number exists and they may see it,
 * a note when they may see it but only the last four digits were ever recorded, and the plain mask otherwise.
 */
export function AccountNumber({ kind, id, last4, state, className }: { kind: NumberKind; id: string | null | undefined; last4: string | null; state: NumberState | string | null | undefined; className?: string }) {
  if (state === "RECORDED" && id) return <RevealNumber kind={kind} id={id} last4={last4} className={className} />;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1 align-middle", className)}>
      <span className="font-mono tabular-nums">{maskNumber(last4)}</span>
      {state === "NOT_RECORDED" && <span className="text-xs text-muted-foreground">Full number not recorded</span>}
    </span>
  );
}

/** Where a company account's money is: the bank and its number (with the eye button when allowed), or the wallet or cash as text. */
export function AccountPlaceNumber({ a, className }: { a: { id: string; account_kind?: string; bank_name?: string | null; account_last4?: string | null; wallet_phone?: string | null; number_state?: NumberState | string | null }; className?: string }) {
  if (a.account_kind !== "BANK") return <>{accountPlace(a)}</>;
  return <span className={className}>{a.bank_name} <AccountNumber kind="account" id={a.id} last4={a.account_last4 ?? null} state={a.number_state} /></span>;
}
