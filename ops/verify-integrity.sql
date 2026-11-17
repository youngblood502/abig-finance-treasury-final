-- Money and access integrity checks. Every row returned with violations above zero needs investigation.
-- Run as the owner role; used by the restore drill and safe to run any time.
\set ON_ERROR_STOP on
WITH checks AS (
  SELECT 'request total differs from its installments' AS name, count(*) AS violations FROM (
    SELECT r.id FROM payment_requests r JOIN payment_installments i ON i.request_id = r.id WHERE r.workflow_state <> 'DRAFT' GROUP BY r.id, r.total_amount HAVING sum(i.amount) <> r.total_amount) x
  -- Balances: reserved_balance must equal the amount held by requests that are RESERVED or VERIFIED on that account.
  UNION ALL SELECT 'account whose reserved balance differs from its reserved and verified requests', count(*) FROM company_bank_accounts a
    WHERE a.reserved_balance <> COALESCE((SELECT sum(r.total_amount) FROM payment_requests r WHERE r.debit_account_id = a.id AND r.workflow_state IN ('RESERVED','VERIFIED')), 0)
  -- A balance below the reserved funds is a shortfall: allowed and shown on the account, so it is not a violation. Its amount must still be right.
  UNION ALL SELECT 'account whose shortfall is not reserved minus current', count(*) FROM company_bank_accounts a WHERE a.shortfall_amount <> GREATEST(a.reserved_balance - a.current_balance, 0)
  UNION ALL SELECT 'account whose available balance is not current minus reserved minus buffer', count(*) FROM company_bank_accounts a WHERE a.available_balance <> a.current_balance - a.reserved_balance - a.min_buffer
  UNION ALL SELECT 'account whose last history entry differs from its current balance', count(*) FROM company_bank_accounts a
    WHERE EXISTS (SELECT 1 FROM bank_balance_history h WHERE h.account_id = a.id) AND a.current_balance <> (SELECT h.new_balance FROM bank_balance_history h WHERE h.account_id = a.id ORDER BY h.updated_at DESC, h.id DESC LIMIT 1)
  UNION ALL SELECT 'bank account without exactly one owner company', count(*) FROM company_bank_accounts a
    WHERE (SELECT count(*) FROM company_bank_account_access g WHERE g.account_id = a.id AND g.is_owner AND g.revoked_at IS NULL) <> 1
  -- Balance log and weeks.
  UNION ALL SELECT 'balance check whose system balance is not the bank figure minus the outstanding payments', count(*) FROM bank_balance_history h
    WHERE h.entry_kind IN ('OPENING','CHECK') AND h.week_id IS NOT NULL AND h.new_balance <> h.bank_figure - h.outstanding_total
  UNION ALL SELECT 'balance check whose implied deposit is not the change in system balance', count(*) FROM bank_balance_history h
    WHERE h.entry_kind = 'CHECK' AND h.week_id IS NOT NULL AND h.implied_deposit IS DISTINCT FROM h.new_balance - h.previous_balance
  UNION ALL SELECT 'balance log entry from after the weekly cycle began without a week', count(*) FROM bank_balance_history h
    WHERE h.week_id IS NULL AND EXISTS (SELECT 1 FROM bank_balance_history x WHERE x.account_id = h.account_id AND x.week_id IS NOT NULL AND x.updated_at < h.updated_at)
  UNION ALL SELECT 'week with more than one opening balance, or an opening entry from another week', count(*) FROM treasury_weeks w
    WHERE (SELECT count(*) FROM bank_balance_history h WHERE h.week_id = w.id AND h.entry_kind = 'OPENING') > 1
       OR (w.opening_entry_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bank_balance_history h WHERE h.id = w.opening_entry_id AND h.week_id = w.id AND h.entry_kind = 'OPENING'))
  UNION ALL SELECT 'locked week with a difference left unexplained, or locked by its preparer', count(*) FROM treasury_weeks w
    WHERE w.status = 'LOCKED' AND (w.balance_difference <> 0 OR w.locked_by = w.prepared_by OR (w.deposit_difference <> 0 AND btrim(coalesce(w.deposit_explanation, '')) = ''))
  UNION ALL SELECT 'locked week with a later week locked before an earlier one', count(*) FROM treasury_weeks w JOIN treasury_weeks e ON e.account_id = w.account_id AND e.week_start < w.week_start AND e.opening_entry_id IS NOT NULL
    WHERE w.status = 'LOCKED' AND (e.status <> 'LOCKED' OR e.locked_at > w.locked_at)
  UNION ALL SELECT 'paid payment without a matched line in a locked week', count(*) FROM payment_requests r
    WHERE r.workflow_state = 'PAID' AND NOT EXISTS (SELECT 1 FROM reconciliation_lines l JOIN treasury_weeks w ON w.id = l.week_id WHERE l.request_id = r.id AND l.kind = 'PAYMENT' AND l.voided_at IS NULL AND w.status = 'LOCKED' AND w.id = r.reconciliation_id)
      AND NOT EXISTS (SELECT 1 FROM audit_events e WHERE e.entity_id = r.id AND e.action = 'PAYMENT_MARKED_PAID_AT_GO_LIVE')
  UNION ALL SELECT 'matched line in a locked week whose payment is not paid', count(*) FROM reconciliation_lines l JOIN treasury_weeks w ON w.id = l.week_id JOIN payment_requests r ON r.id = l.request_id
    WHERE w.status = 'LOCKED' AND l.kind = 'PAYMENT' AND l.voided_at IS NULL AND (r.workflow_state <> 'PAID' OR r.reconciliation_id IS DISTINCT FROM w.id)
  UNION ALL SELECT 'matched or carried line that disagrees with its payment''s amount or company', count(*) FROM reconciliation_lines l JOIN payment_requests r ON r.id = l.request_id
    WHERE l.amount <> r.total_amount OR l.company_id <> r.debtor_company_id OR l.account_id <> r.debit_account_id
  UNION ALL SELECT 'payment still outstanding in a locked week with no carry-over reason', count(*) FROM treasury_weeks w JOIN bank_balance_history h ON h.week_id = w.id AND h.entry_kind = 'PAYMENT' JOIN payment_requests r ON r.id = h.request_id
    WHERE w.status = 'LOCKED' AND r.workflow_state = 'AUTHENTICATED' AND NOT EXISTS (SELECT 1 FROM reconciliation_lines l WHERE l.request_id = r.id AND l.week_id = w.id AND l.kind = 'CARRY' AND l.voided_at IS NULL)
  -- Workflow.
  UNION ALL SELECT 'authenticated request not debited exactly once', count(*) FROM payment_requests r
    WHERE r.workflow_state IN ('AUTHENTICATED','PAID') AND r.authenticated_at IS NOT NULL AND r.debit_account_id IS NOT NULL
      AND (SELECT count(*) FROM bank_balance_history h WHERE h.request_id = r.id AND h.previous_balance - h.new_balance = r.total_amount) <> 1
  UNION ALL SELECT 'verified or authenticated request without its approvers recorded', count(*) FROM payment_requests r
    WHERE (r.workflow_state IN ('VERIFIED','AUTHENTICATED','PAID') AND r.verified_by IS NULL) OR (r.workflow_state IN ('AUTHENTICATED','PAID') AND r.authenticated_by IS NULL)
  UNION ALL SELECT 'authenticated request without an authentication record', count(*) FROM payment_requests r
    WHERE r.workflow_state IN ('AUTHENTICATED','PAID') AND NOT EXISTS (SELECT 1 FROM approval_events a WHERE a.request_id = r.id AND a.action = 'AUTHORIZE')
  UNION ALL SELECT 'paid request without who and when, or never authenticated', count(*) FROM payment_requests r
    WHERE r.workflow_state = 'PAID' AND (r.paid_at IS NULL OR r.paid_by IS NULL OR r.authenticated_at IS NULL)
  UNION ALL SELECT 'cancelled request without a cancellation record', count(*) FROM payment_requests r
    WHERE r.workflow_state = 'CANCELLED' AND NOT EXISTS (SELECT 1 FROM approval_events a WHERE a.request_id = r.id AND a.action = 'CANCEL')
      AND NOT EXISTS (SELECT 1 FROM request_events e WHERE e.request_id = r.id AND e.to_state = 'CANCELLED' AND e.from_state IS DISTINCT FROM 'REJECTED')
  UNION ALL SELECT 'rejected request whose last decision was a cancellation', count(*) FROM payment_requests r
    WHERE r.workflow_state = 'REJECTED' AND (SELECT a.action FROM approval_events a WHERE a.request_id = r.id AND a.action IN ('REJECT','CANCEL') ORDER BY a.occurred_at DESC, a.id DESC LIMIT 1) = 'CANCEL'
  UNION ALL SELECT 'cheque number on a payment that is not a cheque', count(*) FROM payment_requests r WHERE r.cheque_no IS NOT NULL AND r.payment_method <> 'CHEQUE'
  UNION ALL SELECT 'separation of duties broken (creator, verifier and authenticator are not three different people)', count(*) FROM payment_requests r
    WHERE r.verified_by = r.created_by OR r.authenticated_by = r.created_by OR r.verified_by = r.authenticated_by
  UNION ALL SELECT 'request past draft without a debit account', count(*) FROM payment_requests r WHERE r.workflow_state NOT IN ('DRAFT','SCHEDULED','REJECTED','CANCELLED') AND r.debit_account_id IS NULL
  UNION ALL SELECT 'request debiting an account its company is not linked to', count(*) FROM payment_requests r
    WHERE r.debit_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM company_bank_account_access g WHERE g.account_id = r.debit_account_id AND g.company_id = r.debtor_company_id AND 'USE' = ANY(g.permissions))
  UNION ALL SELECT 'request without exactly one payee', count(*) FROM payment_requests r WHERE num_nonnulls(r.supplier_id, r.person_payee_id, r.one_time_payee_id) <> 1
  UNION ALL SELECT 'request paying a one-time payee from another company', count(*) FROM payment_requests r JOIN one_time_payees o ON o.id = r.one_time_payee_id WHERE o.company_id <> r.debtor_company_id
  UNION ALL SELECT 'request paying a person from another company', count(*) FROM payment_requests r JOIN person_payees p ON p.id = r.person_payee_id WHERE p.company_id <> r.debtor_company_id
  UNION ALL SELECT 'payment method that does not fit its account', count(*) FROM payment_requests r JOIN company_bank_accounts a ON a.id = r.debit_account_id
    WHERE r.workflow_state IN ('RESERVED','VERIFIED','AUTHENTICATED','PAID')
      AND NOT ((r.payment_method = 'CASH' AND a.account_kind = 'CASH') OR (r.payment_method = 'TELEBIRR' AND a.account_kind = 'WALLET') OR (r.payment_method IN ('TRANSFER','CHEQUE') AND a.account_kind = 'BANK'))
  UNION ALL SELECT 'authenticated cash payment not marked as processed', count(*) FROM payment_requests r
    WHERE r.payment_method = 'CASH' AND r.workflow_state IN ('AUTHENTICATED','PAID') AND r.bank_processed_at IS NULL
  UNION ALL SELECT 'supplier with more than one verified bank detail', count(*) FROM (SELECT supplier_id FROM supplier_bank_details WHERE status = 'VERIFIED' GROUP BY supplier_id HAVING count(*) > 1) x
  UNION ALL SELECT 'person with more than one verified detail of a kind', count(*) FROM (SELECT person_id FROM person_payment_details WHERE status = 'VERIFIED' GROUP BY person_id, kind HAVING count(*) > 1) x
  UNION ALL SELECT 'person payment details verified by the person who entered them', count(*) FROM person_payment_details d WHERE d.verified_by = d.created_by
  -- Access.
  UNION ALL SELECT 'application role can read the balance log or statement figures directly', (has_table_privilege('abig_app', 'bank_balance_history', 'SELECT')::int + has_column_privilege('abig_app', 'treasury_weeks', 'statement_closing_balance', 'SELECT')::int)::bigint
  UNION ALL SELECT 'application role can read or write encrypted account numbers directly', (has_column_privilege('abig_app', 'company_bank_accounts', 'account_number_enc', 'SELECT')::int
    + has_column_privilege('abig_app', 'supplier_bank_details', 'account_number_enc', 'SELECT')::int + has_column_privilege('abig_app', 'person_payment_details', 'account_number_enc', 'SELECT')::int
    + has_column_privilege('abig_app', 'company_bank_accounts', 'account_number_enc', 'INSERT,UPDATE')::int + has_column_privilege('abig_app', 'supplier_bank_details', 'account_number_enc', 'INSERT,UPDATE')::int
    + has_column_privilege('abig_app', 'person_payment_details', 'account_number_enc', 'INSERT,UPDATE')::int)::bigint
  UNION ALL SELECT 'application or worker role can read or write the email settings table directly', (coalesce(has_table_privilege('abig_app', to_regclass('email_settings'), 'SELECT,INSERT,UPDATE,DELETE'), false)::int
    + coalesce(has_table_privilege('abig_worker', to_regclass('email_settings'), 'SELECT,INSERT,UPDATE,DELETE'), false)::int)::bigint
  UNION ALL SELECT 'supplier bank details whose active status disagrees with their status history', count(*) FROM supplier_bank_details d
     WHERE d.is_active IS DISTINCT FROM COALESCE((SELECT e.action = 'REACTIVATED' FROM supplier_bank_detail_status_events e WHERE e.detail_id = d.id ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1), true)
  UNION ALL SELECT 'person holding a company-limited role in more companies than the role allows', count(*) FROM (
    SELECT cm.user_id, mr.role_id FROM membership_roles mr JOIN company_memberships cm ON cm.id = mr.membership_id AND cm.revoked_at IS NULL JOIN roles r ON r.id = mr.role_id
     WHERE r.max_companies IS NOT NULL GROUP BY cm.user_id, mr.role_id, r.max_companies HAVING count(DISTINCT cm.company_id) > r.max_companies) x
  UNION ALL SELECT 'role holding a permission it may never hold', count(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
    WHERE p.code IN ('user:manage','company:manage') OR (r.code = 'ACCOUNTANT' AND p.code IN ('payment_request:verify','payment_request:authenticate','payment_request:reject','approval:view'))
       OR (r.code = 'FINANCE_MANAGER' AND p.code IN ('payment_request:authenticate','reconciliation:prepare'))
       OR (r.code = 'ACCOUNTANT' AND p.code = 'reconciliation:lock')
)
SELECT name, violations FROM checks ORDER BY violations DESC, name;
