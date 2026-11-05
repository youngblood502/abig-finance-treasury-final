import type { Tx } from "./db";

// One place for the report queries, used by the Reports page and the CSV export. They read through row-level security,
// so every person gets only the companies and accounts they may see.
export const REPORT_TABS: [string, string][] = [["pending", "Waiting for payment"], ["payments", "Authenticated payments"], ["cash", "Cash and commitments"], ["audit", "Audit trail"]];
export const BUCKETS = ["Not yet due", "1-30 days overdue", "31-60 days overdue", "Over 60 days overdue"];

/** Requests that have reserved funds and are not yet authenticated, one row per instalment. */
export const pendingRows = (tx: Tx) => tx.q<any>(
  `SELECT r.request_no, c.legal_name AS company_name, COALESCE(s.legal_name, p.full_name) AS payee_name, r.workflow_state::text AS workflow_state, r.priority, i.seq, i.due_date, i.amount,
          da.account_label AS account_label,
          CASE WHEN i.due_date >= current_date THEN 'Not yet due' WHEN current_date - i.due_date <= 30 THEN '1-30 days overdue' WHEN current_date - i.due_date <= 60 THEN '31-60 days overdue' ELSE 'Over 60 days overdue' END AS bucket
     FROM payment_requests r JOIN payment_installments i ON i.request_id = r.id JOIN companies c ON c.id = r.debtor_company_id LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN person_payees p ON p.id = r.person_payee_id
     LEFT JOIN company_bank_accounts da ON da.id = r.debit_account_id
    WHERE r.workflow_state IN ('RESERVED', 'VERIFIED') ORDER BY i.due_date, r.request_no, i.seq`);

/** Authenticated and Paid requests: the account was debited. Authenticated ones are not yet confirmed by the bank. */
export const paymentRows = (tx: Tx, from: string, to: string) => tx.q<any>(
  `SELECT r.authenticated_at, r.request_no, c.legal_name AS company_name, COALESCE(s.legal_name, p.full_name) AS payee_name, da.account_label AS account_label, r.total_amount AS amount, r.workflow_state::text AS workflow_state, r.payment_method::text AS payment_method,
          vu.full_name AS verified_by, au.full_name AS authenticated_by
     FROM payment_requests r JOIN companies c ON c.id = r.debtor_company_id LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN person_payees p ON p.id = r.person_payee_id
     LEFT JOIN company_bank_accounts da ON da.id = r.debit_account_id LEFT JOIN users vu ON vu.id = r.verified_by LEFT JOIN users au ON au.id = r.authenticated_by
    WHERE r.workflow_state IN ('AUTHENTICATED', 'PAID') AND r.authenticated_at >= $1::date AND r.authenticated_at < $2::date + 1 ORDER BY r.authenticated_at DESC`, [from, to]);

/** Per account: the three balances and what falls due in the next 30 days on requests that hold funds. */
export const cashRows = (tx: Tx) => tx.q<any>(
  `SELECT a.account_label, a.account_kind::text AS account_kind, a.wallet_phone, b.name AS bank_name, a.account_last4, a.current_balance, a.reserved_balance, a.available_balance, a.shortfall_amount, a.min_buffer, a.balance_updated_at,
          COALESCE((SELECT sum(i.amount) FROM payment_requests r JOIN payment_installments i ON i.request_id = r.id
                     WHERE r.debit_account_id = a.id AND r.workflow_state IN ('RESERVED', 'VERIFIED') AND i.due_date <= current_date + 30), 0) AS due_30_days
     FROM company_bank_accounts a LEFT JOIN banks b ON b.id = a.bank_id WHERE a.is_active ORDER BY a.account_label`);

export const auditRows = (tx: Tx, q: string | null, limit = 200) => tx.q<any>(
  `SELECT e.occurred_at, u.full_name AS actor, c.legal_name AS company, e.action, e.entity_type, e.entity_id, e.metadata
     FROM audit_events e LEFT JOIN users u ON u.id = e.actor_id LEFT JOIN companies c ON c.id = e.company_id
    WHERE ($1::text IS NULL OR e.action ILIKE '%' || $1 || '%') ORDER BY e.occurred_at DESC LIMIT ${Math.min(limit, 5000)}`, [q]);
