"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";

export interface ConfirmDialogProps {
  /** The control that opens the dialog. */
  trigger: React.ReactNode;
  title: string; description: string;
  /** What will change, for example Before, After, Difference. */
  effect?: { label: string; value: React.ReactNode }[];
  confirmLabel: string; cancelLabel?: string; destructive?: boolean;
  /** What the confirm button says while the action runs. By default it is worked out from confirmLabel ("Verify" → "Verifying…"). */
  pendingLabel?: string;
  /** A server action. It receives `fields` as form data, as any form on the site would. */
  action: (data: FormData) => void | Promise<void>;
  fields?: Record<string, string>;
  /** Extra fields inside the form, such as a required reason. */
  children?: React.ReactNode;
}


/** Asks before an action that moves money or changes access, and shows its effect. Cancel takes the first focus, so Enter cannot confirm by accident. */
export function ConfirmDialog({ trigger, title, description, effect, confirmLabel, cancelLabel = "Cancel", destructive = false, pendingLabel, action, fields = {}, children }: ConfirmDialogProps) {
  const [open, setOpen] = React.useState(false);
  const cancel = React.useRef<HTMLButtonElement>(null);
  // The dialog closes once the action has finished, whether it succeeded or not; the page then shows the success or error message.
  const run = async (data: FormData) => { try { await action(data); } finally { setOpen(false); } };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content role="alertdialog" data-slot="confirm-dialog" onOpenAutoFocus={(e) => { e.preventDefault(); cancel.current?.focus(); }}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-lg border bg-popover p-5 text-popover-foreground shadow-lg">
          <DialogPrimitive.Title className="m-0 text-lg font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="m-0 text-sm text-muted-foreground">{description}</DialogPrimitive.Description>
          {effect && effect.length > 0 && (
            <dl className="m-0 rounded-md border bg-card p-3">
              {effect.map((e) => <div key={e.label} className="flex justify-between gap-3 py-0.5 text-sm"><dt className="text-muted-foreground">{e.label}</dt><dd className="m-0 font-semibold">{e.value}</dd></div>)}
            </dl>
          )}
          <form action={run} className="flex flex-col gap-3">
            {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            {children}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <DialogPrimitive.Close asChild><Button ref={cancel} type="button" variant="outline">{cancelLabel}</Button></DialogPrimitive.Close>
              <SubmitButton variant={destructive ? "destructive" : "default"} pendingText={pendingLabel}>{confirmLabel}</SubmitButton>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
