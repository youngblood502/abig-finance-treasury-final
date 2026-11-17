import { addReconciliationLine, matchPayment, removeReconciliationLine } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { SubmitButton } from "@/components/ui/submit-button";
import { dstr, etb, PAYMENT_METHODS } from "@/lib/format";
import { carriedIn, isZero, type ReconLine, type ReconPayment } from "@/lib/reconciliation";
import { cn } from "@/lib/utils";

const Line = ({ label, value }: { label: string; value: React.ReactNode }) => <div className="flex justify-between gap-3 py-0.5 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="m-0 tabular-nums">{value}</dd></div>;

/** A remaining difference in large type, with the sum behind it. */
export function DifferenceCard({ title, value, zeroText, otherText, lines, note }: { title: string; value: string | null; zeroText: string; otherText: string; lines: { label: string; value: string | null }[]; note?: string | null }) {
  const zero = isZero(value);
  return (
    <section className="rounded-xl border bg-card p-4" aria-label={title}>
      <h2 className="m-0 text-sm font-semibold text-muted-foreground">{title}</h2>
      <p className={cn("m-0 mt-1 text-3xl font-semibold tabular-nums", !zero && "text-destructive")}>{etb(value)}</p>
      <p className="m-0 mb-2 text-sm text-muted-foreground">{zero ? zeroText : otherText}</p>
      <dl className="m-0 border-t pt-2">{lines.map((l) => <Line key={l.label} label={l.label} value={etb(l.value)} />)}</dl>
      {note && <p className="m-0 mt-2 text-sm">Explanation: {note}</p>}
    </section>
  );
}

function PaymentIdentity({ p, weekStart }: { p: ReconPayment; weekStart: string }) {
  const carried = carriedIn(p.authenticated_at, weekStart);
  return (
    <div className="min-w-0 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><span><b>{p.request_no}</b> <span className="text-muted-foreground">{p.company}</span></span><span className="font-semibold tabular-nums">{etb(p.amount)}</span></div>
      <div className="text-xs text-muted-foreground">{p.payee ?? "Payee not shown"} · {PAYMENT_METHODS[p.method]}{p.cheque_no ? ` ${p.cheque_no}` : ""}{p.bank_reference ? ` · ${p.bank_reference}` : ""}</div>
      {(carried || p.overdue) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {carried && <Badge variant="outline">{p.carried_from ? `Carried from week of ${dstr(p.carried_from)}` : "Carried from an earlier week"}</Badge>}
          {p.overdue && <Badge variant="destructive">Outstanding {p.age_days} days</Badge>}
        </div>
      )}
      {p.carried_reason && <div className="mt-1 text-xs text-muted-foreground">Last week&apos;s reason: {p.carried_reason}</div>}
    </div>
  );
}

const Column = ({ title, summary, empty, children }: { title: string; summary: string; empty: string; children: React.ReactNode[] }) => (
  <section className="rounded-xl border bg-card p-4" aria-label={title}>
    <h3 className="m-0 text-base">{title}</h3><p className="m-0 mb-2 text-sm text-muted-foreground">{summary}</p>
    {children.length === 0 ? <p className="m-0 text-sm text-muted-foreground">{empty}</p> : <ul className="m-0 flex list-none flex-col gap-2 p-0">{children}</ul>}
  </section>
);
const count = (n: number, total: number) => `${n} payment${n === 1 ? "" : "s"}, ${etb(total)}`;

export interface PaymentColumnsProps { week: string; weekStart: string; matched: ReconPayment[]; outstanding: ReconPayment[]; matchedTotal: number; outstandingTotal: number; prepare: boolean; statementDate: string; locked: boolean }

/** System payments beside the statement: what is still outstanding, and what has been found on it. */
export function PaymentColumns({ week, weekStart, matched, outstanding, matchedTotal, outstandingTotal, prepare, statementDate, locked }: PaymentColumnsProps) {
  return (
    <div className="mb-3 grid gap-3 lg:grid-cols-2">
      <Column title={locked ? "Carried to the next week" : "Outstanding payments"} summary={count(outstanding.length, outstandingTotal)} empty="No payments are outstanding.">
        {outstanding.map((p) => (
          <li key={p.id} className="rounded-md border bg-background p-3">
            <PaymentIdentity p={p} weekStart={weekStart} />
            {p.carry_reason && <div className="mt-1 text-sm">Carrying over: {p.carry_reason}</div>}
            {prepare && (
              <form action={matchPayment} className="mt-2 flex flex-wrap items-end gap-2">
                <input type="hidden" name="week" value={week} /><input type="hidden" name="id" value={p.id} />
                <label className="f">Statement date<input name="date" type="date" defaultValue={statementDate} required /></label>
                <label className="f">Reference<input name="reference" /></label>
                <SubmitButton size="sm">Match</SubmitButton>
              </form>
            )}
          </li>
        ))}
      </Column>
      <Column title="On the statement" summary={count(matched.length, matchedTotal)} empty="Nothing has been matched yet.">
        {matched.map((p) => (
          <li key={p.id} className="rounded-md border bg-background p-3">
            <PaymentIdentity p={p} weekStart={weekStart} />
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{dstr(p.statement_date)}{p.reference ? ` · ${p.reference}` : ""}</span>
              {prepare && (
                <ConfirmDialog title={`Remove the match on ${p.request_no}?`} description="The payment goes back to outstanding. The removal stays on the record." confirmLabel="Remove match" cancelLabel="Keep it"
                  action={removeReconciliationLine} fields={{ week, line: p.line_id! }} trigger={<Button variant="outline" size="sm">Remove</Button>}>
                  <label className="f">Reason<textarea name="reason" rows={2} required minLength={3} /></label>
                </ConfirmDialog>
              )}
            </div>
          </li>
        ))}
      </Column>
    </div>
  );
}

const LINE_COLUMNS: DataColumn[] = [
  { key: "kind", header: "Type", primary: true }, { key: "reason", header: "Reason" }, { key: "date", header: "Date" }, { key: "amount", header: "Effect on the balance", align: "right" }, { key: "counted", header: "Counted as" }, { key: "action", header: "" },
];

/** Bank charges and other statement items. Only the account's owner reads these. */
export function OtherLines({ week, lines, prepare }: { week: string; lines: ReconLine[]; prepare: boolean }) {
  const rows: DataRow[] = lines.map((l) => ({
    id: l.id, sort: { amount: Number(l.amount) },
    cells: {
      kind: l.kind === "BANK_CHARGE" ? "Bank charge" : "Other item", reason: <>{l.reason}{l.reference ? ` (${l.reference})` : ""}</>, date: l.statement_date ? dstr(l.statement_date) : "", amount: etb(l.amount),
      counted: l.already_in_balance ? "Already picked up by a check" : "Adjusts the balance at the lock",
      action: prepare ? (
        <ConfirmDialog title="Remove this line?" description={`${l.reason}, ${etb(l.amount)}. The removal stays on the record.`} confirmLabel="Remove line" cancelLabel="Keep it" action={removeReconciliationLine} fields={{ week, line: l.id }} trigger={<Button variant="outline" size="sm">Remove</Button>}>
          <label className="f">Reason<textarea name="reason" rows={2} required minLength={3} /></label>
        </ConfirmDialog>
      ) : "",
    },
  }));
  return (
    <section className="mb-3 rounded-xl border bg-card p-4">
      <h2 className="mt-0">Bank charges and other items</h2>
      <DataTable caption="Bank charges and other items" columns={LINE_COLUMNS} rows={rows} pageSize={20} emptyMessage="No bank charges or other items." />
      {prepare && (
        <form action={addReconciliationLine} className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2">
          <input type="hidden" name="week" value={week} />
          <label className="f">Type<select name="kind" defaultValue="BANK_CHARGE"><option value="BANK_CHARGE">Bank charge</option><option value="OTHER">Other item</option></select></label>
          <label className="f">Amount (a charge is positive; on other items, minus takes money out)<input name="amount" type="number" step="0.01" required /></label>
          <label className="f sm:col-span-2">Reason<input name="reason" required minLength={3} /></label>
          <label className="f">Date<input name="date" type="date" /></label>
          <label className="f">Reference<input name="reference" /></label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="known" />A balance check already picked this up</label>
          <div className="sm:col-span-2"><SubmitButton variant="outline">Add line</SubmitButton></div>
        </form>
      )}
    </section>
  );
}
