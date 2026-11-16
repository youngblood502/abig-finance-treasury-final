"use client";
import { useState } from "react";
import { addPerson, addPersonDetail } from "@/app/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { PAYMENT_METHODS } from "@/lib/format";

const METHODS = Object.entries(PAYMENT_METHODS);

/** A person to pay, for a one-off payment or a regular one. No supplier registration. `back` returns to a new request afterwards. */
export function AddPersonForm({ companies, back }: { companies: { id: string; name: string }[]; back?: "request" }) {
  return (
    <form action={addPerson} className="flex flex-col gap-3">
      {back && <input type="hidden" name="back" value={back} />}
      <label className="f">Company<select name="company">{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="f">Full name<input name="name" required /></label>
      <label className="f">Phone (optional)<input name="phone" type="tel" placeholder="0911 234 567" /></label>
      <label className="f">ID number<input name="id_number" required autoComplete="off" /></label>
      <label className="f">Usually paid by<select name="preferred" defaultValue="CASH">{METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <p className="m-0 text-sm text-muted-foreground">Cash and cheque can be used straight away. Transfer and Telebirr need details that someone else has verified.</p>
      <div><SubmitButton>Add person</SubmitButton></div>
    </form>
  );
}

/** Bank or Telebirr details for one person. Only the fields for the chosen type are shown. */
export function PersonDetailForm({ person }: { person: string }) {
  const [kind, setKind] = useState("BANK");
  return (
    <form action={addPersonDetail} className="flex flex-col gap-3 border-t pt-3">
      <input type="hidden" name="person" value={person} />
      <label className="f">Type<select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="BANK">Bank</option><option value="TELEBIRR">Telebirr</option></select></label>
      {kind === "BANK" ? (<>
        <label className="f">Bank<input name="bank" required /></label>
        <label className="f">Full account number<input name="account_number" required minLength={6} maxLength={40} inputMode="numeric" autoComplete="off" spellCheck={false} /><span className="text-xs font-normal text-muted-foreground">Encrypted when saved. Lists show only the last 4 digits.</span></label>
      </>) : <label className="f">Telebirr phone<input name="phone" type="tel" required placeholder="0911 234 567" /></label>}
      <div><SubmitButton variant="outline">Enter for verification</SubmitButton></div>
    </form>
  );
}
