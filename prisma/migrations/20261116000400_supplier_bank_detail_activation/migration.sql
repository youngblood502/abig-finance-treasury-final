-- ABIG Finance - Deactivating and reactivating a supplier's bank details.
--
-- A version of a supplier's bank details can be taken out of use (the bank closed the account, the supplier asked, it looks wrong) and put back.
-- Deactivation is soft: the row, its status, its verification and every request that names it stay exactly as they were.
--
--   * supplier_bank_detail_deactivate(): anyone holding supplier:manage or payment_request:verify in a company linked to the supplier. A reason
--     is required. Nothing on any request is changed, cancelled or rejected; the Finance Managers of the linked companies and the creators of the
--     open requests that use these details are told.
--   * supplier_bank_detail_reactivate(): payment_request:verify only (a Finance Manager), and never the person who entered the details. It restores
--     the details with the status they had. Refused once a newer version has been verified (it superseded these).
--   * Both are kept in supplier_bank_detail_status_events (append-only) and in the audit trail.
--   * Inactive details cannot be chosen for a request and cannot be verified. Every step that moves a request towards payment (submission,
--     scheduling, scheduled release, verification, authentication, adjustment) already required verified details; it now also requires active
--     ones, and reads them under a row lock, so a deactivation running at the same moment has either committed and is seen, or waits.
--   * A request that is RESERVED or VERIFIED is moved on to other details with the existing adjustment (wf_adjust), which sends it back to
--     verification. An AUTHENTICATED request has been debited and cannot go back, so it gets its own path, with the debit untouched:
--       wf_replace_destination()      a Finance Manager chooses the supplier's active verified details, with a reason (held for re-verification)
--       wf_reverify_destination()     another Finance Manager confirms them (held for re-authorization)
--       wf_reauthorize_destination()  an Owner confirms them; the hold ends
--     While a request is held, or its details are inactive, a first record of how the payment was sent (record_execution) is refused; a payment
--     already sent (recorded, or processed by the bank) can have its record corrected, and its destination is never replaced. Details that were
--     superseded by a newer verified version but are still active do not block it. Reconciliation is not blocked: a payment already on the bank
--     statement went out, is marked paid as it happened, and any hold ends then.
--   * Paid and completed requests keep their original details; nothing here changes them.

-- ---------- 1. Status on the details, and its history ----------
ALTER TABLE supplier_bank_details
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN deactivated_at timestamptz,
  ADD COLUMN deactivated_by uuid REFERENCES users(id),
  ADD COLUMN deactivation_reason text,
  ADD CONSTRAINT supplier_bank_details_active_chk CHECK (
    (is_active AND deactivated_at IS NULL AND deactivated_by IS NULL AND deactivation_reason IS NULL)
    OR (NOT is_active AND deactivated_at IS NOT NULL AND deactivated_by IS NOT NULL AND length(btrim(deactivation_reason)) >= 3));
GRANT SELECT (is_active, deactivated_at, deactivated_by, deactivation_reason) ON supplier_bank_details TO abig_app;

CREATE TABLE supplier_bank_detail_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detail_id uuid NOT NULL REFERENCES supplier_bank_details(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  action text NOT NULL CHECK (action IN ('DEACTIVATED', 'REACTIVATED')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  detail_status text NOT NULL,                      -- the verification status at that moment, kept as it was
  open_requests jsonb NOT NULL DEFAULT '{}'::jsonb, -- open requests using these details at that moment, by state
  actor_id uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX supplier_bank_detail_status_events_detail_idx ON supplier_bank_detail_status_events (detail_id, occurred_at DESC);
CREATE TRIGGER supplier_bank_detail_status_events_no_change BEFORE UPDATE OR DELETE ON supplier_bank_detail_status_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER supplier_bank_detail_status_events_no_truncate BEFORE TRUNCATE ON supplier_bank_detail_status_events FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
ALTER TABLE supplier_bank_detail_status_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_bank_detail_status_events_read ON supplier_bank_detail_status_events FOR SELECT TO abig_app USING (app_is_member_anywhere());   -- as the details themselves
GRANT SELECT ON supplier_bank_detail_status_events TO abig_app;

-- The guard: the activation columns change only through the two functions below (the application role has no privilege on them either),
-- and inactive details cannot be verified.
CREATE OR REPLACE FUNCTION bank_detail_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := COALESCE((SELECT max(version) FROM supplier_bank_details WHERE supplier_id = NEW.supplier_id), 0) + 1;
    NEW.status := 'PENDING'; NEW.verified_by := NULL; NEW.verified_at := NULL; NEW.rejection_reason := NULL;
    NEW.is_active := true; NEW.deactivated_at := NULL; NEW.deactivated_by := NULL; NEW.deactivation_reason := NULL;
    RETURN NEW;
  END IF;
  IF current_setting('app.bank_status', true) = 'on' THEN
    IF (to_jsonb(NEW) - 'is_active' - 'deactivated_at' - 'deactivated_by' - 'deactivation_reason') IS DISTINCT FROM
       (to_jsonb(OLD) - 'is_active' - 'deactivated_at' - 'deactivated_by' - 'deactivation_reason') THEN
      RAISE EXCEPTION 'only the active status of bank details changes here' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'verified_by' - 'verified_at' - 'rejection_reason') IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'verified_by' - 'verified_at' - 'rejection_reason') THEN
    RAISE EXCEPTION 'bank details cannot be edited; add a new version' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'VERIFIED' AND NEW.status = 'SUPERSEDED' AND pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF OLD.status <> 'PENDING' OR NEW.status NOT IN ('VERIFIED','REJECTED') THEN
    RAISE EXCEPTION 'only a pending bank detail can be verified or rejected' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'VERIFIED' AND NOT OLD.is_active THEN
    RAISE EXCEPTION 'these bank details are deactivated; reactivate them before verifying' USING ERRCODE = '23514';
  END IF;
  NEW.verified_by := COALESCE(app_user_id(), NEW.verified_by); NEW.verified_at := now();
  IF NEW.verified_by IS NULL OR NEW.verified_by = OLD.created_by THEN
    RAISE EXCEPTION 'bank details must be checked by someone other than the person who entered them' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'REJECTED' AND coalesce(NEW.rejection_reason, '') = '' THEN
    RAISE EXCEPTION 'a rejection needs a reason' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'VERIFIED' THEN
    UPDATE supplier_bank_details SET status = 'SUPERSEDED' WHERE supplier_id = NEW.supplier_id AND status = 'VERIFIED';
  END IF;
  RETURN NEW;
END $$;

-- ---------- 2. Deactivating and reactivating ----------
-- Open requests naming these details, counted by state, across every company (no numbers or payees).
CREATE FUNCTION supplier_bank_detail_open_requests(p_detail uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_object_agg(s, n), '{}'::jsonb) FROM (
    SELECT workflow_state::text s, count(*) n FROM payment_requests
     WHERE supplier_bank_detail_id = p_detail AND workflow_state IN ('DRAFT','SCHEDULED','RESERVED','VERIFIED','AUTHENTICATED') GROUP BY 1) x $$;
REVOKE EXECUTE ON FUNCTION supplier_bank_detail_open_requests(uuid) FROM PUBLIC;

-- Whether the caller holds one of the permissions in a company that actively uses the supplier these details belong to
-- (a link that was made inactive or blocked does not count).
CREATE FUNCTION app_can_on_supplier_detail(p_detail uuid, p_perms text[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_user_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM supplier_bank_details d JOIN company_suppliers cs ON cs.supplier_id = d.supplier_id AND cs.status = 'ACTIVE' CROSS JOIN unnest(p_perms) perm
     WHERE d.id = p_detail AND cs.company_id IN (SELECT app_permitted_companies(perm))) $$;
REVOKE EXECUTE ON FUNCTION app_can_on_supplier_detail(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_on_supplier_detail(uuid, text[]) TO abig_app;

CREATE FUNCTION supplier_bank_detail_deactivate(p_detail uuid, p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d supplier_bank_details; why text := NULLIF(regexp_replace(btrim(coalesce(p_reason, '')), '\s+', ' ', 'g'), ''); me uuid := app_user_id(); items jsonb;
BEGIN
  IF me IS NULL OR NOT app_can_on_supplier_detail(p_detail, ARRAY['supplier:manage', 'payment_request:verify']) THEN
    RAISE EXCEPTION 'only someone who manages this supplier or verifies its payments can deactivate its bank details' USING ERRCODE = '42501';
  END IF;
  IF length(coalesce(why, '')) < 3 THEN RAISE EXCEPTION 'explain why these bank details are being deactivated' USING ERRCODE = '23514'; END IF;
  IF length(why) > 1000 THEN RAISE EXCEPTION 'the reason is too long' USING ERRCODE = '23514'; END IF;
  -- The lock every step that relies on these details takes (FOR SHARE): they have committed, or they wait and then see them inactive.
  SELECT * INTO d FROM supplier_bank_details WHERE id = p_detail FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank details not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT d.is_active THEN RAISE EXCEPTION 'these bank details are already inactive' USING ERRCODE = '23514'; END IF;
  items := supplier_bank_detail_open_requests(p_detail);
  PERFORM set_config('app.bank_status', 'on', true);
  UPDATE supplier_bank_details SET is_active = false, deactivated_at = clock_timestamp(), deactivated_by = me, deactivation_reason = why WHERE id = p_detail;
  PERFORM set_config('app.bank_status', 'off', true);
  INSERT INTO supplier_bank_detail_status_events (detail_id, supplier_id, action, reason, detail_status, open_requests, actor_id)
  VALUES (p_detail, d.supplier_id, 'DEACTIVATED', why, d.status, items, me);
  PERFORM treasury_audit(NULL, 'SUPPLIER_BANK_DETAILS_DEACTIVATED', 'SUPPLIER', d.supplier_id,
    jsonb_build_object('detail', d.id, 'version', d.version, 'bank', d.bank_name, 'last4', d.account_last4, 'status', d.status, 'reason', why,
                       'previous_active', true, 'new_active', false, 'open_requests', items));
  INSERT INTO notification_outbox (event_type, payload)
  SELECT 'SUPPLIER_BANK_DETAILS_DEACTIVATED', jsonb_build_object('detail_id', d.id, 'supplier_id', d.supplier_id, 'supplier_name', s.legal_name, 'version', d.version,
         'reason', why, 'path', '/suppliers')
    FROM suppliers s WHERE s.id = d.supplier_id;
  RETURN items;
END $$;

CREATE FUNCTION supplier_bank_detail_reactivate(p_detail uuid, p_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d supplier_bank_details; n text := NULLIF(regexp_replace(btrim(coalesce(p_note, '')), '\s+', ' ', 'g'), ''); me uuid := app_user_id();
BEGIN
  IF me IS NULL OR NOT app_can_on_supplier_detail(p_detail, ARRAY['payment_request:verify']) THEN
    RAISE EXCEPTION 'only a Finance Manager of a company that uses this supplier can reactivate its bank details' USING ERRCODE = '42501';
  END IF;
  IF length(coalesce(n, '')) < 3 THEN RAISE EXCEPTION 'explain why these bank details can be used again' USING ERRCODE = '23514'; END IF;
  IF length(n) > 1000 THEN RAISE EXCEPTION 'the note is too long' USING ERRCODE = '23514'; END IF;
  SELECT * INTO d FROM supplier_bank_details WHERE id = p_detail FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank details not found' USING ERRCODE = 'P0002'; END IF;
  IF d.is_active THEN RAISE EXCEPTION 'these bank details are already active' USING ERRCODE = '23514'; END IF;
  IF d.created_by = me THEN RAISE EXCEPTION 'bank details must be reactivated by someone other than the person who entered them' USING ERRCODE = '42501'; END IF;
  IF d.status = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'newer bank details have been verified for this supplier since; these stay inactive' USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('app.bank_status', 'on', true);
  UPDATE supplier_bank_details SET is_active = true, deactivated_at = NULL, deactivated_by = NULL, deactivation_reason = NULL WHERE id = p_detail;
  PERFORM set_config('app.bank_status', 'off', true);
  INSERT INTO supplier_bank_detail_status_events (detail_id, supplier_id, action, reason, detail_status, open_requests, actor_id)
  VALUES (p_detail, d.supplier_id, 'REACTIVATED', n, d.status, supplier_bank_detail_open_requests(p_detail), me);
  PERFORM treasury_audit(NULL, 'SUPPLIER_BANK_DETAILS_REACTIVATED', 'SUPPLIER', d.supplier_id,
    jsonb_build_object('detail', d.id, 'version', d.version, 'bank', d.bank_name, 'last4', d.account_last4, 'status', d.status, 'note', n,
                       'previous_active', false, 'new_active', true, 'previous_reason', d.deactivation_reason, 'inactive_since', d.deactivated_at));
  INSERT INTO notification_outbox (event_type, payload)
  SELECT 'SUPPLIER_BANK_DETAILS_REACTIVATED', jsonb_build_object('detail_id', d.id, 'supplier_id', d.supplier_id, 'supplier_name', s.legal_name, 'version', d.version,
         'reason', n, 'path', '/suppliers')
    FROM suppliers s WHERE s.id = d.supplier_id;
END $$;
REVOKE EXECUTE ON FUNCTION supplier_bank_detail_deactivate(uuid, text), supplier_bank_detail_reactivate(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supplier_bank_detail_deactivate(uuid, text), supplier_bank_detail_reactivate(uuid, text) TO abig_app;

-- The status history of one supplier's details, with who changed it.
CREATE FUNCTION supplier_bank_detail_history(p_supplier uuid) RETURNS TABLE (detail_id uuid, version integer, action text, reason text, actor_name text, occurred_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.detail_id, d.version, e.action, e.reason, u.full_name, e.occurred_at
    FROM supplier_bank_detail_status_events e JOIN supplier_bank_details d ON d.id = e.detail_id JOIN users u ON u.id = e.actor_id
   WHERE e.supplier_id = p_supplier AND app_user_id() IS NOT NULL AND app_is_member_anywhere()
   ORDER BY e.occurred_at DESC, e.id $$;
REVOKE EXECUTE ON FUNCTION supplier_bank_detail_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supplier_bank_detail_history(uuid) TO abig_app;

-- ---------- 3. Only active, verified details move a request towards payment ----------
-- The supplier's details on a request, checked under a share lock: a deactivation has committed and is seen, or waits for this step.
CREATE FUNCTION assert_supplier_destination(r payment_requests) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d supplier_bank_details;
BEGIN
  IF r.payee_type <> 'SUPPLIER' THEN RETURN; END IF;
  IF r.supplier_bank_detail_id IS NOT NULL THEN
    SELECT * INTO d FROM supplier_bank_details WHERE id = r.supplier_bank_detail_id FOR SHARE;
    IF NOT FOUND OR d.supplier_id <> r.supplier_id OR d.status <> 'VERIFIED' THEN
      RAISE EXCEPTION 'verified supplier bank details are required' USING ERRCODE = '23514';
    END IF;
    IF NOT d.is_active THEN
      RAISE EXCEPTION 'the supplier bank details on this request (% ••••%) were deactivated; choose the supplier''s active verified details', d.bank_name, d.account_last4 USING ERRCODE = '23514';
    END IF;
  END IF;
  -- A transfer goes to verified bank details. Telebirr keeps that rule too: suppliers have no other verified destination. Cash and cheque need none.
  IF r.payment_method IN ('TRANSFER','TELEBIRR') AND r.supplier_bank_detail_id IS NULL THEN
    RAISE EXCEPTION 'verified supplier bank details are required for a % payment; cash and cheque need none', CASE r.payment_method WHEN 'TRANSFER' THEN 'bank transfer' ELSE 'Telebirr' END
      USING ERRCODE = '23514';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION assert_supplier_destination(payment_requests) FROM PUBLIC;

CREATE OR REPLACE FUNCTION assert_submittable(p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; n int; s numeric; need text; o one_time_payees;
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
    -- Bank details on a request are always the supplier's own verified and active ones: never an unrelated, unverified or deactivated account.
    PERFORM assert_supplier_destination(r);
    IF NOT app_supplier_active_for(r.debtor_company_id, r.supplier_id) THEN RAISE EXCEPTION 'the supplier is not active for this company' USING ERRCODE = '23514'; END IF;
  ELSIF r.payee_type = 'PERSON' THEN
    IF NOT app_person_active_for(r.debtor_company_id, r.person_payee_id) THEN RAISE EXCEPTION 'this person is not active for this company' USING ERRCODE = '23514'; END IF;
    -- A transfer or Telebirr payment goes somewhere that must be verified. Cash is handed over and a cheque carries the name.
    need := CASE r.payment_method WHEN 'TRANSFER' THEN 'BANK' WHEN 'TELEBIRR' THEN 'TELEBIRR' END;
    IF need IS NOT NULL AND NOT EXISTS (SELECT 1 FROM person_payment_details d WHERE d.id = r.person_payment_detail_id AND d.person_id = r.person_payee_id AND d.kind = need AND d.status = 'VERIFIED') THEN
      RAISE EXCEPTION 'verified % details are required for this person', CASE need WHEN 'BANK' THEN 'bank' ELSE 'Telebirr' END USING ERRCODE = '23514';
    END IF;
  ELSE
    -- A one-time payee's details are entered on the request and checked by its Verifier (never its creator), then its Authorizer.
    SELECT * INTO o FROM one_time_payees WHERE id = r.one_time_payee_id AND company_id = r.debtor_company_id;
    IF NOT FOUND OR btrim(o.full_name) = '' THEN RAISE EXCEPTION 'the payee name is required' USING ERRCODE = '23514'; END IF;
    IF r.payment_method = 'TRANSFER' AND o.account_number_enc IS NULL THEN
      RAISE EXCEPTION 'the payee''s bank and full account number are required for a bank transfer' USING ERRCODE = '23514';
    END IF;
    IF r.payment_method = 'TELEBIRR' AND coalesce(o.phone, '') !~ '^\+251[79][0-9]{8}$' THEN
      RAISE EXCEPTION 'the payee''s Ethiopian mobile number is required for a Telebirr payment' USING ERRCODE = '23514';
    END IF;
  END IF;
END $$;

-- Recurring drafts take the supplier's active verified details only (as before, a draft without them cannot be submitted for a transfer).
CREATE OR REPLACE FUNCTION generate_recurring_requests() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET "TimeZone" = 'Africa/Addis_Ababa' AS $$
DECLARE t recurring_payment_templates; today date := addis_day(treasury_now()); n int := 0; k int; rid uuid; det uuid; why text;
BEGIN
  FOR t IN SELECT * FROM recurring_payment_templates WHERE is_active AND next_date <= today AND (end_date IS NULL OR next_date <= end_date)
            ORDER BY next_date, id FOR UPDATE SKIP LOCKED LOOP
    k := 0;
    WHILE t.next_date <= today AND (t.end_date IS NULL OR t.next_date <= t.end_date) AND k < 24 LOOP
      BEGIN
        PERFORM recurring_assert_usable(t);
        det := CASE WHEN t.payee_type = 'SUPPLIER'
                    THEN (SELECT id FROM supplier_bank_details WHERE supplier_id = t.supplier_id AND status = 'VERIFIED' AND is_active)
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

-- ---------- 4. An authenticated request whose details were deactivated ----------
-- NULL: nothing pending. REVERIFY: new details chosen, waiting for a Finance Manager. REAUTHORIZE: re-verified, waiting for an Owner.
ALTER TABLE payment_requests ADD COLUMN destination_review text CHECK (destination_review IN ('REVERIFY', 'REAUTHORIZE'));
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_destination_review_chk
  CHECK (destination_review IS NULL OR (workflow_state = 'AUTHENTICATED' AND payee_type = 'SUPPLIER'));

-- Reconciliation can still mark a held payment paid (it was found on the bank statement, so it went out). The hold has no meaning after that:
-- it ends in the same update, and the audit trail says so.
CREATE FUNCTION payment_request_paid_ends_review() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM treasury_audit(NEW.debtor_company_id, 'PAYMENT_DESTINATION_REVIEW_ENDED', 'PAYMENT_REQUEST', NEW.id,
    jsonb_build_object('review', OLD.destination_review, 'detail', NEW.supplier_bank_detail_id, 'reason', 'marked paid by reconciliation'));
  NEW.destination_review := NULL;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION payment_request_paid_ends_review() FROM PUBLIC;
CREATE TRIGGER payment_requests_paid_ends_review BEFORE UPDATE OF workflow_state ON payment_requests FOR EACH ROW
  WHEN (NEW.workflow_state = 'PAID' AND OLD.destination_review IS NOT NULL) EXECUTE FUNCTION payment_request_paid_ends_review();

-- Who chose the details now on a held request: the actor of its latest change of supplier details.
CREATE FUNCTION destination_changer(p_request uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT actor_id FROM adjustment_history WHERE request_id = p_request AND field = 'supplier_bank_detail_id' ORDER BY occurred_at DESC, id DESC LIMIT 1 $$;
REVOKE EXECUTE ON FUNCTION destination_changer(uuid) FROM PUBLIC;

CREATE FUNCTION wf_replace_destination(p_request uuid, p_expected_version integer, p_detail uuid, p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; cur supplier_bank_details; nd supplier_bank_details; role_name text; v int; corr uuid := gen_random_uuid(); why text := btrim(coalesce(p_reason, ''));
BEGIN
  IF length(why) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  role_name := wf_assert_actor(p_request, 'VERIFICATION');   -- a Finance Manager, never the creator, never this request's authenticator
  r := wf_lock(p_request, p_expected_version);
  IF r.workflow_state <> 'AUTHENTICATED' THEN
    RAISE EXCEPTION 'only an authenticated payment changes bank details this way; a reserved or verified request is adjusted, a draft is edited by its creator' USING ERRCODE = '42501';
  END IF;
  IF r.payee_type <> 'SUPPLIER' OR r.supplier_bank_detail_id IS NULL THEN RAISE EXCEPTION 'this payment has no supplier bank details to replace' USING ERRCODE = '23514'; END IF;
  IF r.cheque_no IS NOT NULL OR r.bank_reference IS NOT NULL OR r.bank_processed_at IS NOT NULL THEN
    RAISE EXCEPTION 'this payment was already sent (its execution is recorded or the bank processed it); it went to the bank details it names and they stay on it' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO cur FROM supplier_bank_details WHERE id = r.supplier_bank_detail_id FOR SHARE;
  IF cur.is_active AND cur.status = 'VERIFIED' THEN
    RAISE EXCEPTION 'the bank details on this payment are still active and verified; nothing needs replacing' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO nd FROM supplier_bank_details WHERE id = p_detail FOR SHARE;
  IF NOT FOUND OR nd.supplier_id <> r.supplier_id OR nd.status <> 'VERIFIED' OR NOT nd.is_active OR nd.id = cur.id THEN
    RAISE EXCEPTION 'choose this supplier''s active verified bank details' USING ERRCODE = '23514';
  END IF;
  v := r.version + 1;
  INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
  VALUES (r.id, 'REQUEST', r.id, 'supplier_bank_detail_id', cur.id::text, nd.id::text, why, app_user_id(), role_name, 'VERIFICATION', v, corr);
  PERFORM set_config('app.wf', 'on', true);
  UPDATE payment_requests SET supplier_bank_detail_id = nd.id, destination_review = 'REVERIFY' WHERE id = p_request RETURNING version INTO v;
  PERFORM set_config('app.wf', 'off', true);
  PERFORM wf_log(p_request, v, 'VERIFICATION', 'ADJUST', role_name, 'bank details replaced: ' || why, corr);
  PERFORM treasury_audit(r.debtor_company_id, 'PAYMENT_DESTINATION_REPLACED', 'PAYMENT_REQUEST', p_request,
    jsonb_build_object('previous_detail', cur.id, 'previous_version', cur.version, 'new_detail', nd.id, 'new_version', nd.version, 'reason', why));
  PERFORM wf_notify(p_request, 'REQUEST_RESTARTED', jsonb_build_object('reason', 'New supplier bank details need verification: ' || why));
  RETURN v;
END $$;

CREATE FUNCTION wf_reverify_destination(p_request uuid, p_expected_version integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; role_name text; v int; corr uuid := gen_random_uuid();
BEGIN
  role_name := wf_assert_actor(p_request, 'VERIFICATION');
  r := wf_lock(p_request, p_expected_version);
  IF r.workflow_state <> 'AUTHENTICATED' OR r.destination_review IS DISTINCT FROM 'REVERIFY' THEN
    RAISE EXCEPTION 'no new bank details are waiting for verification on this payment' USING ERRCODE = '42501';
  END IF;
  IF destination_changer(p_request) = app_user_id() THEN
    RAISE EXCEPTION 'you chose these bank details; another Finance Manager must verify them' USING ERRCODE = '42501';
  END IF;
  PERFORM assert_supplier_destination(r);
  PERFORM set_config('app.wf', 'on', true);
  UPDATE payment_requests SET destination_review = 'REAUTHORIZE' WHERE id = p_request RETURNING version INTO v;
  PERFORM set_config('app.wf', 'off', true);
  PERFORM wf_log(p_request, v, 'VERIFICATION', 'VERIFY', role_name, 'new bank details verified', corr);
  PERFORM treasury_audit(r.debtor_company_id, 'PAYMENT_DESTINATION_REVERIFIED', 'PAYMENT_REQUEST', p_request, jsonb_build_object('detail', r.supplier_bank_detail_id));
  PERFORM wf_notify(p_request, 'REQUEST_VERIFIED');
  RETURN v;
END $$;

CREATE FUNCTION wf_reauthorize_destination(p_request uuid, p_expected_version integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; role_name text; v int; corr uuid := gen_random_uuid();
BEGIN
  role_name := wf_assert_actor(p_request, 'AUTHORIZATION');   -- an Owner who took no part in its verification
  r := wf_lock(p_request, p_expected_version);
  IF r.workflow_state <> 'AUTHENTICATED' OR r.destination_review IS DISTINCT FROM 'REAUTHORIZE' THEN
    RAISE EXCEPTION 'no verified new bank details are waiting for authorization on this payment' USING ERRCODE = '42501';
  END IF;
  PERFORM assert_supplier_destination(r);
  PERFORM set_config('app.wf', 'on', true);
  UPDATE payment_requests SET destination_review = NULL WHERE id = p_request RETURNING version INTO v;
  PERFORM set_config('app.wf', 'off', true);
  PERFORM wf_log(p_request, v, 'AUTHORIZATION', 'AUTHORIZE', role_name, 'new bank details authorized', corr);
  PERFORM treasury_audit(r.debtor_company_id, 'PAYMENT_DESTINATION_REAUTHORIZED', 'PAYMENT_REQUEST', p_request, jsonb_build_object('detail', r.supplier_bank_detail_id));
  -- The same people as a normal authorization (Treasury and the creator), with wording that says the debit was already made.
  PERFORM wf_notify(p_request, 'REQUEST_AUTHORIZED', jsonb_build_object('destination_changed', true, 'reason', 'The new supplier bank details were verified and authorized; the payment can be sent to them'));
  RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION wf_replace_destination(uuid, integer, uuid, text), wf_reverify_destination(uuid, integer), wf_reauthorize_destination(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wf_replace_destination(uuid, integer, uuid, text), wf_reverify_destination(uuid, integer), wf_reauthorize_destination(uuid, integer) TO abig_app;
GRANT SELECT (destination_review) ON payment_requests TO abig_app;

-- Recording how a payment was sent: refused while its supplier details are inactive or new ones wait for review.
CREATE OR REPLACE FUNCTION record_execution(p_request uuid, p_cheque_no text, p_bank_reference text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; a company_bank_accounts; d supplier_bank_details; v int; c text := NULLIF(btrim(p_cheque_no), ''); b text := NULLIF(btrim(p_bank_reference), '');
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
  IF r.destination_review IS NOT NULL THEN
    RAISE EXCEPTION 'new supplier bank details on this payment are waiting to be %; it cannot be sent until then', CASE r.destination_review WHEN 'REVERIFY' THEN 'verified' ELSE 'authorized' END USING ERRCODE = '23514';
  END IF;
  IF r.payee_type = 'SUPPLIER' AND r.supplier_bank_detail_id IS NOT NULL THEN
    -- Under the lock a deactivation takes: it has committed and is seen, or it waits for this record. Only deactivation stops it: details that were
    -- verified and later superseded by a newer version are still the supplier's and were approved for this payment.
    SELECT * INTO d FROM supplier_bank_details WHERE id = r.supplier_bank_detail_id FOR SHARE;
    -- A payment already sent (recorded before, or processed by the bank) may have its record corrected; a new record against inactive details may not.
    IF NOT d.is_active AND r.cheque_no IS NULL AND r.bank_reference IS NULL AND r.bank_processed_at IS NULL THEN
      RAISE EXCEPTION 'the supplier bank details on this payment were deactivated; a Finance Manager must choose active details, then they are verified and authorized again' USING ERRCODE = '23514';
    END IF;
    IF NOT d.is_active AND c IS NULL AND b IS NULL THEN
      RAISE EXCEPTION 'the record of how this payment was sent can be corrected, not removed, while its bank details are deactivated' USING ERRCODE = '23514';
    END IF;
  END IF;
  PERFORM set_config('app.wf', 'on', true);
  UPDATE payment_requests SET cheque_no = c, bank_reference = b WHERE id = p_request RETURNING version INTO v;
  PERFORM set_config('app.wf', 'off', true);
  PERFORM treasury_audit(r.debtor_company_id, 'PAYMENT_EXECUTION_RECORDED', 'PAYMENT_REQUEST', p_request,
                         jsonb_build_object('cheque_no', jsonb_build_array(r.cheque_no, c), 'bank_reference', jsonb_build_array(r.bank_reference, b)));
  RETURN v;
END $$;

-- ---------- 5. Notifications ----------
ALTER TABLE notification_outbox DROP CONSTRAINT notification_outbox_subject_chk;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_subject_chk CHECK (request_id IS NOT NULL OR event_type IN (
  'ACCOUNT_SHORTFALL', 'RECONCILIATION_SUBMITTED', 'RECONCILIATION_RETURNED', 'RECONCILIATION_LOCKED', 'ACCOUNT_OPENING_OVERDUE',
  'SUPPLIER_BANK_DETAILS_PENDING', 'PERSON_DETAILS_PENDING', 'ACCOUNT_ACCESS_GRANTED', 'ACCOUNT_ACCESS_WITHDRAWN', 'USER_LOCKED', 'PASSWORD_RESET_COMPLETED',
  'ACCOUNT_DEACTIVATED', 'ACCOUNT_REACTIVATED', 'SUPPLIER_BANK_DETAILS_DEACTIVATED', 'SUPPLIER_BANK_DETAILS_REACTIVATED'));

CREATE OR REPLACE FUNCTION in_app_event(p_type text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_type IN ('REQUEST_SUBMITTED','REQUEST_RESTARTED','REQUEST_VERIFIED','REQUEST_RETURNED','REQUEST_REJECTED','REQUEST_OVERDUE','REQUEST_PAID',
                    'REQUEST_SCHEDULE_BLOCKED','ACCOUNT_SHORTFALL','ACCOUNT_OPENING_OVERDUE','RECONCILIATION_SUBMITTED','RECONCILIATION_RETURNED',
                    'SUPPLIER_BANK_DETAILS_PENDING','PERSON_DETAILS_PENDING','ACCOUNT_DEACTIVATED','ACCOUNT_REACTIVATED',
                    'SUPPLIER_BANK_DETAILS_DEACTIVATED','SUPPLIER_BANK_DETAILS_REACTIVATED') $$;

-- Recipients: as before, plus the two new events. They go to the Finance Managers of every company linked to the supplier and to the
-- creators of the open requests that use those details.
CREATE OR REPLACE FUNCTION outbox_recipients(p_event uuid) RETURNS TABLE(user_id uuid, email text) LANGUAGE plpgsql STABLE SECURITY DEFINER ROWS 10 SET search_path = public, pg_temp AS $$
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
    IF NOT FOUND OR sd.status <> 'PENDING' OR NOT sd.is_active THEN RETURN; END IF;
    ids := ARRAY(SELECT DISTINCT x FROM company_suppliers cs CROSS JOIN LATERAL company_permission_users(cs.company_id, 'payment_request:verify') x
                  WHERE cs.supplier_id = sd.supplier_id AND app_supplier_active_for(cs.company_id, sd.supplier_id) AND x <> sd.created_by);
    RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
    RETURN;
  END IF;
  IF e.event_type IN ('SUPPLIER_BANK_DETAILS_DEACTIVATED','SUPPLIER_BANK_DETAILS_REACTIVATED') THEN
    SELECT * INTO sd FROM supplier_bank_details WHERE id = (e.payload->>'detail_id')::uuid;
    IF NOT FOUND THEN RETURN; END IF;
    ids := ARRAY(SELECT DISTINCT x FROM company_suppliers cs CROSS JOIN LATERAL company_permission_users(cs.company_id, 'payment_request:verify') x
                  WHERE cs.supplier_id = sd.supplier_id AND cs.status = 'ACTIVE')
        || ARRAY(SELECT DISTINCT q.created_by FROM payment_requests q
                  WHERE q.supplier_bank_detail_id = sd.id AND q.workflow_state IN ('DRAFT','SCHEDULED','RESERVED','VERIFIED','AUTHENTICATED'));
    RETURN QUERY SELECT DISTINCT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
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
