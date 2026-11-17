-- ABIG Finance - Approvals: strict three-tier workflow (step 4).
--
--   Accountant  creates and submits          DRAFT -> RESERVED   (funds locked, step 3)
--   Finance Manager  verifies                RESERVED -> VERIFIED   (permission payment_request:verify)
--   Owner  authenticates                     VERIFIED -> AUTHENTICATED   (permission payment_request:authenticate)
--
-- Authenticating is also the execution: in the same statement the debit account's current_balance goes down by the amount,
-- its reserved_balance goes down by the same amount (the lock is released) and one balance-history row records the debit.
-- Separation of duties: nobody approves their own request, and the verifier and the authenticator are two different people.
-- A request can be sent back to its creator (-> DRAFT, funds released) at either stage; the Owner can reject it (final).

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Balance history: say why the balance moved
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE bank_balance_history ADD COLUMN request_id uuid REFERENCES payment_requests(id);  -- set when the entry is a payment debit

DROP FUNCTION account_balance_history(uuid, int);
CREATE FUNCTION account_balance_history(p_account uuid, p_limit int DEFAULT 10)
RETURNS TABLE (id uuid, updated_at timestamptz, previous_balance numeric, new_balance numeric, updated_by uuid, updated_by_name text, request_no text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT h.id, h.updated_at, h.previous_balance, h.new_balance, h.updated_by, u.full_name, r.request_no
        FROM bank_balance_history h JOIN users u ON u.id = h.updated_by LEFT JOIN payment_requests r ON r.id = h.request_id
       WHERE h.account_id = p_account AND app_can_see_account(p_account)
       ORDER BY h.updated_at DESC, h.id DESC LIMIT LEAST(GREATEST(p_limit, 1), 100) $$;
REVOKE EXECUTE ON FUNCTION account_balance_history(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_balance_history(uuid, int) TO abig_app;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Execution: authenticating debits the account and releases the lock (extends the funds guard of step 3)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION payment_request_funds_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE old_hold boolean := false; new_hold boolean; avail numeric; a company_bank_accounts;
BEGIN
  new_hold := NEW.workflow_state IN ('RESERVED','VERIFIED');
  IF TG_OP = 'UPDATE' THEN old_hold := OLD.workflow_state IN ('RESERVED','VERIFIED') AND OLD.debit_account_id IS NOT NULL; END IF;

  -- VERIFIED -> AUTHENTICATED: pay. Only a verified request, with both approvers recorded, and with its lock still in place.
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
  IF old_hold THEN
    UPDATE company_bank_accounts SET reserved_balance = reserved_balance - OLD.total_amount WHERE id = OLD.debit_account_id;
  END IF;
  IF new_hold THEN
    SELECT available_balance INTO avail FROM company_bank_accounts WHERE id = NEW.debit_account_id;
    IF NEW.total_amount > avail THEN
      RAISE EXCEPTION 'The requested amount (ETB %) is more than the available balance (ETB %) on this account.',
        to_char(NEW.total_amount, 'FM999,999,999,990.00'), to_char(avail, 'FM999,999,999,990.00') USING ERRCODE = '23514';
    END IF;
    UPDATE company_bank_accounts SET reserved_balance = reserved_balance + NEW.total_amount WHERE id = NEW.debit_account_id;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Who may act, and the state change helper
-- ---------------------------------------------------------------------------------------------------------------------
-- Permission based: verifying needs payment_request:verify, authenticating needs payment_request:authenticate, both in the
-- request's company. A system administrator is not an approver.
CREATE OR REPLACE FUNCTION wf_assert_actor(p_request uuid, p_stage text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; me uuid := app_user_id(); role_name text; perm text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT app_can_see_request(p_request) THEN RAISE EXCEPTION 'request not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO r FROM payment_requests WHERE id = p_request;
  perm := CASE p_stage WHEN 'VERIFICATION' THEN 'payment_request:verify' WHEN 'AUTHORIZATION' THEN 'payment_request:authenticate' ELSE 'payment_request:create' END;
  role_name := CASE p_stage WHEN 'VERIFICATION' THEN 'FINANCE_MANAGER' WHEN 'AUTHORIZATION' THEN 'OWNER' ELSE 'ACCOUNTANT' END;
  IF r.debtor_company_id NOT IN (SELECT app_permitted_companies(perm)) THEN
    RAISE EXCEPTION 'you do not have the % permission for this company', perm USING ERRCODE = '42501';
  END IF;
  IF p_stage = 'SUBMISSION' THEN
    IF r.created_by <> me THEN RAISE EXCEPTION 'only the creator can do this' USING ERRCODE = '42501'; END IF;
  ELSE
    IF r.created_by = me THEN RAISE EXCEPTION 'you created this request; the creator cannot verify or authenticate it' USING ERRCODE = '42501'; END IF;
    IF p_stage = 'VERIFICATION' AND me IN (SELECT wf_stage_actors(p_request, 'AUTHORIZATION')) THEN
      RAISE EXCEPTION 'you already acted at the authentication stage of this request' USING ERRCODE = '42501';
    END IF;
    IF p_stage = 'AUTHORIZATION' AND me IN (SELECT wf_stage_actors(p_request, 'VERIFICATION')) THEN
      RAISE EXCEPTION 'you already acted at the verification stage of this request' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN role_name;
END $$;

-- One state change that also records or clears the approvers (the guard only lets the workflow write those columns).
CREATE FUNCTION wf_move(p_request uuid, p_state text, p_verified_by uuid DEFAULT NULL, p_authenticated_by uuid DEFAULT NULL, p_clear boolean DEFAULT false) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v int;
BEGIN
  PERFORM set_config('app.wf', 'on', true);
  UPDATE payment_requests SET workflow_state = p_state::payment_request_status,
         verified_by = CASE WHEN p_clear THEN NULL ELSE COALESCE(p_verified_by, verified_by) END,
         verified_at = CASE WHEN p_clear THEN NULL WHEN p_verified_by IS NOT NULL THEN clock_timestamp() ELSE verified_at END,
         authenticated_by = CASE WHEN p_clear THEN NULL ELSE COALESCE(p_authenticated_by, authenticated_by) END,
         authenticated_at = CASE WHEN p_clear THEN NULL WHEN p_authenticated_by IS NOT NULL THEN clock_timestamp() ELSE authenticated_at END
   WHERE id = p_request RETURNING version INTO v;
  PERFORM set_config('app.wf', 'off', true);
  RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION wf_move(uuid, text, uuid, uuid, boolean) FROM PUBLIC;  -- internal: called by the wf_* functions only

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. The three steps, return and reject
-- ---------------------------------------------------------------------------------------------------------------------
-- Finance Manager: RESERVED -> VERIFIED
CREATE OR REPLACE FUNCTION wf_verify(p_request uuid, p_expected_version int) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; v int; role_name text; corr uuid := gen_random_uuid();
BEGIN
  role_name := wf_assert_actor(p_request, 'VERIFICATION');
  r := wf_lock(p_request, p_expected_version);
  IF r.workflow_state <> 'RESERVED' THEN RAISE EXCEPTION 'the request is not waiting for verification' USING ERRCODE = '42501'; END IF;
  PERFORM assert_submittable(p_request);
  v := wf_move(p_request, 'VERIFIED', app_user_id(), NULL);
  PERFORM wf_log(p_request, v, 'VERIFICATION', 'VERIFY', role_name, NULL, corr);
  PERFORM wf_notify(p_request, 'REQUEST_VERIFIED');
  RETURN v;
END $$;

-- Owner: VERIFIED -> AUTHENTICATED. The funds guard debits the account and releases the lock in the same statement.
CREATE OR REPLACE FUNCTION wf_authorize(p_request uuid, p_expected_version int) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; v int; role_name text; corr uuid := gen_random_uuid();
BEGIN
  role_name := wf_assert_actor(p_request, 'AUTHORIZATION');
  r := wf_lock(p_request, p_expected_version);
  IF r.workflow_state <> 'VERIFIED' THEN RAISE EXCEPTION 'the request is not waiting for authentication' USING ERRCODE = '42501'; END IF;
  PERFORM assert_submittable(p_request);
  v := wf_move(p_request, 'AUTHENTICATED', NULL, app_user_id());
  PERFORM wf_log(p_request, v, 'AUTHORIZATION', 'AUTHORIZE', role_name, NULL, corr);
  PERFORM wf_notify(p_request, 'REQUEST_AUTHORIZED');
  RETURN v;
END $$;

-- Either approver can send the request back to its creator: it becomes a DRAFT again, the funds are released and the
-- verification is wiped, so it starts again from the top once resubmitted.
CREATE OR REPLACE FUNCTION wf_return(p_request uuid, p_expected_version int, p_reason text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; v int; role_name text; stage text; st text; corr uuid := gen_random_uuid();
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  SELECT workflow_state INTO st FROM payment_requests WHERE id = p_request;
  stage := CASE st WHEN 'RESERVED' THEN 'VERIFICATION' WHEN 'VERIFIED' THEN 'AUTHORIZATION' END;
  IF stage IS NULL THEN RAISE EXCEPTION 'only a reserved or verified request can be returned' USING ERRCODE = '42501'; END IF;
  role_name := wf_assert_actor(p_request, stage);
  r := wf_lock(p_request, p_expected_version);
  v := wf_move(p_request, 'DRAFT', NULL, NULL, true);
  PERFORM wf_log(p_request, v, stage, 'RETURN', role_name, p_reason, corr);
  PERFORM wf_log(p_request, v, stage, 'INVALIDATE', role_name, 'returned for correction', corr);
  PERFORM wf_notify(p_request, 'REQUEST_RETURNED', jsonb_build_object('reason', p_reason));
  RETURN v;
END $$;

-- Owner: VERIFIED -> REJECTED (final). The funds are released.
CREATE OR REPLACE FUNCTION wf_reject(p_request uuid, p_expected_version int, p_reason text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; v int; role_name text; corr uuid := gen_random_uuid();
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  role_name := wf_assert_actor(p_request, 'AUTHORIZATION');
  r := wf_lock(p_request, p_expected_version);
  IF r.workflow_state <> 'VERIFIED' THEN RAISE EXCEPTION 'only a verified request can be rejected, by an Owner' USING ERRCODE = '42501'; END IF;
  v := wf_move(p_request, 'REJECTED');
  PERFORM wf_log(p_request, v, 'AUTHORIZATION', 'REJECT', role_name, p_reason, corr);
  PERFORM wf_notify(p_request, 'REQUEST_REJECTED', jsonb_build_object('reason', p_reason));
  RETURN v;
END $$;

-- An authenticated request has already been paid: it cannot be cancelled. (Reversals are a separate, later feature.)
DROP FUNCTION wf_cancel_authorized(uuid, int, text);

CREATE OR REPLACE FUNCTION public.wf_adjust(p_request uuid, p_expected_version integer, p_changes jsonb, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r payment_requests; st text; stage text; role_name text; v int; corr uuid := gen_random_uuid(); k text;
  amount_changed boolean := false; payee_changed boolean := false; due_changed boolean := false; any_change boolean := false;
  el jsonb; inst payment_installments; new_amt numeric; new_due date; new_state text;
  n_total numeric; n_priority text; n_ref text; n_desc text; n_supplier uuid; n_bank uuid;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_changes) LOOP
    IF k NOT IN ('total_amount','priority','invoice_ref','description','supplier_id','supplier_bank_detail_id','installments') THEN
      RAISE EXCEPTION 'field % cannot be adjusted', k USING ERRCODE = '23514';
    END IF;
  END LOOP;
  SELECT workflow_state INTO st FROM payment_requests WHERE id = p_request;
  stage := CASE st WHEN 'RESERVED' THEN 'VERIFICATION' WHEN 'VERIFIED' THEN 'AUTHORIZATION' END;
  IF stage IS NULL THEN RAISE EXCEPTION 'only a reserved or verified request can be adjusted' USING ERRCODE = '42501'; END IF;
  role_name := wf_assert_actor(p_request, stage);
  r := wf_lock(p_request, p_expected_version);
  v := r.version + 1; -- the single parent update below bumps the version once

  n_total := COALESCE((p_changes->>'total_amount')::numeric, r.total_amount);
  n_priority := COALESCE(p_changes->>'priority', r.priority);
  n_ref := COALESCE(p_changes->>'invoice_ref', r.invoice_ref);
  n_desc := COALESCE(p_changes->>'description', r.description);
  n_supplier := COALESCE((p_changes->>'supplier_id')::uuid, r.supplier_id);
  n_bank := COALESCE((p_changes->>'supplier_bank_detail_id')::uuid, r.supplier_bank_detail_id);

  PERFORM set_config('app.wf', 'on', true);
  IF n_total IS DISTINCT FROM r.total_amount THEN amount_changed := true; any_change := true;
    INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
    VALUES (r.id, 'REQUEST', r.id, 'total_amount', r.total_amount::text, n_total::text, p_reason, app_user_id(), role_name, stage, v, corr); END IF;
  IF n_supplier IS DISTINCT FROM r.supplier_id THEN payee_changed := true; any_change := true;
    INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
    VALUES (r.id, 'REQUEST', r.id, 'supplier_id', r.supplier_id::text, n_supplier::text, p_reason, app_user_id(), role_name, stage, v, corr); END IF;
  IF n_bank IS DISTINCT FROM r.supplier_bank_detail_id THEN payee_changed := true; any_change := true;
    INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
    VALUES (r.id, 'REQUEST', r.id, 'supplier_bank_detail_id', r.supplier_bank_detail_id::text, n_bank::text, p_reason, app_user_id(), role_name, stage, v, corr); END IF;
  IF n_priority IS DISTINCT FROM r.priority THEN any_change := true;
    INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
    VALUES (r.id, 'REQUEST', r.id, 'priority', r.priority, n_priority, p_reason, app_user_id(), role_name, stage, v, corr); END IF;
  IF n_ref IS DISTINCT FROM r.invoice_ref THEN any_change := true;
    INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
    VALUES (r.id, 'REQUEST', r.id, 'invoice_ref', r.invoice_ref, n_ref, p_reason, app_user_id(), role_name, stage, v, corr); END IF;
  IF n_desc IS DISTINCT FROM r.description THEN any_change := true;
    INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
    VALUES (r.id, 'REQUEST', r.id, 'description', r.description, n_desc, p_reason, app_user_id(), role_name, stage, v, corr); END IF;

  IF p_changes ? 'installments' THEN
    FOR el IN SELECT * FROM jsonb_array_elements(p_changes->'installments') LOOP
      SELECT * INTO inst FROM payment_installments WHERE request_id = p_request AND seq = (el->>'seq')::int FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'installment % does not exist', el->>'seq' USING ERRCODE = '23514'; END IF;
      new_amt := COALESCE((el->>'amount')::numeric, inst.amount);
      new_due := COALESCE((el->>'due_date')::date, inst.due_date);
      IF new_amt IS DISTINCT FROM inst.amount THEN amount_changed := true; any_change := true;
        INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
        VALUES (r.id, 'INSTALLMENT', inst.id, 'amount', inst.amount::text, new_amt::text, p_reason, app_user_id(), role_name, stage, v, corr); END IF;
      IF new_due IS DISTINCT FROM inst.due_date THEN due_changed := true; any_change := true;
        INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
        VALUES (r.id, 'INSTALLMENT', inst.id, 'due_date', inst.due_date::text, new_due::text, p_reason, app_user_id(), role_name, stage, v, corr); END IF;
      UPDATE payment_installments SET amount = new_amt, due_date = new_due WHERE id = inst.id;
    END LOOP;
  END IF;
  IF NOT any_change THEN RAISE EXCEPTION 'nothing was changed' USING ERRCODE = '23514'; END IF;

  new_state := CASE WHEN (amount_changed OR payee_changed) THEN 'RESERVED' ELSE st END;
  UPDATE payment_requests SET total_amount = n_total, priority = n_priority, invoice_ref = n_ref, description = n_desc,
         supplier_id = n_supplier, supplier_bank_detail_id = n_bank, workflow_state = new_state::payment_request_status,
         -- a change that restarts the approval wipes the verification that no longer applies
         verified_by = CASE WHEN new_state <> st THEN NULL ELSE verified_by END, verified_at = CASE WHEN new_state <> st THEN NULL ELSE verified_at END
   WHERE id = p_request;
  PERFORM set_config('app.wf', 'off', true);
  PERFORM assert_submittable(p_request); -- totals add up, bank details verified for the (new) supplier, supplier active
  -- A new amount is re-checked against the account's available balance and the reservation is resized by the funds guard
  -- (it runs inside the UPDATE above), so an adjustment that cannot be funded is refused as a whole.

  PERFORM wf_log(p_request, v, stage, 'ADJUST', role_name, p_reason, corr);
  IF st = 'VERIFIED' AND new_state = 'RESERVED' THEN
    PERFORM wf_log(p_request, v, stage, 'INVALIDATE', role_name, 'amount or payee changed: restart at verification', corr);
  END IF;
  IF new_state = 'RESERVED' AND (amount_changed OR payee_changed) THEN PERFORM wf_notify(p_request, 'REQUEST_RESTARTED', jsonb_build_object('reason', p_reason));
  ELSIF due_changed THEN PERFORM wf_notify(p_request, 'REQUEST_RESCHEDULE_NEEDED', jsonb_build_object('reason', p_reason));
  ELSE PERFORM wf_notify(p_request, 'REQUEST_ADJUSTED', jsonb_build_object('reason', p_reason)); END IF;
  RETURN v;
END $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. The queues: Finance Managers see RESERVED requests, Owners see VERIFIED ones
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_actionable_requests() RETURNS TABLE (request_id uuid, request_no text, stage text, debtor_company_id uuid, supplier_id uuid, total_amount numeric, request_version integer, waiting_since timestamptz)
LANGUAGE sql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id, r.request_no, CASE r.workflow_state WHEN 'RESERVED' THEN 'VERIFICATION' ELSE 'AUTHORIZATION' END,
         r.debtor_company_id, r.supplier_id, r.total_amount, r.version, r.updated_at
  FROM payment_requests r
  WHERE r.created_by <> app_user_id() AND (
    (r.workflow_state = 'RESERVED' AND r.debtor_company_id IN (SELECT app_permitted_companies('payment_request:verify'))
       AND NOT app_user_id() IN (SELECT wf_stage_actors(r.id, 'AUTHORIZATION')))
    OR (r.workflow_state = 'VERIFIED' AND r.debtor_company_id IN (SELECT app_permitted_companies('payment_request:authenticate'))
       AND NOT app_user_id() IN (SELECT wf_stage_actors(r.id, 'VERIFICATION'))))
  ORDER BY r.updated_at $$;

-- Payment status is now simply: authenticated means paid (the account was debited). The old instalment-by-instalment payment
-- tracking of the previous treasury engine is no longer used.
CREATE OR REPLACE FUNCTION request_payment_status(p_request uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT CASE WHEN r.workflow_state = 'AUTHENTICATED' THEN 'PAID' END FROM payment_requests r WHERE r.id = p_request AND app_can_see_request(p_request) $$;
