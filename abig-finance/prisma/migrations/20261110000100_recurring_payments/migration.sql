-- ABIG Finance - Phase 6 Task 3C: recurring payments.
--
-- A recurring template (rent, utilities, salaries, subscriptions) belongs to a company and is kept by its Accountants. On each occurrence date the
-- worker creates a Draft payment request from it. It never submits, schedules, approves or reserves anything: the Draft goes through the normal
-- workflow when a person submits or schedules it.
--
--   * Templates: company, creator, supplier or person payee, debit account, payment method, amount (fixed, or an estimate that must be confirmed
--     on each Draft), frequency (weekly, monthly, quarterly, yearly), next date, optional end date, days from occurrence to due date, active.
--   * Managed through recurring_template_save and recurring_template_set_active, which require recurring_payment:manage in the template's company
--     (and payment_request:create, since Drafts are created in the creator's name). Read through row-level security with recurring_payment:view.
--     The application role cannot write the table directly.
--   * generate_recurring_requests (worker): for each active template whose next date has come and is not past its end date, under a row lock with
--     SKIP LOCKED, it checks the same things a person creating the request would need (the creator still active and allowed, the payee active for
--     the company, the account usable by the company and suited to the method), then creates the Draft and one installment and moves the next
--     date on. payment_requests (recurring_template_id, recurring_occurrence) is unique, so an occurrence can never be created twice. If a check
--     fails, nothing is created, the next date stays, and the reason is shown on the template; it is tried again on the next run.
--   * Monthly, quarterly and yearly dates keep the day of the month they started on (31 Jan, 28 Feb, 31 Mar...).
--   * An estimated amount must be confirmed by the Draft's creator (confirm_request_amount) before it can be submitted or scheduled:
--     assert_submittable refuses it until then.
--   * No email is sent for a generated Draft. Each creation is audited as RECURRING_DRAFT_CREATED by the System user.

-- ---------- Templates ----------
CREATE TABLE recurring_payment_templates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  created_by         uuid NOT NULL REFERENCES users(id),
  name               text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  payee_type         payee_type NOT NULL,
  supplier_id        uuid REFERENCES suppliers(id),
  person_payee_id    uuid REFERENCES person_payees(id),
  debit_account_id   uuid NOT NULL REFERENCES company_bank_accounts(id),
  payment_method     payment_method NOT NULL,
  amount             numeric(18,2) NOT NULL CHECK (amount > 0),
  amount_is_estimate boolean NOT NULL DEFAULT false,
  frequency          text NOT NULL CHECK (frequency IN ('WEEKLY','MONTHLY','QUARTERLY','YEARLY')),
  anchor_day         integer NOT NULL CHECK (anchor_day BETWEEN 1 AND 31),   -- the day of the month the dates keep
  next_date          date NOT NULL,
  end_date           date,
  due_days           integer NOT NULL DEFAULT 0 CHECK (due_days BETWEEN 0 AND 90),
  priority           text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  description        text,
  is_active          boolean NOT NULL DEFAULT true,
  last_generated_on  date,
  last_error         text,                -- why the last attempt created nothing; cleared when a Draft is created or the template is saved
  last_error_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((payee_type = 'SUPPLIER' AND supplier_id IS NOT NULL AND person_payee_id IS NULL) OR (payee_type = 'PERSON' AND person_payee_id IS NOT NULL AND supplier_id IS NULL))
);
CREATE INDEX recurring_templates_due_idx ON recurring_payment_templates (next_date) WHERE is_active;
CREATE INDEX recurring_templates_company_idx ON recurring_payment_templates (company_id);
ALTER TABLE recurring_payment_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY recurring_templates_read ON recurring_payment_templates FOR SELECT TO abig_app
  USING (company_id IN (SELECT app_permitted_companies('recurring_payment:view')));
GRANT SELECT ON recurring_payment_templates TO abig_app;

-- ---------- The link from a Draft to its template ----------
ALTER TABLE payment_requests
  ADD COLUMN recurring_template_id uuid REFERENCES recurring_payment_templates(id),
  ADD COLUMN recurring_occurrence date,
  ADD COLUMN amount_is_estimate boolean NOT NULL DEFAULT false,
  ADD COLUMN amount_confirmed_at timestamptz,
  ADD COLUMN amount_confirmed_by uuid REFERENCES users(id),
  ADD CONSTRAINT payment_requests_recurring_chk CHECK ((recurring_template_id IS NULL) = (recurring_occurrence IS NULL)),
  ADD CONSTRAINT payment_requests_recurring_once UNIQUE (recurring_template_id, recurring_occurrence);
GRANT SELECT (recurring_template_id, recurring_occurrence, amount_is_estimate, amount_confirmed_at, amount_confirmed_by) ON payment_requests TO abig_app;

-- The next occurrence after p_date. Monthly steps keep p_anchor (the day of the month), or the month's last day when it is shorter.
CREATE FUNCTION recurring_next(p_date date, p_frequency text, p_anchor integer) RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_frequency WHEN 'WEEKLY' THEN p_date + 7 ELSE
    (SELECT (m + (least(p_anchor, extract(day FROM (m + interval '1 month' - interval '1 day'))::int) - 1) * interval '1 day')::date
       FROM (SELECT date_trunc('month', p_date::timestamp) + (CASE p_frequency WHEN 'MONTHLY' THEN 1 WHEN 'QUARTERLY' THEN 3 ELSE 12 END) * interval '1 month' AS m) x) END $$;

-- What a template needs in order to make a valid Draft today. Raises with the reason; used when saving and before each generation.
CREATE FUNCTION recurring_assert_usable(t recurring_payment_templates) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = t.company_id AND is_active) THEN RAISE EXCEPTION 'the company is inactive' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.created_by AND u.is_active
                   AND (u.is_system_admin OR u.id IN (SELECT company_permission_users(t.company_id, 'payment_request:create')))) THEN
    RAISE EXCEPTION 'the person who set it up can no longer create payment requests for this company' USING ERRCODE = '23514';
  END IF;
  IF t.payee_type = 'SUPPLIER' AND NOT app_supplier_active_for(t.company_id, t.supplier_id) THEN RAISE EXCEPTION 'the supplier is not active for this company' USING ERRCODE = '23514'; END IF;
  IF t.payee_type = 'PERSON' AND NOT app_person_active_for(t.company_id, t.person_payee_id) THEN RAISE EXCEPTION 'this person is not active for this company' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM company_bank_accounts a WHERE a.id = t.debit_account_id AND a.is_active) OR t.company_id NOT IN (SELECT app_granted_companies(t.debit_account_id, 'USE')) THEN
    RAISE EXCEPTION 'the debit account is not available to this company' USING ERRCODE = '23514';
  END IF;
  PERFORM assert_method_fits_account(t.payment_method, t.debit_account_id);
END $$;

-- ---------- Managing templates ----------
CREATE FUNCTION recurring_template_save(p_id uuid, p_company uuid, p_name text, p_payee_type text, p_payee uuid, p_account uuid, p_method text, p_amount numeric,
  p_estimate boolean, p_frequency text, p_next date, p_end date, p_due_days integer, p_priority text, p_description text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t recurring_payment_templates; old recurring_payment_templates; today date := addis_day(treasury_now());
BEGIN
  IF app_user_id() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_id IS NOT NULL THEN
    SELECT * INTO old FROM recurring_payment_templates WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'recurring payment not found' USING ERRCODE = 'P0002'; END IF;
    IF p_company IS DISTINCT FROM old.company_id THEN RAISE EXCEPTION 'a recurring payment cannot move to another company' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NOT app_has_permission(p_company, 'recurring_payment:manage') THEN RAISE EXCEPTION 'you may not manage recurring payments for this company' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL AND NOT app_has_permission(p_company, 'payment_request:create') THEN
    RAISE EXCEPTION 'you may not create payment requests for this company, so a recurring payment cannot create them in your name' USING ERRCODE = '42501';
  END IF;
  IF p_next IS NULL OR (p_next < today AND (old.id IS NULL OR p_next IS DISTINCT FROM old.next_date)) THEN
    RAISE EXCEPTION 'the next date must be today or later' USING ERRCODE = '23514';
  END IF;
  IF p_end IS NOT NULL AND p_end < p_next THEN RAISE EXCEPTION 'the end date cannot be before the next date' USING ERRCODE = '23514'; END IF;
  t := ROW(COALESCE(p_id, gen_random_uuid()), p_company, COALESCE(old.created_by, app_user_id()), btrim(coalesce(p_name, '')), p_payee_type::payee_type,
           CASE WHEN p_payee_type = 'SUPPLIER' THEN p_payee END, CASE WHEN p_payee_type = 'PERSON' THEN p_payee END, p_account, p_method::payment_method,
           p_amount, coalesce(p_estimate, false), p_frequency, extract(day FROM p_next)::int, p_next, p_end, coalesce(p_due_days, 0), coalesce(p_priority, 'NORMAL'),
           NULLIF(btrim(coalesce(p_description, '')), ''), COALESCE(old.is_active, true), old.last_generated_on, NULL, NULL, COALESCE(old.created_at, now()), now());
  PERFORM recurring_assert_usable(t);
  IF p_id IS NULL THEN
    INSERT INTO recurring_payment_templates SELECT t.*;
  ELSE
    UPDATE recurring_payment_templates SET name = t.name, payee_type = t.payee_type, supplier_id = t.supplier_id, person_payee_id = t.person_payee_id,
           debit_account_id = t.debit_account_id, payment_method = t.payment_method, amount = t.amount, amount_is_estimate = t.amount_is_estimate,
           frequency = t.frequency, anchor_day = CASE WHEN t.next_date = old.next_date THEN old.anchor_day ELSE t.anchor_day END, next_date = t.next_date,
           end_date = t.end_date, due_days = t.due_days, priority = t.priority, description = t.description, last_error = NULL, last_error_at = NULL, updated_at = now()
     WHERE id = p_id;
  END IF;
  PERFORM treasury_audit(p_company, CASE WHEN p_id IS NULL THEN 'RECURRING_TEMPLATE_CREATED' ELSE 'RECURRING_TEMPLATE_UPDATED' END, 'RECURRING_TEMPLATE', t.id,
    jsonb_build_object('name', t.name, 'payee_type', t.payee_type, 'payee', COALESCE(t.supplier_id, t.person_payee_id), 'account', t.debit_account_id, 'method', t.payment_method,
                       'amount', t.amount, 'estimate', t.amount_is_estimate, 'frequency', t.frequency, 'next_date', t.next_date, 'end_date', t.end_date, 'due_days', t.due_days,
                       'before', CASE WHEN old.id IS NULL THEN NULL ELSE jsonb_build_object('amount', old.amount, 'estimate', old.amount_is_estimate, 'frequency', old.frequency,
                         'next_date', old.next_date, 'end_date', old.end_date, 'account', old.debit_account_id, 'payee', COALESCE(old.supplier_id, old.person_payee_id)) END));
  RETURN t.id;
END $$;

CREATE FUNCTION recurring_template_set_active(p_id uuid, p_active boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t recurring_payment_templates;
BEGIN
  SELECT * INTO t FROM recurring_payment_templates WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR app_user_id() IS NULL THEN RAISE EXCEPTION 'recurring payment not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT app_has_permission(t.company_id, 'recurring_payment:manage') THEN RAISE EXCEPTION 'you may not manage recurring payments for this company' USING ERRCODE = '42501'; END IF;
  IF p_active THEN
    IF t.next_date < addis_day(treasury_now()) THEN RAISE EXCEPTION 'set a next date of today or later before turning it back on' USING ERRCODE = '23514'; END IF;
    PERFORM recurring_assert_usable(t);
  END IF;
  UPDATE recurring_payment_templates SET is_active = p_active, last_error = NULL, last_error_at = NULL, updated_at = now() WHERE id = p_id;
  PERFORM treasury_audit(t.company_id, CASE WHEN p_active THEN 'RECURRING_TEMPLATE_ACTIVATED' ELSE 'RECURRING_TEMPLATE_DEACTIVATED' END, 'RECURRING_TEMPLATE', p_id, jsonb_build_object('name', t.name));
END $$;

-- ---------- Confirming an estimated amount ----------
CREATE FUNCTION confirm_request_amount(p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests;
BEGIN
  PERFORM wf_assert_actor(p_request, 'SUBMISSION');   -- the Draft's creator
  SELECT * INTO r FROM payment_requests WHERE id = p_request FOR UPDATE;
  IF r.workflow_state <> 'DRAFT' THEN RAISE EXCEPTION 'only a draft''s amount can be confirmed' USING ERRCODE = '42501'; END IF;
  IF NOT r.amount_is_estimate THEN RAISE EXCEPTION 'this request''s amount is not an estimate' USING ERRCODE = '23514'; END IF;
  IF r.amount_confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'the amount is already confirmed' USING ERRCODE = '23514'; END IF;
  UPDATE payment_requests SET amount_confirmed_at = clock_timestamp(), amount_confirmed_by = app_user_id() WHERE id = p_request;
  PERFORM treasury_audit(r.debtor_company_id, 'REQUEST_AMOUNT_CONFIRMED', 'PAYMENT_REQUEST', p_request, jsonb_build_object('amount', r.total_amount, 'template', r.recurring_template_id));
END $$;

-- ---------- Submission refuses an estimate that is not confirmed (the rest of assert_submittable is unchanged) ----------
CREATE OR REPLACE FUNCTION public.assert_submittable(p_request uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r payment_requests; n int; s numeric; need text;
BEGIN
  SELECT * INTO r FROM payment_requests WHERE id = p_request;
  IF r.amount_is_estimate AND r.amount_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'this amount is an estimate from a recurring payment: confirm it before submitting or scheduling' USING ERRCODE = '23514';
  END IF;
  SELECT count(*), COALESCE(sum(amount), 0) INTO n, s FROM payment_installments WHERE request_id = p_request;
  IF n = 0 THEN RAISE EXCEPTION 'at least one installment is required' USING ERRCODE = '23514'; END IF;
  IF s <> r.total_amount THEN RAISE EXCEPTION 'installments (%) must add up to the request total (%)', s, r.total_amount USING ERRCODE = '23514'; END IF;
  IF r.total_amount <= 0 THEN RAISE EXCEPTION 'the amount must be more than zero' USING ERRCODE = '23514'; END IF;
  IF r.debit_account_id IS NULL THEN RAISE EXCEPTION 'choose the account the payment will be debited from' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM company_bank_accounts a WHERE a.id = r.debit_account_id AND a.is_active)
     OR r.debtor_company_id NOT IN (SELECT app_granted_companies(r.debit_account_id, 'USE')) THEN
    RAISE EXCEPTION 'the debit account is not available to this company' USING ERRCODE = '23514';
  END IF;
  PERFORM assert_method_fits_account(r.payment_method, r.debit_account_id);
  IF r.payee_type = 'SUPPLIER' THEN
    IF NOT EXISTS (SELECT 1 FROM supplier_bank_details WHERE id = r.supplier_bank_detail_id AND supplier_id = r.supplier_id AND status = 'VERIFIED') THEN
      RAISE EXCEPTION 'verified supplier bank details are required' USING ERRCODE = '23514';
    END IF;
    IF NOT app_supplier_active_for(r.debtor_company_id, r.supplier_id) THEN RAISE EXCEPTION 'the supplier is not active for this company' USING ERRCODE = '23514'; END IF;
  ELSE
    IF NOT app_person_active_for(r.debtor_company_id, r.person_payee_id) THEN RAISE EXCEPTION 'this person is not active for this company' USING ERRCODE = '23514'; END IF;
    -- A transfer or Telebirr payment goes somewhere that must be verified. Cash is handed over and a cheque carries the name.
    need := CASE r.payment_method WHEN 'TRANSFER' THEN 'BANK' WHEN 'TELEBIRR' THEN 'TELEBIRR' END;
    IF need IS NOT NULL AND NOT EXISTS (SELECT 1 FROM person_payment_details d WHERE d.id = r.person_payment_detail_id AND d.person_id = r.person_payee_id AND d.kind = need AND d.status = 'VERIFIED') THEN
      RAISE EXCEPTION 'verified % details are required for this person', CASE need WHEN 'BANK' THEN 'bank' ELSE 'Telebirr' END USING ERRCODE = '23514';
    END IF;
  END IF;
END $function$;

-- ---------- The worker: create the Drafts that are due ----------
-- Concurrent runs skip templates another run holds; the unique (template, occurrence) pair stops a second copy even so. Each template is tried
-- on its own. A run creates every missed occurrence up to today (at most 24 per template per run), oldest first.
CREATE FUNCTION generate_recurring_requests() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET "TimeZone" = 'Africa/Addis_Ababa' AS $$
DECLARE t recurring_payment_templates; today date := addis_day(treasury_now()); n int := 0; k int; rid uuid; det uuid; why text;
BEGIN
  FOR t IN SELECT * FROM recurring_payment_templates WHERE is_active AND next_date <= today AND (end_date IS NULL OR next_date <= end_date)
            ORDER BY next_date, id FOR UPDATE SKIP LOCKED LOOP
    k := 0;
    WHILE t.next_date <= today AND (t.end_date IS NULL OR t.next_date <= t.end_date) AND k < 24 LOOP
      BEGIN
        PERFORM recurring_assert_usable(t);
        det := CASE WHEN t.payee_type = 'SUPPLIER'
                    THEN (SELECT id FROM supplier_bank_details WHERE supplier_id = t.supplier_id AND status = 'VERIFIED')
                    ELSE (SELECT d.id FROM person_payment_details d WHERE d.person_id = t.person_payee_id AND d.status = 'VERIFIED'
                            AND d.kind = CASE t.payment_method WHEN 'TRANSFER' THEN 'BANK' WHEN 'TELEBIRR' THEN 'TELEBIRR' END) END;
        INSERT INTO payment_requests (debtor_company_id, payee_type, supplier_id, person_payee_id, supplier_bank_detail_id, person_payment_detail_id, debit_account_id,
                                      created_by, description, priority, total_amount, payment_method, recurring_template_id, recurring_occurrence, amount_is_estimate)
        VALUES (t.company_id, t.payee_type, t.supplier_id, t.person_payee_id, CASE WHEN t.payee_type = 'SUPPLIER' THEN det END, CASE WHEN t.payee_type = 'PERSON' THEN det END,
                t.debit_account_id, t.created_by, concat_ws(' · ', t.name, 'occurrence ' || t.next_date, t.description), t.priority, t.amount, t.payment_method,
                t.id, t.next_date, t.amount_is_estimate)
        ON CONFLICT (recurring_template_id, recurring_occurrence) DO NOTHING
        RETURNING id INTO rid;
        IF rid IS NOT NULL THEN
          INSERT INTO payment_installments (request_id, seq, due_date, amount) VALUES (rid, 1, t.next_date + t.due_days, t.amount);
          INSERT INTO audit_events (actor_id, company_id, action, entity_type, entity_id, metadata)
          VALUES (app_system_user(), t.company_id, 'RECURRING_DRAFT_CREATED', 'PAYMENT_REQUEST', rid,
                  jsonb_build_object('template', t.id, 'name', t.name, 'occurrence', t.next_date, 'amount', t.amount, 'estimate', t.amount_is_estimate, 'creator', t.created_by));
          n := n + 1;
        END IF;
        UPDATE recurring_payment_templates SET last_generated_on = t.next_date, next_date = recurring_next(t.next_date, t.frequency, t.anchor_day),
               last_error = NULL, last_error_at = NULL WHERE id = t.id RETURNING * INTO t;
      EXCEPTION
        WHEN serialization_failure OR deadlock_detected OR lock_not_available THEN EXIT;   -- tried again next run
        WHEN OTHERS THEN
          why := SQLERRM;
          UPDATE recurring_payment_templates SET last_error = why, last_error_at = clock_timestamp() WHERE id = t.id AND last_error IS DISTINCT FROM why;
          EXIT;   -- the next date stays, so the occurrence is created once the problem is fixed
      END;
      k := k + 1;
    END LOOP;
  END LOOP;
  RETURN n;
END $$;

REVOKE EXECUTE ON FUNCTION recurring_next(date, text, integer), recurring_assert_usable(recurring_payment_templates),
  recurring_template_save(uuid, uuid, text, text, uuid, uuid, text, numeric, boolean, text, date, date, integer, text, text),
  recurring_template_set_active(uuid, boolean), confirm_request_amount(uuid), generate_recurring_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recurring_template_save(uuid, uuid, text, text, uuid, uuid, text, numeric, boolean, text, date, date, integer, text, text),
  recurring_template_set_active(uuid, boolean), confirm_request_amount(uuid) TO abig_app;
GRANT EXECUTE ON FUNCTION generate_recurring_requests() TO abig_worker;
