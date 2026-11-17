"use client";
import * as React from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { claimSubmission, lockFor, pendingLabel } from "@/lib/submit-lock";

/**
 * The guard behind every submit button. From the first click or Enter it holds the form's submission lock, so a second click or Enter in that
 * moment is cancelled; while React reports the submission as pending the caller disables its button. When the action finishes (success or
 * error: the page then shows the message) the lock is released, which is the equivalent of a finally block. The server checks every action again;
 * this only stops the browser from sending it twice.
 */
export function useSubmitGuard(onClick?: React.MouseEventHandler<HTMLButtonElement>) {
  const status = useFormStatus();
  const [pressed, setPressed] = React.useState(false);
  const form = React.useRef<HTMLFormElement | null>(null);
  const gen = React.useRef(0);        // which submission of the form's lock this button took; 0 = none
  const started = React.useRef(false);

  React.useEffect(() => {
    const f = form.current;
    if (status.pending) {
      // The submission is running: keep the lock until it finishes, however long that takes (the safety timer no longer applies).
      if (f && gen.current) { started.current = true; lockFor(f).hold(gen.current); }
      return;
    }
    if (started.current) {
      started.current = false; setPressed(false);
      if (f) lockFor(f).release(gen.current);
      gen.current = 0;
    }
  }, [status.pending]);

  const guard = (e: React.MouseEvent<HTMLButtonElement>) => {
    const f = e.currentTarget.form;
    if (f) {
      const claim = claimSubmission(f, { noValidate: e.currentTarget.formNoValidate });
      if (claim === "blocked") { e.preventDefault(); return; }   // a second click or Enter while the first is on its way
      if (claim === "invalid") { onClick?.(e); return; }         // the browser shows the missing field; nothing is sent or locked
      const mine = lockFor(f).generation;
      form.current = f; gen.current = mine; started.current = false;
      // If this submission never starts (it was cancelled), do not leave the form locked. Only this submission's lock is released, never a later one.
      window.setTimeout(() => { if (gen.current === mine && !started.current) { lockFor(f).release(mine); gen.current = 0; setPressed(false); } }, 3000);
    }
    setPressed(true);
    onClick?.(e);
  };
  return { pending: status.pending, pressed, guard };
}

export type SubmitButtonProps = React.ComponentProps<typeof Button> & {
  /** What the button says while its action runs. By default it is worked out from the label ("Save" → "Saving…"). */
  pendingText?: string;
  /** Pending state given directly, for a button that is not driven by its form (and for tests). */
  pending?: boolean;
  /** A plain <button> that keeps the page's older button styling instead of the design-system Button. */
  plain?: boolean;
};

/** A form's submit button: every button in the form is disabled while it is pending, and the one that was pressed shows a spinner and its loading text. */
export function SubmitButton({ children, disabled, pendingText, pending: given, plain = false, onClick, className, ...props }: SubmitButtonProps) {
  const g = useSubmitGuard(onClick);
  const pending = given ?? g.pending;
  const busy = pending && (g.pressed || given !== undefined);
  const content = <>{busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}{busy ? (pendingText ?? pendingLabel(children)) : children}</>;
  const common = { type: "submit" as const, disabled: pending || disabled, "aria-busy": busy || undefined, onClick: g.guard, className };
  if (plain) {
    const { variant: _v, size: _s, asChild: _a, ...rest } = props as typeof props & { variant?: unknown; size?: unknown; asChild?: unknown };
    return <button {...rest} {...common}>{content}</button>;
  }
  return <Button {...props} {...common}>{content}</Button>;
}
