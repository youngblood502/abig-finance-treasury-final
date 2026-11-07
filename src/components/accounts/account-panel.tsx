import Link from "next/link";
import { grantAccess, revokeAccess, setAccountPolicy, setDepositAlert } from "@/app/actions";
import { BalanceLog } from "@/components/treasury/balance-log";
import { AmountInput } from "@/components/ui/amount-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SidePanel } from "@/components/ui/side-panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { accountPlace, dtime, etb } from "@/lib/format";
import { ACCESS_LABEL, type AccountRow, type AccountUser } from "@/lib/treasury-screens";

const Line = ({ label, value }: { label: string; value: React.ReactNode }) => <div className="flex justify-between gap-3 py-0.5 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="m-0 text-right tabular-nums">{value}</dd></div>;
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="mt-4"><h3 className="m-0 mb-2 text-base">{title}</h3>{children}</section>;
const canDo = (u: AccountUser) => (u.permissions.includes("RECORD_SNAPSHOT") ? "Can pay from it and enter its balance" : "Can pay from it");

/** One account beside the list. Everything in it was decided by the database for this person, and settings appear only for the owner's managers. */
export function AccountPanel({ a, openWeek, companies }: { a: AccountRow; openWeek: boolean; companies: { id: string; legal_name: string }[] }) {
  const canGrant = companies.filter((c) => !a.users.some((u) => u.company_id === c.id));
  return (
    <SidePanel title={a.account_label} description={accountPlace(a)} trigger={<Button variant="outline" size="sm">Details</Button>}>
      <dl className="m-0 mt-3">
        <Line label="Current balance" value={etb(a.current_balance)} />
        <Line label="Reserved" value={etb(a.reserved_balance)} />
        <Line label="Available" value={etb(a.available_balance)} />
        <Line label="Minimum buffer" value={etb(a.min_buffer)} />
        <Line label="Last updated" value={a.balance_updated_at ? dtime(a.balance_updated_at) : "No balance yet"} />
        <Line label="Your access" value={ACCESS_LABEL[a.access]} />
      </dl>
      {a.users.length > 1 && <p className="m-0 mt-2 text-sm text-muted-foreground">These are the account&apos;s figures, shared by every company on it.</p>}
      {openWeek && a.is_active && <p className="m-0 mt-2 text-sm"><Link href={`/treasury/${a.id}`}>{a.can_update ? "Enter a balance check" : "Open this account's week"}</Link></p>}

      <Section title="Ownership and access">
        <p className="m-0 mb-2 text-sm">Legal owner: <b>{a.owner ?? "None"}</b></p>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {a.users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-3 text-sm">
              <span><b>{u.name}</b>{u.is_owner && <Badge variant="outline" className="ml-2">Owner</Badge>}<span className="block text-xs text-muted-foreground">{canDo(u)}</span></span>
              {a.can_manage && !u.is_owner && (
                <ConfirmDialog title={`Withdraw ${u.name}'s access?`} description={`${u.name} will no longer see this account or pay from it. Its past payments stay on the record. This is refused while its requests hold funds here: they must be finished or cancelled first.`} confirmLabel="Withdraw access" cancelLabel="Keep access" destructive
                  action={revokeAccess} fields={{ id: u.id }} trigger={<Button variant="outline" size="sm">Withdraw</Button>} />
              )}
            </li>
          ))}
        </ul>
        <p className="m-0 mt-2 text-xs text-muted-foreground">Each payment belongs to the company that requested it. Owning the account or having access to it does not make a company responsible for another company&apos;s payment.</p>
      </Section>

      <Section title="Balance log"><BalanceLog entries={a.history} access={a.access} pageSize={10} limit={25} /></Section>

      {a.can_manage && (
        <Section title="Settings">
          <div className="flex flex-col gap-3">
            <form action={setAccountPolicy} className="flex flex-wrap items-end gap-2"><input type="hidden" name="account" value={a.id} /><AmountInput name="buffer" label="Minimum buffer to keep" defaultValue={Number(a.min_buffer)} /><SubmitButton variant="outline" size="sm">Save buffer</SubmitButton></form>
            <form action={setDepositAlert} className="flex flex-wrap items-end gap-2"><input type="hidden" name="account" value={a.id} /><AmountInput name="threshold" label="Flag an implied deposit above" defaultValue={Number(a.large_deposit_threshold)} required /><SubmitButton variant="outline" size="sm">Save limit</SubmitButton></form>
            {canGrant.length > 0 && (
              <form action={grantAccess} className="flex flex-col gap-2 border-t pt-3"><input type="hidden" name="account" value={a.id} />
                <label className="f">Give access to<select name="company">{canGrant.map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}</select></label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="snapshot" />May also enter the balance</label>
                <div><SubmitButton variant="outline" size="sm">Grant access</SubmitButton></div>
              </form>
            )}
          </div>
        </Section>
      )}
    </SidePanel>
  );
}
