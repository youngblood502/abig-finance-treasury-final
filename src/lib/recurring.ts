import type { Tx } from "./db";

// Recurring payments: templates kept by a company's Accountants, from which the worker creates a Draft on each occurrence date.
// Row-level security shows templates to people with recurring_payment:view in the company; every change goes through recurring_template_save and
// recurring_template_set_active, which check recurring_payment:manage in the database. A generated Draft, like any Draft, is visible only to its creator.

export const FREQUENCIES: Record<string, string> = { WEEKLY: "Every week", MONTHLY: "Every month", QUARTERLY: "Every three months", YEARLY: "Every year" };

export interface RecurringTemplate {
  id: string; company_id: string; company: string; created_by: string; creator: string | null; name: string; payee_type: string; supplier_id: string | null; person_payee_id: string | null;
  payee: string | null; debit_account_id: string; account_label: string | null; payment_method: string; amount: string; amount_is_estimate: boolean; frequency: string;
  next_date: string; end_date: string | null; due_days: number; priority: string; description: string | null; is_active: boolean; last_generated_on: string | null;
  last_error: string | null; last_error_at: Date | null; ended: boolean;
}
export interface GeneratedRequest { id: string; request_no: string; recurring_template_id: string; recurring_occurrence: string; workflow_state: string; total_amount: string; amount_is_estimate: boolean; amount_confirmed_at: Date | null }

export const templateList = async (tx: Tx, company: string | null) => {
  const templates = await tx.q<RecurringTemplate>(
    `SELECT t.id, t.company_id, c.legal_name AS company, t.created_by, u.full_name AS creator, t.name, t.payee_type::text AS payee_type, t.supplier_id, t.person_payee_id,
            COALESCE(s.legal_name, p.full_name) AS payee, t.debit_account_id, a.account_label, t.payment_method::text AS payment_method, t.amount, t.amount_is_estimate, t.frequency,
            t.next_date, t.end_date, t.due_days, t.priority, t.description, t.is_active, t.last_generated_on, t.last_error, t.last_error_at,
            (t.end_date IS NOT NULL AND t.next_date > t.end_date) AS ended
       FROM recurring_payment_templates t JOIN companies c ON c.id = t.company_id LEFT JOIN users u ON u.id = t.created_by
       LEFT JOIN suppliers s ON s.id = t.supplier_id LEFT JOIN person_payees p ON p.id = t.person_payee_id LEFT JOIN company_bank_accounts a ON a.id = t.debit_account_id
      WHERE $1::uuid IS NULL OR t.company_id = $1 ORDER BY t.is_active DESC, t.next_date, t.name`, [company]);
  // The Drafts and requests generated from them that this person may see (a Draft only by its creator).
  const generated = templates.length === 0 ? [] : await tx.q<GeneratedRequest>(
    `SELECT id, request_no, recurring_template_id, recurring_occurrence, workflow_state::text AS workflow_state, total_amount, amount_is_estimate, amount_confirmed_at
       FROM payment_requests WHERE recurring_template_id = ANY($1::uuid[]) ORDER BY recurring_occurrence DESC`, [templates.map((t) => t.id)]);
  return templates.map((t) => ({ ...t, generated: generated.filter((g) => g.recurring_template_id === t.id) }));
};
/** What the template's state means for the next run, in words. */
export const templateStatus = (t: Pick<RecurringTemplate, "is_active" | "ended" | "last_error">) =>
  !t.is_active ? "Inactive" : t.ended ? "Ended" : t.last_error ? "Needs attention" : "Active";
