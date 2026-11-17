-- ABIG Finance - Payment requests: debit account, available-balance check and fund reservation (step 3).
--
--   * A request names the bank account it will be paid from (payment_requests.debit_account_id) and its total amount.
--   * Submitting it (DRAFT -> RESERVED) checks total <= the account's available_balance and moves the total from available
--     into reserved_balance, under a row lock on the account, so two requests can never spend the same money.
--   * The lock follows the request: it is held while the request is RESERVED or VERIFIED and is released on any other state
--     (cancel, reject, return to draft, authenticate). It is enforced by a trigger, so no code path can skip it.
--   * AUTHENTICATED only releases the lock here. The debit of current_balance belongs to the Approvals step.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. The reservation itself
-- ---------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION payment_request_funds_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE old_hold boolean := false; new_hold boolean; avail numeric;
BEGIN
  new_hold := NEW.workflow_state IN ('RESERVED','VERIFIED');
  IF TG_OP = 'UPDATE' THEN old_hold := OLD.workflow_state IN ('RESERVED','VERIFIED') AND OLD.debit_account_id IS NOT NULL; END IF;
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
-- Runs after the debit-account guard (names sort in that order) and before the version guard.
CREATE TRIGGER payment_requests_funds_guard BEFORE INSERT OR UPDATE ON payment_requests FOR EACH ROW EXECUTE FUNCTION payment_request_funds_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Guards that still spoke the old states (editing is allowed in DRAFT only; RETURNED no longer exists)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_can_edit_draft(p_request uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM payment_requests r WHERE r.id = p_request AND r.workflow_state = 'DRAFT' AND r.created_by = app_user_id()
                       AND r.debtor_company_id IN (SELECT app_permitted_companies('payment_request:update'))) $$;

CREATE OR REPLACE FUNCTION payment_request_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.version := 1; NEW.updated_at := now(); RETURN NEW; END IF;
  IF NEW.created_by <> OLD.created_by OR NEW.debtor_company_id <> OLD.debtor_company_id
     OR NEW.currency <> OLD.currency OR NEW.request_no <> OLD.request_no THEN
    RAISE EXCEPTION 'creator, debtor company, currency and number cannot change' USING ERRCODE = '42501';
  END IF;
  IF current_setting('app.wf', true) IS DISTINCT FROM 'on' THEN
    IF OLD.workflow_state <> 'DRAFT' THEN RAISE EXCEPTION 'the request is locked after submission' USING ERRCODE = '42501'; END IF;
    IF NEW.workflow_state <> OLD.workflow_state THEN RAISE EXCEPTION 'use the workflow functions to change state' USING ERRCODE = '42501'; END IF;
    IF NEW.verified_by IS DISTINCT FROM OLD.verified_by OR NEW.authenticated_by IS DISTINCT FROM OLD.authenticated_by
       OR NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.authenticated_at IS DISTINCT FROM OLD.authenticated_at THEN
      RAISE EXCEPTION 'verification and authentication are recorded by the workflow only' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.version := OLD.version + 1; NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION installment_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st payment_request_status; cur char(3); rid uuid;
BEGIN
  rid := CASE WHEN TG_OP = 'DELETE' THEN OLD.request_id ELSE NEW.request_id END;
  SELECT workflow_state, currency INTO st, cur FROM payment_requests WHERE id = rid;
  IF current_setting('app.wf', true) IS DISTINCT FROM 'on' AND st <> 'DRAFT' THEN
    RAISE EXCEPTION 'installments are locked after submission' USING ERRCODE = '42501';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.currency <> cur THEN RAISE EXCEPTION 'installment currency must match the request' USING ERRCODE = '23514'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE OR REPLACE FUNCTION attachment_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (SELECT workflow_state FROM payment_requests WHERE id = NEW.request_id) <> 'DRAFT' THEN
    RAISE EXCEPTION 'attachments can only be added to a draft request' USING ERRCODE = '42501';
  END IF;
  IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM attachments WHERE id = NEW.supersedes_id AND request_id = NEW.request_id) THEN
    RAISE EXCEPTION 'a replacement must belong to the same request' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- Every workflow function changes state through this one; the column is an enum now.
CREATE OR REPLACE FUNCTION wf_set_state(p_request uuid, p_state text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v int;
BEGIN
  PERFORM set_config('app.wf', 'on', true);
  UPDATE payment_requests SET workflow_state = p_state::payment_request_status WHERE id = p_request RETURNING version INTO v;
  PERFORM set_config('app.wf', 'off', true);
  RETURN v;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Submitting and cancelling
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_submittable(p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; n int; s numeric;
BEGIN
  SELECT * INTO r FROM payment_requests WHERE id = p_request;
  SELECT count(*), COALESCE(sum(amount), 0) INTO n, s FROM payment_installments WHERE request_id = p_request;
  IF n = 0 THEN RAISE EXCEPTION 'at least one installment is required' USING ERRCODE = '23514'; END IF;
  IF s <> r.total_amount THEN RAISE EXCEPTION 'installments (%) must add up to the request total (%)', s, r.total_amount USING ERRCODE = '23514'; END IF;
  IF r.total_amount <= 0 THEN RAISE EXCEPTION 'the amount must be more than zero' USING ERRCODE = '23514'; END IF;
  IF r.debit_account_id IS NULL THEN RAISE EXCEPTION 'choose the bank account the payment will be debited from' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM company_bank_accounts a WHERE a.id = r.debit_account_id AND a.is_active)
     OR r.debtor_company_id NOT IN (SELECT app_granted_companies(r.debit_account_id, 'USE')) THEN
    RAISE EXCEPTION 'the debit account is not available to this company' USING ERRCODE = '23514';
  END IF;
  IF r.invoice_ref IS NULL OR r.invoice_date IS NULL THEN RAISE EXCEPTION 'invoice reference and date are required' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM supplier_bank_details WHERE id = r.supplier_bank_detail_id AND supplier_id = r.supplier_id AND status = 'VERIFIED') THEN
    RAISE EXCEPTION 'verified supplier bank details are required' USING ERRCODE = '23514';
  END IF;
  IF NOT app_supplier_active_for(r.debtor_company_id, r.supplier_id) THEN RAISE EXCEPTION 'the supplier is not active for this company' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM attachments a WHERE a.request_id = p_request AND a.kind = 'INVOICE'
                 AND NOT EXISTS (SELECT 1 FROM attachments b WHERE b.supersedes_id = a.id)) THEN
    RAISE EXCEPTION 'an invoice attachment is required' USING ERRCODE = '23514';
  END IF;
END $$;

-- DRAFT -> RESERVED. The funds guard (trigger above) checks the available balance and locks the amount in the same statement.
CREATE OR REPLACE FUNCTION wf_submit(p_request uuid) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; v int; corr uuid := gen_random_uuid();
BEGIN
  PERFORM wf_assert_actor(p_request, 'SUBMISSION');
  SELECT * INTO r FROM payment_requests WHERE id = p_request FOR UPDATE;
  IF r.workflow_state <> 'DRAFT' THEN RAISE EXCEPTION 'only a draft can be submitted' USING ERRCODE = '42501'; END IF;
  IF NOT app_has_permission(r.debtor_company_id, 'payment_request:create') THEN RAISE EXCEPTION 'you may not submit payment requests for this company' USING ERRCODE = '42501'; END IF;
  PERFORM assert_submittable(p_request);
  v := wf_set_state(p_request, 'RESERVED');
  PERFORM wf_log(p_request, v, 'SUBMISSION', 'SUBMIT', 'ACCOUNTANT', NULL, corr);
  PERFORM wf_notify(p_request, 'REQUEST_SUBMITTED');
  RETURN v;
END $$;

-- The creator can withdraw a request until it is authenticated. A cancelled request is REJECTED (there is no separate
-- cancelled state) and its reserved funds are released by the funds guard.
CREATE OR REPLACE FUNCTION wf_cancel(p_request uuid, p_expected_version int, p_reason text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; v int; role_name text; corr uuid := gen_random_uuid();
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  role_name := wf_assert_actor(p_request, 'SUBMISSION');
  r := wf_lock(p_request, p_expected_version);
  IF r.workflow_state NOT IN ('DRAFT','SCHEDULED','RESERVED','VERIFIED') THEN RAISE EXCEPTION 'this request can no longer be cancelled' USING ERRCODE = '42501'; END IF;
  v := wf_set_state(p_request, 'REJECTED');
  PERFORM wf_log(p_request, v, 'SUBMISSION', 'CANCEL', role_name, p_reason, corr);
  PERFORM wf_notify(p_request, 'REQUEST_CANCELLED', jsonb_build_object('reason', p_reason));
  RETURN v;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Approvals queue: placeholder until the Approvals step
-- ---------------------------------------------------------------------------------------------------------------------
-- The old queue was built on the old states and made every page fail (the page frame counts it). Until verification and
-- authentication are rewritten, nothing is offered for approval.
CREATE OR REPLACE FUNCTION app_actionable_requests() RETURNS TABLE (request_id uuid, request_no text, stage text, debtor_company_id uuid, supplier_id uuid, total_amount numeric, request_version integer, waiting_since timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::uuid, NULL::numeric, NULL::integer, NULL::timestamptz WHERE false $$;
