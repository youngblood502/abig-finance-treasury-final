import { withUser } from "./db";
import { translate, WorkflowError } from "./errors";
export { WorkflowError };

export type WorkflowAction = "submit" | "verify" | "authorize" | "return" | "reject" | "cancel" | "adjust";
export interface WorkflowInput { version?: number; reason?: string; changes?: Record<string, unknown> }

/**
 * The three-tier workflow. Accountant: DRAFT -> RESERVED (submit). Finance Manager: RESERVED -> VERIFIED (verify).
 * Owner: VERIFIED -> AUTHENTICATED (authorize), which debits the account and releases the reserved funds.
 * `stage` is the name the database uses in app_actionable_requests() and in the approval history.
 */
export const APPROVAL_STAGES = {
  VERIFICATION: { action: "verify", label: "Verify", permission: "payment_request:verify", state: "RESERVED", title: "Waiting for verification", role: "Finance Manager" },
  AUTHORIZATION: { action: "authorize", label: "Authenticate", permission: "payment_request:authenticate", state: "VERIFIED", title: "Waiting for authentication", role: "Owner" },
} as const;
export type ApprovalStage = keyof typeof APPROVAL_STAGES;

// The rules live in the database (wf_* functions). This layer only calls them and translates their errors.
export async function runWorkflow(userId: string, requestId: string, action: WorkflowAction, input: WorkflowInput = {}): Promise<number> {
  const { version = 0, reason = "", changes = {} } = input;
  const sql: Record<WorkflowAction, [string, unknown[]]> = {
    submit: ["SELECT wf_submit($1) AS v", [requestId]],
    verify: ["SELECT wf_verify($1,$2) AS v", [requestId, version]],
    authorize: ["SELECT wf_authorize($1,$2) AS v", [requestId, version]],
    return: ["SELECT wf_return($1,$2,$3) AS v", [requestId, version, reason]],
    reject: ["SELECT wf_reject($1,$2,$3) AS v", [requestId, version, reason]],
    cancel: ["SELECT wf_cancel($1,$2,$3) AS v", [requestId, version, reason]],
    adjust: ["SELECT wf_adjust($1,$2,$3::jsonb,$4) AS v", [requestId, version, JSON.stringify(changes), reason]],
  };
  try { return (await withUser(userId, (tx) => tx.q<{ v: number }>(...sql[action])))[0].v; } catch (e) { return translate(e); }
}
