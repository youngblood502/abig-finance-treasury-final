-- ABIG Finance - Treasury Phase 1: money logic.
--
--   * Every status means one thing. Cancelled is no longer stored as Rejected, and Authenticated no longer means Paid: the debit
--     stays at authentication, and Paid is final and set only by reconciliation (Phase 3) or the one-off go-live step below.
--   * Requests carry a payment method. The Accountant may note the cheque number and bank reference after authentication.
--   * A bank figure below the reserved funds is accepted and is a shortfall: it is visible, the Finance Manager is told, and the
--     account takes no new or larger reservations until it recovers. Requests already holding funds can still move forward.
--   * available_balance = current - reserved - minimum buffer.
--   * The owner-approval setting for shared accounts is gone. Sharing itself (company_bank_account_access) is unchanged.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. New request columns
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TYPE payment_method AS ENUM ('TRANSFER','CHEQUE','CASH','TELEBIRR');

-- Existing requests all pay a supplier's verified bank account, so they are transfers.
ALTER TABLE payment_requests
  ADD COLUMN payment_method payment_method NOT NULL DEFAULT 'TRANSFER',
  ADD COLUMN cheque_no text,
  ADD COLUMN bank_reference text,
  ADD COLUMN bank_processed_at timestamptz,   -- written by balance checks (Phase 3)
  ADD COLUMN bank_processed_by uuid REFERENCES users(id),
  ADD COLUMN balance_check_id uuid,           -- foreign key added with its table in Phase 3
  ADD COLUMN paid_at timestamptz,
  ADD COLUMN paid_by uuid REFERENCES users(id),
  ADD COLUMN reconciliation_id uuid,          -- foreign key added with its table in Phase 3
  ADD CONSTRAINT payment_requests_cheque_no_chk CHECK (cheque_no IS NULL OR (payment_method = 'CHEQUE' AND length(cheque_no) BETWEEN 1 AND 64)),
  ADD CONSTRAINT payment_requests_bank_reference_chk CHECK (bank_reference IS NULL OR length(bank_reference) BETWEEN 1 AND 128),
  ADD CONSTRAINT payment_requests_paid_chk CHECK ((workflow_state = 'PAID') = (paid_at IS NOT NULL AND paid_by IS NOT NULL));

GRANT INSERT (payment_method) ON payment_requests TO abig_app;   -- chosen while it is a draft; locked after submission like the rest
GRANT UPDATE (payment_method) ON payment_requests TO abig_app;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Rules that named the end states
-- ---------------------------------------------------------------------------------------------------------------------
-- A cancelled draft may have no debit account, and a cancelled invoice can be entered again. NOT VALID as before: requests from
-- before the treasury refactor may legitimately have no account yet.
ALTER TABLE payment_requests DROP CONSTRAINT payment_requests_debit_account_chk;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_debit_account_chk
  CHECK (workflow_state IN ('DRAFT','SCHEDULED','REJECTED','CANCELLED') OR debit_account_id IS NOT NULL) NOT VALID;
DROP INDEX payment_requests_invoice_once;
CREATE UNIQUE INDEX payment_requests_invoice_once ON payment_requests (supplier_id, lower(invoice_ref))
  WHERE invoice_ref IS NOT NULL AND workflow_state NOT IN ('DRAFT','REJECTED','CANCELLED');

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Past cancellations: stored as REJECTED, recognised by their cancel event
-- ---------------------------------------------------------------------------------------------------------------------
-- The last deciding approval event settles it. Requests from before the approval log carry the old CANCELLED state in request_events.
-- This goes through the normal triggers, so each change is added to the append-only request_events (no actor: it is a data
-- correction). Approval history is not touched, and a true rejection stays REJECTED.
SELECT set_config('app.wf', 'on', true);
UPDATE payment_requests r SET workflow_state = 'CANCELLED'
 WHERE r.workflow_state = 'REJECTED'
   AND COALESCE((SELECT e.action = 'CANCEL' FROM approval_events e WHERE e.request_id = r.id AND e.action IN ('REJECT','CANCEL') ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1),
                EXISTS (SELECT 1 FROM request_events x WHERE x.request_id = r.id AND x.to_state = 'CANCELLED'));
SELECT set_config('app.wf', 'off', true);

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Status rules that hold for every code path
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION payment_request_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.workflow_state = 'PAID' THEN RAISE EXCEPTION 'a payment only becomes paid through reconciliation' USING ERRCODE = '42501'; END IF;
    NEW.version := 1; NEW.updated_at := now(); RETURN NEW;
  END IF;
  IF NEW.created_by <> OLD.created_by OR NEW.debtor_company_id <> OLD.debtor_company_id
     OR NEW.currency <> OLD.currency OR NEW.request_no <> OLD.request_no THEN
    RAISE EXCEPTION 'creator, debtor company, currency and number cannot change' USING ERRCODE = '42501';
  END IF;
  IF OLD.workflow_state = 'PAID' THEN RAISE EXCEPTION 'a paid payment is final' USING ERRCODE = '42501'; END IF;
  IF NEW.workflow_state <> OLD.workflow_state THEN
    IF OLD.workflow_state IN ('REJECTED','CANCELLED') THEN RAISE EXCEPTION 'a rejected or cancelled request is final' USING ERRCODE = '42501'; END IF;
    IF OLD.workflow_state = 'AUTHENTICATED' AND NEW.workflow_state <> 'PAID' THEN
      RAISE EXCEPTION 'an authenticated payment has been debited and cannot be cancelled, rejected or returned' USING ERRCODE = '42501';
    END IF;
    IF NEW.workflow_state = 'PAID' AND (OLD.workflow_state <> 'AUTHENTICATED' OR current_setting('app.paid', true) IS DISTINCT FROM 'on') THEN
      RAISE EXCEPTION 'a payment only becomes paid through reconciliation, after authentication' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF current_setting('app.paid', true) IS DISTINCT FROM 'on'
     AND (NEW.paid_at IS DISTINCT FROM OLD.paid_at OR NEW.paid_by IS DISTINCT FROM OLD.paid_by OR NEW.reconciliation_id IS DISTINCT FROM OLD.reconciliation_id) THEN
    RAISE EXCEPTION 'paid details are recorded by reconciliation only' USING ERRCODE = '42501';
  END IF;
  IF current_setting('app.wf', true) IS DISTINCT FROM 'on' THEN
    IF OLD.workflow_state <> 'DRAFT' THEN RAISE EXCEPTION 'the request is locked after submission' USING ERRCODE = '42501'; END IF;
    IF NEW.workflow_state <> OLD.workflow_state THEN RAISE EXCEPTION 'use the workflow functions to change state' USING ERRCODE = '42501'; END IF;
    IF NEW.verified_by IS DISTINCT FROM OLD.verified_by OR NEW.authenticated_by IS DISTINCT FROM OLD.authenticated_by
       OR NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.authenticated_at IS DISTINCT FROM OLD.authenticated_at
       OR NEW.cheque_no IS DISTINCT FROM OLD.cheque_no OR NEW.bank_reference IS DISTINCT FROM OLD.bank_reference
       OR NEW.bank_processed_at IS DISTINCT FROM OLD.bank_processed_at OR NEW.bank_processed_by IS DISTINCT FROM OLD.bank_processed_by
       OR NEW.balance_check_id IS DISTINCT FROM OLD.balance_check_id THEN
      RAISE EXCEPTION 'verification, authentication and execution details are recorded by the workflow only' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.version := OLD.version + 1; NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Balances: the buffer counts, and a shortfall is a fact rather than an error
-- ---------------------------------------------------------------------------------------------------------------------
-- Dropped and re-added: SET EXPRESSION needs PostgreSQL 17, and production runs 16.
ALTER TABLE company_bank_accounts DROP COLUMN available_balance;
ALTER TABLE company_bank_accounts
  ADD COLUMN available_balance numeric(19,4) GENERATED ALWAYS AS (current_balance - reserved_balance - min_buffer) STORED,
  ADD COLUMN shortfall_amount numeric(19,4) GENERATED ALWAYS AS (GREATEST(reserved_balance - current_balance, 0)) STORED;

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

  IF NOT old_hold AND NOT new_hold THEN RETURN NEW; END IF;
  IF new_hold AND NEW.debit_account_id IS NULL THEN RAISE EXCEPTION 'choose the bank account the payment will be debited from' USING ERRCODE = '23514'; END IF;
  -- Nothing moves when the lock stays exactly as it was (for example RESERVED -> VERIFIED).
  IF old_hold AND new_hold AND NEW.debit_account_id = OLD.debit_account_id AND NEW.total_amount = OLD.total_amount THEN RETURN NEW; END IF;

  -- Lock the account rows in a fixed order so two requests cannot deadlock each other.
  PERFORM 1 FROM company_bank_accounts WHERE id IN (CASE WHEN old_hold THEN OLD.debit_account_id END, CASE WHEN new_hold THEN NEW.debit_account_id END) ORDER BY id FOR UPDATE;

  -- Reserving less on the same account only gives money back, so it is always allowed, even during a shortfall.
  IF old_hold AND new_hold AND NEW.debit_account_id = OLD.debit_account_id AND NEW.total_amount < OLD.total_amount THEN
    UPDATE company_bank_accounts SET reserved_balance = reserved_balance - (OLD.total_amount - NEW.total_amount) WHERE id = NEW.debit_account_id;
    RETURN NEW;
  END IF;

  IF new_hold THEN
    SELECT * INTO a FROM company_bank_accounts WHERE id = NEW.debit_account_id;
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

-- The outbox can now carry account events, which belong to no request.
ALTER TABLE notification_outbox ALTER COLUMN request_id DROP NOT NULL;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_subject_chk CHECK (request_id IS NOT NULL OR event_type = 'ACCOUNT_SHORTFALL');

-- The figure is accepted even below the reserved funds. A shortfall that appears or grows is audited and sent to the Finance Managers.
CREATE OR REPLACE FUNCTION update_bank_balance(p_account uuid, p_new numeric) RETURNS bank_balance_history
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a company_bank_accounts; b company_bank_accounts; h bank_balance_history; v_new numeric(19,4);
BEGIN
  IF app_user_id() IS NULL THEN RAISE EXCEPTION 'sign in first' USING ERRCODE = '42501'; END IF;
  IF p_new IS NULL THEN RAISE EXCEPTION 'enter the total amount that is in the bank account' USING ERRCODE = '23514'; END IF;
  v_new := round(p_new, 4);
  IF v_new < 0 THEN RAISE EXCEPTION 'the balance cannot be negative' USING ERRCODE = '23514'; END IF;
  IF NOT app_can_snapshot(p_account) THEN RAISE EXCEPTION 'you may not update the balance of this account' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM company_bank_accounts WHERE id = p_account FOR UPDATE;  -- two updates cannot both read the same "previous"
  UPDATE company_bank_accounts SET current_balance = v_new, balance_updated_at = clock_timestamp() WHERE id = p_account RETURNING * INTO b;
  INSERT INTO bank_balance_history (account_id, previous_balance, new_balance, updated_by) VALUES (p_account, a.current_balance, v_new, app_user_id()) RETURNING * INTO h;
  PERFORM treasury_audit(account_owner_company(p_account), 'BANK_BALANCE_UPDATED', 'BANK_ACCOUNT', p_account,
                         jsonb_build_object('previous', a.current_balance, 'new', v_new, 'shortfall', b.shortfall_amount));
  IF b.shortfall_amount > a.shortfall_amount THEN
    PERFORM treasury_audit(account_owner_company(p_account), 'ACCOUNT_SHORTFALL_DETECTED', 'BANK_ACCOUNT', p_account,
                           jsonb_build_object('balance', v_new, 'reserved', b.reserved_balance, 'shortfall', b.shortfall_amount));
    INSERT INTO notification_outbox (event_type, payload)
    VALUES ('ACCOUNT_SHORTFALL', jsonb_build_object('account_id', p_account, 'account_label', b.account_label, 'balance', v_new,
                                                    'reserved', b.reserved_balance, 'shortfall_amount', b.shortfall_amount));
  END IF;
  RETURN h;
END $$;

CREATE OR REPLACE FUNCTION outbox_recipients(p_event uuid) RETURNS TABLE (user_id uuid, email text) LANGUAGE plpgsql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e notification_outbox; r payment_requests; ids uuid[];
BEGIN
  SELECT * INTO e FROM notification_outbox WHERE id = p_event;
  IF e.event_type = 'ACCOUNT_SHORTFALL' THEN
    -- Finance Managers of every company linked to the account: a shared account's shortfall affects all of them.
    ids := ARRAY(SELECT DISTINCT x FROM company_bank_account_access g CROSS JOIN LATERAL company_role_users(g.company_id, 'VERIFIER') x
                  WHERE g.account_id = (e.payload->>'account_id')::uuid AND g.revoked_at IS NULL);
    RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
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

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. The owner-approval setting is removed
-- ---------------------------------------------------------------------------------------------------------------------
-- Accounts that had it switched on are kept here, so nothing is lost if someone asks for it again. Not readable by the application.
CREATE TABLE removed_owner_approval_settings (account_id uuid PRIMARY KEY REFERENCES company_bank_accounts(id), removed_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE removed_owner_approval_settings ENABLE ROW LEVEL SECURITY;
INSERT INTO removed_owner_approval_settings (account_id) SELECT id FROM company_bank_accounts WHERE owner_approval_required;

DROP FUNCTION register_bank_account(uuid, text, text, text, bytea, numeric, boolean);
DROP FUNCTION set_account_policy(uuid, numeric, boolean);
DROP FUNCTION owner_pending_approvals();
DROP FUNCTION owner_approve_account_use(uuid, uuid);
DROP FUNCTION owner_revoke_account_use(uuid, text);
ALTER TABLE company_bank_accounts DROP COLUMN owner_approval_required;

CREATE FUNCTION register_bank_account(p_owner uuid, p_bank text, p_label text, p_last4 text, p_enc bytea, p_buffer numeric) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_bank uuid;
BEGIN
  IF app_user_id() IS NULL OR NOT app_has_permission(p_owner, 'bank_account:manage') THEN RAISE EXCEPTION 'you may not register accounts for this company' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_bank, ''))) = 0 THEN RAISE EXCEPTION 'the bank is required' USING ERRCODE = '23514'; END IF;
  IF COALESCE(p_buffer, 0) < 0 THEN RAISE EXCEPTION 'the minimum buffer cannot be negative' USING ERRCODE = '23514'; END IF;
  INSERT INTO banks (name) VALUES (btrim(p_bank)) ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_bank FROM banks WHERE name = btrim(p_bank);
  INSERT INTO company_bank_accounts (bank_id, account_label, account_last4, account_number_enc, min_buffer)
  VALUES (v_bank, p_label, p_last4, p_enc, COALESCE(p_buffer, 0)) RETURNING company_bank_accounts.id INTO v_id;
  INSERT INTO company_bank_account_access (account_id, company_id, is_owner, permissions, granted_by)
  VALUES (v_id, p_owner, true, ARRAY['USE','RECORD_SNAPSHOT'], app_user_id());
  PERFORM treasury_audit(p_owner, 'BANK_ACCOUNT_REGISTERED', 'BANK_ACCOUNT', v_id, jsonb_build_object('bank', p_bank, 'label', p_label));
  RETURN v_id;
END $$;

CREATE FUNCTION set_account_policy(p_account uuid, p_buffer numeric) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a company_bank_accounts;
BEGIN
  IF app_user_id() IS NULL OR NOT app_can_manage_access(p_account) THEN RAISE EXCEPTION 'only the account owner can change account policy' USING ERRCODE = '42501'; END IF;
  IF COALESCE(p_buffer, 0) < 0 THEN RAISE EXCEPTION 'the minimum buffer cannot be negative' USING ERRCODE = '23514'; END IF;
  SELECT * INTO a FROM company_bank_accounts WHERE id = p_account FOR UPDATE;
  UPDATE company_bank_accounts SET min_buffer = COALESCE(p_buffer, min_buffer) WHERE id = p_account;
  PERFORM treasury_audit(account_owner_company(p_account), 'BANK_ACCOUNT_POLICY_CHANGED', 'BANK_ACCOUNT', p_account,
         jsonb_build_object('min_buffer', p_buffer, 'previous_min_buffer', a.min_buffer));
END $$;
REVOKE EXECUTE ON FUNCTION register_bank_account(uuid, text, text, text, bytea, numeric), set_account_policy(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_bank_account(uuid, text, text, text, bytea, numeric), set_account_policy(uuid, numeric) TO abig_app;

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Workflow: cancel, authenticate, and what happens after
-- ---------------------------------------------------------------------------------------------------------------------
-- The creator can withdraw a request until it is authenticated. The funds guard releases what it held.
CREATE OR REPLACE FUNCTION wf_cancel(p_request uuid, p_expected_version int, p_reason text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; v int; role_name text; corr uuid := gen_random_uuid();
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  role_name := wf_assert_actor(p_request, 'SUBMISSION');
  r := wf_lock(p_request, p_expected_version);
  IF r.workflow_state NOT IN ('DRAFT','SCHEDULED','RESERVED','VERIFIED') THEN RAISE EXCEPTION 'this request can no longer be cancelled' USING ERRCODE = '42501'; END IF;
  v := wf_set_state(p_request, 'CANCELLED');
  PERFORM wf_log(p_request, v, 'SUBMISSION', 'CANCEL', role_name, p_reason, corr);
  PERFORM wf_notify(p_request, 'REQUEST_CANCELLED', jsonb_build_object('reason', p_reason));
  RETURN v;
END $$;

-- Owner: VERIFIED -> AUTHENTICATED. The funds guard debits the account and releases the lock in the same statement. The payment stays
-- Authenticated: authenticating does not mean the bank has paid it.
CREATE OR REPLACE FUNCTION wf_authorize(p_request uuid, p_expected_version int) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; v int; role_name text; corr uuid := gen_random_uuid();
BEGIN
  role_name := wf_assert_actor(p_request, 'AUTHORIZATION');
  r := wf_lock(p_request, p_expected_version);
  IF r.workflow_state <> 'VERIFIED' THEN RAISE EXCEPTION 'the request is not waiting for authentication' USING ERRCODE = '42501'; END IF;
  PERFORM assert_submittable(p_request);
  v := wf_move(p_request, 'AUTHENTICATED', NULL, app_user_id());
  PERFORM wf_log(p_request, v, 'AUTHORIZATION', 'AUTHORIZE', role_name, NULL, corr);
  PERFORM treasury_audit(r.debtor_company_id, 'PAYMENT_AUTHENTICATED', 'PAYMENT_REQUEST', p_request,
                         jsonb_build_object('method', r.payment_method, 'amount', r.total_amount, 'account', r.debit_account_id));
  PERFORM wf_notify(p_request, 'REQUEST_AUTHORIZED');
  RETURN v;
END $$;

-- The Accountant notes how an authenticated payment was sent. Both details are optional and can be corrected until it is Paid.
CREATE FUNCTION record_execution(p_request uuid, p_cheque_no text, p_bank_reference text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; v int; c text := NULLIF(btrim(p_cheque_no), ''); b text := NULLIF(btrim(p_bank_reference), '');
BEGIN
  IF app_user_id() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT app_can_see_request(p_request) THEN RAISE EXCEPTION 'request not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO r FROM payment_requests WHERE id = p_request FOR UPDATE;
  IF NOT app_has_permission(r.debtor_company_id, 'payment_request:create') THEN RAISE EXCEPTION 'only an Accountant of this company can record how a payment was sent' USING ERRCODE = '42501'; END IF;
  IF r.workflow_state <> 'AUTHENTICATED' THEN RAISE EXCEPTION 'this can only be recorded on an authenticated payment' USING ERRCODE = '42501'; END IF;
  IF c IS NOT NULL AND r.payment_method <> 'CHEQUE' THEN RAISE EXCEPTION 'a cheque number only applies to a cheque payment' USING ERRCODE = '23514'; END IF;
  PERFORM set_config('app.wf', 'on', true);
  UPDATE payment_requests SET cheque_no = c, bank_reference = b WHERE id = p_request RETURNING version INTO v;
  PERFORM set_config('app.wf', 'off', true);
  PERFORM treasury_audit(r.debtor_company_id, 'PAYMENT_EXECUTION_RECORDED', 'PAYMENT_REQUEST', p_request,
                         jsonb_build_object('cheque_no', jsonb_build_array(r.cheque_no, c), 'bank_reference', jsonb_build_array(r.bank_reference, b)));
  RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION record_execution(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_execution(uuid, text, text) TO abig_app;

-- The only way to Paid. Internal: reconciliation calls it in Phase 3. The application role cannot run it.
CREATE FUNCTION wf_mark_paid(p_request uuid, p_actor uuid) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v int;
BEGIN
  PERFORM set_config('app.wf', 'on', true); PERFORM set_config('app.paid', 'on', true);
  UPDATE payment_requests SET workflow_state = 'PAID', paid_at = clock_timestamp(), paid_by = p_actor WHERE id = p_request RETURNING version INTO v;
  PERFORM set_config('app.paid', 'off', true); PERFORM set_config('app.wf', 'off', true);
  RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION wf_mark_paid(uuid, uuid) FROM PUBLIC;

-- Go-live only, by hand, as the owner role: requests authenticated during testing become Paid. No migration or application code calls
-- this. See docs/OPERATIONS.md. It does not move any money: they were debited when authenticated.
CREATE FUNCTION mark_authenticated_paid_at_go_live(p_actor uuid, p_note text) RETURNS int LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; n int := 0;
BEGIN
  IF length(btrim(coalesce(p_note, ''))) < 3 THEN RAISE EXCEPTION 'a note is required' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_actor AND is_active) THEN RAISE EXCEPTION 'name the active person responsible for this step' USING ERRCODE = '23514'; END IF;
  PERFORM set_config('app.user_id', p_actor::text, true);
  FOR r IN SELECT * FROM payment_requests WHERE workflow_state = 'AUTHENTICATED' ORDER BY authenticated_at, id FOR UPDATE LOOP
    PERFORM wf_mark_paid(r.id, p_actor);
    PERFORM treasury_audit(r.debtor_company_id, 'PAYMENT_MARKED_PAID_AT_GO_LIVE', 'PAYMENT_REQUEST', r.id, jsonb_build_object('note', btrim(p_note), 'amount', r.total_amount));
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION mark_authenticated_paid_at_go_live(uuid, text) FROM PUBLIC;

-- Authenticated no longer means paid.
CREATE OR REPLACE FUNCTION request_payment_status(p_request uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT CASE WHEN r.workflow_state = 'PAID' THEN 'PAID' END FROM payment_requests r WHERE r.id = p_request AND app_can_see_request(p_request) $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. Local time for the background job that works in calendar days (the application sets it per transaction)
-- ---------------------------------------------------------------------------------------------------------------------
ALTER FUNCTION enqueue_overdue_requests() SET timezone TO 'Africa/Addis_Ababa';
