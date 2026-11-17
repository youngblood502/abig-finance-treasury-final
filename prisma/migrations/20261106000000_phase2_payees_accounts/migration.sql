-- ABIG Finance - Treasury Phase 2: people as payees, payment methods and account types.
--
--   * A request pays exactly one supplier or one person. Suppliers work as before.
--   * A person belongs to one company. Name, phone and ID number are required. The ID number is encrypted by the application with
--     APP_ENCRYPTION_KEY (the database never sees it or the key). The application role cannot read the encrypted column: lists show
--     the last four digits, and reveal_person_id() hands it out on the request page only, to those allowed, and logs each view.
--   * A person's bank or Telebirr details are versioned, and a second person must verify every change, like supplier bank details.
--   * Accounts are BANK, WALLET (Telebirr, identified by phone) or CASH. Balances, reservations, shortfall and buffer work the same on all.
--   * Invoice documents are optional. A reference, when entered, is still checked for duplicates.
--   * Cash comes from cash accounts, Telebirr from wallets, cheques and transfers from bank accounts.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Phone numbers
-- ---------------------------------------------------------------------------------------------------------------------
-- One written form, so the same number cannot be entered twice in two spellings.
CREATE FUNCTION normalize_et_phone(p text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text := regexp_replace(coalesce(p, ''), '[[:space:]()-]', '', 'g');
BEGIN
  IF s ~ '^0[79][0-9]{8}$' THEN RETURN '+251' || substr(s, 2); END IF;
  IF s ~ '^251[79][0-9]{8}$' THEN RETURN '+' || s; END IF;
  IF s ~ '^\+251[79][0-9]{8}$' THEN RETURN s; END IF;
  RAISE EXCEPTION 'enter an Ethiopian mobile number, for example 0911 234 567' USING ERRCODE = '23514';
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Account types
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TYPE account_kind AS ENUM ('BANK','WALLET','CASH');
ALTER TABLE company_bank_accounts
  ADD COLUMN account_kind account_kind NOT NULL DEFAULT 'BANK',
  ADD COLUMN wallet_phone text,
  ALTER COLUMN bank_id DROP NOT NULL,
  ALTER COLUMN account_last4 DROP NOT NULL,
  ADD CONSTRAINT company_bank_accounts_kind_chk CHECK (
       (account_kind = 'BANK'   AND bank_id IS NOT NULL AND account_last4 IS NOT NULL AND wallet_phone IS NULL)
    OR (account_kind = 'WALLET' AND wallet_phone IS NOT NULL AND bank_id IS NULL AND account_last4 IS NULL)
    OR (account_kind = 'CASH'   AND bank_id IS NULL AND account_last4 IS NULL AND wallet_phone IS NULL));
CREATE UNIQUE INDEX company_bank_accounts_wallet_phone ON company_bank_accounts (wallet_phone) WHERE wallet_phone IS NOT NULL;

CREATE FUNCTION register_wallet_account(p_owner uuid, p_label text, p_phone text, p_buffer numeric) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF app_user_id() IS NULL OR NOT app_has_permission(p_owner, 'bank_account:manage') THEN RAISE EXCEPTION 'you may not register accounts for this company' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_label, ''))) = 0 THEN RAISE EXCEPTION 'the account name is required' USING ERRCODE = '23514'; END IF;
  IF COALESCE(p_buffer, 0) < 0 THEN RAISE EXCEPTION 'the minimum buffer cannot be negative' USING ERRCODE = '23514'; END IF;
  INSERT INTO company_bank_accounts (account_kind, account_label, wallet_phone, min_buffer)
  VALUES ('WALLET', btrim(p_label), normalize_et_phone(p_phone), COALESCE(p_buffer, 0)) RETURNING id INTO v_id;
  INSERT INTO company_bank_account_access (account_id, company_id, is_owner, permissions, granted_by) VALUES (v_id, p_owner, true, ARRAY['USE','RECORD_SNAPSHOT'], app_user_id());
  PERFORM treasury_audit(p_owner, 'WALLET_ACCOUNT_REGISTERED', 'BANK_ACCOUNT', v_id, jsonb_build_object('label', p_label, 'phone', normalize_et_phone(p_phone)));
  RETURN v_id;
END $$;

CREATE FUNCTION register_cash_account(p_owner uuid, p_label text, p_buffer numeric) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF app_user_id() IS NULL OR NOT app_has_permission(p_owner, 'bank_account:manage') THEN RAISE EXCEPTION 'you may not register accounts for this company' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_label, ''))) = 0 THEN RAISE EXCEPTION 'the account name is required' USING ERRCODE = '23514'; END IF;
  IF COALESCE(p_buffer, 0) < 0 THEN RAISE EXCEPTION 'the minimum buffer cannot be negative' USING ERRCODE = '23514'; END IF;
  INSERT INTO company_bank_accounts (account_kind, account_label, min_buffer) VALUES ('CASH', btrim(p_label), COALESCE(p_buffer, 0)) RETURNING id INTO v_id;
  INSERT INTO company_bank_account_access (account_id, company_id, is_owner, permissions, granted_by) VALUES (v_id, p_owner, true, ARRAY['USE','RECORD_SNAPSHOT'], app_user_id());
  PERFORM treasury_audit(p_owner, 'CASH_ACCOUNT_REGISTERED', 'BANK_ACCOUNT', v_id, jsonb_build_object('label', p_label));
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION register_wallet_account(uuid, text, text, numeric), register_cash_account(uuid, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_wallet_account(uuid, text, text, numeric), register_cash_account(uuid, text, numeric) TO abig_app;

-- A bank account still needs its bank and last four digits, now that the table allows them to be empty.
CREATE OR REPLACE FUNCTION register_bank_account(p_owner uuid, p_bank text, p_label text, p_last4 text, p_enc bytea, p_buffer numeric) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_bank uuid;
BEGIN
  IF app_user_id() IS NULL OR NOT app_has_permission(p_owner, 'bank_account:manage') THEN RAISE EXCEPTION 'you may not register accounts for this company' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_bank, ''))) = 0 THEN RAISE EXCEPTION 'the bank is required' USING ERRCODE = '23514'; END IF;
  IF coalesce(p_last4, '') !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'the last four digits of the account are required' USING ERRCODE = '23514'; END IF;
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

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. People
-- ---------------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, resource, action, description) VALUES
  ('payee:view',          'payee', 'view',          'See people who are paid'),
  ('payee:manage',        'payee', 'manage',        'Create and correct people who are paid, and enter their payment details'),
  ('payee:view_identity', 'payee', 'view_identity', 'See a person''s full ID number on a payment request');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON
     (r.code IN ('ACCOUNTANT','FINANCE_MANAGER') AND p.code IN ('payee:view','payee:manage','payee:view_identity'))
  OR (r.code = 'OWNER' AND p.code IN ('payee:view','payee:view_identity'));

-- One row per company: uniqueness is per company, and a person's details do not travel between companies.
CREATE TABLE person_payees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  full_name text NOT NULL CHECK (btrim(full_name) <> ''),
  phone text NOT NULL CHECK (phone ~ '^\+251[79][0-9]{8}$'),
  id_number_enc text NOT NULL CHECK (id_number_enc LIKE 'v1:%'),            -- AES-256-GCM, written by the application
  id_last4 text NOT NULL CHECK (length(id_last4) = 4),
  id_hash text NOT NULL CHECK (id_hash ~ '^[0-9a-f]{64}$'),                 -- keyed hash of the ID number, only to find duplicates
  preferred_method payment_method NOT NULL DEFAULT 'TRANSFER',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_payees_company_id_key UNIQUE (company_id, id),
  CONSTRAINT person_payees_phone_key UNIQUE (company_id, phone),
  CONSTRAINT person_payees_id_hash_key UNIQUE (company_id, id_hash)
);
CREATE TRIGGER person_payees_no_delete BEFORE DELETE ON person_payees FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER person_payees_no_truncate BEFORE TRUNCATE ON person_payees FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Every change to how a person is paid is a new version that someone other than its creator must verify.
CREATE TABLE person_payment_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES person_payees(id),
  version int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('BANK','TELEBIRR')),
  bank_name text,
  account_last4 char(4),
  telebirr_phone text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','REJECTED','SUPERSEDED')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz,
  rejection_reason text,
  UNIQUE (person_id, version),
  CONSTRAINT person_payment_details_person_id_key UNIQUE (person_id, id),
  CONSTRAINT person_payment_details_kind_chk CHECK (
       (kind = 'BANK' AND btrim(coalesce(bank_name, '')) <> '' AND account_last4 ~ '^[0-9]{4}$' AND telebirr_phone IS NULL)
    OR (kind = 'TELEBIRR' AND telebirr_phone ~ '^\+251[79][0-9]{8}$' AND bank_name IS NULL AND account_last4 IS NULL))
);
CREATE UNIQUE INDEX person_detail_one_verified ON person_payment_details (person_id, kind) WHERE status = 'VERIFIED';

CREATE FUNCTION person_detail_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := COALESCE((SELECT max(version) FROM person_payment_details WHERE person_id = NEW.person_id), 0) + 1;
    NEW.status := 'PENDING'; NEW.verified_by := NULL; NEW.verified_at := NULL; NEW.rejection_reason := NULL;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'verified_by' - 'verified_at' - 'rejection_reason') IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'verified_by' - 'verified_at' - 'rejection_reason') THEN
    RAISE EXCEPTION 'payment details cannot be edited; add a new version' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'VERIFIED' AND NEW.status = 'SUPERSEDED' AND pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF OLD.status <> 'PENDING' OR NEW.status NOT IN ('VERIFIED','REJECTED') THEN
    RAISE EXCEPTION 'only pending payment details can be verified or rejected' USING ERRCODE = '42501';
  END IF;
  NEW.verified_by := COALESCE(app_user_id(), NEW.verified_by); NEW.verified_at := now();
  IF NEW.verified_by IS NULL OR NEW.verified_by = OLD.created_by THEN
    RAISE EXCEPTION 'payment details must be checked by someone other than the person who entered them' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'REJECTED' AND btrim(coalesce(NEW.rejection_reason, '')) = '' THEN RAISE EXCEPTION 'a rejection needs a reason' USING ERRCODE = '23514'; END IF;
  IF NEW.status = 'VERIFIED' THEN
    UPDATE person_payment_details SET status = 'SUPERSEDED' WHERE person_id = NEW.person_id AND kind = NEW.kind AND status = 'VERIFIED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER person_payment_details_guard BEFORE INSERT OR UPDATE ON person_payment_details FOR EACH ROW EXECUTE FUNCTION person_detail_guard();
CREATE TRIGGER person_payment_details_no_delete BEFORE DELETE ON person_payment_details FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER person_payment_details_no_truncate BEFORE TRUNCATE ON person_payment_details FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

ALTER TABLE person_payees ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_payment_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY person_payees_read ON person_payees FOR SELECT TO abig_app USING (company_id IN (SELECT app_readable_companies()));
CREATE POLICY person_details_read ON person_payment_details FOR SELECT TO abig_app
  USING (EXISTS (SELECT 1 FROM person_payees p WHERE p.id = person_id AND p.company_id IN (SELECT app_readable_companies())));
-- Reading is by column: id_number_enc and id_hash are left out on purpose. All writes go through the functions below.
GRANT SELECT (id, company_id, full_name, phone, id_last4, preferred_method, is_active, created_by, created_at) ON person_payees TO abig_app;
GRANT SELECT ON person_payment_details TO abig_app;

CREATE FUNCTION app_person_active_for(p_company uuid, p_person uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM person_payees p WHERE p.id = p_person AND p.company_id = p_company AND p.is_active) $$;

CREATE FUNCTION person_payee_create(p_company uuid, p_name text, p_phone text, p_id_enc text, p_id_last4 text, p_id_hash text, p_preferred payment_method) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF app_user_id() IS NULL OR NOT app_has_permission(p_company, 'payee:manage') THEN RAISE EXCEPTION 'you may not add people for this company' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_name, ''))) = 0 THEN RAISE EXCEPTION 'the name is required' USING ERRCODE = '23514'; END IF;
  IF p_id_enc IS NULL OR p_id_hash IS NULL OR p_id_last4 IS NULL THEN RAISE EXCEPTION 'the ID number is required' USING ERRCODE = '23514'; END IF;
  INSERT INTO person_payees (company_id, full_name, phone, id_number_enc, id_last4, id_hash, preferred_method, created_by)
  VALUES (p_company, btrim(p_name), normalize_et_phone(p_phone), p_id_enc, p_id_last4, p_id_hash, COALESCE(p_preferred, 'TRANSFER'), app_user_id()) RETURNING id INTO v_id;
  PERFORM treasury_audit(p_company, 'PERSON_PAYEE_ADDED', 'PERSON_PAYEE', v_id, jsonb_build_object('name', btrim(p_name), 'id_last4', p_id_last4));
  RETURN v_id;
END $$;

-- A new ID number is optional: leave the three ID arguments empty to keep the current one. Name, phone, ID and status are frozen while a
-- request for this person holds funds, as they are for suppliers.
CREATE FUNCTION person_payee_update(p_id uuid, p_name text, p_phone text, p_preferred payment_method, p_active boolean, p_id_enc text DEFAULT NULL, p_id_last4 text DEFAULT NULL, p_id_hash text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o person_payees; v_phone text := normalize_et_phone(p_phone); new_id boolean := p_id_enc IS NOT NULL;
BEGIN
  SELECT * INTO o FROM person_payees WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR o.company_id NOT IN (SELECT app_readable_companies()) THEN RAISE EXCEPTION 'person not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT app_has_permission(o.company_id, 'payee:manage') THEN RAISE EXCEPTION 'you may not change people for this company' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_name, ''))) = 0 THEN RAISE EXCEPTION 'the name is required' USING ERRCODE = '23514'; END IF;
  IF new_id AND (p_id_last4 IS NULL OR p_id_hash IS NULL) THEN RAISE EXCEPTION 'the ID number is incomplete' USING ERRCODE = '23514'; END IF;
  IF (btrim(p_name) <> o.full_name OR v_phone <> o.phone OR new_id OR NOT p_active)
     AND EXISTS (SELECT 1 FROM payment_requests r WHERE r.person_payee_id = p_id AND r.workflow_state IN ('RESERVED','VERIFIED')) THEN
    RAISE EXCEPTION 'this person has requests in progress; finish or cancel them before changing the name, phone, ID or status' USING ERRCODE = '42501';
  END IF;
  UPDATE person_payees SET full_name = btrim(p_name), phone = v_phone, preferred_method = COALESCE(p_preferred, preferred_method), is_active = p_active,
         id_number_enc = COALESCE(p_id_enc, id_number_enc), id_last4 = COALESCE(p_id_last4, id_last4), id_hash = COALESCE(p_id_hash, id_hash) WHERE id = p_id;
  PERFORM treasury_audit(o.company_id, 'PERSON_PAYEE_CHANGED', 'PERSON_PAYEE', p_id,
    jsonb_build_object('name', jsonb_build_array(o.full_name, btrim(p_name)), 'phone', jsonb_build_array(o.phone, v_phone), 'active', jsonb_build_array(o.is_active, p_active),
                       'id_last4', jsonb_build_array(o.id_last4, COALESCE(p_id_last4, o.id_last4))));
END $$;

CREATE FUNCTION person_detail_add(p_person uuid, p_kind text, p_bank text, p_last4 text, p_phone text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c uuid; v_id uuid;
BEGIN
  SELECT company_id INTO c FROM person_payees WHERE id = p_person;
  IF NOT FOUND OR c NOT IN (SELECT app_readable_companies()) THEN RAISE EXCEPTION 'person not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT app_has_permission(c, 'payee:manage') THEN RAISE EXCEPTION 'you may not change people for this company' USING ERRCODE = '42501'; END IF;
  IF p_kind = 'BANK' THEN
    IF btrim(coalesce(p_bank, '')) = '' OR coalesce(p_last4, '') !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'enter the bank and the last four digits of the account' USING ERRCODE = '23514'; END IF;
    INSERT INTO person_payment_details (person_id, version, kind, bank_name, account_last4, created_by) VALUES (p_person, 0, 'BANK', btrim(p_bank), p_last4, app_user_id()) RETURNING id INTO v_id;
  ELSIF p_kind = 'TELEBIRR' THEN
    INSERT INTO person_payment_details (person_id, version, kind, telebirr_phone, created_by) VALUES (p_person, 0, 'TELEBIRR', normalize_et_phone(p_phone), app_user_id()) RETURNING id INTO v_id;
  ELSE RAISE EXCEPTION 'choose bank or Telebirr' USING ERRCODE = '23514'; END IF;
  PERFORM treasury_audit(c, 'PERSON_DETAILS_ENTERED', 'PERSON_PAYEE', p_person, jsonb_build_object('detail', v_id, 'kind', p_kind));
  RETURN v_id;
END $$;

-- Verifying needs the verify permission in the person's company. The guard above refuses the person who entered the details.
CREATE FUNCTION person_detail_decide(p_detail uuid, p_verify boolean, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c uuid; p uuid;
BEGIN
  SELECT pp.company_id, pp.id INTO c, p FROM person_payment_details d JOIN person_payees pp ON pp.id = d.person_id WHERE d.id = p_detail FOR UPDATE OF d;
  IF NOT FOUND OR c NOT IN (SELECT app_readable_companies()) THEN RAISE EXCEPTION 'payment details not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT app_has_permission(c, 'payment_request:verify') THEN RAISE EXCEPTION 'only a Finance Manager of this company can verify payment details' USING ERRCODE = '42501'; END IF;
  UPDATE person_payment_details SET status = CASE WHEN p_verify THEN 'VERIFIED' ELSE 'REJECTED' END, rejection_reason = CASE WHEN p_verify THEN NULL ELSE p_reason END WHERE id = p_detail;
  PERFORM treasury_audit(c, CASE WHEN p_verify THEN 'PERSON_DETAILS_VERIFIED' ELSE 'PERSON_DETAILS_REJECTED' END, 'PERSON_PAYEE', p, jsonb_build_object('detail', p_detail, 'reason', p_reason));
END $$;

REVOKE EXECUTE ON FUNCTION normalize_et_phone(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION person_payee_create(uuid, text, text, text, text, text, payment_method), person_payee_update(uuid, text, text, payment_method, boolean, text, text, text),
  person_detail_add(uuid, text, text, text, text), person_detail_decide(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION person_payee_create(uuid, text, text, text, text, text, payment_method), person_payee_update(uuid, text, text, payment_method, boolean, text, text, text),
  person_detail_add(uuid, text, text, text, text), person_detail_decide(uuid, boolean, text) TO abig_app;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Requests pay a supplier or a person, never both
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TYPE payee_type AS ENUM ('SUPPLIER','PERSON');
ALTER TABLE payment_requests
  ADD COLUMN payee_type payee_type NOT NULL DEFAULT 'SUPPLIER',
  ADD COLUMN person_payee_id uuid,
  ADD COLUMN person_payment_detail_id uuid,
  ALTER COLUMN supplier_id DROP NOT NULL,
  ADD CONSTRAINT payment_requests_payee_chk CHECK (
       (payee_type = 'SUPPLIER' AND supplier_id IS NOT NULL AND person_payee_id IS NULL AND person_payment_detail_id IS NULL)
    OR (payee_type = 'PERSON' AND person_payee_id IS NOT NULL AND supplier_id IS NULL AND supplier_bank_detail_id IS NULL)),
  -- The person must belong to the company paying, and the details to that person.
  ADD CONSTRAINT payment_requests_person_company_fkey FOREIGN KEY (debtor_company_id, person_payee_id) REFERENCES person_payees (company_id, id),
  ADD CONSTRAINT payment_requests_person_detail_fkey FOREIGN KEY (person_payee_id, person_payment_detail_id) REFERENCES person_payment_details (person_id, id);
CREATE INDEX payment_requests_person_payee_idx ON payment_requests (person_payee_id) WHERE person_payee_id IS NOT NULL;
CREATE UNIQUE INDEX payment_requests_person_invoice_once ON payment_requests (person_payee_id, lower(invoice_ref))
  WHERE person_payee_id IS NOT NULL AND invoice_ref IS NOT NULL AND workflow_state NOT IN ('DRAFT','REJECTED','CANCELLED');

GRANT INSERT (payee_type, person_payee_id, person_payment_detail_id) ON payment_requests TO abig_app;
GRANT UPDATE (person_payment_detail_id) ON payment_requests TO abig_app;

DROP POLICY requests_insert ON payment_requests;
CREATE POLICY requests_insert ON payment_requests FOR INSERT TO abig_app
  WITH CHECK (debtor_company_id IN (SELECT app_permitted_companies('payment_request:create')) AND created_by = app_user_id() AND workflow_state = 'DRAFT'
              AND CASE payee_type WHEN 'SUPPLIER' THEN app_supplier_active_for(debtor_company_id, supplier_id) ELSE app_person_active_for(debtor_company_id, person_payee_id) END);

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. What a request needs before it can hold money
-- ---------------------------------------------------------------------------------------------------------------------
-- Which kind of account each method draws on. Held in one place, used by the guard on every path.
CREATE FUNCTION assert_method_fits_account(p_method payment_method, p_account uuid) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k account_kind;
BEGIN
  SELECT account_kind INTO k FROM company_bank_accounts WHERE id = p_account;
  IF p_method = 'CASH' AND k <> 'CASH' THEN RAISE EXCEPTION 'a cash payment must come from a cash account' USING ERRCODE = '23514'; END IF;
  IF p_method = 'TELEBIRR' AND k <> 'WALLET' THEN RAISE EXCEPTION 'a Telebirr payment must come from a Telebirr wallet' USING ERRCODE = '23514'; END IF;
  IF p_method IN ('TRANSFER','CHEQUE') AND k <> 'BANK' THEN RAISE EXCEPTION 'transfers and cheques must come from a bank account' USING ERRCODE = '23514'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION assert_method_fits_account(payment_method, uuid) FROM PUBLIC;

-- A draft may be saved half finished. From the moment it holds money the method must fit the account, whichever path it took.
CREATE OR REPLACE FUNCTION payment_request_account_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.debit_account_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.debit_account_id IS DISTINCT FROM OLD.debit_account_id) THEN
    IF NOT EXISTS (SELECT 1 FROM company_bank_accounts a WHERE a.id = NEW.debit_account_id AND a.is_active)
       OR NEW.debtor_company_id NOT IN (SELECT app_granted_companies(NEW.debit_account_id, 'USE')) THEN
      RAISE EXCEPTION 'the debit account is not available to this company' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.debit_account_id IS NOT NULL AND NEW.workflow_state IN ('RESERVED','VERIFIED','AUTHENTICATED')
     AND (TG_OP = 'INSERT' OR NEW.workflow_state <> OLD.workflow_state OR NEW.payment_method <> OLD.payment_method OR NEW.debit_account_id <> OLD.debit_account_id) THEN
    PERFORM assert_method_fits_account(NEW.payment_method, NEW.debit_account_id);
  END IF;
  RETURN NEW;
END $$;

-- Cash leaves the moment it is authenticated, so there is nothing for the bank to process later. The payment still stays Authenticated.
CREATE FUNCTION payment_request_cash_processed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.workflow_state = 'AUTHENTICATED' AND OLD.workflow_state <> 'AUTHENTICATED' AND NEW.payment_method = 'CASH' THEN
    NEW.bank_processed_at := clock_timestamp(); NEW.bank_processed_by := NEW.authenticated_by;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_requests_cash_processed BEFORE UPDATE ON payment_requests FOR EACH ROW EXECUTE FUNCTION payment_request_cash_processed();

CREATE OR REPLACE FUNCTION assert_submittable(p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; n int; s numeric; need text;
BEGIN
  SELECT * INTO r FROM payment_requests WHERE id = p_request;
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
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. The full ID number, for those allowed, on the request page only
-- ---------------------------------------------------------------------------------------------------------------------
-- Returns the encrypted value for the application to decrypt, and NULL for anyone who may not see it. Every view is logged.
CREATE FUNCTION reveal_person_id(p_request uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; enc text;
BEGIN
  IF app_user_id() IS NULL OR NOT app_can_see_request(p_request) THEN RETURN NULL; END IF;
  SELECT * INTO r FROM payment_requests WHERE id = p_request;
  IF r.person_payee_id IS NULL OR NOT app_has_permission(r.debtor_company_id, 'payee:view_identity') THEN RETURN NULL; END IF;
  SELECT id_number_enc INTO enc FROM person_payees WHERE id = r.person_payee_id;
  PERFORM treasury_audit(r.debtor_company_id, 'PERSON_ID_VIEWED', 'PERSON_PAYEE', r.person_payee_id, jsonb_build_object('request', p_request));
  RETURN enc;
END $$;
REVOKE EXECUTE ON FUNCTION reveal_person_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reveal_person_id(uuid) TO abig_app;
