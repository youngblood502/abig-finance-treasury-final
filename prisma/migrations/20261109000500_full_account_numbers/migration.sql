-- ABIG Finance - Full bank account numbers, encrypted, revealed one at a time to the people who may see them.
--
-- Before this migration only the last four digits were kept. company_bank_accounts.account_number_enc and supplier_bank_details.account_number_enc
-- existed as bytea but were never filled, and the application role could read company_bank_accounts.account_number_enc through its table-wide grant.
--
-- What changes:
--   1. Storage. The full number is encrypted by the application (encryptSecret: AES-256-GCM, stored as "v1:<base64>" text) before it reaches the
--      database. The two bytea columns become text to hold that, and person_payment_details gets the same column. The last four digits stay in their
--      own column for lists. Existing rows keep their last four digits and no full number: nothing is invented for them.
--   2. Access. The application role can no longer read any account_number_enc column, or write one directly. The only way to a full number is one of
--      three reveal functions, each of which checks who is asking, writes an audit event when it hands one out, and returns NULL otherwise:
--        reveal_account_number(account)    FULL access to the account (app_account_access). TICK, NONE and group reporting get NULL.
--        reveal_supplier_account(detail)   a member (not a group reporter) of a company linked to the supplier, holding payment_request:verify,
--                                          payment_request:authenticate or supplier:manage there.
--        reveal_person_account(detail)     payee:view_identity in the person's company, as a member.
--      account_number_state, supplier_account_state and person_account_state tell a page, without revealing anything, whether to offer the reveal:
--      MASKED (not for this person), NOT_RECORDED (allowed, but only the last four digits exist) or RECORDED.
--   3. Entry. register_bank_account takes the encrypted number as text, person_detail_add takes it as an optional last argument, and supplier bank
--      details are entered through supplier_bank_detail_add instead of a direct insert. Changing a supplier's or a person's number is still a new
--      version that someone else must verify (the existing guards are not touched).
-- No RBAC rule, workflow or stored financial record changes.

-- ---------- 1. Storage ----------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM company_bank_accounts WHERE account_number_enc IS NOT NULL) OR EXISTS (SELECT 1 FROM supplier_bank_details WHERE account_number_enc IS NOT NULL) THEN
    RAISE EXCEPTION 'account_number_enc already holds data in an unknown format; it must be reviewed before this migration runs';
  END IF;
END $$;
ALTER TABLE company_bank_accounts ALTER COLUMN account_number_enc TYPE text USING NULL;
ALTER TABLE supplier_bank_details ALTER COLUMN account_number_enc TYPE text USING NULL;
ALTER TABLE person_payment_details ADD COLUMN account_number_enc text;

ALTER TABLE company_bank_accounts ADD CONSTRAINT company_bank_accounts_number_enc_chk
  CHECK (account_number_enc IS NULL OR (account_kind = 'BANK' AND account_number_enc LIKE 'v1:%'));
ALTER TABLE supplier_bank_details ADD CONSTRAINT supplier_bank_details_number_enc_chk
  CHECK (account_number_enc IS NULL OR account_number_enc LIKE 'v1:%');
ALTER TABLE person_payment_details ADD CONSTRAINT person_payment_details_number_enc_chk
  CHECK (account_number_enc IS NULL OR (kind = 'BANK' AND account_number_enc LIKE 'v1:%'));

-- ---------- 2. Column grants: every column except the encrypted number ----------
REVOKE SELECT ON company_bank_accounts FROM abig_app;
GRANT SELECT (id, account_label, account_last4, currency, is_active, min_buffer, created_at, bank_id, current_balance, reserved_balance, balance_updated_at,
              available_balance, shortfall_amount, account_kind, wallet_phone, large_deposit_threshold) ON company_bank_accounts TO abig_app;

REVOKE SELECT ON person_payment_details FROM abig_app;
GRANT SELECT (id, person_id, version, kind, bank_name, account_last4, telebirr_phone, status, created_by, created_at, verified_by, verified_at, rejection_reason)
  ON person_payment_details TO abig_app;

-- supplier_bank_details was already read column by column without the number; it could still be written directly.
REVOKE INSERT (account_number_enc) ON supplier_bank_details FROM abig_app;

-- ---------- 3. Who may see a full number ----------
-- Each answers for the signed-in person only, and is false (or NULL) for anyone signed out, any group reporter and any other company.
CREATE FUNCTION app_can_reveal_account(p_account uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT app_user_id() IS NOT NULL AND COALESCE(app_account_access(p_account) = 'FULL', false) $$;

-- The company the reveal is made through: the first linked company where the person is a member with the authority. NULL when there is none.
CREATE FUNCTION app_supplier_reveal_company(p_detail uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT cs.company_id FROM supplier_bank_details d JOIN company_suppliers cs ON cs.supplier_id = d.supplier_id
       WHERE d.id = p_detail AND app_user_id() IS NOT NULL AND cs.company_id IN (SELECT app_member_companies())
         AND (app_has_permission(cs.company_id, 'payment_request:verify') OR app_has_permission(cs.company_id, 'payment_request:authenticate')
              OR app_has_permission(cs.company_id, 'supplier:manage'))
       ORDER BY cs.created_at, cs.company_id LIMIT 1 $$;

CREATE FUNCTION app_person_reveal_company(p_detail uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT pp.company_id FROM person_payment_details d JOIN person_payees pp ON pp.id = d.person_id
       WHERE d.id = p_detail AND app_user_id() IS NOT NULL AND pp.company_id IN (SELECT app_member_companies())
         AND app_has_permission(pp.company_id, 'payee:view_identity') $$;

-- ---------- 4. Whether to offer the reveal (no number, no audit) ----------
CREATE FUNCTION account_number_state(p_account uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT CASE WHEN a.account_kind <> 'BANK' OR NOT app_can_reveal_account(a.id) THEN 'MASKED'
                  WHEN a.account_number_enc IS NULL THEN 'NOT_RECORDED' ELSE 'RECORDED' END
       FROM company_bank_accounts a WHERE a.id = p_account $$;

CREATE FUNCTION supplier_account_state(p_detail uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT CASE WHEN app_supplier_reveal_company(d.id) IS NULL THEN 'MASKED'
                  WHEN d.account_number_enc IS NULL THEN 'NOT_RECORDED' ELSE 'RECORDED' END
       FROM supplier_bank_details d WHERE d.id = p_detail $$;

CREATE FUNCTION person_account_state(p_detail uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT CASE WHEN d.kind <> 'BANK' OR app_person_reveal_company(d.id) IS NULL THEN 'MASKED'
                  WHEN d.account_number_enc IS NULL THEN 'NOT_RECORDED' ELSE 'RECORDED' END
       FROM person_payment_details d WHERE d.id = p_detail $$;

-- ---------- 5. Reveal: the encrypted number to the people allowed, audited; NULL to everyone else ----------
CREATE FUNCTION reveal_account_number(p_account uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE enc text;
BEGIN
  IF NOT app_can_reveal_account(p_account) THEN RETURN NULL; END IF;
  SELECT account_number_enc INTO enc FROM company_bank_accounts WHERE id = p_account AND account_kind = 'BANK';
  IF enc IS NULL THEN RETURN NULL; END IF;
  PERFORM treasury_audit(account_owner_company(p_account), 'ACCOUNT_NUMBER_VIEWED', 'BANK_ACCOUNT', p_account, '{}'::jsonb);
  RETURN enc;
END $$;

CREATE FUNCTION reveal_supplier_account(p_detail uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c uuid; d supplier_bank_details;
BEGIN
  c := app_supplier_reveal_company(p_detail);
  IF c IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO d FROM supplier_bank_details WHERE id = p_detail;
  IF d.account_number_enc IS NULL THEN RETURN NULL; END IF;
  PERFORM treasury_audit(c, 'SUPPLIER_ACCOUNT_NUMBER_VIEWED', 'SUPPLIER', d.supplier_id, jsonb_build_object('detail', d.id, 'version', d.version));
  RETURN d.account_number_enc;
END $$;

CREATE FUNCTION reveal_person_account(p_detail uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c uuid; d person_payment_details;
BEGIN
  c := app_person_reveal_company(p_detail);
  IF c IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO d FROM person_payment_details WHERE id = p_detail AND kind = 'BANK';
  IF d.account_number_enc IS NULL THEN RETURN NULL; END IF;
  PERFORM treasury_audit(c, 'PERSON_ACCOUNT_NUMBER_VIEWED', 'PERSON_PAYEE', d.person_id, jsonb_build_object('detail', d.id, 'version', d.version));
  RETURN d.account_number_enc;
END $$;

-- ---------- 6. Entry ----------
-- Same checks as before; the encrypted number is now text. It stays optional here so that an account can still be registered with its last four digits.
DROP FUNCTION register_bank_account(uuid, text, text, text, bytea, numeric);
CREATE FUNCTION register_bank_account(p_owner uuid, p_bank text, p_label text, p_last4 text, p_enc text, p_buffer numeric) RETURNS uuid
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
  PERFORM treasury_audit(p_owner, 'BANK_ACCOUNT_REGISTERED', 'BANK_ACCOUNT', v_id, jsonb_build_object('bank', p_bank, 'label', p_label, 'full_number', p_enc IS NOT NULL));
  RETURN v_id;
END $$;

DROP FUNCTION person_detail_add(uuid, text, text, text, text);
CREATE FUNCTION person_detail_add(p_person uuid, p_kind text, p_bank text, p_last4 text, p_phone text, p_enc text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c uuid; v_id uuid;
BEGIN
  SELECT company_id INTO c FROM person_payees WHERE id = p_person;
  IF NOT FOUND OR c NOT IN (SELECT app_readable_companies()) THEN RAISE EXCEPTION 'person not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT app_has_permission(c, 'payee:manage') THEN RAISE EXCEPTION 'you may not change people for this company' USING ERRCODE = '42501'; END IF;
  IF p_kind = 'BANK' THEN
    IF btrim(coalesce(p_bank, '')) = '' OR coalesce(p_last4, '') !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'enter the bank and the last four digits of the account' USING ERRCODE = '23514'; END IF;
    INSERT INTO person_payment_details (person_id, version, kind, bank_name, account_last4, account_number_enc, created_by)
    VALUES (p_person, 0, 'BANK', btrim(p_bank), p_last4, p_enc, app_user_id()) RETURNING id INTO v_id;
  ELSIF p_kind = 'TELEBIRR' THEN
    INSERT INTO person_payment_details (person_id, version, kind, telebirr_phone, created_by) VALUES (p_person, 0, 'TELEBIRR', normalize_et_phone(p_phone), app_user_id()) RETURNING id INTO v_id;
  ELSE RAISE EXCEPTION 'choose bank or Telebirr' USING ERRCODE = '23514'; END IF;
  PERFORM treasury_audit(c, 'PERSON_DETAILS_ENTERED', 'PERSON_PAYEE', p_person, jsonb_build_object('detail', v_id, 'kind', p_kind));
  RETURN v_id;
END $$;

-- The direct insert's rule (bank_insert policy: an Inputter anywhere, entering as themselves), now in one place that can also store the number.
-- The guard trigger still numbers the version and makes it PENDING, so it must be verified by someone else before use.
CREATE FUNCTION supplier_bank_detail_add(p_supplier uuid, p_bank text, p_last4 text, p_enc text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF app_user_id() IS NULL OR NOT app_has_role_anywhere('INPUTTER') THEN RAISE EXCEPTION 'you may not enter bank details' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_supplier) THEN RAISE EXCEPTION 'supplier not found' USING ERRCODE = 'P0002'; END IF;
  IF btrim(coalesce(p_bank, '')) = '' OR coalesce(p_last4, '') !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'enter the bank and the last four digits of the account' USING ERRCODE = '23514'; END IF;
  INSERT INTO supplier_bank_details (supplier_id, bank_name, account_last4, account_number_enc, created_by)
  VALUES (p_supplier, btrim(p_bank), p_last4, p_enc, app_user_id()) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---------- 7. Execute grants ----------
REVOKE EXECUTE ON FUNCTION app_can_reveal_account(uuid), app_supplier_reveal_company(uuid), app_person_reveal_company(uuid),
  account_number_state(uuid), supplier_account_state(uuid), person_account_state(uuid),
  reveal_account_number(uuid), reveal_supplier_account(uuid), reveal_person_account(uuid),
  register_bank_account(uuid, text, text, text, text, numeric), person_detail_add(uuid, text, text, text, text, text), supplier_bank_detail_add(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_number_state(uuid), supplier_account_state(uuid), person_account_state(uuid),
  reveal_account_number(uuid), reveal_supplier_account(uuid), reveal_person_account(uuid),
  register_bank_account(uuid, text, text, text, text, numeric), person_detail_add(uuid, text, text, text, text, text), supplier_bank_detail_add(uuid, text, text, text) TO abig_app;
