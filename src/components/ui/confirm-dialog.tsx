"use client";
import * as React from "react";
import { useFormStatus } from "react-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ConfirmDialogProps {
  /** The control that opens the dialog. */
  trigger: React.ReactNode;
  title: string; description: string;
  /** What will change, for example Before, After, Difference. */
  effect?: { label: string; value: React.ReactNode }[];
  confirmLabel: string; cancelLabel?: string; destructive?: boolean;
  /** A server action. It receives `fields` as form data, as any form on the site would. */
  action: (data: FormData) => void | Promise<void>;
  fields?: Record<string, string>;
}

/** Disabled while the request is on its way, so nothing is sent twice. */
function ConfirmButton({ label, destructive }: { label: string; destructive: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>{pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}{label}</Button>;
}

/** Asks before an action that moves money or changes access, and shows its effect. Cancel takes the first focus, so Enter cannot confirm by accident. */
export function ConfirmDialog({ trigger, title, description, effect, confirmLabel, cancelLabel = "Cancel", destructive = false, action, fields = {} }: ConfirmDialogProps) {
  const [open, setOpen] = React.useState(false);
  const cancel = React.useRef<HTMLButtonElement>(null);
  const run = async (data: FormData) => { await action(data); setOpen(false); };
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
          <form action={run} className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <DialogPrimitive.Close asChild><Button ref={cancel} type="button" variant="outline">{cancelLabel}</Button></DialogPrimitive.Close>
            <ConfirmButton label={confirmLabel} destructive={destructive} />
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
