"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createAndSubmitRequest, createRequest } from "../../actions";
import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SubmitButton } from "@/components/ui/submit-button";
import { accountPlace, etb, METHODS_FOR_KIND, PAYMENT_METHODS } from "@/lib/format";
import type { FormAccount, FormPayee } from "@/lib/requests";

const Step = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="mb-3 rounded-xl border bg-card p-4"><h2 className="mt-0">{title}</h2>{children}</section>;
let nextRow = 1;
const newRow = () => ({ key: nextRow++, due: "", amount: "" });

/** Company, then payee, then method and account. Every field keeps the name createRequest has always read. */
export default function NewRequestForm({ payees, accounts, startCompany }: { payees: FormPayee[]; accounts: FormAccount[]; startCompany: string | null }) {
  const companies = [...new Map(payees.map((p) => [p.company_id, p.company])).entries()];
  const [companyId, setCompanyId] = useState(companies.some(([id]) => id === startCompany) ? startCompany! : companies[0][0]);
  const [target, setTarget] = useState("");
  const [method, setMethod] = useState("TRANSFER");
  const [accountId, setAccountId] = useState("");
  const [rows, setRows] = useState(() => [newRow()]);

  const payeeOptions = payees.filter((p) => p.company_id === companyId).map((p) => ({
    value: `${p.company_id}|${p.payee_type}|${p.payee_id}`, label: p.payee, disabled: !p.bank_ok, hint: p.bank_ok ? (p.payee_type === "PERSON" ? "Person" : "Supplier") : "Bank details not verified",
  }));
  const usable = accounts.filter((a) => a.company_id === companyId && METHODS_FOR_KIND[a.account_kind]?.includes(method));
  const account = usable.find((a) => a.id === accountId);
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const over = account !== undefined && total > account.available_balance;
  const update = (key: number, change: Partial<{ due: string; amount: string }>) => setRows((p) => p.map((r) => (r.key === key ? { ...r, ...change } : r)));

  return (
    <form action={createRequest}>
      <Step title="Who is paid">
        <div className="grid gap-3 md:grid-cols-2">
          {companies.length > 1 && <label className="f">Company<select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setTarget(""); setAccountId(""); }}>{companies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
          <SearchableSelect label="Payee" name="target" options={payeeOptions} value={target} onChange={setTarget} placeholder="Type a supplier or person" />
        </div>
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

      <Step title="Installments">
        <div className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <div key={r.key} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <label className="f">Due date {i + 1}<input name="due" type="date" required value={r.due} onChange={(e) => update(r.key, { due: e.target.value })} /></label>
              <AmountInput name="amt" label={`Amount ${i + 1}`} required value={r.amount} onChange={(amount) => update(r.key, { amount })} />
              <Button type="button" variant="outline" size="icon" aria-label={`Remove installment ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((p) => p.filter((x) => x.key !== r.key))}><Trash2 /></Button>
            </div>
          ))}
          <div><Button type="button" variant="outline" size="sm" onClick={() => setRows((p) => [...p, newRow()])}><Plus />Add installment</Button></div>
        </div>
        <div role="status" className="mt-3 rounded-md border bg-background p-3 text-sm">
          Total to reserve: <b>{etb(total)}</b>
          {account ? <> · Available on this account: <b>{etb(account.available_balance)}</b></> : " · choose an account to see what is available"}
        </div>
        {account && account.shortfall_amount > 0 && <div role="alert" className="note bad mt-2">This account is in shortfall by {etb(account.shortfall_amount)}, so new submissions are blocked. You can save a draft.</div>}
        {over && account.shortfall_amount === 0 && <div role="alert" className="note bad mt-2">The total is more than the available balance. You can save a draft, but it cannot be submitted until the account has enough.</div>}
      </Step>

      <div className="flex flex-wrap gap-2">
        <SubmitButton formAction={createAndSubmitRequest} disabled={!target}>Save and submit (reserve funds)</SubmitButton>
        <SubmitButton variant="outline" disabled={!target}>Save as draft</SubmitButton>
      </div>
      {!target && <p className="mute mt-2">Choose a payee to continue.</p>}
    </form>
  );
}
