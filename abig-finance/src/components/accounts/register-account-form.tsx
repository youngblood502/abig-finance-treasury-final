"use client";
import { useState } from "react";
import { registerAccount } from "@/app/actions";
import { AmountInput } from "@/components/ui/amount-input";
import { SubmitButton } from "@/components/ui/submit-button";
import { ACCOUNT_KINDS } from "@/lib/format";

/** Each kind of account needs different details, so only those are shown. The database checks them again. */
export function RegisterAccountForm({ owners }: { owners: { id: string; name: string }[] }) {
  const [kind, setKind] = useState("BANK");
  return (
    <form action={registerAccount} className="flex flex-col gap-3">
      <label className="f">Owned by<select name="owner">{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <label className="f">Type<select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(ACCOUNT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="f">Account name<input name="label" required /></label>
      {kind === "BANK" && (<>
        <label className="f">Bank<input name="bank" required /></label>
        <label className="f">Last 4 digits<input name="last4" required pattern="[0-9]{4}" maxLength={4} inputMode="numeric" /></label>
      </>)}
      {kind === "WALLET" && <label className="f">Telebirr phone<input name="phone" type="tel" required placeholder="0911 234 567" /></label>}
      <AmountInput name="buffer" label="Minimum buffer" defaultValue={0} />
      <div><SubmitButton>Register</SubmitButton></div>
    </form>
  );
}
