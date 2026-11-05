import Link from "next/link";
import { Flash, ShortfallChip } from "@/components";
import { dstr, dtime, etb, addisDate, PAYMENT_METHODS, STATE_LABEL, accountPlace } from "@/lib/format";
import { withUser } from "@/lib/db";
import { requireAccess } from "@/lib/rbac";
import { requireMe } from "@/lib/session";
import { auditRows, BUCKETS, cashRows, paymentRows, pendingRows, REPORT_TABS as TABS } from "@/lib/reports";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const me = await requireMe(); requireAccess(me, "/reports");
  const tab = TABS.some(([k]) => k === sp.r) ? sp.r! : "pending";
  const today = addisDate(), from = DATE.test(sp.from ?? "") ? sp.from! : addisDate(new Date(Date.now() - 30 * 864e5)), to = DATE.test(sp.to ?? "") ? sp.to! : today;
  const q = (sp.q ?? "").trim() || null;
  const d = await withUser(me.id, async (tx) => {
    if (tab === "pending") return { rows: await pendingRows(tx) };
    if (tab === "payments") return { rows: await paymentRows(tx, from, to) };
    if (tab === "audit") return { rows: await auditRows(tx, q) };
    return { rows: await cashRows(tx) };
  });
  const sum = (rows: any[], k = "amount") => rows.reduce((s, r) => s + Number(r[k]), 0);
  const by = (rows: any[], key: string) => [...rows.reduce((m: Map<string, number>, r: any) => m.set(r[key], (m.get(r[key]) ?? 0) + Number(r.amount)), new Map()).entries()].sort((a, b) => b[1] - a[1]);
  const status = (s: string) => (s === "RESERVED" ? "Waiting for verification" : "Waiting for authentication");
  return (
    <>
      <h1>Reports</h1><p className="sub">Everything here follows the same visibility rules as the rest of the app. Amounts are in ETB.</p><Flash sp={sp} />
      <div className="inline" style={{ marginBottom: 12 }}>{TABS.map(([k, t]) => <Link key={k} className={`btn ${tab === k ? "" : "sec"}`} href={`/reports?r=${k}`}>{t}</Link>)}</div>

      {tab === "pending" && (<>
        <div className="row"><h2 style={{ margin: 0 }}>Reserved and waiting for approval: {etb(sum(d.rows))}</h2><a className="btn sec" href="/reports/export/pending">Download CSV</a></div>
        <div className="figs" style={{ marginTop: 12 }}>{BUCKETS.map((b) => { const r = d.rows.filter((x: any) => x.bucket === b); return <div className="card" key={b}><b>{etb(sum(r))}</b><span>{b} ({r.length})</span></div>; })}</div>
        <div className="form"><div className="card"><b>By company</b><table><tbody>{by(d.rows, "company_name").map(([k, v]) => <tr key={k}><td>{k}</td><td className="n">{etb(v)}</td></tr>)}</tbody></table></div>
          <div className="card"><b>By payee</b><table><tbody>{by(d.rows, "payee_name").slice(0, 10).map(([k, v]) => <tr key={k}><td>{k}</td><td className="n">{etb(v)}</td></tr>)}</tbody></table></div></div>
        <div className="card scroll" style={{ marginTop: 12 }}><table><thead><tr><th>Request</th><th>Company</th><th>Payee</th><th>Status</th><th>Due</th><th className="n">Amount</th><th>Debit account</th></tr></thead>
          <tbody>{d.rows.map((r: any) => <tr key={r.request_no + r.seq}><td>{r.request_no} <span className="mute">#{r.seq}</span></td><td>{r.company_name}</td><td>{r.payee_name}</td><td>{status(r.workflow_state)}</td><td>{dstr(r.due_date)}</td><td className="n">{etb(r.amount)}</td><td>{r.account_label ?? "—"}</td></tr>)}
            {d.rows.length === 0 && <tr><td colSpan={7} className="mute">Nothing is waiting.</td></tr>}</tbody></table></div>
      </>)}

      {tab === "payments" && (<>
        <form className="card form" action="/reports"><input type="hidden" name="r" value="payments" /><label className="f">From<input type="date" name="from" defaultValue={from} /></label><label className="f">To<input type="date" name="to" defaultValue={to} /></label><button>Show</button>
          <a className="btn sec" href={`/reports/export/payments?from=${from}&to=${to}`}>Download CSV</a></form>
        <h2>Authenticated payments: {etb(sum(d.rows))} <span className="mute">({d.rows.length})</span></h2>
        <div className="card scroll"><table><thead><tr><th>Authenticated</th><th>Status</th><th>Method</th><th>Request</th><th>Company</th><th>Payee</th><th>Debit account</th><th className="n">Amount</th><th>Verified by</th><th>Authenticated by</th></tr></thead>
          <tbody>{d.rows.map((r: any) => <tr key={r.request_no}><td>{dtime(r.authenticated_at)}</td><td>{STATE_LABEL[r.workflow_state]}</td><td>{PAYMENT_METHODS[r.payment_method]}</td><td>{r.request_no}</td><td>{r.company_name}</td><td>{r.payee_name}</td><td>{r.account_label ?? "—"}</td><td className="n">{etb(r.amount)}</td><td>{r.verified_by}</td><td>{r.authenticated_by}</td></tr>)}
            {d.rows.length === 0 && <tr><td colSpan={10} className="mute">No payments in this period.</td></tr>}</tbody></table></div>
      </>)}

      {tab === "cash" && (<>
        <h2>Cash and commitments</h2>
        <div className="card scroll"><table><thead><tr><th>Account</th><th className="n">Current</th><th className="n">Reserved</th><th className="n">Available</th><th className="n">Falls due in 30 days</th><th>Balance updated</th></tr></thead>
          <tbody>{d.rows.map((a: any) => <tr key={a.account_label}><td><b>{a.account_label}</b><div className="mute">{accountPlace(a)}</div><ShortfallChip amount={a.shortfall_amount} /></td><td className="n">{etb(a.current_balance)}</td><td className="n">{etb(a.reserved_balance)}</td><td className="n"><b>{etb(a.available_balance)}</b></td><td className="n">{etb(a.due_30_days)}</td><td>{a.balance_updated_at ? dtime(a.balance_updated_at) : "No balance entered"}</td></tr>)}
            <tr><td><b>Total</b></td><td className="n"><b>{etb(sum(d.rows, "current_balance"))}</b></td><td className="n"><b>{etb(sum(d.rows, "reserved_balance"))}</b></td><td className="n"><b>{etb(sum(d.rows, "available_balance"))}</b></td><td className="n"><b>{etb(sum(d.rows, "due_30_days"))}</b></td><td></td></tr></tbody></table></div>
        <p className="mute">Funds for these commitments are already reserved, so Available (after each account's minimum buffer) is what can still be committed to new requests.</p>
      </>)}

      {tab === "audit" && (<>
        <form className="card form" action="/reports"><input type="hidden" name="r" value="audit" /><label className="f">Action contains<input name="q" defaultValue={q ?? ""} placeholder="e.g. BALANCE" /></label><button>Filter</button><a className="btn sec" href="/reports/export/audit">Download CSV</a></form>
        <div className="card scroll"><table><thead><tr><th>When</th><th>Who</th><th>Company</th><th>What</th><th></th></tr></thead>
          <tbody>{d.rows.map((e: any, i: number) => <tr key={i}><td>{dtime(e.occurred_at)}</td><td>{e.actor ?? ""}</td><td>{e.company ?? ""}</td><td>{String(e.action).replace(/_/g, " ").toLowerCase()}</td><td className="mute">{e.metadata ? JSON.stringify(e.metadata) : ""}</td></tr>)}</tbody></table></div>
      </>)}
    </>
  );
}
