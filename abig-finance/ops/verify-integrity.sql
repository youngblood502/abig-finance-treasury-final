-- Money and access integrity checks. Every row returned with violations above zero needs investigation.
-- Run as the owner role; used by the restore drill and safe to run any time.
\set ON_ERROR_STOP on
WITH checks AS (
  SELECT 'request total differs from its installments' AS name, count(*) AS violations FROM (
    SELECT r.id FROM payment_requests r JOIN payment_installments i ON i.request_id = r.id WHERE r.workflow_state <> 'DRAFT' GROUP BY r.id, r.total_amount HAVING sum(i.amount) <> r.total_amount) x
  -- Balances: reserved_balance must equal the amount held by requests that are RESERVED or VERIFIED on that account.
  UNION ALL SELECT 'account whose reserved balance differs from its reserved and verified requests', count(*) FROM company_bank_accounts a
    WHERE a.reserved_balance <> COALESCE((SELECT sum(r.total_amount) FROM payment_requests r WHERE r.debit_account_id = a.id AND r.workflow_state IN ('RESERVED','VERIFIED')), 0)
  UNION ALL SELECT 'account where reserved funds exceed the current balance', count(*) FROM company_bank_accounts a WHERE a.reserved_balance > a.current_balance
  UNION ALL SELECT 'account whose available balance is not current minus reserved', count(*) FROM company_bank_accounts a WHERE a.available_balance <> a.current_balance - a.reserved_balance
  UNION ALL SELECT 'account whose last history entry differs from its current balance', count(*) FROM company_bank_accounts a
    WHERE EXISTS (SELECT 1 FROM bank_balance_history h WHERE h.account_id = a.id) AND a.current_balance <> (SELECT h.new_balance FROM bank_balance_history h WHERE h.account_id = a.id ORDER BY h.updated_at DESC, h.id DESC LIMIT 1)
  UNION ALL SELECT 'bank account without exactly one owner company', count(*) FROM company_bank_accounts a
    WHERE (SELECT count(*) FROM company_bank_account_access g WHERE g.account_id = a.id AND g.is_owner AND g.revoked_at IS NULL) <> 1
  -- Workflow.
  UNION ALL SELECT 'authenticated request not debited exactly once', count(*) FROM payment_requests r
    WHERE r.workflow_state = 'AUTHENTICATED' AND r.authenticated_at IS NOT NULL AND r.debit_account_id IS NOT NULL
      AND (SELECT count(*) FROM bank_balance_history h WHERE h.request_id = r.id AND h.previous_balance - h.new_balance = r.total_amount) <> 1
  UNION ALL SELECT 'verified or authenticated request without its approvers recorded', count(*) FROM payment_requests r
    WHERE (r.workflow_state IN ('VERIFIED','AUTHENTICATED') AND r.verified_by IS NULL) OR (r.workflow_state = 'AUTHENTICATED' AND r.authenticated_by IS NULL)
  UNION ALL SELECT 'authenticated request without an authentication record', count(*) FROM payment_requests r
    WHERE r.workflow_state = 'AUTHENTICATED' AND NOT EXISTS (SELECT 1 FROM approval_events a WHERE a.request_id = r.id AND a.action = 'AUTHORIZE')
  UNION ALL SELECT 'separation of duties broken (creator, verifier and authenticator are not three different people)', count(*) FROM payment_requests r
    WHERE r.verified_by = r.created_by OR r.authenticated_by = r.created_by OR r.verified_by = r.authenticated_by
  UNION ALL SELECT 'request past draft without a debit account', count(*) FROM payment_requests r WHERE r.workflow_state NOT IN ('DRAFT','SCHEDULED','REJECTED') AND r.debit_account_id IS NULL
  UNION ALL SELECT 'request debiting an account its company is not linked to', count(*) FROM payment_requests r
    WHERE r.debit_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM company_bank_account_access g WHERE g.account_id = r.debit_account_id AND g.company_id = r.debtor_company_id AND 'USE' = ANY(g.permissions))
  UNION ALL SELECT 'submitted request without a current invoice file', count(*) FROM payment_requests r
    WHERE r.workflow_state IN ('RESERVED','VERIFIED','AUTHENTICATED') AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.request_id = r.id AND a.kind = 'INVOICE' AND NOT EXISTS (SELECT 1 FROM attachments b WHERE b.supersedes_id = a.id))
  UNION ALL SELECT 'supplier with more than one verified bank detail', count(*) FROM (SELECT supplier_id FROM supplier_bank_details WHERE status = 'VERIFIED' GROUP BY supplier_id HAVING count(*) > 1) x
  -- Access.
  UNION ALL SELECT 'person holding a company-limited role in more companies than the role allows', count(*) FROM (
    SELECT cm.user_id, mr.role_id FROM membership_roles mr JOIN company_memberships cm ON cm.id = mr.membership_id AND cm.revoked_at IS NULL JOIN roles r ON r.id = mr.role_id
     WHERE r.max_companies IS NOT NULL GROUP BY cm.user_id, mr.role_id, r.max_companies HAVING count(DISTINCT cm.company_id) > r.max_companies) x
  UNION ALL SELECT 'role holding a permission it may never hold', count(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
    WHERE p.code IN ('user:manage','company:manage') OR (r.code = 'ACCOUNTANT' AND p.code IN ('payment_request:verify','payment_request:authenticate','payment_request:reject','approval:view'))
       OR (r.code = 'FINANCE_MANAGER' AND p.code = 'payment_request:authenticate')
)
SELECT name, violations FROM checks ORDER BY violations DESC, name;
