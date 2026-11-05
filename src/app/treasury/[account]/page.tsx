import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, ShortfallChip } from "@/components";
import { recordFigure, startReconciliation, undoTick } from "../../actions";
import { ANOMALIES, dstr, dtime, ENTRY_KINDS, etb, PAYMENT_METHODS, WEEK_STATUS } from "@/lib/format";
import { withUser } from "@/lib/db";
import { requireAccess } from "@/lib/rbac";
import { currentUserId, requireMe } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TreasuryAccount({ params, searchParams }: { params: Promise<{ account: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { account } = await params; const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/treasury");
  if (!UUID.test(account)) notFound();
  const d = await withUser(uid, async (tx) => ({
    status: (await tx.q<any>("SELECT * FROM account_week_status() WHERE account_id = $1", [account]))[0],
    account: (await tx.q<any>("SELECT account_kind::text AS account_kind, current_balance, reserved_balance, shortfall_amount FROM company_bank_accounts WHERE id = $1", [account]))[0],
    payments: await tx.q<any>("SELECT * FROM outstanding_payments($1)", [account]),
    log: await tx.q<any>("SELECT * FROM account_balance_history($1, 50)", [account]),
    weeks: await tx.q<any>("SELECT id, week_start, status::text AS status, opening_entry_id FROM treasury_weeks WHERE account_id = $1 ORDER BY week_start DESC LIMIT 12", [account]),
  }));
  if (!d.status || !d.account) notFound();
  const s = d.status, opening = !s.has_opening, kind = d.account.account_kind;
  const waiting = d.payments.filter((p: any) => !p.processed_at), ticked = d.payments.filter((p: any) => p.processed_at && p.method !== "CASH");
  const place = kind === "CASH" ? "Cash counted" : kind === "WALLET" ? "Amount in the wallet" : "Amount the bank shows";
  return (
    <>
      <p className="mute"><Link href="/treasury">Weekly treasury</Link></p>
      <h1>{s.account_label}</h1><p className="sub">Week of {dstr(s.week_start)}. System balance {etb(d.account.current_balance)}, reserved {etb(d.account.reserved_balance)}.</p><Flash sp={sp} />
      <ShortfallChip amount={d.account.shortfall_amount} />
      {s.can_check && (
        <form action={recordFigure} className="card"><h2 style={{ marginTop: 0 }}>{opening ? "Opening balance for this week" : "Balance check"}</h2>
          <input type="hidden" name="account" value={account} /><input type="hidden" name="opening" value={opening ? "1" : "0"} />
          <label className="f">{place} (ETB)<input name="figure" type="number" step="0.01" min="0" required /></label>
          {waiting.length > 0 && <div className="scroll"><p className="mute">Tick the payments the bank has processed. The rest are subtracted from the figure.</p>
            <table><thead><tr><th>Processed</th><th>Payment</th><th>Company</th><th>Payee</th><th>Method</th><th className="n">Amount</th></tr></thead>
              <tbody>{waiting.map((p: any) => (
                <tr key={p.id}><td><input type="hidden" name="shown" value={p.id} /><input type="checkbox" name="processed" value={p.id} defaultChecked={p.default_processed} aria-label={`${p.request_no} processed`} /></td>
                  <td>{p.request_no}{p.carried && <span className="chip o">Carried over</span>}{p.overdue && <span className="chip b">{p.age_days} days</span>}</td><td>{p.company}</td><td>{p.payee}</td><td>{PAYMENT_METHODS[p.method]}{p.cheque_no ? ` ${p.cheque_no}` : ""}</td><td className="n">{etb(p.amount)}</td></tr>))}</tbody></table></div>}
          <button style={{ marginTop: 10 }}>{opening ? "Record opening balance" : "Save balance check"}</button>
        </form>)}
      {!s.can_check && waiting.length > 0 && <div className="card scroll"><h2 style={{ marginTop: 0 }}>Outstanding payments</h2><table><tbody>{waiting.map((p: any) => (
        <tr key={p.id}><td>{p.request_no}{p.overdue && <span className="chip b">{p.age_days} days</span>}</td><td>{p.company}</td><td>{PAYMENT_METHODS[p.method]}</td><td className="n">{etb(p.amount)}</td></tr>))}</tbody></table></div>}
      {s.can_check && ticked.length > 0 && <div className="card scroll"><h2 style={{ marginTop: 0 }}>Ticked as processed, not yet on a statement</h2><table><tbody>{ticked.map((p: any) => (
        <tr key={p.id}><td>{p.request_no}</td><td>{p.company}</td><td className="n">{etb(p.amount)}</td><td><form action={undoTick} className="inline"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="account" value={account} /><input name="reason" placeholder="Reason" aria-label="Reason to undo" required /><button className="sec">Undo tick</button></form></td></tr>))}</tbody></table></div>}

      <h2>Weeks</h2>
      <div className="card scroll"><table><tbody>{d.weeks.map((w: any) => (
        <tr key={w.id}><td>{dstr(w.week_start)}</td><td>{w.status === "OPEN" ? WEEK_STATUS.OPEN : <Link href={`/treasury/week/${w.id}`}>{WEEK_STATUS[w.status]}</Link>}</td>
          <td>{w.status === "OPEN" && w.opening_entry_id && s.can_prepare && (
            <form action={startReconciliation} className="inline"><input type="hidden" name="account" value={account} /><input type="hidden" name="week" value={dstr(w.week_start)} />
              <label className="f">Statement closing balance<input name="closing" type="number" step="0.01" min="0" required /></label><label className="f">Statement deposits<input name="deposits" type="number" step="0.01" min="0" required /></label><button>Start reconciliation</button></form>)}</td></tr>))}</tbody></table>
        {d.weeks.length === 0 && <p className="mute">No weeks yet.</p>}</div>

      <h2>Balance log</h2>
      <div className="card scroll"><table><thead><tr><th>When</th><th>Entry</th><th className="n">Bank figure</th><th className="n">Not yet processed</th><th className="n">Previous</th><th className="n">System balance</th><th className="n">Implied deposit</th><th>By</th></tr></thead>
        <tbody>{d.log.map((h: any) => (
          <tr key={h.id}><td>{dtime(h.updated_at)}</td><td>{h.request_no ? `Payment ${h.request_no}` : ENTRY_KINDS[h.entry_kind]}{h.anomalies.map((x: string) => <span className="chip w" key={x}>{ANOMALIES[x]}</span>)}</td>
            <td className="n">{h.bank_figure === null ? "" : etb(h.bank_figure)}</td><td className="n">{h.outstanding_total === null ? "" : etb(h.outstanding_total)}</td><td className="n">{etb(h.previous_balance)}</td><td className="n">{etb(h.new_balance)}</td><td className="n">{h.implied_deposit === null ? "" : etb(h.implied_deposit)}</td><td>{h.updated_by_name}</td></tr>))}</tbody></table></div>
    </>
  );
}
