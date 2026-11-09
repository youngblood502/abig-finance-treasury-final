import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { dtime, etb, PAYMENT_METHODS } from "@/lib/format";
import { VERSION_STATUS, type PaymentLine } from "@/lib/payee-screens";

/** Suppliers and people are two lists of one thing. Each tab appears only for those who may open it. */
export function PayeeTabs({ active, suppliers, people }: { active: "suppliers" | "people"; suppliers: boolean; people: boolean }) {
  const tab = (key: "suppliers" | "people", href: string, label: string) => (
    <Button asChild size="sm" variant={active === key ? "default" : "outline"}><Link href={href} aria-current={active === key ? "page" : undefined}>{label}</Link></Button>
  );
  return <nav aria-label="Payees" className="mb-3 flex gap-2">{suppliers && tab("suppliers", "/suppliers", "Suppliers")}{people && tab("people", "/payees", "People")}</nav>;
}

export const Section = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="mt-4"><h3 className="m-0 mb-2 text-base">{title}</h3>{children}</section>;

/** label is plain text for dialogs; display, when given, is what the list shows instead (for example the account number with its eye button). */
export interface VersionItem { id: string; version: number; label: string; display?: React.ReactNode; status: string; created_by: string; rejection_reason: string | null }
/**
 * Every version of a payee's payment details. A second person must verify each one: it is offered to those who may, never to whoever entered it, and the database checks both.
 */
export function VersionList({ versions, canVerify, userId, verify, reject }: { versions: VersionItem[]; canVerify: boolean; userId: string; verify: (f: FormData) => Promise<void>; reject: (f: FormData) => Promise<void> }) {
  if (versions.length === 0) return <p className="m-0 text-sm text-muted-foreground">No payment details yet.</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {versions.map((v) => (
        <li key={v.id} className="rounded-md border bg-background p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><span><b>Version {v.version}</b> {v.display ?? v.label}</span><Badge variant={v.status === "VERIFIED" ? "default" : v.status === "PENDING" ? "warning" : "outline"}>{VERSION_STATUS[v.status] ?? v.status}</Badge></div>
          {v.rejection_reason && <p className="m-0 mt-1 text-muted-foreground">Rejected: {v.rejection_reason}</p>}
          {v.status === "PENDING" && v.created_by === userId && <p className="m-0 mt-1 text-muted-foreground">Someone else must verify this.</p>}
          {v.status === "PENDING" && v.created_by !== userId && canVerify && (
            <div className="mt-2 flex flex-wrap gap-2">
              <ConfirmDialog title={`Verify version ${v.version}?`} description={`${v.label}. Payments can go to these details once verified.`} confirmLabel="Verify" cancelLabel="Not yet" action={verify} fields={{ id: v.id }} trigger={<Button size="sm">Verify</Button>} />
              <ConfirmDialog title={`Reject version ${v.version}?`} description={v.label} confirmLabel="Reject" cancelLabel="Keep it waiting" destructive action={reject} fields={{ id: v.id }} trigger={<Button size="sm" variant="outline">Reject</Button>}>
                <label className="f">Reason<textarea name="reason" rows={2} required /></label>
              </ConfirmDialog>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The latest payments to a payee, from the person's own companies only. */
export function PaymentHistory({ lines }: { lines: PaymentLine[] }) {
  if (lines.length === 0) return <p className="m-0 text-sm text-muted-foreground">No payments from your companies.</p>;
  return (
    <>
      <ul className="m-0 list-none p-0">
        {lines.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm first:border-t-0">
            <span><Link href={`/requests/${p.id}`}>{p.request_no}</Link> <span className="text-muted-foreground">{p.company}, {dtime(p.created_at)}</span></span>
            <span className="flex items-center gap-2"><span className="tabular-nums">{etb(p.total_amount)}</span><StatusBadge state={p.workflow_state} /></span>
          </li>
        ))}
      </ul>
      {lines.length >= 10 && <p className="m-0 mt-2 text-xs text-muted-foreground">The latest 10 payments.</p>}
    </>
  );
}

export const MethodList = ({ methods }: { methods: string[] }) => <>{methods.map((m) => PAYMENT_METHODS[m]).join(", ")}</>;
