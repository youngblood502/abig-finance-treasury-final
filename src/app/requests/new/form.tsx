"use client";
import { useState } from "react";
import { createAndScheduleRequest, createAndSubmitRequest, createRequest } from "../../actions";
import { AmountEntry } from "@/components/requests/amount-entry";
import { ScheduleField } from "@/components/requests/schedule-field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SubmitButton } from "@/components/ui/submit-button";
import { accountPlace, etb, METHODS_FOR_KIND, PAYMENT_METHODS } from "@/lib/format";
import type { FormAccount, FormCompany, FormPayee } from "@/lib/requests";
import { centsToPlain, etbCents, type TaxOptions } from "@/lib/tax";

const Step = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="mb-3 rounded-xl border bg-card p-4"><h2 className="mt-0">{title}</h2>{children}</section>;

/**
 * Company, then payee, then method and account. Every field keeps the name createRequest has always read.
 * The payee is a registered supplier or person, or a one-time payee entered here (name required; phone and bank details as the method needs).
 */
export default function NewRequestForm({ payees, accounts, companies: allowed, startCompany, canSchedule = false, tax }: { payees: FormPayee[]; accounts: FormAccount[]; companies: FormCompany[]; startCompany: string | null; canSchedule?: boolean; tax: TaxOptions }) {
  const companies: [string, string][] = allowed.map((c) => [c.id, c.name]);
  const [companyId, setCompanyId] = useState(companies.some(([id]) => id === startCompany) ? startCompany! : companies[0][0]);
  const [mode, setMode] = useState<"registered" | "one_time">(payees.length === 0 ? "one_time" : "registered");
  const [otName, setOtName] = useState("");
  const [target, setTarget] = useState("");
  const [method, setMethod] = useState("TRANSFER");
  const [accountId, setAccountId] = useState("");
  const [net, setNet] = useState<bigint | null>(null);
  const [firstDue, setFirstDue] = useState<string | undefined>(undefined);

  const payeeOptions = payees.filter((p) => p.company_id === companyId).map((p) => ({
    value: `${p.company_id}|${p.payee_type}|${p.payee_id}`, label: p.payee, hint: p.payee_type === "PERSON" ? "Person" : p.bank_ok ? "Supplier" : "Supplier, no verified bank details: cash or cheque",
  }));
  const chosen = payees.find((p) => `${p.company_id}|${p.payee_type}|${p.payee_id}` === target);
  const ready = mode === "one_time" ? otName.trim() !== "" : target !== "";
  const usable = accounts.filter((a) => a.company_id === companyId && METHODS_FOR_KIND[a.account_kind]?.includes(method));
  const account = usable.find((a) => a.id === accountId);
  // Display only: the database decides whether the net fits the available balance when the request is submitted.
  const over = account !== undefined && net !== null && Number(centsToPlain(net)) > account.available_balance;

  return (
    <form action={createRequest}>
      <Step title="Who is paid">
        <div className="grid gap-3 md:grid-cols-2">
          <fieldset className="md:col-span-2 m-0 flex flex-wrap gap-4 border-0 p-0">
            <legend className="mb-1 text-sm font-semibold">Payee</legend>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="payee_mode" value="registered" checked={mode === "registered"} onChange={() => setMode("registered")} disabled={payees.length === 0} />Registered supplier or person</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="payee_mode" value="one_time" checked={mode === "one_time"} onChange={() => setMode("one_time")} />One-time payee (not registered)</label>
          </fieldset>
          {companies.length > 1 && <label className="f">Company<select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setTarget(""); setAccountId(""); }}>{companies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
          {mode === "registered" ? <SearchableSelect label="Payee" name="target" options={payeeOptions} value={target} onChange={setTarget} placeholder="Type a supplier or person" />
            : <><input type="hidden" name="ot_company" value={companyId} />
              <label className="f">Payee name<input name="ot_name" required maxLength={200} value={otName} onChange={(e) => setOtName(e.target.value)} /></label>
              <label className="f">Phone{method === "TELEBIRR" ? " (the Telebirr number, needed before submitting)" : " (optional)"}<input name="ot_phone" type="tel" placeholder="0911 234 567" /></label>
              <label className="f">Bank{method === "TRANSFER" ? " (needed before submitting a transfer)" : " (optional)"}<input name="ot_bank" maxLength={120} /></label>
              <label className="f">Full account number{method === "TRANSFER" ? " (needed before submitting a transfer)" : " (optional)"}<input name="ot_account_number" minLength={6} maxLength={40} inputMode="numeric" autoComplete="off" spellCheck={false} /><span className="text-xs font-normal text-muted-foreground">Encrypted when saved. Only the last 4 digits are shown in lists.</span></label>
              <p className="m-0 text-sm text-muted-foreground md:col-span-2">No supplier or person record is created. The details stay with this request; its Verifier checks them before it can be authenticated. A bank transfer needs the bank and account number before it is submitted.</p></>}
        </div>
        {mode === "registered" && chosen?.payee_type === "SUPPLIER" && !chosen.bank_ok && method === "TRANSFER" && <div role="alert" className="note bad mt-2">This supplier has no verified bank details. Choose cash or cheque, or have bank details entered and verified before submitting a transfer. You can save a draft.</div>}
      </Step>

      <Step title="How it is paid">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="f">Payment method<select name="payment_method" value={method} onChange={(e) => { setMethod(e.target.value); setAccountId(""); }}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="f">Pay from
            <select name="account" required value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="" disabled>{usable.length ? "Choose an account" : "No account fits this method"}</option>
              {usable.map((a) => <option key={a.id} value={a.id}>{a.account_label} · {accountPlace({ account_kind: a.account_kind, bank_name: a.bank_name, account_last4: a.account_last4, wallet_phone: a.wallet_phone })}</option>)}
            </select></label>
          <label className="f">Invoice reference (optional)<input name="invoice_ref" /></label>
          <label className="f">Invoice date (optional)<input name="invoice_date" type="date" /></label>
          <label className="f">Priority<select name="priority" defaultValue="NORMAL"><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></label>
          <label className="f">Invoice file, optional (PDF, PNG or JPEG, up to 10 MB)<input name="invoice" type="file" accept="application/pdf,image/png,image/jpeg" /></label>
        </div>
        <label className="f mt-3">Notes<textarea name="description" rows={2} /></label>
      </Step>

      <Step title="Amount and tax">
        <AmountEntry options={tax} initial={{ mode: "BEFORE_VAT", entered: "", vatRateId: null, withholding: false }} installments={[]} onNet={setNet} onFirstDue={setFirstDue} />
        <div role="status" className="mt-3 rounded-md border bg-background p-3 text-sm">
          To reserve (the net payment): <b>{net === null ? "—" : etbCents(net)}</b>
          {account ? <> · Available on this account: <b>{etb(account.available_balance)}</b></> : " · choose an account to see what is available"}
        </div>
        {account && account.shortfall_amount > 0 && <div role="alert" className="note bad mt-2">This account is in shortfall by {etb(account.shortfall_amount)}, so new submissions are blocked. You can save a draft.</div>}
        {over && account.shortfall_amount === 0 && <div role="alert" className="note bad mt-2">The total is more than the available balance. You can save a draft, but it cannot be submitted until the account has enough.</div>}
      </Step>

      {canSchedule && <Step title="Or schedule it"><ScheduleField firstDue={firstDue} /></Step>}

      <div className="flex flex-wrap gap-2">
        <SubmitButton formAction={createAndSubmitRequest} disabled={!ready}>Save and submit (reserve funds)</SubmitButton>
        {canSchedule && <SubmitButton formAction={createAndScheduleRequest} variant="outline" disabled={!ready}>Save and schedule</SubmitButton>}
        <SubmitButton variant="outline" disabled={!ready}>Save as draft</SubmitButton>
      </div>
      {!ready && <p className="mute mt-2">{mode === "one_time" ? "Enter the payee's name to continue." : "Choose a payee to continue."}</p>}
    </form>
  );
}
