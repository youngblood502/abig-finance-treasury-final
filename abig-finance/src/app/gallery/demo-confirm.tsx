"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/** The gallery's examples. Confirming only shows a message here: nothing is sent to the server. */
export function DemoConfirm() {
  const [result, setResult] = useState("");
  const wait = () => new Promise((r) => setTimeout(r, 600));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ConfirmDialog title="Authenticate this payment?" description="The amount leaves the available balance. A mistake after this is corrected by a reversal entry." confirmLabel="Authenticate"
        effect={[{ label: "Before", value: "ETB 1,500,000.00" }, { label: "After", value: "ETB 1,100,000.00" }, { label: "Difference", value: "ETB -400,000.00" }]}
        action={async () => { await wait(); setResult("Example only: nothing was authenticated."); }} trigger={<Button>Authenticate</Button>} />
      <ConfirmDialog title="Remove this person's access?" description="They can no longer sign in to this company." confirmLabel="Remove access" destructive
        action={async () => { await wait(); setResult("Example only: nothing was removed."); }} trigger={<Button variant="destructive">Remove access</Button>} />
      {result && <span role="status" className="text-sm text-muted-foreground">{result}</span>}
    </div>
  );
}
