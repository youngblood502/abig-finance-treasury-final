"use client";
import { useState } from "react";
import { createRequest } from "../../actions";
import { etb, PAYMENT_METHODS } from "@/lib/format";

type Target = { company_id: string; supplier_id: string; company: string; supplier: string; bank_ok: boolean };
type Account = { company_id: string; id: string; account_label: string; bank_name: string; account_last4: string; available_balance: number; shortfall_amount: number };

export default function NewRequestForm({ targets, accounts }: { targets: Target[]; accounts: Account[] }) {
  const [target, setTarget] = useState(() => { const t = targets.find((x) => x.bank_ok) ?? targets[0]; return `${t.company_id}|${t.supplier_id}`; });
  const [accountId, setAccountId] = useState("");
  const [amts, setAmts] = useState(["", "", "", ""]);
  const companyId = target.split("|")[0];
  const options = accounts.filter((a) => a.company_id === companyId);
  const account = options.find((a) => a.id === accountId);
  const total = amts.reduce((s, x) => s + (Number(x) > 0 ? Number(x) : 0), 0);
  const over = account !== undefined && total > account.available_balance;
  return (
    <form action={createRequest} className="card">
      <div className="form">
        <label className="f">Company and supplier
          <select name="target" required value={target} onChange={(e) => { setTarget(e.target.value); setAccountId(""); }}>
            {targets.map((t) => <option key={t.company_id + t.supplier_id} value={`${t.company_id}|${t.supplier_id}`} disabled={!t.bank_ok}>{t.company} — {t.supplier}{t.bank_ok ? "" : " (bank details not verified)"}</option>)}
          </select></label>
        <label className="f">Pay from (debit account)
          <select name="account" required value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="" disabled>{options.length ? "Choose an account" : "No account is linked to this company"}</option>
            {options.map((a) => <option key={a.id} value={a.id}>{a.account_label} · {a.bank_name} ••••{a.account_last4} — {a.shortfall_amount > 0 ? `in shortfall by ${etb(a.shortfall_amount)}, submissions blocked` : `available ${etb(a.available_balance)}`}</option>)}
          </select></label>
        <label className="f">Invoice reference<input name="invoice_ref" required /></label>
        <label className="f">Invoice date<input name="invoice_date" type="date" required /></label>
        <label className="f">Payment method<select name="payment_method" defaultValue="TRANSFER">{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="f">Priority<select name="priority" defaultValue="NORMAL"><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></label>
      </div>
      <h2>Installments</h2><p className="mute">Fill in one row for each payment. The total is the sum of the rows, and all of it is reserved when you submit.</p>
      {[1, 2, 3, 4].map((i) => (
        <div className="inline" key={i} style={{ marginBottom: 8 }}>
          <label className="f">Due date {i}<input name="due" type="date" required={i === 1} /></label>
          <label className="f">Amount (ETB) {i}<input name="amt" type="number" min="0.01" step="0.01" required={i === 1} value={amts[i - 1]} onChange={(e) => setAmts((p) => p.map((x, j) => (j === i - 1 ? e.target.value : x)))} /></label>
        </div>))}
      <div className="note" role="status" style={{ marginTop: 8 }}>
        Total to reserve: <b>{etb(total)}</b>{account ? <> · Available on this account: <b>{etb(account.available_balance)}</b></> : " · choose a debit account to see its available balance"}
      </div>
      {over && <div className="note bad" role="alert" style={{ marginTop: 8 }}>The total is more than the available balance. You can save a draft, but it cannot be submitted until the account has enough available balance.</div>}
      <div className="form" style={{ marginTop: 12 }}>
        <label className="f">Invoice file (PDF, PNG or JPEG, up to 10 MB)<input name="invoice" type="file" accept="application/pdf,image/png,image/jpeg" required /></label>
        <label className="f">Notes<textarea name="description" rows={2} /></label>
      </div>
      <div className="inline" style={{ marginTop: 14 }}>
        <button name="submit_now" value="1">Save and submit (reserve funds)</button><button className="sec">Save as draft</button>
      </div>
    </form>
  );
}
