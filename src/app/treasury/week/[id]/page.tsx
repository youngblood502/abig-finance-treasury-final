import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components";
import { addReconciliationLine, lockWeek, matchPayment, removeReconciliationLine, returnReconciliation, startReconciliation, submitReconciliation } from "../../../actions";
import { addisDate, dstr, dtime, etb, PAYMENT_METHODS, WEEK_STATUS } from "@/lib/format";
import { withUser } from "@/lib/db";
import { requireAccess } from "@/lib/rbac";
import { currentUserId, requireMe } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Reconciliation({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params; const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/treasury");
  if (!UUID.test(id)) notFound();
  const d = await withUser(uid, async (tx) => ({
    w: (await tx.q<any>("SELECT * FROM reconciliation_summary($1)", [id]))[0],
    payments: await tx.q<any>("SELECT * FROM reconciliation_payments($1)", [id]),
    lines: await tx.q<any>("SELECT id, kind::text AS kind, statement_date, reference, amount, already_in_balance, reason FROM reconciliation_lines WHERE week_id = $1 AND kind IN ('BANK_CHARGE','OTHER') AND voided_at IS NULL ORDER BY created_at", [id]),
  }));
  if (!d.w) notFound();
  const w = d.w, locked = w.status === "LOCKED", sent = !!w.prepared_at;
  const editing = !locked && !sent && w.can_prepare && w.status === "RECONCILING";
  const reviewing = !locked && sent && w.can_review && w.prepared_by !== me.id;
  const unmatched = d.payments.filter((p: any) => !p.line_id);
  const weekField = <input type="hidden" name="week" value={id} />;
  return (
    <>
      <p className="mute"><Link href={`/treasury/${w.account_id}`}>{w.account_label}</Link></p>
      <h1>Reconciliation, week of {dstr(w.week_start)}</h1>
      <p className="sub">{WEEK_STATUS[w.status]}{sent && !locked ? `, sent for review by ${w.prepared_by_name} on ${dtime(w.prepared_at)}` : ""}{locked ? ` by ${w.locked_by_name} on ${dtime(w.locked_at)}` : ""}.</p><Flash sp={sp} />
      {w.return_reason && <div className="card"><span className="chip w">Returned</span> {w.return_reason}</div>}
      <div className="figs">
        <div className="card"><b>{etb(w.closing)}</b><span>Statement closing balance</span></div>
        <div className="card"><b>{etb(w.unmatched_total)}</b><span>Unmatched payments</span></div>
        <div className="card"><b>{etb(w.system_balance)}</b><span>System balance at the end of the week</span></div>
        <div className="card"><b>{etb(w.adjust_total)}</b><span>Items that adjust the balance</span></div>
        <div className="card"><b>{etb(w.balance_difference)}</b><span>Balance difference (must be zero)</span></div>
      </div>
      <div className="figs">
        <div className="card"><b>{etb(w.deposits)}</b><span>Statement deposits</span></div>
        <div className="card"><b>{etb(w.implied_total)}</b><span>Implied deposits this week</span></div>
        <div className="card"><b>{etb(w.known_total)}</b><span>Items a check already picked up</span></div>
        <div className="card"><b>{etb(w.deposit_difference)}</b><span>Deposit difference{w.deposit_explanation ? `: ${w.deposit_explanation}` : " (zero, or explained)"}</span></div>
      </div>
      {editing && <form action={startReconciliation} className="card form"><input type="hidden" name="account" value={w.account_id} /><input type="hidden" name="week" value={dstr(w.week_start)} />
        <label className="f">Statement closing balance<input name="closing" type="number" step="0.01" min="0" defaultValue={Number(w.closing)} required /></label>
        <label className="f">Statement deposits<input name="deposits" type="number" step="0.01" min="0" defaultValue={Number(w.deposits)} required /></label><button className="sec">Correct the statement figures</button></form>}

      <h2>Payments</h2>
      <div className="card scroll"><table><thead><tr><th>Payment</th><th>Company</th><th>Payee</th><th>Method</th><th className="n">Amount</th><th>On the statement</th></tr></thead>
        <tbody>{d.payments.map((p: any) => (
          <tr key={p.id}><td>{p.request_no}{p.overdue && <span className="chip b">{p.age_days} days</span>}</td><td>{p.company}</td><td>{p.payee}</td><td>{PAYMENT_METHODS[p.method]}{p.cheque_no ? ` ${p.cheque_no}` : ""}{p.bank_reference ? ` ${p.bank_reference}` : ""}</td><td className="n">{etb(p.amount)}</td>
            <td>{p.line_id ? <>{dstr(p.statement_date)} {p.reference}{editing && <form action={removeReconciliationLine} className="inline">{weekField}<input type="hidden" name="line" value={p.line_id} /><input name="reason" placeholder="Reason" aria-label="Reason to remove" required /><button className="sec">Remove</button></form>}</>
              : editing ? <form action={matchPayment} className="inline">{weekField}<input type="hidden" name="id" value={p.id} /><input name="date" type="date" defaultValue={addisDate()} aria-label="Statement date" required /><input name="reference" placeholder="Reference" aria-label="Statement reference" /><button>Match</button></form>
              : p.carry_reason ?? "Not matched"}</td></tr>))}</tbody></table>
        {d.payments.length === 0 && <p className="mute">No payments in this week.</p>}</div>

      <h2>Bank charges and other items</h2>
      <div className="card scroll">{d.lines.length === 0 && <p className="mute">None.</p>}
        <table><tbody>{d.lines.map((l: any) => (
          <tr key={l.id}><td>{l.kind === "BANK_CHARGE" ? "Bank charge" : "Other"}</td><td>{l.reason}{l.reference ? ` (${l.reference})` : ""}</td><td>{l.statement_date ? dstr(l.statement_date) : ""}</td><td className="n">{etb(l.amount)}</td><td>{l.already_in_balance ? "Already picked up by a check" : "Adjusts the balance"}</td>
            <td>{editing && <form action={removeReconciliationLine} className="inline">{weekField}<input type="hidden" name="line" value={l.id} /><input name="reason" placeholder="Reason" aria-label="Reason to remove" required /><button className="sec">Remove</button></form>}</td></tr>))}</tbody></table>
        {editing && <form action={addReconciliationLine} className="form" style={{ marginTop: 10 }}>{weekField}
          <label className="f">Type<select name="kind"><option value="BANK_CHARGE">Bank charge</option><option value="OTHER">Other item</option></select></label>
          <label className="f">Amount (a charge is positive; for other items, minus takes money out)<input name="amount" type="number" step="0.01" required /></label>
          <label className="f">Reason<input name="reason" required /></label><label className="f">Date<input name="date" type="date" /></label><label className="f">Reference<input name="reference" /></label>
          <label className="f">Already seen<span className="inline"><input type="checkbox" name="known" />A balance check already picked this up</span></label><button>Add line</button></form>}</div>

      {editing && <form action={submitReconciliation} className="card"><h2 style={{ marginTop: 0 }}>Send for review</h2>{weekField}<input type="hidden" name="revision" value={w.revision} />
        {unmatched.map((p: any) => <label className="f" key={p.id}><input type="hidden" name="carry" value={p.id} />Why is {p.request_no} ({p.company}, {etb(p.amount)}) carrying over?<input name={`reason_${p.id}`} required /></label>)}
        {Number(w.deposit_difference) !== 0 && <label className="f">Explain the deposit difference<input name="explanation" required /></label>}
        <button style={{ marginTop: 10 }}>Send to the Finance Manager</button></form>}

      {reviewing && <div className="card"><h2 style={{ marginTop: 0 }}>Review</h2>
        <form action={lockWeek}>{weekField}<input type="hidden" name="revision" value={w.revision} /><button>Lock this week</button></form>
        <form action={returnReconciliation} className="inline" style={{ marginTop: 10 }}>{weekField}<input name="reason" placeholder="What needs changing" aria-label="Reason to return" required /><button className="sec">Return to the Accountant</button></form></div>}
      {locked && <p className="mute">This week is locked and cannot be changed. A correction is a new line in the next week.</p>}
    </>
  );
}
