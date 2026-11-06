import { workflowAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { etb } from "@/lib/format";
import { authenticateEffect } from "@/lib/requests";
import type { ApprovalStage } from "@/lib/workflow";

export interface ReviewTarget { id: string; requestNo: string; version: number; amount: string; current: string | null; reserved: string | null }

const Reason = ({ label }: { label: string }) => <label className="f">{label}<textarea name="reason" rows={3} required minLength={3} /></label>;

/**
 * The verifier's and the authenticator's decisions. `stage` comes from app_actionable_requests(), so a person only ever sees the step that is theirs.
 * `back` returns them to the queue they came from. wf_verify, wf_authorize, wf_return and wf_reject check everything again.
 */
export function ReviewActions({ target: t, stage, back }: { target: ReviewTarget; stage: ApprovalStage; back?: "approvals" }) {
  const fields = (action: string) => ({ id: t.id, version: String(t.version), action, ...(back ? { back } : {}) });
  return (
    <div className="flex flex-wrap gap-2">
      {stage === "VERIFICATION" && (
        <ConfirmDialog title={`Verify ${t.requestNo}?`} description="It moves on to an Owner to authenticate. The funds stay reserved and no money moves." confirmLabel="Verify"
          effect={[{ label: "Amount", value: etb(t.amount) }]} action={workflowAction} fields={fields("verify")} trigger={<Button>Verify</Button>} />
      )}
      {stage === "AUTHORIZATION" && (
        <ConfirmDialog title={`Authenticate ${t.requestNo}?`} description="This debits the account and releases the reservation. It can no longer be cancelled, and it stays Authenticated until reconciliation finds it on the bank statement." confirmLabel="Authenticate"
          effect={[{ label: "Amount", value: etb(t.amount) }, ...(t.current !== null && t.reserved !== null ? authenticateEffect(t.current, t.reserved, t.amount) : [])]} action={workflowAction} fields={fields("authorize")} trigger={<Button>Authenticate</Button>} />
      )}
      <ConfirmDialog title={`Return ${t.requestNo}?`} description="It goes back to its creator as a draft, and the reserved funds are released." confirmLabel="Return for correction" action={workflowAction} fields={fields("return")} trigger={<Button variant="outline">Return for correction</Button>}>
        <Reason label="What needs correcting" />
      </ConfirmDialog>
      {stage === "AUTHORIZATION" && (
        <ConfirmDialog title={`Reject ${t.requestNo}?`} description="This is final, and the reserved funds are released." confirmLabel="Reject" destructive action={workflowAction} fields={fields("reject")} trigger={<Button variant="destructive">Reject</Button>}>
          <Reason label="Why it is rejected" />
        </ConfirmDialog>
      )}
    </div>
  );
}
