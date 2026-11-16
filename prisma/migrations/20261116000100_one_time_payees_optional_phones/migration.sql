-- ABIG Finance - One-time payees, supplier bank details only where the method needs them, and optional phone numbers.
--
--   * A request can pay a one-time payee: a name (required), an optional phone and, when needed, bank details, entered on the request itself.
--     No supplier or person record is created. The details are a row of their own (one_time_payees) that can never be changed or deleted; editing
--     a draft enters a new row and points the request at it, so every version stays, and each change is written to the audit log.
--     The full account number is encrypted by the application, as for suppliers. The application role cannot read it: it comes back only through
--     reveal_one_time_account(), to the request's creator, Verifiers and Authorizers of the company, and each view is logged.
--   * Separation of duties does not change: the request is still verified by someone other than its creator and authenticated by a third person,
--     and both see the payee's name and destination before they act. Nothing about the request can change after submission except through the
--     existing review steps, which cannot touch the payee.
--   * Destination details are checked where they always were: assert_submittable(), which runs on submission (before any money is reserved) and
--     again on verification, authentication, adjustment and the release of a scheduled request.
--       - Suppliers: a transfer still needs the supplier's verified bank details, and so does Telebirr (suppliers have no other verified destination).
--         Cash and cheque need none. Bank details attached to a request, whatever the method, must still be the supplier's own verified ones.
--       - One-time payees: a transfer needs the bank and the full account number; Telebirr needs an Ethiopian mobile number. Cash and cheque need none.
--       - People: unchanged.
--   * Suppliers get an optional phone number; a person's phone becomes optional. Empty means none (NULL). No existing row changes.
--   * Money logic is untouched: reservations, balances, the funds guard and the approval steps are not redefined here.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Phone numbers, optional
-- ---------------------------------------------------------------------------------------------------------------------
-- A contact number: Ethiopian mobile or landline in any usual spelling, or an international number. Empty is NULL. One written form (+country...).
CREATE FUNCTION normalize_contact_phone(p text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text := regexp_replace(coalesce(p, ''), '[[:space:]().-]', '', 'g');
BEGIN
  IF s = '' THEN RETURN NULL; END IF;
  IF s ~ '^00[1-9]' THEN s := '+' || substr(s, 3); END IF;
  IF s ~ '^0[1-9][0-9]{8}$' THEN RETURN '+251' || substr(s, 2); END IF;
  IF s ~ '^251[1-9][0-9]{8}$' THEN RETURN '+' || s; END IF;
  IF s ~ '^\+251' THEN
    IF s ~ '^\+251[1-9][0-9]{8}$' THEN RETURN s; END IF;
  ELSIF s ~ '^\+[1-9][0-9]{6,14}$' THEN RETURN s;
  END IF;
  RAISE EXCEPTION 'enter a valid phone number, for example 0911 234 567 or 011 551 2345, or leave it empty' USING ERRCODE = '23514';
END $$;

-- A person's phone keeps its existing rule (an Ethiopian mobile), but may now be left empty.
CREATE FUNCTION normalize_et_phone_optional(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN btrim(coalesce(p, '')) = '' THEN NULL ELSE normalize_et_phone(p) END $$;
REVOKE EXECUTE ON FUNCTION normalize_contact_phone(text), normalize_et_phone_optional(text) FROM PUBLIC;

-- Suppliers: an optional phone. Every write goes through the same normalisation, so '' and NULL both mean none.
ALTER TABLE suppliers ADD COLUMN phone text CONSTRAINT suppliers_phone_check CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$');
CREATE FUNCTION supplier_phone_normalize() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN NEW.phone := normalize_contact_phone(NEW.phone); RETURN NEW; END $$;
CREATE TRIGGER suppliers_phone_normalize BEFORE INSERT OR UPDATE OF phone ON suppliers FOR EACH ROW EXECUTE FUNCTION supplier_phone_normalize();

-- Setting or clearing a supplier's phone needs the same rights as correcting its name. A phone is contact information, not a payment destination,
-- so it may change while requests are in progress. Every change is audited.
CREATE FUNCTION supplier_set_phone(p_id uuid, p_phone text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s suppliers; v_phone text := normalize_contact_phone(p_phone);
BEGIN
  IF app_user_id() IS NULL OR NOT (app_has_role_anywhere('VERIFIER') OR app_has_role_anywhere('FINANCE_MANAGER') OR EXISTS (SELECT 1 FROM app_permitted_companies('supplier:manage'))) THEN
    RAISE EXCEPTION 'you may not change suppliers' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM suppliers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'supplier not found' USING ERRCODE = 'P0002'; END IF;
  IF v_phone IS NOT DISTINCT FROM s.phone THEN RETURN; END IF;
  UPDATE suppliers SET phone = v_phone WHERE id = p_id;
  PERFORM treasury_audit(NULL, 'SUPPLIER_PHONE_CHANGED', 'SUPPLIER', p_id, jsonb_build_object('phone', jsonb_build_array(s.phone, v_phone)));
END $$;
REVOKE EXECUTE ON FUNCTION supplier_set_phone(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supplier_set_phone(uuid, text) TO abig_app;

-- People: the phone becomes optional. The format check and the per-company uniqueness stay (UNIQUE treats NULLs as different).
ALTER TABLE person_payees ALTER COLUMN phone DROP NOT NULL;

CREATE OR REPLACE FUNCTION person_payee_create(p_company uuid, p_name text, p_phone text, p_id_enc text, p_id_last4 text, p_id_hash text, p_preferred payment_method) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF app_user_id() IS NULL OR NOT app_has_permission(p_company, 'payee:manage') THEN RAISE EXCEPTION 'you may not add people for this company' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_name, ''))) = 0 THEN RAISE EXCEPTION 'the name is required' USING ERRCODE = '23514'; END IF;
  IF p_id_enc IS NULL OR p_id_hash IS NULL OR p_id_last4 IS NULL THEN RAISE EXCEPTION 'the ID number is required' USING ERRCODE = '23514'; END IF;
  INSERT INTO person_payees (company_id, full_name, phone, id_number_enc, id_last4, id_hash, preferred_method, created_by)
  VALUES (p_company, btrim(p_name), normalize_et_phone_optional(p_phone), p_id_enc, p_id_last4, p_id_hash, COALESCE(p_preferred, 'TRANSFER'), app_user_id()) RETURNING id INTO v_id;
  PERFORM treasury_audit(p_company, 'PERSON_PAYEE_ADDED', 'PERSON_PAYEE', v_id, jsonb_build_object('name', btrim(p_name), 'id_last4', p_id_last4));
  RETURN v_id;
END $$;

-- Unchanged except that the phone may be empty. Changing it (including adding or clearing it) still counts as a change while requests hold funds.
CREATE OR REPLACE FUNCTION person_payee_update(p_id uuid, p_name text, p_phone text, p_preferred payment_method, p_active boolean, p_id_enc text DEFAULT NULL, p_id_last4 text DEFAULT NULL, p_id_hash text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o person_payees; v_phone text := normalize_et_phone_optional(p_phone); new_id boolean := p_id_enc IS NOT NULL;
BEGIN
  SELECT * INTO o FROM person_payees WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR o.company_id NOT IN (SELECT app_readable_companies()) THEN RAISE EXCEPTION 'person not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT app_has_permission(o.company_id, 'payee:manage') THEN RAISE EXCEPTION 'you may not change people for this company' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_name, ''))) = 0 THEN RAISE EXCEPTION 'the name is required' USING ERRCODE = '23514'; END IF;
  IF new_id AND (p_id_last4 IS NULL OR p_id_hash IS NULL) THEN RAISE EXCEPTION 'the ID number is incomplete' USING ERRCODE = '23514'; END IF;
  IF (btrim(p_name) <> o.full_name OR v_phone IS DISTINCT FROM o.phone OR new_id OR NOT p_active)
     AND EXISTS (SELECT 1 FROM payment_requests r WHERE r.person_payee_id = p_id AND r.workflow_state IN ('RESERVED','VERIFIED')) THEN
    RAISE EXCEPTION 'this person has requests in progress; finish or cancel them before changing the name, phone, ID or status' USING ERRCODE = '42501';
  END IF;
  UPDATE person_payees SET full_name = btrim(p_name), phone = v_phone, preferred_method = COALESCE(p_preferred, preferred_method), is_active = p_active,
         id_number_enc = COALESCE(p_id_enc, id_number_enc), id_last4 = COALESCE(p_id_last4, id_last4), id_hash = COALESCE(p_id_hash, id_hash) WHERE id = p_id;
  PERFORM treasury_audit(o.company_id, 'PERSON_PAYEE_CHANGED', 'PERSON_PAYEE', p_id,
    jsonb_build_object('name', jsonb_build_array(o.full_name, btrim(p_name)), 'phone', jsonb_build_array(o.phone, v_phone), 'active', jsonb_build_array(o.is_active, p_active),
                       'id_last4', jsonb_build_array(o.id_last4, COALESCE(p_id_last4, o.id_last4))));
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. One-time payees
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE one_time_payees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  full_name text NOT NULL CONSTRAINT one_time_payees_name_chk CHECK (btrim(full_name) <> '' AND length(full_name) <= 200),
  phone text CONSTRAINT one_time_payees_phone_chk CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$'),
  bank_name text,
  account_last4 char(4),
  account_number_enc text,                                                   -- AES-256-GCM, written by the application
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_time_payees_company_id_key UNIQUE (company_id, id),
  -- Bank details are all or nothing: the bank, the last four digits and the encrypted full number.
  CONSTRAINT one_time_payees_bank_chk CHECK (
       (bank_name IS NULL AND account_last4 IS NULL AND account_number_enc IS NULL)
    OR (btrim(bank_name) <> '' AND length(bank_name) <= 120 AND account_last4 ~ '^[0-9]{4}$' AND account_number_enc LIKE 'v1:%'))
);
CREATE INDEX one_time_payees_company_idx ON one_time_payees (company_id);
-- What was entered is kept as entered: a correction is a new row.
CREATE TRIGGER one_time_payees_no_update BEFORE UPDATE ON one_time_payees FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER one_time_payees_no_delete BEFORE DELETE ON one_time_payees FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER one_time_payees_no_truncate BEFORE TRUNCATE ON one_time_payees FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

ALTER TABLE one_time_payees ENABLE ROW LEVEL SECURITY;   -- the read policy follows section 3, once requests can point at a payee
-- By column: the encrypted account number is left out on purpose. Rows are written only by one_time_payee_create().
GRANT SELECT (id, company_id, full_name, phone, bank_name, account_last4, created_by, created_at) ON one_time_payees TO abig_app;

-- Entering a one-time payee needs the right to create payment requests in that company.
CREATE FUNCTION one_time_payee_create(p_company uuid, p_name text, p_phone text, p_bank text, p_last4 text, p_enc text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_name text := btrim(coalesce(p_name, '')); v_bank text := NULLIF(btrim(coalesce(p_bank, '')), ''); v_phone text := normalize_contact_phone(p_phone);
BEGIN
  IF app_user_id() IS NULL OR NOT app_has_permission(p_company, 'payment_request:create') THEN
    RAISE EXCEPTION 'you may not create payment requests for this company' USING ERRCODE = '42501';
  END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'the payee name is required' USING ERRCODE = '23514'; END IF;
  IF length(v_name) > 200 THEN RAISE EXCEPTION 'the payee name is too long' USING ERRCODE = '23514'; END IF;
  IF (v_bank IS NULL) <> (p_enc IS NULL) OR (p_enc IS NOT NULL AND coalesce(p_last4, '') !~ '^[0-9]{4}$') OR (p_enc IS NULL AND p_last4 IS NOT NULL) THEN
    RAISE EXCEPTION 'enter both the bank and the full account number, or leave both empty' USING ERRCODE = '23514';
  END IF;
  INSERT INTO one_time_payees (company_id, full_name, phone, bank_name, account_last4, account_number_enc, created_by)
  VALUES (p_company, v_name, v_phone, v_bank, p_last4, p_enc, app_user_id()) RETURNING id INTO v_id;
  PERFORM treasury_audit(p_company, 'ONE_TIME_PAYEE_ENTERED', 'ONE_TIME_PAYEE', v_id,
    jsonb_build_object('name', v_name, 'phone', v_phone, 'bank', v_bank, 'account_last4', p_last4, 'account_number_recorded', p_enc IS NOT NULL));
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION one_time_payee_create(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION one_time_payee_create(uuid, text, text, text, text, text) TO abig_app;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Requests pay a supplier, a person or a one-time payee: exactly one
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE payment_requests ADD COLUMN one_time_payee_id uuid;
ALTER TABLE payment_requests DROP CONSTRAINT payment_requests_payee_chk;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_payee_chk CHECK (
       (payee_type = 'SUPPLIER' AND supplier_id IS NOT NULL AND person_payee_id IS NULL AND person_payment_detail_id IS NULL AND one_time_payee_id IS NULL)
    OR (payee_type = 'PERSON' AND person_payee_id IS NOT NULL AND supplier_id IS NULL AND supplier_bank_detail_id IS NULL AND one_time_payee_id IS NULL)
    OR (payee_type = 'ONE_TIME' AND one_time_payee_id IS NOT NULL AND supplier_id IS NULL AND supplier_bank_detail_id IS NULL
        AND person_payee_id IS NULL AND person_payment_detail_id IS NULL));
-- The payee belongs to the company paying, and to one request only.
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_one_time_company_fkey FOREIGN KEY (debtor_company_id, one_time_payee_id) REFERENCES one_time_payees (company_id, id);
CREATE UNIQUE INDEX payment_requests_one_time_payee_once ON payment_requests (one_time_payee_id) WHERE one_time_payee_id IS NOT NULL;

GRANT INSERT (one_time_payee_id), UPDATE (one_time_payee_id) ON payment_requests TO abig_app;

-- Members of the company see a one-time payee when they can see a request that pays it (drafts only to their creator), or when they entered it.
-- Group reporting is not membership, so it never sees who is paid, as for suppliers and people.
CREATE POLICY one_time_payees_read ON one_time_payees FOR SELECT TO abig_app
  USING (company_id IN (SELECT app_member_companies())
         AND (created_by = app_user_id() OR EXISTS (SELECT 1 FROM payment_requests r WHERE r.one_time_payee_id = one_time_payees.id)));

DROP POLICY requests_insert ON payment_requests;
CREATE POLICY requests_insert ON payment_requests FOR INSERT TO abig_app
  WITH CHECK (debtor_company_id IN (SELECT app_permitted_companies('payment_request:create')) AND created_by = app_user_id() AND workflow_state = 'DRAFT'
              AND CASE payee_type WHEN 'SUPPLIER' THEN app_supplier_active_for(debtor_company_id, supplier_id)
                                  WHEN 'PERSON' THEN app_person_active_for(debtor_company_id, person_payee_id)
                                  WHEN 'ONE_TIME' THEN one_time_payee_id IS NOT NULL
                                  ELSE false END);

-- A request can only point at one-time payee details its own creator entered. Pointing a draft at new details is the only way to correct them;
-- the old row stays, and the change is audited with what was entered. After submission the request cannot be updated outside the workflow,
-- and no workflow step changes the payee.
CREATE FUNCTION payment_request_one_time_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o one_time_payees;
BEGIN
  IF NEW.one_time_payee_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.one_time_payee_id IS DISTINCT FROM OLD.one_time_payee_id) THEN
    SELECT * INTO o FROM one_time_payees WHERE id = NEW.one_time_payee_id;
    IF NOT FOUND OR o.created_by <> NEW.created_by THEN
      RAISE EXCEPTION 'one-time payee details must be entered by the person who creates the request' USING ERRCODE = '42501';
    END IF;
    PERFORM treasury_audit(NEW.debtor_company_id, 'REQUEST_ONE_TIME_PAYEE_SET', 'PAYMENT_REQUEST', NEW.id,
      jsonb_build_object('one_time_payee_id', o.id, 'previous', CASE WHEN TG_OP = 'UPDATE' THEN OLD.one_time_payee_id END,
                         'name', o.full_name, 'phone', o.phone, 'bank', o.bank_name, 'account_last4', o.account_last4));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_requests_one_time_guard BEFORE INSERT OR UPDATE OF one_time_payee_id ON payment_requests FOR EACH ROW EXECUTE FUNCTION payment_request_one_time_guard();

-- Corrects the one-time payee on the caller's own draft. Leaving the account number empty keeps the current bank details when the bank is unchanged
-- (the encrypted number is copied here; the application never reads it back), removes them when the bank is cleared, and is refused when the bank
-- changes without a new number. Nothing changes when nothing differs. Returns the details the request now points at.
CREATE FUNCTION one_time_payee_revise(p_request uuid, p_name text, p_phone text, p_bank text, p_last4 text, p_enc text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; o one_time_payees; v_bank text := NULLIF(btrim(coalesce(p_bank, '')), ''); v_last4 text := p_last4; v_enc text := p_enc; v_id uuid;
BEGIN
  SELECT * INTO r FROM payment_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR NOT app_can_see_request(p_request) THEN RAISE EXCEPTION 'request not found' USING ERRCODE = 'P0002'; END IF;
  IF r.created_by <> app_user_id() OR r.workflow_state <> 'DRAFT' OR NOT app_has_permission(r.debtor_company_id, 'payment_request:update') THEN
    RAISE EXCEPTION 'this request can no longer be edited by you' USING ERRCODE = '42501';
  END IF;
  IF r.payee_type <> 'ONE_TIME' THEN RAISE EXCEPTION 'this request does not pay a one-time payee' USING ERRCODE = '23514'; END IF;
  SELECT * INTO o FROM one_time_payees WHERE id = r.one_time_payee_id;
  IF v_enc IS NULL AND v_last4 IS NULL AND v_bank IS NOT NULL THEN
    IF v_bank IS DISTINCT FROM o.bank_name OR o.account_number_enc IS NULL THEN
      RAISE EXCEPTION 'enter the full account number for the new bank details' USING ERRCODE = '23514';
    END IF;
    v_last4 := o.account_last4; v_enc := o.account_number_enc;
  END IF;
  IF btrim(coalesce(p_name, '')) = o.full_name AND normalize_contact_phone(p_phone) IS NOT DISTINCT FROM o.phone AND v_bank IS NOT DISTINCT FROM o.bank_name
     AND v_last4 IS NOT DISTINCT FROM o.account_last4::text AND v_enc IS NOT DISTINCT FROM o.account_number_enc THEN
    RETURN o.id;
  END IF;
  v_id := one_time_payee_create(r.debtor_company_id, p_name, p_phone, v_bank, v_last4, v_enc);
  UPDATE payment_requests SET one_time_payee_id = v_id WHERE id = p_request;
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION one_time_payee_revise(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION one_time_payee_revise(uuid, text, text, text, text, text) TO abig_app;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. What a request needs before it can hold money (the stage where destination details become mandatory)
-- ---------------------------------------------------------------------------------------------------------------------
-- Unchanged for everything but the payee checks. Called by wf_submit, wf_verify, wf_authorize, wf_adjust, wf_schedule and the scheduled release.
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
    -- Bank details on a request are always the supplier's own verified ones, whatever the method: never an unrelated or unverified account.
    IF r.supplier_bank_detail_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM supplier_bank_details WHERE id = r.supplier_bank_detail_id AND supplier_id = r.supplier_id AND status = 'VERIFIED') THEN
      RAISE EXCEPTION 'verified supplier bank details are required' USING ERRCODE = '23514';
    END IF;
    -- A transfer goes to verified bank details. Telebirr keeps that rule too: suppliers have no other verified destination. Cash and cheque need none.
    IF r.payment_method IN ('TRANSFER','TELEBIRR') AND r.supplier_bank_detail_id IS NULL THEN
      RAISE EXCEPTION 'verified supplier bank details are required for a % payment; cash and cheque need none', CASE r.payment_method WHEN 'TRANSFER' THEN 'bank transfer' ELSE 'Telebirr' END
        USING ERRCODE = '23514';
    END IF;
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

-- The details a scheduled request is saved with, before and after a change: now including the one-time payee.
CREATE OR REPLACE FUNCTION request_snapshot(p_request uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('scheduled_for', r.scheduled_for, 'total_amount', r.total_amount, 'debit_account_id', r.debit_account_id, 'payment_method', r.payment_method,
           'supplier_id', r.supplier_id, 'supplier_bank_detail_id', r.supplier_bank_detail_id, 'person_payee_id', r.person_payee_id, 'person_payment_detail_id', r.person_payment_detail_id,
           'one_time_payee_id', r.one_time_payee_id,
           'invoice_ref', r.invoice_ref, 'invoice_date', r.invoice_date, 'priority', r.priority, 'description', r.description,
           'installments', COALESCE((SELECT jsonb_agg(jsonb_build_object('seq', i.seq, 'due_date', i.due_date, 'amount', i.amount) ORDER BY i.seq) FROM payment_installments i WHERE i.request_id = r.id), '[]'::jsonb))
    FROM payment_requests r WHERE r.id = p_request $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. The full account number of a one-time payee, for those who handle the request
-- ---------------------------------------------------------------------------------------------------------------------
-- The company a person may reveal it for: they can see the request, belong to the company, and created it or may verify or authenticate there.
CREATE FUNCTION app_one_time_reveal_company(p_payee uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.company_id FROM one_time_payees o JOIN payment_requests r ON r.one_time_payee_id = o.id
   WHERE o.id = p_payee AND app_user_id() IS NOT NULL AND o.company_id IN (SELECT app_member_companies()) AND app_can_see_request(r.id)
     AND (r.created_by = app_user_id() OR app_has_permission(o.company_id, 'payment_request:verify') OR app_has_permission(o.company_id, 'payment_request:authenticate'))
   LIMIT 1 $$;
CREATE FUNCTION one_time_account_state(p_payee uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN app_one_time_reveal_company(o.id) IS NULL THEN 'MASKED' WHEN o.account_number_enc IS NULL THEN 'NOT_RECORDED' ELSE 'RECORDED' END
    FROM one_time_payees o WHERE o.id = p_payee $$;
CREATE FUNCTION reveal_one_time_account(p_payee uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c uuid; o one_time_payees;
BEGIN
  c := app_one_time_reveal_company(p_payee);
  IF c IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO o FROM one_time_payees WHERE id = p_payee;
  IF o.account_number_enc IS NULL THEN RETURN NULL; END IF;
  PERFORM treasury_audit(c, 'ONE_TIME_ACCOUNT_NUMBER_VIEWED', 'ONE_TIME_PAYEE', o.id, jsonb_build_object('request', (SELECT r.id FROM payment_requests r WHERE r.one_time_payee_id = o.id)));
  RETURN o.account_number_enc;
END $$;
REVOKE EXECUTE ON FUNCTION app_one_time_reveal_company(uuid), one_time_account_state(uuid), reveal_one_time_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION one_time_account_state(uuid), reveal_one_time_account(uuid) TO abig_app;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Shared accounts: the payee's name on outstanding and reconciliation lists, under the same visibility rule as before
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION outstanding_payments(p_account uuid) RETURNS TABLE(id uuid, request_no text, company_id uuid, company text, payee text, method text, amount numeric, cheque_no text, bank_reference text, authenticated_at timestamp with time zone, processed_at timestamp with time zone, age_days integer, overdue boolean, carried boolean, default_processed boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id, r.request_no, r.debtor_company_id, c.legal_name,
         CASE WHEN d.detail THEN COALESCE(s.legal_name, p.full_name, ot.full_name) END, r.payment_method::text, r.total_amount,
         CASE WHEN d.detail THEN r.cheque_no END, CASE WHEN d.detail THEN r.bank_reference END, r.authenticated_at, r.bank_processed_at,
         a.age, a.age >= 14,
         COALESCE((SELECT t.week_start FROM bank_balance_history h JOIN treasury_weeks t ON t.id = h.week_id WHERE h.request_id = r.id), '-infinity') < week_monday(addis_day(treasury_now())),
         r.payment_method IN ('TRANSFER','TELEBIRR')
    FROM payment_requests r JOIN companies c ON c.id = r.debtor_company_id LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN person_payees p ON p.id = r.person_payee_id
         LEFT JOIN one_time_payees ot ON ot.id = r.one_time_payee_id
         CROSS JOIN LATERAL (SELECT GREATEST(addis_day(treasury_now()) - addis_day(r.authenticated_at), 0) AS age) a
         CROSS JOIN LATERAL (SELECT app_account_access(p_account) = 'FULL' OR r.debtor_company_id IN (SELECT app_readable_companies()) AS detail) d
   WHERE r.debit_account_id = p_account AND r.workflow_state = 'AUTHENTICATED' AND app_can_see_account(p_account) AND app_can_see_line(r.debtor_company_id, p_account)
   ORDER BY r.authenticated_at, r.id $$;

CREATE OR REPLACE FUNCTION reconciliation_payments(p_week uuid) RETURNS TABLE(id uuid, request_no text, company text, payee text, method text, amount numeric, cheque_no text, bank_reference text, authenticated_at timestamp with time zone, age_days integer, overdue boolean, line_id uuid, statement_date date, reference text, carry_reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w treasury_weeks; everything boolean;
BEGIN
  SELECT * INTO w FROM treasury_weeks x WHERE x.id = p_week;
  IF NOT FOUND OR NOT app_can_see_account(w.account_id) THEN RETURN; END IF;
  everything := app_account_access(w.account_id) = 'FULL';
  RETURN QUERY
  SELECT r.id, r.request_no, c.legal_name,
         CASE WHEN d.detail THEN COALESCE(s.legal_name, p.full_name, ot.full_name) END, r.payment_method::text, r.total_amount,
         CASE WHEN d.detail THEN r.cheque_no END, CASE WHEN d.detail THEN r.bank_reference END, r.authenticated_at,
         GREATEST(addis_day(treasury_now()) - addis_day(r.authenticated_at), 0), addis_day(treasury_now()) - addis_day(r.authenticated_at) >= 14 AND r.workflow_state = 'AUTHENTICATED',
         m.id, m.statement_date, CASE WHEN d.detail THEN m.reference END, CASE WHEN d.detail THEN cr.reason END
    FROM payment_requests r JOIN companies c ON c.id = r.debtor_company_id LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN person_payees p ON p.id = r.person_payee_id
         LEFT JOIN one_time_payees ot ON ot.id = r.one_time_payee_id
         LEFT JOIN reconciliation_lines m ON m.request_id = r.id AND m.week_id = p_week AND m.kind = 'PAYMENT' AND m.voided_at IS NULL
         LEFT JOIN reconciliation_lines cr ON cr.request_id = r.id AND cr.week_id = p_week AND cr.kind = 'CARRY' AND cr.voided_at IS NULL
         CROSS JOIN LATERAL (SELECT everything OR r.debtor_company_id IN (SELECT app_readable_companies()) AS detail) d
   WHERE app_can_see_line(r.debtor_company_id, w.account_id)
     AND (m.id IS NOT NULL OR cr.id IS NOT NULL OR (w.status <> 'LOCKED' AND r.id IN (SELECT y.id FROM recon_candidates(w) y)))
   ORDER BY r.authenticated_at, r.id;
END $$;
