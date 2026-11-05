-- ABIG Finance - production readiness: sign-in storage, reports, administration, supplier edits.

-- ---------- Sign-in ----------
-- A separate role handles credentials, so the app role can never read password hashes or MFA secrets.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'abig_auth') THEN CREATE ROLE abig_auth NOLOGIN NOBYPASSRLS; END IF;
END $$;
ALTER ROLE abig_auth SET jit = off;

ALTER TABLE users
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN totp_secret_enc text,                 -- encrypted by the application (AES-256-GCM)
  ADD COLUMN totp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN totp_last_step bigint,                -- a code can be used once
  ADD COLUMN failed_logins int NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN password_changed_at timestamptz;

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,                     -- SHA-256 of the cookie value; the cookie itself is never stored
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ip text,
  user_agent text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE auth_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  user_id uuid REFERENCES users(id),
  email text,
  event text NOT NULL CHECK (event IN ('LOGIN_OK','LOGIN_FAILED','LOGIN_LOCKED','MFA_FAILED','LOGOUT','PASSWORD_CHANGED','PASSWORD_RESET','MFA_ENABLED','MFA_DISABLED','SESSIONS_REVOKED')),
  ip text,
  detail text
);
CREATE INDEX auth_events_time_idx ON auth_events (occurred_at DESC);
CREATE TRIGGER auth_events_append_only BEFORE UPDATE OR DELETE ON auth_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER auth_events_no_truncate BEFORE TRUNCATE ON auth_events FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_auth_all ON users FOR ALL TO abig_auth USING (true) WITH CHECK (true);
CREATE POLICY sessions_auth_all ON sessions FOR ALL TO abig_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_events_auth_all ON auth_events FOR ALL TO abig_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_events_admin_read ON auth_events FOR SELECT TO abig_app USING (app_is_admin());

GRANT USAGE ON SCHEMA public TO abig_auth;
GRANT SELECT (id, email, full_name, password_hash, is_system_admin, is_active, must_change_password, totp_secret_enc, totp_enabled, totp_last_step, failed_logins, locked_until)
  ON users TO abig_auth;
GRANT UPDATE (password_hash, must_change_password, totp_secret_enc, totp_enabled, totp_last_step, failed_logins, locked_until, password_changed_at) ON users TO abig_auth;
GRANT SELECT, INSERT, DELETE ON sessions TO abig_auth;
GRANT UPDATE (last_seen_at) ON sessions TO abig_auth;
GRANT SELECT, INSERT ON auth_events TO abig_auth;
GRANT SELECT ON auth_events TO abig_app;
-- The app role may read these flags about itself and others it can already see (never the secrets).
GRANT SELECT (must_change_password, totp_enabled, locked_until) ON users TO abig_app;

-- ---------- Directory and administration ----------
CREATE FUNCTION company_directory() RETURNS TABLE (id uuid, code text, legal_name text, is_active boolean) LANGUAGE sql STABLE ROWS 20 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT c.id, c.code, c.legal_name, c.is_active FROM companies c WHERE app_user_id() IS NOT NULL ORDER BY c.legal_name $$;

CREATE FUNCTION admin_create_company(p_code text, p_name text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can add companies' USING ERRCODE = '42501'; END IF;
  IF p_code !~ '^[A-Z0-9_]{2,20}$' THEN RAISE EXCEPTION 'the company code must be 2 to 20 capital letters, digits or underscores' USING ERRCODE = '23514'; END IF;
  INSERT INTO companies (code, legal_name) VALUES (p_code, btrim(p_name)) RETURNING companies.id INTO v_id;
  PERFORM treasury_audit(v_id, 'COMPANY_CREATED', 'COMPANY', v_id, jsonb_build_object('code', p_code, 'name', p_name));
  RETURN v_id;
END $$;

CREATE FUNCTION set_treasury_settings(p_warn int, p_block int, p_split boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can change treasury settings' USING ERRCODE = '42501'; END IF;
  IF p_warn < 1 OR p_block < p_warn OR p_block > 720 THEN RAISE EXCEPTION 'the block limit must be at least the warning limit (1 to 720 hours)' USING ERRCODE = '23514'; END IF;
  UPDATE treasury_settings SET stale_warn_hours = p_warn, stale_block_hours = p_block, allow_split_funding = p_split;
  PERFORM treasury_audit(NULL, 'TREASURY_SETTINGS_CHANGED', 'SETTINGS', NULL, jsonb_build_object('warn_hours', p_warn, 'block_hours', p_block, 'split_funding', p_split));
END $$;

-- Supplier identity can change only while nothing is in flight for it (blueprint: payee identity is a control).
CREATE FUNCTION supplier_update(p_id uuid, p_name text, p_tin text, p_active boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s suppliers;
BEGIN
  IF app_user_id() IS NULL OR NOT (app_has_role_anywhere('VERIFIER') OR app_has_role_anywhere('FINANCE_MANAGER')) THEN
    RAISE EXCEPTION 'only a verifier or finance manager can change a supplier' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM suppliers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'supplier not found' USING ERRCODE = 'P0002'; END IF;
  IF (btrim(p_name) <> s.legal_name OR upper(p_tin) <> s.tin OR NOT p_active) AND EXISTS (
       SELECT 1 FROM payment_requests r WHERE r.supplier_id = p_id AND r.workflow_state IN ('SUBMITTED','VERIFIED','AUTHORIZED')
         AND EXISTS (SELECT 1 FROM payment_installments i WHERE i.request_id = r.id AND installment_outstanding(i.id) > 0)) THEN
    RAISE EXCEPTION 'this supplier has requests in progress; finish or cancel them before changing its name, TIN or status' USING ERRCODE = '42501';
  END IF;
  UPDATE suppliers SET legal_name = btrim(p_name), tin = upper(p_tin), is_active = p_active WHERE id = p_id;
  PERFORM treasury_audit(NULL, 'SUPPLIER_CHANGED', 'SUPPLIER', p_id, jsonb_build_object('name', p_name, 'tin', upper(p_tin), 'active', p_active, 'was_name', s.legal_name, 'was_tin', s.tin));
END $$;

-- ---------- Reports (respect the same visibility rules as everything else) ----------
CREATE FUNCTION report_outstanding() RETURNS TABLE (
  request_id uuid, request_no text, company_id uuid, company_name text, supplier_name text, workflow_state text, priority text,
  seq int, due_date date, amount numeric, outstanding numeric, reserved numeric, days_overdue int, bucket text)
LANGUAGE sql STABLE ROWS 200 SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id, r.request_no, r.debtor_company_id, c.legal_name, s.legal_name, r.workflow_state, r.priority, i.seq, i.due_date, i.amount,
         installment_outstanding(i.id),
         COALESCE((SELECT sum(x.amount - x.consumed_amount) FROM cash_reservations x WHERE x.installment_id = i.id AND x.status = 'ACTIVE'), 0),
         GREATEST(current_date - i.due_date, 0),
         CASE WHEN i.due_date >= current_date THEN 'Not yet due' WHEN current_date - i.due_date <= 30 THEN '1-30 days overdue'
              WHEN current_date - i.due_date <= 60 THEN '31-60 days overdue' ELSE 'Over 60 days overdue' END
  FROM payment_installments i JOIN payment_requests r ON r.id = i.request_id JOIN companies c ON c.id = r.debtor_company_id JOIN suppliers s ON s.id = r.supplier_id
  WHERE app_can_see_request(r.id) AND r.workflow_state IN ('SUBMITTED','VERIFIED','AUTHORIZED') AND installment_outstanding(i.id) > 0
  ORDER BY i.due_date, r.request_no, i.seq $$;

CREATE FUNCTION report_payments(p_from date, p_to date) RETURNS TABLE (
  payment_id uuid, paid_at timestamptz, amount numeric, reference text, account_label text, account_owner text, request_no text, company_name text, supplier_name text, reversed boolean)
LANGUAGE sql STABLE ROWS 200 SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.paid_at, p.amount, p.reference, a.account_label, o.legal_name,
         CASE WHEN app_can_see_request(r.id) THEN r.request_no END, CASE WHEN app_can_see_request(r.id) THEN c.legal_name END, CASE WHEN app_can_see_request(r.id) THEN s.legal_name END,
         EXISTS (SELECT 1 FROM payment_reversals x WHERE x.payment_id = p.id)
  FROM payment_transactions p JOIN company_bank_accounts a ON a.id = p.account_id JOIN companies o ON o.id = a.owner_company_id
  JOIN payment_installments i ON i.id = p.installment_id JOIN payment_requests r ON r.id = i.request_id JOIN companies c ON c.id = r.debtor_company_id JOIN suppliers s ON s.id = r.supplier_id
  WHERE app_can_see_account(p.account_id) AND app_can_see_funding(p.installment_id, p.account_id)
    AND p.paid_at >= p_from AND p.paid_at < (p_to + 1)
  ORDER BY p.paid_at DESC, p.id $$;

-- ---------- Housekeeping for the worker ----------
CREATE FUNCTION purge_expired_sessions() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  DELETE FROM sessions WHERE expires_at < now() OR last_seen_at < now() - interval '1 day';
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION purge_expired_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_expired_sessions() TO abig_worker;
