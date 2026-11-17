-- ABIG Finance - Shared-account privacy.
--
-- A shared account has one balance, but each payment on it belongs to one company. Until now the balance log was read at account level, so anyone who
-- could see the account also saw other companies' payment numbers, amounts and approver names. This changes who can read; it changes nothing that is stored,
-- and no balance, workflow step or reconciliation calculation.
--
--   FULL   finance staff of the company that owns the account, and administrators: they reconcile it, so they see everything.
--   TICK   others who may enter the account's balance: they must tick payments, so they see a payment's number, company, method and amount. Not who it pays.
--   NONE   everyone else who can see the account, including group reporting: the shared balance, and their own company's payments.
--
-- A company always sees its own payments in full. What cannot be hidden is the balance itself: anyone who sees it at two moments can work out the net change.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. One rule
-- ---------------------------------------------------------------------------------------------------------------------
-- app_permitted_companies follows memberships, so group reporting never reaches FULL through the owner company. Administrators get every company.
CREATE FUNCTION app_account_access(p_account uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT CASE
    WHEN account_owner_company(p_account) IN (SELECT app_permitted_companies('reconciliation:view') UNION SELECT app_permitted_companies('reconciliation:prepare') UNION SELECT app_permitted_companies('reconciliation:lock')) THEN 'FULL'
    WHEN app_can_snapshot(p_account) THEN 'TICK'
    ELSE 'NONE' END $$;
REVOKE EXECUTE ON FUNCTION app_account_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_account_access(uuid) TO abig_app;

-- A payment is visible to its own company and to those who work on the account. Reading the owner company is no longer enough.
CREATE OR REPLACE FUNCTION app_can_see_line(p_company uuid, p_account uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT p_company IN (SELECT app_readable_companies()) OR app_account_access(p_account) <> 'NONE' $$;

-- A reconciliation line holds statement references and reasons, so someone who only ticks does not read other companies' lines.
DROP POLICY reconciliation_lines_read ON reconciliation_lines;
CREATE POLICY reconciliation_lines_read ON reconciliation_lines FOR SELECT TO abig_app
  USING (company_id IN (SELECT app_readable_companies()) OR app_account_access(account_id) = 'FULL');

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. The balance log
-- ---------------------------------------------------------------------------------------------------------------------
-- account_balance_history() below is now the only way the application reads the log. Rows stay as they are, and row-level security stays on with no policy.
DROP POLICY balance_history_read ON bank_balance_history;
REVOKE SELECT ON bank_balance_history FROM abig_app;

-- Row by row: a viewer's own company's payments in full; at FULL, everything. At TICK, another company's payment loses the person's name.
-- At NONE, another company's payment is left out, and every other entry shows only when it happened, what it was and the balance after it:
-- a bank figure next to a balance would give away the outstanding total.
CREATE OR REPLACE FUNCTION account_balance_history(p_account uuid, p_limit int DEFAULT 10)
RETURNS TABLE (id uuid, updated_at timestamptz, previous_balance numeric, new_balance numeric, updated_by uuid, updated_by_name text, request_no text, entry_kind text, bank_figure numeric, outstanding_total numeric, implied_deposit numeric, anomalies text[], week_start date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH viewer AS (SELECT app_account_access(p_account) AS level),
  log AS (
    SELECT h.*, r.request_no AS number, h.request_id IS NOT NULL AS is_payment,
           COALESCE(r.debtor_company_id IN (SELECT app_readable_companies()), false) AS own_payment
      FROM bank_balance_history h LEFT JOIN payment_requests r ON r.id = h.request_id
     WHERE h.account_id = p_account AND app_can_see_account(p_account))
  SELECT l.id, l.updated_at,
         CASE WHEN v.level <> 'NONE' OR l.own_payment THEN l.previous_balance END,
         l.new_balance,
         CASE WHEN v.level = 'FULL' OR l.own_payment OR (v.level = 'TICK' AND NOT l.is_payment) THEN l.updated_by END,
         CASE WHEN v.level = 'FULL' OR l.own_payment OR (v.level = 'TICK' AND NOT l.is_payment) THEN u.full_name END,
         l.number, l.entry_kind::text,
         CASE WHEN v.level <> 'NONE' THEN l.bank_figure END,
         CASE WHEN v.level <> 'NONE' THEN l.outstanding_total END,
         CASE WHEN v.level <> 'NONE' THEN l.implied_deposit END,
         CASE WHEN v.level <> 'NONE' THEN l.anomalies ELSE '{}'::text[] END,
         t.week_start
    FROM log l CROSS JOIN viewer v JOIN users u ON u.id = l.updated_by LEFT JOIN treasury_weeks t ON t.id = l.week_id
   WHERE v.level <> 'NONE' OR l.own_payment OR NOT l.is_payment
   ORDER BY l.updated_at DESC, l.id DESC LIMIT LEAST(GREATEST(p_limit, 1), 100) $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Payments and reconciliation
-- ---------------------------------------------------------------------------------------------------------------------
-- Everything a viewer needs to tick stays. The payee and the payment's references are for its own company and the owner's finance staff.
CREATE OR REPLACE FUNCTION outstanding_payments(p_account uuid) RETURNS TABLE (id uuid, request_no text, company_id uuid, company text, payee text, method text, amount numeric, cheque_no text, bank_reference text,
    authenticated_at timestamptz, processed_at timestamptz, age_days int, overdue boolean, carried boolean, default_processed boolean)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id, r.request_no, r.debtor_company_id, c.legal_name,
         CASE WHEN d.detail THEN COALESCE(s.legal_name, p.full_name) END, r.payment_method::text, r.total_amount,
         CASE WHEN d.detail THEN r.cheque_no END, CASE WHEN d.detail THEN r.bank_reference END, r.authenticated_at, r.bank_processed_at,
         a.age, a.age >= 14,
         COALESCE((SELECT t.week_start FROM bank_balance_history h JOIN treasury_weeks t ON t.id = h.week_id WHERE h.request_id = r.id), '-infinity') < week_monday(addis_day(treasury_now())),
         r.payment_method IN ('TRANSFER','TELEBIRR')
    FROM payment_requests r JOIN companies c ON c.id = r.debtor_company_id LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN person_payees p ON p.id = r.person_payee_id
         CROSS JOIN LATERAL (SELECT GREATEST(addis_day(treasury_now()) - addis_day(r.authenticated_at), 0) AS age) a
         CROSS JOIN LATERAL (SELECT app_account_access(p_account) = 'FULL' OR r.debtor_company_id IN (SELECT app_readable_companies()) AS detail) d
   WHERE r.debit_account_id = p_account AND r.workflow_state = 'AUTHENTICATED' AND app_can_see_account(p_account) AND app_can_see_line(r.debtor_company_id, p_account)
   ORDER BY r.authenticated_at, r.id $$;

-- Below FULL, a week shows only its identity and status. Statement figures and totals can give away a single payment.
CREATE OR REPLACE FUNCTION reconciliation_summary(p_week uuid) RETURNS TABLE (week_id uuid, account_id uuid, account_label text, week_start date, status text, revision int, closing numeric, deposits numeric, deposit_explanation text, return_reason text,
    prepared_by uuid, prepared_by_name text, prepared_at timestamptz, locked_by_name text, locked_at timestamptz, system_balance numeric, unmatched_total numeric, implied_total numeric, adjust_total numeric, known_total numeric, balance_difference numeric, deposit_difference numeric,
    can_prepare boolean, can_review boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w treasury_weeks; f record; a company_bank_accounts;
BEGIN
  SELECT * INTO w FROM treasury_weeks x WHERE x.id = p_week;
  IF NOT FOUND OR NOT app_can_see_account(w.account_id) THEN RETURN; END IF;
  SELECT * INTO a FROM company_bank_accounts x WHERE x.id = w.account_id;
  IF app_account_access(w.account_id) <> 'FULL' THEN
    RETURN QUERY SELECT w.id, w.account_id, a.account_label, w.week_start, w.status::text, w.revision, NULL::numeric, NULL::numeric, NULL::text, NULL::text, NULL::uuid, NULL::text, NULL::timestamptz, NULL::text, NULL::timestamptz,
      NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, false, false;
    RETURN;
  END IF;
  SELECT * INTO f FROM recon_figures(w);
  RETURN QUERY SELECT w.id, w.account_id, a.account_label, w.week_start, w.status::text, w.revision, w.statement_closing_balance, w.statement_deposits_total, w.deposit_explanation, w.return_reason,
    w.prepared_by, (SELECT u.full_name FROM users u WHERE u.id = w.prepared_by), w.prepared_at, (SELECT u.full_name FROM users u WHERE u.id = w.locked_by), w.locked_at,
    COALESCE(w.system_balance, f.system_balance), COALESCE(w.unmatched_total, f.unmatched_total), COALESCE(w.implied_deposits_total, f.implied_total), COALESCE(w.adjustments_total, f.adjust_total), f.known_total,
    COALESCE(w.balance_difference, f.balance_difference), COALESCE(w.deposit_difference, f.deposit_difference),
    app_has_permission(account_owner_company(w.account_id), 'reconciliation:prepare'), app_has_permission(account_owner_company(w.account_id), 'reconciliation:lock');
END $$;

CREATE OR REPLACE FUNCTION reconciliation_payments(p_week uuid) RETURNS TABLE (id uuid, request_no text, company text, payee text, method text, amount numeric, cheque_no text, bank_reference text, authenticated_at timestamptz,
    age_days int, overdue boolean, line_id uuid, statement_date date, reference text, carry_reason text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w treasury_weeks; everything boolean;
BEGIN
  SELECT * INTO w FROM treasury_weeks x WHERE x.id = p_week;
  IF NOT FOUND OR NOT app_can_see_account(w.account_id) THEN RETURN; END IF;
  everything := app_account_access(w.account_id) = 'FULL';
  RETURN QUERY
  SELECT r.id, r.request_no, c.legal_name,
         CASE WHEN d.detail THEN COALESCE(s.legal_name, p.full_name) END, r.payment_method::text, r.total_amount,
         CASE WHEN d.detail THEN r.cheque_no END, CASE WHEN d.detail THEN r.bank_reference END, r.authenticated_at,
         GREATEST(addis_day(treasury_now()) - addis_day(r.authenticated_at), 0), addis_day(treasury_now()) - addis_day(r.authenticated_at) >= 14 AND r.workflow_state = 'AUTHENTICATED',
         m.id, m.statement_date, CASE WHEN d.detail THEN m.reference END, CASE WHEN d.detail THEN cr.reason END
    FROM payment_requests r JOIN companies c ON c.id = r.debtor_company_id LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN person_payees p ON p.id = r.person_payee_id
         LEFT JOIN reconciliation_lines m ON m.request_id = r.id AND m.week_id = p_week AND m.kind = 'PAYMENT' AND m.voided_at IS NULL
         LEFT JOIN reconciliation_lines cr ON cr.request_id = r.id AND cr.week_id = p_week AND cr.kind = 'CARRY' AND cr.voided_at IS NULL
         CROSS JOIN LATERAL (SELECT everything OR r.debtor_company_id IN (SELECT app_readable_companies()) AS detail) d
   WHERE app_can_see_line(r.debtor_company_id, w.account_id)
     AND (m.id IS NOT NULL OR cr.id IS NOT NULL OR (w.status <> 'LOCKED' AND r.id IN (SELECT y.id FROM recon_candidates(w) y)))
   ORDER BY r.authenticated_at, r.id;
END $$;

-- Sharers still see that a week exists and its status. The statement and its figures come only through reconciliation_summary().
REVOKE SELECT ON treasury_weeks FROM abig_app;
GRANT SELECT (id, account_id, week_start, status, opening_entry_id) ON treasury_weeks TO abig_app;
