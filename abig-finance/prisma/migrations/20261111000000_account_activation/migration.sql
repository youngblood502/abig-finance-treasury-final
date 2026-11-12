-- ABIG Finance - Deactivating and reactivating accounts (bank accounts, Telebirr wallets and cash).
--
-- A bank or provider can suspend an account without warning, so deactivation is never refused because of what is outstanding on it.
-- Deactivating changes the account's status and nothing else:
--   * No request, installment, reservation, balance, week, line or audit entry is changed, cancelled, reversed or released.
--   * The figures stay as they were: the balance does not drop to zero and reserved funds stay reserved until a person decides.
--   * What is outstanding (reserved, verified, authenticated and unpaid, scheduled, recurring templates, reconciliations in progress) is listed by
--     account_commitments() and the Finance Managers of every company on the account are told (ACCOUNT_DEACTIVATED).
-- While the account is inactive, nothing new can use it. Each of these was already checked before taking the account lock; it is now also checked
-- under the lock, so a concurrent deactivation has either committed and is seen, or waits for the operation to finish:
--   * reserving funds (submission, scheduled release, a larger adjusted amount)          payment_request_funds_guard, account row FOR UPDATE
--   * verification and authentication (the debit)                                      payment_request_funds_guard, FOR SHARE / FOR UPDATE
--   * recording how an authenticated payment was sent (cheque number, bank reference)   record_execution, FOR SHARE
--   * balance checks                                                                    already refused: app_can_snapshot needs an active account
--   * new drafts, schedules and recurring templates naming it                           already refused by the existing account checks
-- Still allowed, because they release money or record what already happened: cancelling, returning or rejecting a request (which releases its
-- reservation as usual) and finishing a reconciliation that is already in progress. (Adjusting a request is refused, as before, because
-- assert_submittable already required an active account.)
-- Reactivating restores eligibility and nothing else. A scheduled request whose account was deactivated after it was scheduled is not submitted
-- automatically even after reactivation: its creator must schedule it again. Recurring templates only ever create drafts.
-- Both actions need bank_account:manage in the company that owns the account (app_can_manage_access), as for every other account setting.

-- ---------- 1. Status on the account, and its history ----------
CREATE TYPE account_deactivation_reason AS ENUM ('PROVIDER_SUSPENDED', 'COMPANY_DECISION', 'PERMANENTLY_CLOSED', 'OTHER');

ALTER TABLE company_bank_accounts
  ADD COLUMN deactivated_at timestamptz,
  ADD COLUMN deactivated_by uuid REFERENCES users(id),
  ADD COLUMN deactivation_reason account_deactivation_reason,
  ADD COLUMN deactivation_note text,
  -- An active account carries no deactivation details. (An account made inactive before this migration may have none: it shows "not recorded".)
  ADD CONSTRAINT company_bank_accounts_active_chk CHECK (NOT is_active OR (deactivated_at IS NULL AND deactivated_by IS NULL AND deactivation_reason IS NULL AND deactivation_note IS NULL)),
  ADD CONSTRAINT company_bank_accounts_other_reason_chk CHECK (deactivation_reason IS DISTINCT FROM 'OTHER' OR length(btrim(coalesce(deactivation_note, ''))) >= 3);
GRANT SELECT (deactivated_at, deactivated_by, deactivation_reason, deactivation_note) ON company_bank_accounts TO abig_app;

-- One row per change of status. Never changed or deleted.
CREATE TABLE account_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES company_bank_accounts(id),
  owner_company_id uuid REFERENCES companies(id),
  action text NOT NULL CHECK (action IN ('DEACTIVATED', 'REACTIVATED')),
  previous_active boolean NOT NULL,
  new_active boolean NOT NULL,
  reason account_deactivation_reason,
  note text,
  open_items jsonb NOT NULL DEFAULT '{}'::jsonb,   -- counts and totals of what was outstanding at that moment
  actor_id uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT account_status_events_shape_chk CHECK (
    (action = 'DEACTIVATED' AND previous_active AND NOT new_active AND reason IS NOT NULL)
    OR (action = 'REACTIVATED' AND NOT previous_active AND new_active))
);
CREATE INDEX account_status_events_account_idx ON account_status_events (account_id, occurred_at DESC);
CREATE TRIGGER account_status_events_no_change BEFORE UPDATE OR DELETE ON account_status_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER account_status_events_no_truncate BEFORE TRUNCATE ON account_status_events FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
ALTER TABLE account_status_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_status_events_read ON account_status_events FOR SELECT TO abig_app USING (app_can_see_account(account_id));
GRANT SELECT ON account_status_events TO abig_app;

CREATE FUNCTION account_deactivation_label(p account_deactivation_reason) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'PROVIDER_SUSPENDED' THEN 'The bank or provider deactivated or suspended the account'
                WHEN 'COMPANY_DECISION' THEN 'The company chose to stop using the account'
                WHEN 'PERMANENTLY_CLOSED' THEN 'The account is permanently closed'
                WHEN 'OTHER' THEN 'Other' END $$;

-- ---------- 2. What is outstanding on an account ----------
-- Requests that hold, used or will use the account; recurring templates that would create requests on it; reconciliations in progress.
-- Each person sees the items of companies they may read, or every item when they may see all the account's payments (app_can_see_line),
-- and no payee names: the same as the reconciliation screens.
CREATE FUNCTION account_commitments(p_account uuid) RETURNS TABLE (kind text, item_id uuid, label text, company text, state text, amount numeric, on_date date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_user_id() IS NULL OR NOT app_can_see_account(p_account) THEN RETURN; END IF;
  RETURN QUERY
  SELECT 'REQUEST'::text, r.id, r.request_no, c.legal_name, r.workflow_state::text, r.total_amount, r.scheduled_for
    FROM payment_requests r JOIN companies c ON c.id = r.debtor_company_id
   WHERE r.debit_account_id = p_account AND r.workflow_state IN ('SCHEDULED','RESERVED','VERIFIED','AUTHENTICATED') AND app_can_see_line(r.debtor_company_id, p_account)
  UNION ALL
  SELECT 'RECURRING', t.id, t.name, c.legal_name, 'ACTIVE', t.amount, t.next_date
    FROM recurring_payment_templates t JOIN companies c ON c.id = t.company_id
   WHERE t.debit_account_id = p_account AND t.is_active AND app_can_see_line(t.company_id, p_account)
  UNION ALL
  SELECT 'RECONCILIATION', w.id, 'Week of ' || to_char(w.week_start, 'DD Mon YYYY'), NULL::text, w.status::text, NULL::numeric, w.week_start
    FROM treasury_weeks w WHERE w.account_id = p_account AND w.status = 'RECONCILING'
  ORDER BY 1, 7 NULLS LAST, 3;
END $$;
REVOKE EXECUTE ON FUNCTION account_commitments(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_commitments(uuid) TO abig_app;

-- Counts and totals for the record, across every company: kept on the status event and in the audit entry. No request numbers or payees.
CREATE FUNCTION account_open_items(p_account uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'reserved_count', (SELECT count(*) FROM payment_requests WHERE debit_account_id = p_account AND workflow_state IN ('RESERVED','VERIFIED')),
    'reserved_total', (SELECT COALESCE(sum(total_amount), 0) FROM payment_requests WHERE debit_account_id = p_account AND workflow_state IN ('RESERVED','VERIFIED')),
    'unpaid_count', (SELECT count(*) FROM payment_requests WHERE debit_account_id = p_account AND workflow_state = 'AUTHENTICATED'),
    'unpaid_total', (SELECT COALESCE(sum(total_amount), 0) FROM payment_requests WHERE debit_account_id = p_account AND workflow_state = 'AUTHENTICATED'),
    'scheduled_count', (SELECT count(*) FROM payment_requests WHERE debit_account_id = p_account AND workflow_state = 'SCHEDULED'),
    'recurring_count', (SELECT count(*) FROM recurring_payment_templates WHERE debit_account_id = p_account AND is_active),
    'reconciling_count', (SELECT count(*) FROM treasury_weeks WHERE account_id = p_account AND status = 'RECONCILING'),
    'reserved_balance', (SELECT reserved_balance FROM company_bank_accounts WHERE id = p_account),
    'current_balance', (SELECT current_balance FROM company_bank_accounts WHERE id = p_account)) $$;
REVOKE EXECUTE ON FUNCTION account_open_items(uuid) FROM PUBLIC;

-- The status history with the names of who changed it.
CREATE FUNCTION account_status_history(p_account uuid) RETURNS TABLE (id uuid, action text, reason text, note text, actor_name text, occurred_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.id, e.action, e.reason::text, e.note, u.full_name, e.occurred_at
    FROM account_status_events e JOIN users u ON u.id = e.actor_id
   WHERE e.account_id = p_account AND app_user_id() IS NOT NULL AND app_can_see_account(p_account)
   ORDER BY e.occurred_at DESC, e.id $$;
REVOKE EXECUTE ON FUNCTION account_status_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_status_history(uuid) TO abig_app;

-- ---------- 3. Deactivating and reactivating ----------
CREATE FUNCTION deactivate_account(p_account uuid, p_reason text, p_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a company_bank_accounts; why account_deactivation_reason; n text := NULLIF(btrim(coalesce(p_note, '')), ''); items jsonb; me uuid := app_user_id(); owner_c uuid;
BEGIN
  IF me IS NULL OR NOT app_can_manage_access(p_account) THEN RAISE EXCEPTION 'only a manager of the company that owns this account can deactivate it' USING ERRCODE = '42501'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('PROVIDER_SUSPENDED','COMPANY_DECISION','PERMANENTLY_CLOSED','OTHER') THEN
    RAISE EXCEPTION 'choose why the account is being deactivated' USING ERRCODE = '23514';
  END IF;
  why := p_reason::account_deactivation_reason;
  IF why = 'OTHER' AND length(coalesce(n, '')) < 3 THEN RAISE EXCEPTION 'explain why the account is being deactivated' USING ERRCODE = '23514'; END IF;
  IF length(coalesce(n, '')) > 1000 THEN RAISE EXCEPTION 'the explanation is too long' USING ERRCODE = '23514'; END IF;
  -- The same lock every reservation, verification, debit and execution record takes: they have committed and are counted below, or they wait and then see it inactive.
  SELECT * INTO a FROM company_bank_accounts WHERE id = p_account FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT a.is_active THEN RAISE EXCEPTION 'this account is already inactive' USING ERRCODE = '23514'; END IF;
  items := account_open_items(p_account);
  owner_c := account_owner_company(p_account);
  UPDATE company_bank_accounts SET is_active = false, deactivated_at = clock_timestamp(), deactivated_by = me, deactivation_reason = why, deactivation_note = n WHERE id = p_account;
  INSERT INTO account_status_events (account_id, owner_company_id, action, previous_active, new_active, reason, note, open_items, actor_id)
  VALUES (p_account, owner_c, 'DEACTIVATED', true, false, why, n, items, me);
  PERFORM treasury_audit(owner_c, 'BANK_ACCOUNT_DEACTIVATED', 'BANK_ACCOUNT', p_account,
    jsonb_build_object('label', a.account_label, 'kind', a.account_kind, 'reason', why, 'note', n, 'previous_status', 'ACTIVE', 'new_status', 'INACTIVE', 'open_items', items));
  INSERT INTO notification_outbox (event_type, payload)
  VALUES ('ACCOUNT_DEACTIVATED', jsonb_build_object('account_id', p_account, 'account_label', a.account_label, 'path', '/accounts',
          'reason', account_deactivation_label(why) || COALESCE(': ' || n, ''),
          'open_items', (items->>'reserved_count')::int + (items->>'unpaid_count')::int + (items->>'scheduled_count')::int + (items->>'recurring_count')::int + (items->>'reconciling_count')::int));
  RETURN items;
END $$;

CREATE FUNCTION reactivate_account(p_account uuid, p_restored boolean, p_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a company_bank_accounts; n text := NULLIF(btrim(coalesce(p_note, '')), ''); me uuid := app_user_id(); owner_c uuid;
BEGIN
  IF me IS NULL OR NOT app_can_manage_access(p_account) THEN RAISE EXCEPTION 'only a manager of the company that owns this account can reactivate it' USING ERRCODE = '42501'; END IF;
  IF p_restored IS NOT TRUE THEN RAISE EXCEPTION 'confirm that the account has been restored and can be used again' USING ERRCODE = '23514'; END IF;
  IF length(coalesce(n, '')) > 1000 THEN RAISE EXCEPTION 'the note is too long' USING ERRCODE = '23514'; END IF;
  SELECT * INTO a FROM company_bank_accounts WHERE id = p_account FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account not found' USING ERRCODE = 'P0002'; END IF;
  IF a.is_active THEN RAISE EXCEPTION 'this account is already active' USING ERRCODE = '23514'; END IF;
  owner_c := account_owner_company(p_account);
  -- Only the status changes. Nothing waiting on the account is submitted, approved, released or rescheduled.
  UPDATE company_bank_accounts SET is_active = true, deactivated_at = NULL, deactivated_by = NULL, deactivation_reason = NULL, deactivation_note = NULL WHERE id = p_account;
  INSERT INTO account_status_events (account_id, owner_company_id, action, previous_active, new_active, reason, note, open_items, actor_id)
  VALUES (p_account, owner_c, 'REACTIVATED', false, true, NULL, n, account_open_items(p_account), me);
  PERFORM treasury_audit(owner_c, 'BANK_ACCOUNT_REACTIVATED', 'BANK_ACCOUNT', p_account,
    jsonb_build_object('label', a.account_label, 'kind', a.account_kind, 'note', n, 'restored_confirmed', true, 'previous_status', 'INACTIVE', 'new_status', 'ACTIVE',
                       'previous_reason', a.deactivation_reason, 'inactive_since', a.deactivated_at));
  INSERT INTO notification_outbox (event_type, payload)
  VALUES ('ACCOUNT_REACTIVATED', jsonb_build_object('account_id', p_account, 'account_label', a.account_label, 'path', '/accounts', 'reason', n));
END $$;
REVOKE EXECUTE ON FUNCTION deactivate_account(uuid, text, text), reactivate_account(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION deactivate_account(uuid, text, text), reactivate_account(uuid, boolean, text) TO abig_app;

-- ---------- 4. Nothing new uses an inactive account: checked under the account lock ----------
CREATE FUNCTION account_inactive_message(a company_bank_accounts) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('the account %s is inactive, so it cannot take new payments, reservations or approvals', a.account_label) $$;

CREATE OR REPLACE FUNCTION payment_request_funds_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE old_hold boolean := false; new_hold boolean; a company_bank_accounts;
BEGIN
  new_hold := NEW.workflow_state IN ('RESERVED','VERIFIED');
  IF TG_OP = 'UPDATE' THEN old_hold := OLD.workflow_state IN ('RESERVED','VERIFIED') AND OLD.debit_account_id IS NOT NULL; END IF;

  -- VERIFIED -> AUTHENTICATED: debit. Only a verified request, with both approvers recorded, and with its lock still in place.
  -- Still allowed during a shortfall if the balance covers this payment: it lowers the balance and the reserved funds alike.
  IF NEW.workflow_state = 'AUTHENTICATED' AND (TG_OP = 'INSERT' OR OLD.workflow_state <> 'AUTHENTICATED') THEN
    IF TG_OP = 'INSERT' OR OLD.workflow_state <> 'VERIFIED' THEN RAISE EXCEPTION 'only a verified request can be authenticated' USING ERRCODE = '42501'; END IF;
    IF NEW.verified_by IS NULL OR NEW.authenticated_by IS NULL THEN RAISE EXCEPTION 'the verifier and the authenticator must be recorded' USING ERRCODE = '42501'; END IF;
    IF NEW.debit_account_id IS NULL THEN RAISE EXCEPTION 'this request has no debit account; return it to its creator to choose one' USING ERRCODE = '23514'; END IF;
    IF NOT old_hold OR NEW.debit_account_id <> OLD.debit_account_id OR NEW.total_amount <> OLD.total_amount THEN
      RAISE EXCEPTION 'the funds for this request are not reserved as approved' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO a FROM company_bank_accounts WHERE id = NEW.debit_account_id FOR UPDATE;
    -- Under the lock that deactivate_account takes: a deactivation has committed and is seen, or it waits for this debit.
    IF NOT a.is_active THEN RAISE EXCEPTION '%', account_inactive_message(a) USING ERRCODE = '23514'; END IF;
    IF NEW.total_amount > a.current_balance THEN
      RAISE EXCEPTION 'The account balance (ETB %) is lower than the amount (ETB %). Update the bank balance first.',
        to_char(a.current_balance, 'FM999,999,999,990.00'), to_char(NEW.total_amount, 'FM999,999,999,990.00') USING ERRCODE = '23514';
    END IF;
    UPDATE company_bank_accounts SET current_balance = current_balance - NEW.total_amount, reserved_balance = reserved_balance - NEW.total_amount,
           balance_updated_at = clock_timestamp() WHERE id = a.id;
    INSERT INTO bank_balance_history (account_id, previous_balance, new_balance, updated_by, request_id)
    VALUES (a.id, a.current_balance, a.current_balance - NEW.total_amount, NEW.authenticated_by, NEW.id);
    RETURN NEW;
  END IF;

  -- RESERVED -> VERIFIED moves no money, but it takes the request a step closer to the debit, so it needs an active account too.
  IF TG_OP = 'UPDATE' AND NEW.workflow_state = 'VERIFIED' AND OLD.workflow_state <> 'VERIFIED' AND NEW.debit_account_id IS NOT NULL THEN
    SELECT * INTO a FROM company_bank_accounts WHERE id = NEW.debit_account_id FOR SHARE;
    IF NOT a.is_active THEN RAISE EXCEPTION '%', account_inactive_message(a) USING ERRCODE = '23514'; END IF;
  END IF;

  IF NOT old_hold AND NOT new_hold THEN RETURN NEW; END IF;
  IF new_hold AND NEW.debit_account_id IS NULL THEN RAISE EXCEPTION 'choose the bank account the payment will be debited from' USING ERRCODE = '23514'; END IF;
  -- Nothing moves when the lock stays exactly as it was (for example RESERVED -> VERIFIED).
  IF old_hold AND new_hold AND NEW.debit_account_id = OLD.debit_account_id AND NEW.total_amount = OLD.total_amount THEN RETURN NEW; END IF;

  -- Lock the account rows in a fixed order so two requests cannot deadlock each other.
  PERFORM 1 FROM company_bank_accounts WHERE id IN (CASE WHEN old_hold THEN OLD.debit_account_id END, CASE WHEN new_hold THEN NEW.debit_account_id END) ORDER BY id FOR UPDATE;

  -- Reserving less on the same account only gives money back, so it is always allowed, even during a shortfall or on an inactive account.
  IF old_hold AND new_hold AND NEW.debit_account_id = OLD.debit_account_id AND NEW.total_amount < OLD.total_amount THEN
    UPDATE company_bank_accounts SET reserved_balance = reserved_balance - (OLD.total_amount - NEW.total_amount) WHERE id = NEW.debit_account_id;
    RETURN NEW;
  END IF;

  -- Checked here, under the account lock, and not only before it: a withdrawal of this company's access takes the same lock, so it has either committed
  -- and is seen now, or it waits and then sees these funds held.
  IF new_hold AND NEW.debtor_company_id NOT IN (SELECT app_granted_companies(NEW.debit_account_id, 'USE')) THEN
    RAISE EXCEPTION 'the debit account is not available to this company' USING ERRCODE = '23514';
  END IF;

  IF new_hold THEN
    SELECT * INTO a FROM company_bank_accounts WHERE id = NEW.debit_account_id;
    -- The same for a deactivation: it takes this lock, so it is seen here once committed.
    IF NOT a.is_active THEN RAISE EXCEPTION '%', account_inactive_message(a) USING ERRCODE = '23514'; END IF;
    IF a.shortfall_amount > 0 THEN
      RAISE EXCEPTION 'This account is in shortfall: its balance (ETB %) is ETB % below the reserved funds (ETB %). New submissions are blocked until the shortfall is cleared.',
        to_char(a.current_balance, 'FM999,999,999,990.00'), to_char(a.shortfall_amount, 'FM999,999,999,990.00'), to_char(a.reserved_balance, 'FM999,999,999,990.00') USING ERRCODE = '23514';
    END IF;
  END IF;
  IF old_hold THEN
    UPDATE company_bank_accounts SET reserved_balance = reserved_balance - OLD.total_amount WHERE id = OLD.debit_account_id;
  END IF;
  IF new_hold THEN
    SELECT * INTO a FROM company_bank_accounts WHERE id = NEW.debit_account_id;
    IF NEW.total_amount > a.available_balance THEN
      RAISE EXCEPTION 'The requested amount (ETB %) is more than the available balance (ETB %) on this account, which keeps a minimum buffer of ETB %.',
        to_char(NEW.total_amount, 'FM999,999,999,990.00'), to_char(a.available_balance, 'FM999,999,999,990.00'), to_char(a.min_buffer, 'FM999,999,999,990.00') USING ERRCODE = '23514';
    END IF;
    UPDATE company_bank_accounts SET reserved_balance = reserved_balance + NEW.total_amount WHERE id = NEW.debit_account_id;
  END IF;
  RETURN NEW;
END $$;

-- Recording how an authenticated payment was sent says it went out through the account: refused while the account is inactive.
CREATE OR REPLACE FUNCTION record_execution(p_request uuid, p_cheque_no text, p_bank_reference text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; a company_bank_accounts; v int; c text := NULLIF(btrim(p_cheque_no), ''); b text := NULLIF(btrim(p_bank_reference), '');
BEGIN
  IF app_user_id() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT app_can_see_request(p_request) THEN RAISE EXCEPTION 'request not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO r FROM payment_requests WHERE id = p_request FOR UPDATE;
  IF NOT app_has_permission(r.debtor_company_id, 'payment_request:create') THEN RAISE EXCEPTION 'only an Accountant of this company can record how a payment was sent' USING ERRCODE = '42501'; END IF;
  IF r.workflow_state <> 'AUTHENTICATED' THEN RAISE EXCEPTION 'this can only be recorded on an authenticated payment' USING ERRCODE = '42501'; END IF;
  IF c IS NOT NULL AND r.payment_method <> 'CHEQUE' THEN RAISE EXCEPTION 'a cheque number only applies to a cheque payment' USING ERRCODE = '23514'; END IF;
  SELECT * INTO a FROM company_bank_accounts WHERE id = r.debit_account_id FOR SHARE;
  IF NOT a.is_active THEN
    RAISE EXCEPTION 'the account % is inactive, so no payment can be sent from it; the payment stays authenticated until the account is reactivated or a Finance Manager decides', a.account_label USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('app.wf', 'on', true);
  UPDATE payment_requests SET cheque_no = c, bank_reference = b WHERE id = p_request RETURNING version INTO v;
  PERFORM set_config('app.wf', 'off', true);
  PERFORM treasury_audit(r.debtor_company_id, 'PAYMENT_EXECUTION_RECORDED', 'PAYMENT_REQUEST', p_request,
                         jsonb_build_object('cheque_no', jsonb_build_array(r.cheque_no, c), 'bank_reference', jsonb_build_array(r.bank_reference, b)));
  RETURN v;
END $$;

-- ---------- 5. Scheduled requests and recurring templates ----------
-- A clearer reason than "not available" when the account is inactive. Everything else is as before.
CREATE OR REPLACE FUNCTION recurring_assert_usable(t recurring_payment_templates) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = t.company_id AND is_active) THEN RAISE EXCEPTION 'the company is inactive' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.created_by AND u.is_active
                   AND (u.is_system_admin OR u.id IN (SELECT company_permission_users(t.company_id, 'payment_request:create')))) THEN
    RAISE EXCEPTION 'the person who set it up can no longer create payment requests for this company' USING ERRCODE = '23514';
  END IF;
  IF t.payee_type = 'SUPPLIER' AND NOT app_supplier_active_for(t.company_id, t.supplier_id) THEN RAISE EXCEPTION 'the supplier is not active for this company' USING ERRCODE = '23514'; END IF;
  IF t.payee_type = 'PERSON' AND NOT app_person_active_for(t.company_id, t.person_payee_id) THEN RAISE EXCEPTION 'this person is not active for this company' USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM company_bank_accounts a WHERE a.id = t.debit_account_id AND NOT a.is_active) THEN
    RAISE EXCEPTION 'the debit account is not available: it is inactive' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM company_bank_accounts a WHERE a.id = t.debit_account_id AND a.is_active) OR t.company_id NOT IN (SELECT app_granted_companies(t.debit_account_id, 'USE')) THEN
    RAISE EXCEPTION 'the debit account is not available to this company' USING ERRCODE = '23514';
  END IF;
  PERFORM assert_method_fits_account(t.payment_method, t.debit_account_id);
END $$;

-- A scheduled request is not submitted while its account is inactive, nor after reactivation if the account was deactivated after it was scheduled:
-- its creator decides again. It stays Scheduled, with the reason on the request, and its creator is told once, as for any other blocked release.
CREATE OR REPLACE FUNCTION release_scheduled_requests() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET "TimeZone" = 'Africa/Addis_Ababa' AS $$
DECLARE r payment_requests; v int; n int := 0; why text;
BEGIN
  FOR r IN SELECT * FROM payment_requests WHERE workflow_state = 'SCHEDULED' AND scheduled_for <= addis_day(treasury_now())
            ORDER BY scheduled_for, created_at, id FOR UPDATE SKIP LOCKED LOOP
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.created_by AND u.is_active
                       AND (u.is_system_admin OR u.id IN (SELECT company_permission_users(r.debtor_company_id, 'payment_request:create')))) THEN
        RAISE EXCEPTION 'the person who scheduled it can no longer submit payment requests for this company' USING ERRCODE = '42501';
      END IF;
      IF EXISTS (SELECT 1 FROM company_bank_accounts a WHERE a.id = r.debit_account_id AND NOT a.is_active) THEN
        RAISE EXCEPTION 'the debit account is not available: it is inactive, so it was not submitted' USING ERRCODE = '23514';
      END IF;
      IF EXISTS (SELECT 1 FROM account_status_events e WHERE e.account_id = r.debit_account_id AND e.action = 'DEACTIVATED'
                    AND e.occurred_at > COALESCE((SELECT max(x.occurred_at) FROM approval_events x WHERE x.request_id = r.id AND x.action = 'SCHEDULE'), '-infinity'::timestamptz)) THEN
        RAISE EXCEPTION 'the debit account was deactivated after this was scheduled, so it is not submitted automatically: change it and schedule it again' USING ERRCODE = '23514';
      END IF;
      PERFORM assert_submittable(r.id);
      PERFORM set_config('app.wf', 'on', true);
      -- The funds guard reserves the money here, under the account lock, exactly as for a person's submission, and refuses if it cannot.
      UPDATE payment_requests SET workflow_state = 'RESERVED', schedule_error = NULL, schedule_error_at = NULL WHERE id = r.id RETURNING version INTO v;
      PERFORM set_config('app.wf', 'off', true);
      PERFORM schedule_log(r.id, v, 'SUBMIT', app_system_user(), 'SYSTEM', 'Submitted automatically on its scheduled date (' || r.scheduled_for || ')', NULL);
      PERFORM wf_notify(r.id, 'REQUEST_SUBMITTED');
      n := n + 1;
    EXCEPTION
      WHEN serialization_failure OR deadlock_detected OR lock_not_available THEN NULL;   -- tried again next run
      WHEN OTHERS THEN
        why := SQLERRM;
        PERFORM set_config('app.wf', 'on', true);
        -- Kept current for the request page, but the row is only touched when the reason changes, and the creator is told only the first time.
        UPDATE payment_requests SET schedule_error = why, schedule_error_at = clock_timestamp(), schedule_notified_at = COALESCE(schedule_notified_at, clock_timestamp())
         WHERE id = r.id AND (schedule_error IS DISTINCT FROM why OR schedule_notified_at IS NULL);
        PERFORM set_config('app.wf', 'off', true);
        IF r.schedule_notified_at IS NULL THEN
          PERFORM wf_notify(r.id, 'REQUEST_SCHEDULE_BLOCKED', jsonb_build_object('reason', why, 'scheduled_for', r.scheduled_for));
        END IF;
    END;
  END LOOP;
  RETURN n;
END $$;

-- ---------- 6. Notifications ----------
ALTER TABLE notification_outbox DROP CONSTRAINT notification_outbox_subject_chk;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_subject_chk CHECK (request_id IS NOT NULL OR event_type IN (
  'ACCOUNT_SHORTFALL', 'RECONCILIATION_SUBMITTED', 'RECONCILIATION_RETURNED', 'RECONCILIATION_LOCKED', 'ACCOUNT_OPENING_OVERDUE',
  'SUPPLIER_BANK_DETAILS_PENDING', 'PERSON_DETAILS_PENDING', 'ACCOUNT_ACCESS_GRANTED', 'ACCOUNT_ACCESS_WITHDRAWN', 'USER_LOCKED', 'PASSWORD_RESET_COMPLETED',
  'ACCOUNT_DEACTIVATED', 'ACCOUNT_REACTIVATED'));

CREATE OR REPLACE FUNCTION in_app_event(p_type text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_type IN ('REQUEST_SUBMITTED','REQUEST_RESTARTED','REQUEST_VERIFIED','REQUEST_RETURNED','REQUEST_REJECTED','REQUEST_OVERDUE','REQUEST_PAID',
                    'REQUEST_SCHEDULE_BLOCKED','ACCOUNT_SHORTFALL','ACCOUNT_OPENING_OVERDUE','RECONCILIATION_SUBMITTED','RECONCILIATION_RETURNED',
                    'SUPPLIER_BANK_DETAILS_PENDING','PERSON_DETAILS_PENDING','ACCOUNT_DEACTIVATED','ACCOUNT_REACTIVATED') $$;

-- ACCOUNT_DEACTIVATED / ACCOUNT_REACTIVATED: the Finance Managers of every company with live access, as for a shortfall, and the owner's account managers.
CREATE OR REPLACE FUNCTION outbox_recipients(p_event uuid) RETURNS TABLE (user_id uuid, email text) LANGUAGE plpgsql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e notification_outbox; r payment_requests; ids uuid[]; w treasury_weeks; owner_c uuid; acct uuid; sd supplier_bank_details; pd person_payment_details; pc uuid;
BEGIN
  SELECT * INTO e FROM notification_outbox WHERE id = p_event;
  IF e.event_type = 'ACCOUNT_SHORTFALL' THEN
    -- Finance Managers of every company linked to the account: a shared account's shortfall affects all of them.
    ids := ARRAY(SELECT DISTINCT x FROM company_bank_account_access g CROSS JOIN LATERAL company_role_users(g.company_id, 'VERIFIER') x
                  WHERE g.account_id = (e.payload->>'account_id')::uuid AND g.revoked_at IS NULL);
    RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
    RETURN;
  END IF;
  IF e.event_type IN ('ACCOUNT_DEACTIVATED','ACCOUNT_REACTIVATED') THEN
    acct := (e.payload->>'account_id')::uuid;
    ids := ARRAY(SELECT DISTINCT x FROM company_bank_account_access g CROSS JOIN LATERAL company_role_users(g.company_id, 'VERIFIER') x
                  WHERE g.account_id = acct AND g.revoked_at IS NULL)
        || ARRAY(SELECT x FROM company_permission_users(account_owner_company(acct), 'bank_account:manage') x);
    RETURN QUERY SELECT DISTINCT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
    RETURN;
  END IF;
  IF e.event_type IN ('RECONCILIATION_SUBMITTED','RECONCILIATION_RETURNED','RECONCILIATION_LOCKED') THEN
    SELECT * INTO w FROM treasury_weeks WHERE id = (e.payload->>'week_id')::uuid;
    owner_c := account_owner_company(w.account_id);
    IF e.event_type = 'RECONCILIATION_SUBMITTED' THEN
      -- Reviewers who may lock it: not anyone who worked on it, and nobody once it was returned or locked. A submission that was returned and
      -- sent again has a newer revision and its own event, so the older one goes to nobody.
      ids := CASE WHEN w.status = 'RECONCILING' AND w.prepared_at IS NOT NULL AND w.revision = (e.payload->>'revision')::int THEN
               ARRAY(SELECT x FROM company_permission_users(owner_c, 'reconciliation:lock') x
                      WHERE x IS DISTINCT FROM w.prepared_by AND x IS DISTINCT FROM w.started_by
                        AND NOT EXISTS (SELECT 1 FROM reconciliation_lines l WHERE l.week_id = w.id AND l.created_by = x))
             ELSE '{}'::uuid[] END;
    ELSE
      ids := ARRAY(SELECT x FROM company_permission_users(owner_c, 'reconciliation:prepare') x
                    WHERE x = (e.payload->>'prepared_by')::uuid OR x = w.prepared_by OR x = w.started_by);
    END IF;
    RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
    RETURN;
  END IF;
  IF e.event_type = 'ACCOUNT_OPENING_OVERDUE' THEN
    acct := (e.payload->>'account_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM company_bank_accounts a WHERE a.id = acct AND a.is_active)
       OR EXISTS (SELECT 1 FROM treasury_weeks t WHERE t.account_id = acct AND t.week_start = (e.payload->>'week_start')::date AND t.opening_entry_id IS NOT NULL) THEN
      RETURN;
    END IF;
    ids := ARRAY(SELECT DISTINCT x FROM app_granted_companies(acct, 'RECORD_SNAPSHOT') g CROSS JOIN LATERAL company_permission_users(g, 'bank_balance:update') x);
    RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
    RETURN;
  END IF;
  IF e.event_type = 'SUPPLIER_BANK_DETAILS_PENDING' THEN
    SELECT * INTO sd FROM supplier_bank_details WHERE id = (e.payload->>'detail_id')::uuid;
    IF NOT FOUND OR sd.status <> 'PENDING' THEN RETURN; END IF;
    ids := ARRAY(SELECT DISTINCT x FROM company_suppliers cs CROSS JOIN LATERAL company_permission_users(cs.company_id, 'payment_request:verify') x
                  WHERE cs.supplier_id = sd.supplier_id AND app_supplier_active_for(cs.company_id, sd.supplier_id) AND x <> sd.created_by);
    RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
    RETURN;
  END IF;
  IF e.event_type = 'PERSON_DETAILS_PENDING' THEN
    SELECT * INTO pd FROM person_payment_details WHERE id = (e.payload->>'detail_id')::uuid;
    IF NOT FOUND OR pd.status <> 'PENDING' THEN RETURN; END IF;
    SELECT company_id INTO pc FROM person_payees WHERE id = pd.person_id;
    ids := ARRAY(SELECT x FROM company_permission_users(pc, 'payment_request:verify') x WHERE x <> pd.created_by);
    RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
    RETURN;
  END IF;
  IF e.event_type IN ('ACCOUNT_ACCESS_GRANTED','ACCOUNT_ACCESS_WITHDRAWN') THEN
    ids := ARRAY(SELECT x FROM company_permission_users((e.payload->>'company_id')::uuid, 'bank_account:view') x);
    RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
    RETURN;
  END IF;
  IF e.event_type IN ('USER_LOCKED','PASSWORD_RESET_COMPLETED') THEN
    RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = (e.payload->>'user_id')::uuid;
    RETURN;
  END IF;
  SELECT * INTO r FROM payment_requests WHERE id = e.request_id;
  IF e.event_type IN ('REQUEST_SUBMITTED','REQUEST_RESTARTED') THEN
    ids := ARRAY(SELECT x FROM company_role_users(r.debtor_company_id, 'VERIFIER') x
                 WHERE x <> r.created_by AND x NOT IN (SELECT wf_stage_actors(r.id, 'AUTHORIZATION')));
  ELSIF e.event_type = 'REQUEST_VERIFIED' THEN
    ids := ARRAY(SELECT x FROM company_role_users(r.debtor_company_id, 'AUTHENTICATOR') x
                 WHERE x <> r.created_by AND x NOT IN (SELECT wf_stage_actors(r.id, 'VERIFICATION')));
  ELSIF e.event_type = 'REQUEST_OVERDUE' THEN
    ids := ARRAY(SELECT x FROM company_permission_users(r.debtor_company_id,
                   CASE r.workflow_state WHEN 'RESERVED' THEN 'payment_request:verify' ELSE 'payment_request:authenticate' END) x WHERE x <> r.created_by) || r.created_by;
  ELSIF e.event_type IN ('REQUEST_AUTHORIZED','REQUEST_RESCHEDULE_NEEDED') THEN
    ids := ARRAY(SELECT x FROM company_role_users(r.debtor_company_id, 'TREASURY') x) || r.created_by;
  ELSE
    ids := ARRAY[r.created_by];
  END IF;
  RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
END $$;
