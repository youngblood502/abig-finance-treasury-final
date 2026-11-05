-- ABIG Finance - Phase 5: scheduler. Forecast, ranked funding recommendations, schedule queue, confirmation,
-- reapproval after funding (due date / amount / payee changes), cancelling an authorized request, overdue reminders.
-- Recommendations are read-only and may go stale; confirming rechecks everything inside treasury_reserve (Phase 4).

CREATE TABLE cash_forecast_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES company_bank_accounts(id),
  kind text NOT NULL CHECK (kind IN ('INFLOW','OUTFLOW')),
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL DEFAULT 'ETB' CHECK (currency = 'ETB'),
  expected_date date NOT NULL,
  description text NOT NULL CHECK (length(btrim(description)) >= 3),
  status text NOT NULL DEFAULT 'EXPECTED' CHECK (status IN ('EXPECTED','CANCELLED')),
  cancel_reason text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cancelled_at timestamptz
);
CREATE INDEX cash_forecast_account_idx ON cash_forecast_items (account_id, expected_date) WHERE status = 'EXPECTED';

CREATE FUNCTION forecast_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'cancel_reason' - 'cancelled_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'cancel_reason' - 'cancelled_at')
     OR OLD.status <> 'EXPECTED' OR NEW.status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'a forecast item can only be cancelled' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cash_forecast_guard BEFORE UPDATE ON cash_forecast_items FOR EACH ROW EXECUTE FUNCTION forecast_guard();
CREATE TRIGGER cash_forecast_no_delete BEFORE DELETE ON cash_forecast_items FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE cash_forecast_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY forecast_read ON cash_forecast_items FOR SELECT TO abig_app USING (app_can_see_account(account_id));
GRANT SELECT ON cash_forecast_items TO abig_app;

CREATE FUNCTION forecast_add(p_account uuid, p_kind text, p_amount numeric, p_date date, p_description text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF app_user_id() IS NULL OR NOT app_can_snapshot(p_account) THEN RAISE EXCEPTION 'you may not edit the forecast of this account' USING ERRCODE = '42501'; END IF;
  IF p_date < current_date THEN RAISE EXCEPTION 'a forecast item cannot be dated in the past' USING ERRCODE = '23514'; END IF;
  INSERT INTO cash_forecast_items (account_id, kind, amount, expected_date, description, created_by)
  VALUES (p_account, p_kind, p_amount, p_date, p_description, app_user_id()) RETURNING cash_forecast_items.id INTO v_id;
  PERFORM treasury_audit((SELECT owner_company_id FROM company_bank_accounts WHERE id = p_account), 'FORECAST_ITEM_ADDED', 'BANK_ACCOUNT', p_account,
         jsonb_build_object('kind', p_kind, 'amount', p_amount, 'date', p_date));
  RETURN v_id;
END $$;

CREATE FUNCTION forecast_cancel(p_item uuid, p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE f cash_forecast_items;
BEGIN
  SELECT * INTO f FROM cash_forecast_items WHERE id = p_item;
  IF NOT FOUND OR app_user_id() IS NULL OR NOT app_can_snapshot(f.account_id) THEN RAISE EXCEPTION 'forecast item not found' USING ERRCODE = 'P0002'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  UPDATE cash_forecast_items SET status = 'CANCELLED', cancel_reason = p_reason, cancelled_at = now() WHERE id = p_item;
END $$;

-- Forecast cash, shown separately from actual cash: today's available amount plus expected inflows and outflows, day by day.
CREATE FUNCTION _forecast(p_account uuid, p_days int) RETURNS TABLE (day date, inflow numeric, outflow numeric, projected_available numeric)
LANGUAGE sql STABLE ROWS 100 SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH d AS (SELECT generate_series(current_date, current_date + p_days, interval '1 day')::date AS dd),
  f AS (SELECT x.expected_date AS fd, sum(CASE x.kind WHEN 'INFLOW' THEN x.amount ELSE 0 END) AS fi, sum(CASE x.kind WHEN 'OUTFLOW' THEN x.amount ELSE 0 END) AS fo
        FROM cash_forecast_items x WHERE x.account_id = p_account AND x.status = 'EXPECTED' AND x.expected_date >= current_date GROUP BY x.expected_date)
  SELECT d.dd, COALESCE(f.fi, 0), COALESCE(f.fo, 0),
         (SELECT p.available FROM _cash_position(p_account) p) + COALESCE(sum(COALESCE(f.fi, 0) - COALESCE(f.fo, 0)) OVER (ORDER BY d.dd), 0)
  FROM d LEFT JOIN f ON f.fd = d.dd ORDER BY d.dd $$;
CREATE FUNCTION account_forecast(p_account uuid, p_days int DEFAULT 30) RETURNS TABLE (day date, inflow numeric, outflow numeric, projected_available numeric)
LANGUAGE sql STABLE ROWS 100 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT * FROM _forecast(p_account, LEAST(GREATEST(p_days, 1), 180)) WHERE app_can_see_account(p_account) $$;

-- Ranked funding options for one installment. Read-only; explains every option.
-- Order: usable options first, then the company's own account (avoid intercompany use), then fresher balance, then most headroom.
CREATE FUNCTION treasury_recommend(p_installment uuid) RETURNS TABLE (
  rank int, account_id uuid, account_label text, owner_name text, is_own_account boolean, available numeric, snapshot_age_hours numeric, freshness text,
  amount_needed numeric, shortfall numeric, eligible boolean, needs_owner_approval boolean, earliest_feasible_date date, suggested_date date, reason text)
LANGUAGE plpgsql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; inst payment_installments; need numeric;
BEGIN
  r := treasury_context(p_installment);
  SELECT * INTO inst FROM payment_installments WHERE id = p_installment;
  need := installment_outstanding(p_installment) - COALESCE((SELECT sum(c.amount - c.consumed_amount) FROM cash_reservations c WHERE c.installment_id = p_installment AND c.status = 'ACTIVE'), 0);
  IF need <= 0 THEN RETURN; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT a.id AS aid, a.account_label AS lbl, o.legal_name AS oname, (a.owner_company_id = r.debtor_company_id) AS own,
           p.available AS avail, p.snapshot_age_hours AS age, p.freshness AS fresh,
           (a.owner_approval_required AND a.owner_company_id <> r.debtor_company_id) AS needs_appr,
           EXISTS (SELECT 1 FROM account_use_approvals x WHERE x.account_id = a.id AND x.installment_id = p_installment AND x.revoked_at IS NULL) AS approved,
           EXISTS (SELECT 1 FROM cash_forecast_items x WHERE x.account_id = a.id AND x.status = 'EXPECTED' AND x.expected_date >= current_date) AS has_forecast
    FROM company_bank_accounts a JOIN companies o ON o.id = a.owner_company_id, LATERAL _cash_position(a.id) p
    WHERE a.is_active AND (a.owner_company_id = r.debtor_company_id OR r.debtor_company_id IN (SELECT app_granted_companies(a.id, 'USE')))),
  scored AS (
    SELECT b.*, b.avail - need AS headroom,
           (b.fresh IN ('OK','WARN') AND b.avail >= need AND (NOT b.needs_appr OR b.approved)) AS ok,
           CASE WHEN b.fresh NOT IN ('OK','WARN') THEN NULL
                WHEN b.avail >= need THEN current_date
                WHEN b.has_forecast THEN (SELECT min(f.day) FROM _forecast(b.aid, 90) f WHERE f.projected_available >= need) END AS earliest
    FROM base b)
  SELECT (row_number() OVER (ORDER BY s.ok DESC, s.own DESC, (s.fresh = 'OK') DESC, s.headroom DESC, s.lbl))::int,
         s.aid, s.lbl, s.oname, s.own, s.avail, s.age, s.fresh, need, GREATEST(need - s.avail, 0), s.ok, s.needs_appr, s.earliest,
         CASE WHEN s.earliest IS NULL THEN NULL ELSE GREATEST(current_date, inst.due_date, s.earliest) END,
         CASE WHEN s.fresh = 'NONE' THEN 'No balance snapshot yet'
              WHEN s.fresh = 'BLOCK' THEN format('The balance is %s hours old (over the limit); record a new snapshot or give an override reason', s.age)
              WHEN s.needs_appr AND NOT s.approved THEN 'The account owner must approve this use first'
              WHEN s.avail < need THEN format('Shortfall of %s', to_char(need - s.avail, 'FM999,999,999,990')) ||
                   CASE WHEN s.earliest IS NOT NULL THEN format('; enough cash is expected by %s', s.earliest) ELSE '; no expected inflow covers it' END
              ELSE CASE WHEN s.own THEN 'Own account' ELSE 'Shared account owned by ' || s.oname END ||
                   format('; %s available after the minimum buffer', to_char(s.avail, 'FM999,999,999,990')) ||
                   CASE WHEN s.fresh = 'WARN' THEN format('; the balance is %s hours old', s.age) ELSE '' END END
  FROM scored s ORDER BY 1;
END $$;

-- The treasury work list: unfunded first, then overdue, then priority, then due date.
CREATE FUNCTION treasury_schedule_queue() RETURNS TABLE (
  installment_id uuid, request_id uuid, request_no text, debtor_company_id uuid, supplier_name text, seq int, due_date date, priority text,
  outstanding numeric, reserved numeric, unfunded numeric, days_to_due int, overdue boolean, funded boolean, planned_date date, funding_account_id uuid)
LANGUAGE sql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, r.id, r.request_no, r.debtor_company_id, s.legal_name, i.seq, i.due_date, r.priority,
         installment_outstanding(i.id), COALESCE(rs.amt, 0), GREATEST(installment_outstanding(i.id) - COALESCE(rs.amt, 0), 0),
         (i.due_date - current_date)::int, i.due_date < current_date, COALESCE(rs.amt, 0) >= installment_outstanding(i.id), rs.pdate, rs.acct
  FROM payment_installments i JOIN payment_requests r ON r.id = i.request_id JOIN suppliers s ON s.id = r.supplier_id
  LEFT JOIN LATERAL (SELECT sum(c.amount - c.consumed_amount) AS amt, min(c.planned_date) AS pdate, (array_agg(c.account_id))[1] AS acct
                     FROM cash_reservations c WHERE c.installment_id = i.id AND c.status = 'ACTIVE') rs ON true
  WHERE r.workflow_state = 'AUTHORIZED' AND r.debtor_company_id IN (SELECT app_member_companies('TREASURY')) AND installment_outstanding(i.id) > 0
  ORDER BY (COALESCE(rs.amt, 0) >= installment_outstanding(i.id)), (i.due_date < current_date) DESC,
           CASE r.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, i.due_date, r.request_no, i.seq $$;

-- Confirms a schedule: date + account (+ amount when split funding is on). Defaults to funding the whole unreserved amount.
CREATE FUNCTION treasury_confirm_schedule(p_installment uuid, p_account uuid, p_planned_date date, p_override_reason text DEFAULT NULL, p_amount numeric DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE need numeric;
BEGIN
  IF p_planned_date < current_date THEN RAISE EXCEPTION 'the planned payment date cannot be in the past' USING ERRCODE = '23514'; END IF;
  need := installment_outstanding(p_installment) - COALESCE((SELECT sum(c.amount - c.consumed_amount) FROM cash_reservations c WHERE c.installment_id = p_installment AND c.status = 'ACTIVE'), 0);
  RETURN treasury_reserve(p_installment, p_account, COALESCE(p_amount, need), p_planned_date, p_override_reason);
END $$;

-- Cancelling an authorized request: authenticator only, no unreversed payments, reservations released.
CREATE FUNCTION wf_cancel_authorized(p_request uuid, p_expected_version int, p_reason text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; v int; role_name text; corr uuid := gen_random_uuid();
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  role_name := wf_assert_actor(p_request, 'AUTHORIZATION');
  r := wf_lock(p_request, p_expected_version);
  IF r.workflow_state <> 'AUTHORIZED' THEN RAISE EXCEPTION 'only an authorized request can be cancelled here' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM payment_transactions pt JOIN payment_installments pi ON pi.id = pt.installment_id WHERE pi.request_id = p_request
             AND NOT EXISTS (SELECT 1 FROM payment_reversals x WHERE x.payment_id = pt.id)) THEN
    RAISE EXCEPTION 'payments were already recorded; reverse them before cancelling' USING ERRCODE = '42501';
  END IF;
  UPDATE cash_reservations c SET status = 'RELEASED', close_reason = 'request cancelled', closed_at = now()
  FROM payment_installments pi WHERE c.installment_id = pi.id AND pi.request_id = p_request AND c.status = 'ACTIVE';
  v := wf_set_state(p_request, 'CANCELLED');
  PERFORM wf_log(p_request, v, 'AUTHORIZATION', 'CANCEL', role_name, p_reason, corr);
  PERFORM wf_notify(p_request, 'REQUEST_CANCELLED', jsonb_build_object('reason', p_reason));
  RETURN v;
END $$;

-- Worker job: remind treasury about authorized requests with overdue unpaid installments, at most once a day per request.
CREATE FUNCTION treasury_enqueue_overdue() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  INSERT INTO notification_outbox (event_type, request_id, payload)
  SELECT 'REQUEST_OVERDUE', r.id, jsonb_build_object('request_no', r.request_no, 'state', r.workflow_state, 'overdue_amount', sum(installment_outstanding(i.id)))
  FROM payment_requests r JOIN payment_installments i ON i.request_id = r.id
  WHERE r.workflow_state = 'AUTHORIZED' AND i.due_date < current_date AND installment_outstanding(i.id) > 0
    AND NOT EXISTS (SELECT 1 FROM notification_outbox o WHERE o.request_id = r.id AND o.event_type = 'REQUEST_OVERDUE' AND o.created_at > now() - interval '24 hours')
  GROUP BY r.id, r.request_no, r.workflow_state;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION _forecast(uuid, int), treasury_enqueue_overdue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION treasury_enqueue_overdue() TO abig_worker;

-- What an account owner must decide: authorized installments from companies that use this account, waiting for approval.
-- The owner cannot see other companies' requests, so this shows exactly what it needs to decide and nothing more.
CREATE FUNCTION owner_pending_approvals() RETURNS TABLE (account_id uuid, account_label text, installment_id uuid, company_name text, request_no text, supplier_name text, amount numeric, due_date date)
LANGUAGE sql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.account_label, i.id, c.legal_name, r.request_no, s.legal_name, installment_outstanding(i.id), i.due_date
  FROM company_bank_accounts a
  JOIN company_bank_account_access g ON g.account_id = a.id AND g.revoked_at IS NULL AND g.valid_from <= now() AND (g.valid_to IS NULL OR g.valid_to > now()) AND 'USE' = ANY (g.permissions)
  JOIN payment_requests r ON r.debtor_company_id = g.company_id AND r.workflow_state = 'AUTHORIZED'
  JOIN payment_installments i ON i.request_id = r.id JOIN companies c ON c.id = r.debtor_company_id JOIN suppliers s ON s.id = r.supplier_id
  WHERE a.owner_approval_required AND app_can_manage_access(a.id) AND installment_outstanding(i.id) > 0
    AND NOT EXISTS (SELECT 1 FROM account_use_approvals x WHERE x.account_id = a.id AND x.installment_id = i.id AND x.revoked_at IS NULL)
  ORDER BY i.due_date, r.request_no $$;

-- ---------- Replaced functions (full text) ----------
CREATE OR REPLACE FUNCTION wf_adjust(p_request uuid, p_expected_version int, p_changes jsonb, p_reason text) RETURNS int
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
  stage := CASE st WHEN 'SUBMITTED' THEN 'VERIFICATION' WHEN 'VERIFIED' THEN 'AUTHORIZATION' WHEN 'AUTHORIZED' THEN 'AUTHORIZATION' END;
  IF stage IS NULL THEN RAISE EXCEPTION 'only a submitted, verified or authorized request can be adjusted' USING ERRCODE = '42501'; END IF;
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
  IF st = 'AUTHORIZED' THEN -- already funded: any change means treasury must reconfirm; amount or payee changes also restart approval
    IF (amount_changed OR payee_changed) AND EXISTS (SELECT 1 FROM payment_transactions pt JOIN payment_installments pi ON pi.id = pt.installment_id
         WHERE pi.request_id = p_request AND NOT EXISTS (SELECT 1 FROM payment_reversals x WHERE x.payment_id = pt.id)) THEN
      RAISE EXCEPTION 'payments were already recorded; reverse them before changing the amount or payee' USING ERRCODE = '42501';
    END IF;
    UPDATE cash_reservations c SET status = 'RELEASED', close_reason = 'request changed after funding: treasury must reconfirm', closed_at = now()
    FROM payment_installments pi WHERE c.installment_id = pi.id AND pi.request_id = p_request AND c.status = 'ACTIVE';
  END IF;

  PERFORM wf_log(p_request, v, stage, 'ADJUST', role_name, p_reason, corr);
  IF st IN ('VERIFIED','AUTHORIZED') AND new_state = 'SUBMITTED' THEN
    PERFORM wf_log(p_request, v, stage, 'INVALIDATE', role_name, 'amount or payee changed: restart at verification', corr);
  END IF;
  IF new_state = 'SUBMITTED' THEN PERFORM wf_notify(p_request, 'REQUEST_RESTARTED', jsonb_build_object('reason', p_reason));
  ELSIF due_changed THEN PERFORM wf_notify(p_request, 'REQUEST_RESCHEDULE_NEEDED', jsonb_build_object('reason', p_reason));
  ELSE PERFORM wf_notify(p_request, 'REQUEST_ADJUSTED', jsonb_build_object('reason', p_reason)); END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION outbox_recipients(p_event uuid) RETURNS TABLE (user_id uuid, email text) LANGUAGE plpgsql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  ELSIF e.event_type = 'REQUEST_OVERDUE' THEN
    ids := ARRAY(SELECT x FROM company_role_users(r.debtor_company_id, 'TREASURY') x);
  ELSIF e.event_type IN ('REQUEST_AUTHORIZED','REQUEST_RESCHEDULE_NEEDED') THEN
    ids := ARRAY(SELECT x FROM company_role_users(r.debtor_company_id, 'TREASURY') x) || r.created_by;
  ELSE
    ids := ARRAY[r.created_by];
  END IF;
  RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
END $$;
