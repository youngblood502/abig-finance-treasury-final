-- ABIG Finance - Phase 3: approval workflow (Inputter -> Verifier -> Authenticator), adjustments, reapproval matrix, outbox.
-- All state changes go through the wf_* functions. The app role can no longer set workflow_state directly.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'abig_worker') THEN CREATE ROLE abig_worker NOLOGIN NOBYPASSRLS; END IF;
END $$;
ALTER ROLE abig_worker SET jit = off;

CREATE TABLE approval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES payment_requests(id),
  request_version int NOT NULL,
  stage text NOT NULL CHECK (stage IN ('SUBMISSION','VERIFICATION','AUTHORIZATION')),
  action text NOT NULL CHECK (action IN ('SUBMIT','VERIFY','AUTHORIZE','RETURN','REJECT','CANCEL','ADJUST','INVALIDATE')),
  actor_id uuid NOT NULL REFERENCES users(id),
  actor_role text NOT NULL,
  reason text,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp() -- real time, so steps within one transaction stay ordered
);
CREATE INDEX approval_events_request_idx ON approval_events (request_id, occurred_at);

CREATE TABLE adjustment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES payment_requests(id),
  entity_type text NOT NULL CHECK (entity_type IN ('REQUEST','INSTALLMENT')),
  entity_id uuid NOT NULL,
  field text NOT NULL,
  old_value text,
  new_value text,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  actor_id uuid NOT NULL REFERENCES users(id),
  actor_role text NOT NULL,
  workflow_stage text NOT NULL,
  request_version int NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX adjustment_history_request_idx ON adjustment_history (request_id, occurred_at);

-- Written in the same transaction as the business change; delivered later by a worker.
CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  request_id uuid NOT NULL REFERENCES payment_requests(id),
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0,
  delivered_at timestamptz,
  last_error text,
  dead_at timestamptz
);
CREATE INDEX notification_outbox_pending_idx ON notification_outbox (available_at) WHERE delivered_at IS NULL AND dead_at IS NULL;

CREATE TRIGGER approval_events_append_only BEFORE UPDATE OR DELETE ON approval_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER approval_events_no_truncate BEFORE TRUNCATE ON approval_events FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER adjustment_history_append_only BEFORE UPDATE OR DELETE ON adjustment_history FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER adjustment_history_no_truncate BEFORE TRUNCATE ON adjustment_history FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- ---------- Replace the Phase 2 guards: drafts AND returned requests are editable by their creator ----------
CREATE OR REPLACE FUNCTION app_can_edit_draft(p_request uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM payment_requests r WHERE r.id = p_request AND r.workflow_state IN ('DRAFT','RETURNED') AND r.created_by = app_user_id()
                       AND r.debtor_company_id IN (SELECT app_member_companies('INPUTTER'))) $$;

-- The flag app.wf is set only inside wf_* functions. It is not a security boundary: the app role cannot update
-- workflow_state (no column grant), and RLS only lets it touch its own draft/returned rows.
CREATE OR REPLACE FUNCTION payment_request_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.version := 1; NEW.updated_at := now(); RETURN NEW; END IF;
  IF NEW.created_by <> OLD.created_by OR NEW.debtor_company_id <> OLD.debtor_company_id
     OR NEW.currency <> OLD.currency OR NEW.request_no <> OLD.request_no THEN
    RAISE EXCEPTION 'creator, debtor company, currency and number cannot change' USING ERRCODE = '42501';
  END IF;
  IF current_setting('app.wf', true) IS DISTINCT FROM 'on' THEN
    IF OLD.workflow_state NOT IN ('DRAFT','RETURNED') THEN RAISE EXCEPTION 'the request is locked after submission' USING ERRCODE = '42501'; END IF;
    IF NEW.workflow_state <> OLD.workflow_state THEN RAISE EXCEPTION 'use the workflow functions to change state' USING ERRCODE = '42501'; END IF;
  END IF;
  NEW.version := OLD.version + 1; NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION installment_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st text; cur char(3); rid uuid;
BEGIN
  rid := CASE WHEN TG_OP = 'DELETE' THEN OLD.request_id ELSE NEW.request_id END;
  SELECT workflow_state, currency INTO st, cur FROM payment_requests WHERE id = rid;
  IF current_setting('app.wf', true) IS DISTINCT FROM 'on' AND st NOT IN ('DRAFT','RETURNED') THEN
    RAISE EXCEPTION 'installments are locked after submission' USING ERRCODE = '42501';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.currency <> cur THEN RAISE EXCEPTION 'installment currency must match the request' USING ERRCODE = '23514'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE OR REPLACE FUNCTION attachment_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (SELECT workflow_state FROM payment_requests WHERE id = NEW.request_id) NOT IN ('DRAFT','RETURNED') THEN
    RAISE EXCEPTION 'attachments can only be added to a draft or returned request (a draft)' USING ERRCODE = '42501';
  END IF;
  IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM attachments WHERE id = NEW.supersedes_id AND request_id = NEW.request_id) THEN
    RAISE EXCEPTION 'a replacement must belong to the same request' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP POLICY requests_update_draft ON payment_requests;
CREATE POLICY requests_update_draft ON payment_requests FOR UPDATE TO abig_app
  USING (created_by = app_user_id() AND workflow_state IN ('DRAFT','RETURNED') AND debtor_company_id IN (SELECT app_member_companies('INPUTTER')))
  WITH CHECK (created_by = app_user_id());
REVOKE UPDATE (workflow_state) ON payment_requests FROM abig_app;

-- ---------- Workflow helpers ----------
CREATE FUNCTION assert_submittable(p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; n int; s numeric;
BEGIN
  SELECT * INTO r FROM payment_requests WHERE id = p_request;
  SELECT count(*), COALESCE(sum(amount), 0) INTO n, s FROM payment_installments WHERE request_id = p_request;
  IF n = 0 THEN RAISE EXCEPTION 'at least one installment is required' USING ERRCODE = '23514'; END IF;
  IF s <> r.total_amount THEN RAISE EXCEPTION 'installments (%) must add up to the request total (%)', s, r.total_amount USING ERRCODE = '23514'; END IF;
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

-- People who have acted at a stage of this request, over its whole history.
CREATE FUNCTION wf_stage_actors(p_request uuid, p_stage text) RETURNS SETOF uuid LANGUAGE sql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT DISTINCT actor_id FROM approval_events WHERE request_id = p_request AND stage = p_stage $$;

-- Checks who is acting. Separation of duties: the creator, the verification-stage actors and the authorization-stage actors
-- of a request must be three disjoint sets. Returns the role the person is acting in.
CREATE FUNCTION wf_assert_actor(p_request uuid, p_stage text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; me uuid := app_user_id(); role_name text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT app_can_see_request(p_request) THEN RAISE EXCEPTION 'request not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO r FROM payment_requests WHERE id = p_request;
  role_name := CASE p_stage WHEN 'VERIFICATION' THEN 'VERIFIER' WHEN 'AUTHORIZATION' THEN 'AUTHENTICATOR' ELSE 'INPUTTER' END;
  IF r.debtor_company_id NOT IN (SELECT app_member_companies(role_name)) THEN
    RAISE EXCEPTION 'you do not hold the % role for this company', role_name USING ERRCODE = '42501';
  END IF;
  IF p_stage = 'SUBMISSION' THEN
    IF r.created_by <> me THEN RAISE EXCEPTION 'only the creator can do this' USING ERRCODE = '42501'; END IF;
  ELSE
    IF r.created_by = me THEN RAISE EXCEPTION 'you created this request; the creator cannot verify or authorize it' USING ERRCODE = '42501'; END IF;
    IF p_stage = 'VERIFICATION' AND me IN (SELECT wf_stage_actors(p_request, 'AUTHORIZATION')) THEN
      RAISE EXCEPTION 'you already acted at the authorization stage of this request' USING ERRCODE = '42501';
    END IF;
    IF p_stage = 'AUTHORIZATION' AND me IN (SELECT wf_stage_actors(p_request, 'VERIFICATION')) THEN
      RAISE EXCEPTION 'you already acted at the verification stage of this request' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN role_name;
END $$;

CREATE FUNCTION wf_lock(p_request uuid, p_expected_version int) RETURNS payment_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests;
BEGIN
  SELECT * INTO r FROM payment_requests WHERE id = p_request FOR UPDATE;
  IF r.version <> p_expected_version THEN
    RAISE EXCEPTION 'the request changed (now version %); reload it before acting', r.version USING ERRCODE = '40001';
  END IF;
  RETURN r;
END $$;

CREATE FUNCTION wf_set_state(p_request uuid, p_state text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v int;
BEGIN
  PERFORM set_config('app.wf', 'on', true);
  UPDATE payment_requests SET workflow_state = p_state WHERE id = p_request RETURNING version INTO v;
  PERFORM set_config('app.wf', 'off', true);
  RETURN v;
END $$;

CREATE FUNCTION wf_log(p_request uuid, p_version int, p_stage text, p_action text, p_role text, p_reason text, p_corr uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO approval_events (request_id, request_version, stage, action, actor_id, actor_role, reason, correlation_id)
  VALUES (p_request, p_version, p_stage, p_action, app_user_id(), p_role, p_reason, p_corr);
  INSERT INTO audit_events (actor_id, company_id, action, entity_type, entity_id, metadata, correlation_id)
  SELECT app_user_id(), r.debtor_company_id, 'REQUEST_' || p_action, 'PAYMENT_REQUEST', r.id,
         jsonb_build_object('stage', p_stage, 'version', p_version, 'reason', p_reason), p_corr
  FROM payment_requests r WHERE r.id = p_request;
END $$;

CREATE FUNCTION wf_notify(p_request uuid, p_event text, p_payload jsonb DEFAULT '{}') RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ INSERT INTO notification_outbox (event_type, request_id, payload)
      SELECT p_event, r.id, p_payload || jsonb_build_object('request_no', r.request_no, 'state', r.workflow_state, 'version', r.version)
      FROM payment_requests r WHERE r.id = p_request $$;

-- ---------- Workflow actions ----------
CREATE FUNCTION wf_submit(p_request uuid) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; v int; corr uuid := gen_random_uuid();
BEGIN
  PERFORM wf_assert_actor(p_request, 'SUBMISSION');
  SELECT * INTO r FROM payment_requests WHERE id = p_request FOR UPDATE;
  IF r.workflow_state NOT IN ('DRAFT','RETURNED') THEN RAISE EXCEPTION 'only a draft or returned request can be submitted' USING ERRCODE = '42501'; END IF;
  PERFORM assert_submittable(p_request);
  v := wf_set_state(p_request, 'SUBMITTED');
  PERFORM wf_log(p_request, v, 'SUBMISSION', 'SUBMIT', 'INPUTTER', NULL, corr);
  PERFORM wf_notify(p_request, 'REQUEST_SUBMITTED');
  RETURN v;
END $$;

CREATE FUNCTION wf_verify(p_request uuid, p_expected_version int) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; v int; role_name text; corr uuid := gen_random_uuid();
BEGIN
  role_name := wf_assert_actor(p_request, 'VERIFICATION');
  r := wf_lock(p_request, p_expected_version);
  IF r.workflow_state <> 'SUBMITTED' THEN RAISE EXCEPTION 'the request is not waiting for verification' USING ERRCODE = '42501'; END IF;
  PERFORM assert_submittable(p_request);
  v := wf_set_state(p_request, 'VERIFIED');
  PERFORM wf_log(p_request, v, 'VERIFICATION', 'VERIFY', role_name, NULL, corr);
  PERFORM wf_notify(p_request, 'REQUEST_VERIFIED');
  RETURN v;
END $$;

CREATE FUNCTION wf_authorize(p_request uuid, p_expected_version int) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; v int; role_name text; corr uuid := gen_random_uuid();
BEGIN
  role_name := wf_assert_actor(p_request, 'AUTHORIZATION');
  r := wf_lock(p_request, p_expected_version);
  IF r.workflow_state <> 'VERIFIED' THEN RAISE EXCEPTION 'the request is not waiting for authorization' USING ERRCODE = '42501'; END IF;
  PERFORM assert_submittable(p_request);
  v := wf_set_state(p_request, 'AUTHORIZED');
  PERFORM wf_log(p_request, v, 'AUTHORIZATION', 'AUTHORIZE', role_name, NULL, corr);
  PERFORM wf_notify(p_request, 'REQUEST_AUTHORIZED');
  RETURN v;
END $$;

-- A verifier returns a submitted request; an authenticator returns a verified one. Approval history is kept and a marker invalidates it.
CREATE FUNCTION wf_return(p_request uuid, p_expected_version int, p_reason text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; v int; role_name text; stage text; st text; corr uuid := gen_random_uuid();
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  SELECT workflow_state INTO st FROM payment_requests WHERE id = p_request;
  stage := CASE st WHEN 'SUBMITTED' THEN 'VERIFICATION' WHEN 'VERIFIED' THEN 'AUTHORIZATION' END;
  IF stage IS NULL THEN RAISE EXCEPTION 'only a submitted or verified request can be returned' USING ERRCODE = '42501'; END IF;
  role_name := wf_assert_actor(p_request, stage);
  r := wf_lock(p_request, p_expected_version);
  v := wf_set_state(p_request, 'RETURNED');
  PERFORM wf_log(p_request, v, stage, 'RETURN', role_name, p_reason, corr);
  PERFORM wf_log(p_request, v, stage, 'INVALIDATE', role_name, 'returned for correction', corr);
  PERFORM wf_notify(p_request, 'REQUEST_RETURNED', jsonb_build_object('reason', p_reason));
  RETURN v;
END $$;

CREATE FUNCTION wf_reject(p_request uuid, p_expected_version int, p_reason text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; v int; role_name text; corr uuid := gen_random_uuid();
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  role_name := wf_assert_actor(p_request, 'AUTHORIZATION');
  r := wf_lock(p_request, p_expected_version);
  IF r.workflow_state <> 'VERIFIED' THEN RAISE EXCEPTION 'only a verified request can be rejected, by an authenticator' USING ERRCODE = '42501'; END IF;
  v := wf_set_state(p_request, 'REJECTED');
  PERFORM wf_log(p_request, v, 'AUTHORIZATION', 'REJECT', role_name, p_reason, corr);
  PERFORM wf_notify(p_request, 'REQUEST_REJECTED', jsonb_build_object('reason', p_reason));
  RETURN v;
END $$;

-- The creator can cancel before authorization. Cancelling an authorized request needs reservation handling (Phase 5).
CREATE FUNCTION wf_cancel(p_request uuid, p_expected_version int, p_reason text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; v int; role_name text; corr uuid := gen_random_uuid();
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  role_name := wf_assert_actor(p_request, 'SUBMISSION');
  r := wf_lock(p_request, p_expected_version);
  IF r.workflow_state NOT IN ('DRAFT','RETURNED','SUBMITTED','VERIFIED') THEN RAISE EXCEPTION 'this request can no longer be cancelled here' USING ERRCODE = '42501'; END IF;
  v := wf_set_state(p_request, 'CANCELLED');
  PERFORM wf_log(p_request, v, 'SUBMISSION', 'CANCEL', role_name, p_reason, corr);
  PERFORM wf_notify(p_request, 'REQUEST_CANCELLED', jsonb_build_object('reason', p_reason));
  RETURN v;
END $$;

-- Adjustment with the reapproval matrix:
--   amount change                      -> restart at Verification (prior verification invalidated)
--   supplier or bank detail change     -> restart at Verification; the new bank detail must be verified
--   due date change only               -> approvals kept; treasury must reconfirm the schedule
--   priority / invoice ref / description -> approvals kept
-- p_changes keys: total_amount, priority, invoice_ref, description, supplier_id, supplier_bank_detail_id,
--                 installments: [{seq, amount?, due_date?}]
CREATE FUNCTION wf_adjust(p_request uuid, p_expected_version int, p_changes jsonb, p_reason text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  stage := CASE st WHEN 'SUBMITTED' THEN 'VERIFICATION' WHEN 'VERIFIED' THEN 'AUTHORIZATION' END;
  IF stage IS NULL THEN RAISE EXCEPTION 'only a submitted or verified request can be adjusted' USING ERRCODE = '42501'; END IF;
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

  new_state := CASE WHEN (amount_changed OR payee_changed) THEN 'SUBMITTED' ELSE st END;
  UPDATE payment_requests SET total_amount = n_total, priority = n_priority, invoice_ref = n_ref, description = n_desc,
         supplier_id = n_supplier, supplier_bank_detail_id = n_bank, workflow_state = new_state WHERE id = p_request;
  PERFORM set_config('app.wf', 'off', true);
  PERFORM assert_submittable(p_request); -- totals add up, bank details verified for the (new) supplier, supplier active

  PERFORM wf_log(p_request, v, stage, 'ADJUST', role_name, p_reason, corr);
  IF st = 'VERIFIED' AND new_state = 'SUBMITTED' THEN
    PERFORM wf_log(p_request, v, stage, 'INVALIDATE', role_name, 'amount or payee changed: restart at verification', corr);
  END IF;
  IF new_state = 'SUBMITTED' THEN PERFORM wf_notify(p_request, 'REQUEST_RESTARTED', jsonb_build_object('reason', p_reason));
  ELSIF due_changed THEN PERFORM wf_notify(p_request, 'REQUEST_RESCHEDULE_NEEDED', jsonb_build_object('reason', p_reason));
  ELSE PERFORM wf_notify(p_request, 'REQUEST_ADJUSTED', jsonb_build_object('reason', p_reason)); END IF;
  RETURN v;
END $$;

-- Requests this user can act on right now (for the approval queue screen).
CREATE FUNCTION app_actionable_requests() RETURNS TABLE (request_id uuid, request_no text, stage text, debtor_company_id uuid, supplier_id uuid, total_amount numeric, request_version int, waiting_since timestamptz)
LANGUAGE sql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id, r.request_no, CASE r.workflow_state WHEN 'SUBMITTED' THEN 'VERIFICATION' ELSE 'AUTHORIZATION' END,
         r.debtor_company_id, r.supplier_id, r.total_amount, r.version, r.updated_at
  FROM payment_requests r
  WHERE r.created_by <> app_user_id() AND (
    (r.workflow_state = 'SUBMITTED' AND r.debtor_company_id IN (SELECT app_member_companies('VERIFIER'))
       AND NOT app_user_id() IN (SELECT wf_stage_actors(r.id, 'AUTHORIZATION')))
    OR (r.workflow_state = 'VERIFIED' AND r.debtor_company_id IN (SELECT app_member_companies('AUTHENTICATOR'))
       AND NOT app_user_id() IN (SELECT wf_stage_actors(r.id, 'VERIFICATION'))))
  ORDER BY r.updated_at $$;

-- ---------- Outbox: recipients are resolved at delivery time, so revoked access is respected ----------
CREATE FUNCTION company_role_users(p_company uuid, p_role text) RETURNS SETOF uuid LANGUAGE sql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT m.user_id FROM company_memberships m JOIN users u ON u.id = m.user_id AND u.is_active
      WHERE m.company_id = p_company AND p_role = ANY (m.roles) AND m.revoked_at IS NULL
        AND m.valid_from <= now() AND (m.valid_to IS NULL OR m.valid_to > now()) $$;

CREATE FUNCTION outbox_recipients(p_event uuid) RETURNS TABLE (user_id uuid, email text) LANGUAGE plpgsql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e notification_outbox; r payment_requests; ids uuid[];
BEGIN
  SELECT * INTO e FROM notification_outbox WHERE id = p_event;
  SELECT * INTO r FROM payment_requests WHERE id = e.request_id;
  IF e.event_type IN ('REQUEST_SUBMITTED','REQUEST_RESTARTED') THEN
    ids := ARRAY(SELECT x FROM company_role_users(r.debtor_company_id, 'VERIFIER') x
                 WHERE x <> r.created_by AND x NOT IN (SELECT wf_stage_actors(r.id, 'AUTHORIZATION')));
  ELSIF e.event_type = 'REQUEST_VERIFIED' THEN
    ids := ARRAY(SELECT x FROM company_role_users(r.debtor_company_id, 'AUTHENTICATOR') x
                 WHERE x <> r.created_by AND x NOT IN (SELECT wf_stage_actors(r.id, 'VERIFICATION')));
  ELSIF e.event_type IN ('REQUEST_AUTHORIZED','REQUEST_RESCHEDULE_NEEDED') THEN
    ids := ARRAY(SELECT x FROM company_role_users(r.debtor_company_id, 'TREASURY') x) || r.created_by;
  ELSE
    ids := ARRAY[r.created_by];
  END IF;
  RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
END $$;

CREATE FUNCTION outbox_claim(p_limit int DEFAULT 20) RETURNS SETOF notification_outbox LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH c AS (SELECT id FROM notification_outbox WHERE delivered_at IS NULL AND dead_at IS NULL AND available_at <= now()
             ORDER BY created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
  UPDATE notification_outbox o SET attempts = o.attempts + 1, available_at = now() + interval '5 minutes' -- lease: a crashed worker's rows come back
  FROM c WHERE o.id = c.id RETURNING o.* $$;
CREATE FUNCTION outbox_complete(p_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ UPDATE notification_outbox SET delivered_at = now(), last_error = NULL WHERE id = p_id $$;
CREATE FUNCTION outbox_fail(p_id uuid, p_error text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ UPDATE notification_outbox SET last_error = left(p_error, 500),
        available_at = now() + least(power(2, attempts), 60) * interval '1 minute',
        dead_at = CASE WHEN attempts >= 8 THEN now() END
      WHERE id = p_id $$;

-- ---------- RLS and privileges ----------
ALTER TABLE approval_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE adjustment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY; -- no policy: the app role sees nothing
CREATE POLICY approval_events_read ON approval_events FOR SELECT TO abig_app USING (app_can_see_request(request_id));
CREATE POLICY adjustment_history_read ON adjustment_history FOR SELECT TO abig_app USING (app_can_see_request(request_id));
GRANT SELECT ON approval_events, adjustment_history TO abig_app;

REVOKE EXECUTE ON FUNCTION wf_assert_actor(uuid, text), wf_lock(uuid, int), wf_set_state(uuid, text), wf_log(uuid, int, text, text, text, text, uuid),
  wf_notify(uuid, text, jsonb), assert_submittable(uuid), wf_stage_actors(uuid, text), company_role_users(uuid, text),
  outbox_recipients(uuid), outbox_claim(int), outbox_complete(uuid), outbox_fail(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outbox_recipients(uuid), outbox_claim(int), outbox_complete(uuid), outbox_fail(uuid, text) TO abig_worker;
GRANT USAGE ON SCHEMA public TO abig_worker;
-- The wf_* actions, app_actionable_requests and the earlier app_* helpers stay executable by the app role.
