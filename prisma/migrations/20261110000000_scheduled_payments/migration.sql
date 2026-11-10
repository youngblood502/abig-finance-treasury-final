-- ABIG Finance - Phase 6 Task 3B: scheduled payments.
--
-- A draft can be scheduled for a later date instead of being submitted now. On that date the worker submits it, through the same path as a person
-- submitting: the same checks (assert_submittable), the same state change, and the same funds guard, which reserves the money under the account lock.
--
-- Approved rules:
--   1. The worker submits it on its date. The actor recorded is System (a fixed, deactivated user that cannot sign in); the creator stays the creator,
--      so separation of duties is unchanged: the creator still cannot verify or authenticate it.
--   2-3. If anything stops it on the date (not enough available balance, a shortfall, account access or eligibility, supplier or person status,
--      bank details, missing installments, the creator no longer allowed to submit...), it stays Scheduled, nothing is reserved, and its creator is
--      told once, with the reason. Hourly retries carry on quietly; the reason shown on the request is kept current.
--   4. The creator may change a Scheduled request: it goes back to a draft, is edited, and is scheduled again, all in one transaction, with the
--      details before and after in the audit history. The scheduled date is after today and on or before the first installment's due date.
--
-- New: payment_requests.scheduled_for and the schedule_* status columns; wf_schedule, wf_unschedule and release_scheduled_requests (worker);
-- the REQUEST_SCHEDULE_BLOCKED notification to the creator. Nothing else about submission, approval, reservation or the outbox changes.

-- ---------- The System actor ----------
INSERT INTO users (id, email, full_name, is_active, is_system_admin, password_hash)
VALUES ('00000000-0000-4000-8000-000000000000', 'system@abig.invalid', 'System (automatic actions)', false, false, NULL)
ON CONFLICT (id) DO NOTHING;
CREATE FUNCTION app_system_user() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '00000000-0000-4000-8000-000000000000'::uuid $$;

-- It records automatic actions only: it can never be activated, given a password or administration, or a company membership.
CREATE FUNCTION system_user_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    IF OLD.id = app_system_user() AND (NEW.is_active OR NEW.is_system_admin OR NEW.password_hash IS NOT NULL OR NEW.email <> OLD.email OR NEW.id <> OLD.id) THEN
      RAISE EXCEPTION 'the System user records automatic actions and cannot be changed' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.user_id = app_system_user() THEN RAISE EXCEPTION 'the System user cannot be a member of a company' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_system_guard BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION system_user_guard();
CREATE TRIGGER memberships_system_guard BEFORE INSERT OR UPDATE ON company_memberships FOR EACH ROW EXECUTE FUNCTION system_user_guard();

-- ---------- Columns ----------
ALTER TABLE payment_requests
  ADD COLUMN scheduled_for date,
  ADD COLUMN schedule_error text,                 -- why the last attempt on the date did not submit it; cleared when it is submitted or rescheduled
  ADD COLUMN schedule_error_at timestamptz,
  ADD COLUMN schedule_notified_at timestamptz,    -- when its creator was told; set once per request (kept when it is changed and rescheduled), so nobody is told twice
  ADD CONSTRAINT payment_requests_scheduled_date_chk CHECK (workflow_state <> 'SCHEDULED' OR scheduled_for IS NOT NULL);
-- The application reads them; only the workflow functions below write them (the app role has no INSERT or UPDATE on them).
GRANT SELECT (scheduled_for, schedule_error, schedule_error_at, schedule_notified_at) ON payment_requests TO abig_app;
CREATE INDEX payment_requests_scheduled_due_idx ON payment_requests (scheduled_for) WHERE workflow_state = 'SCHEDULED';

ALTER TABLE approval_events DROP CONSTRAINT approval_events_action_check;
ALTER TABLE approval_events ADD CONSTRAINT approval_events_action_check
  CHECK (action IN ('SUBMIT','VERIFY','AUTHORIZE','RETURN','REJECT','CANCEL','ADJUST','INVALIDATE','SCHEDULE','UNSCHEDULE'));

-- The request's details as an audit record: what was scheduled, and what an edit changed.
CREATE FUNCTION request_snapshot(p_request uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('scheduled_for', r.scheduled_for, 'total_amount', r.total_amount, 'debit_account_id', r.debit_account_id, 'payment_method', r.payment_method,
           'supplier_id', r.supplier_id, 'supplier_bank_detail_id', r.supplier_bank_detail_id, 'person_payee_id', r.person_payee_id, 'person_payment_detail_id', r.person_payment_detail_id,
           'invoice_ref', r.invoice_ref, 'invoice_date', r.invoice_date, 'priority', r.priority, 'description', r.description,
           'installments', COALESCE((SELECT jsonb_agg(jsonb_build_object('seq', i.seq, 'due_date', i.due_date, 'amount', i.amount) ORDER BY i.seq) FROM payment_installments i WHERE i.request_id = r.id), '[]'::jsonb))
    FROM payment_requests r WHERE r.id = p_request $$;

-- An approval-trail entry and its audit event, for an actor given explicitly (System has no session).
CREATE FUNCTION schedule_log(p_request uuid, p_version int, p_action text, p_actor uuid, p_role text, p_reason text, p_meta jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE corr uuid := gen_random_uuid();
BEGIN
  INSERT INTO approval_events (request_id, request_version, stage, action, actor_id, actor_role, reason, correlation_id)
  VALUES (p_request, p_version, 'SUBMISSION', p_action, p_actor, p_role, p_reason, corr);
  INSERT INTO audit_events (actor_id, company_id, action, entity_type, entity_id, metadata, correlation_id)
  SELECT p_actor, r.debtor_company_id, 'REQUEST_' || p_action, 'PAYMENT_REQUEST', r.id,
         jsonb_build_object('stage', 'SUBMISSION', 'version', p_version, 'reason', p_reason) || COALESCE(p_meta, '{}'::jsonb), corr
    FROM payment_requests r WHERE r.id = p_request;
END $$;

-- ---------- Scheduling a draft ----------
CREATE FUNCTION wf_schedule(p_request uuid, p_date date) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; role_name text; first_due date; v int; today date := addis_day(treasury_now());
BEGIN
  role_name := wf_assert_actor(p_request, 'SUBMISSION');   -- the creator, holding payment_request:create
  SELECT * INTO r FROM payment_requests WHERE id = p_request FOR UPDATE;
  IF r.workflow_state <> 'DRAFT' THEN RAISE EXCEPTION 'only a draft can be scheduled' USING ERRCODE = '42501'; END IF;
  IF NOT app_has_permission(r.debtor_company_id, 'payment_request:schedule') THEN RAISE EXCEPTION 'you may not schedule payment requests for this company' USING ERRCODE = '42501'; END IF;
  IF p_date IS NULL OR p_date <= today THEN RAISE EXCEPTION 'choose a scheduled date after today; to send it for verification today, submit it instead' USING ERRCODE = '23514'; END IF;
  SELECT min(due_date) INTO first_due FROM payment_installments WHERE request_id = p_request;
  IF first_due IS NOT NULL AND p_date > first_due THEN
    RAISE EXCEPTION 'the scheduled date must be on or before the first installment''s due date (%)', first_due USING ERRCODE = '23514';
  END IF;
  PERFORM assert_submittable(p_request);   -- everything a submission needs today, except the funds, which are reserved on the date
  PERFORM set_config('app.wf', 'on', true);
  UPDATE payment_requests SET workflow_state = 'SCHEDULED', scheduled_for = p_date, schedule_error = NULL, schedule_error_at = NULL
   WHERE id = p_request RETURNING version INTO v;
  PERFORM set_config('app.wf', 'off', true);
  PERFORM schedule_log(p_request, v, 'SCHEDULE', app_user_id(), role_name, 'Scheduled for ' || p_date, jsonb_build_object('details', request_snapshot(p_request)));
  RETURN v;
END $$;

-- Back to a draft, so the creator can change it (and schedule it again in the same transaction). Allowed while it is still Scheduled.
CREATE FUNCTION wf_unschedule(p_request uuid, p_expected_version integer) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; role_name text; v int; before jsonb;
BEGIN
  role_name := wf_assert_actor(p_request, 'SUBMISSION');
  r := wf_lock(p_request, p_expected_version);
  IF r.workflow_state <> 'SCHEDULED' THEN RAISE EXCEPTION 'only a scheduled request can be changed this way; it may already have been submitted' USING ERRCODE = '42501'; END IF;
  before := request_snapshot(p_request);
  v := wf_set_state(p_request, 'DRAFT');
  PERFORM schedule_log(p_request, v, 'UNSCHEDULE', app_user_id(), role_name, 'Changed by its creator before submission', jsonb_build_object('details', before));
  RETURN v;
END $$;

-- ---------- The worker: submit what is due ----------
-- Concurrent runs skip requests another run holds (SKIP LOCKED); a request is submitted only while it is still Scheduled, under its row lock, so it
-- cannot be submitted twice. Each request is tried on its own: one that is refused does not stop the others. Lock and serialization conflicts are
-- left for the next run without telling anyone.
CREATE FUNCTION release_scheduled_requests() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET "TimeZone" = 'Africa/Addis_Ababa' AS $$
DECLARE r payment_requests; v int; n int := 0; why text;
BEGIN
  FOR r IN SELECT * FROM payment_requests WHERE workflow_state = 'SCHEDULED' AND scheduled_for <= addis_day(treasury_now())
            ORDER BY scheduled_for, created_at, id FOR UPDATE SKIP LOCKED LOOP
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.created_by AND u.is_active
                       AND (u.is_system_admin OR u.id IN (SELECT company_permission_users(r.debtor_company_id, 'payment_request:create')))) THEN
        RAISE EXCEPTION 'the person who scheduled it can no longer submit payment requests for this company' USING ERRCODE = '42501';
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

REVOKE EXECUTE ON FUNCTION app_system_user(), system_user_guard(), request_snapshot(uuid), schedule_log(uuid, int, text, uuid, text, text, jsonb),
  wf_schedule(uuid, date), wf_unschedule(uuid, integer), release_scheduled_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wf_schedule(uuid, date), wf_unschedule(uuid, integer) TO abig_app;
GRANT EXECUTE ON FUNCTION release_scheduled_requests() TO abig_worker;
