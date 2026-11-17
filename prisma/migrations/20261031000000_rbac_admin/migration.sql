-- ABIG Finance - Access control and administration (step 5).
--
--   * A system administrator acts in every company with every permission: the member / permission helpers that all policies
--     and workflow functions go through now include "all companies" for administrators. Separation of duties is unchanged:
--     nobody approves their own request and one person cannot both verify and authenticate the same request.
--   * Roles can be configured, but some permissions are never grantable to a role: user:manage and company:manage belong to
--     administrators only, Accountants can never verify / authenticate / reject, Finance Managers can never authenticate.
--   * Companies can be edited (name, TIN, phone, active) by administrators.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Administrators act in every company
-- ---------------------------------------------------------------------------------------------------------------------
-- The permissions a person gets from their own memberships (what app_permitted_companies used to be).
CREATE FUNCTION app_member_permitted_companies(p_perm text) RETURNS SETOF uuid LANGUAGE sql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT DISTINCT m.company_id FROM company_memberships m JOIN users u ON u.id = m.user_id AND u.is_active
      JOIN membership_roles mr ON mr.membership_id = m.id JOIN roles r ON r.id = mr.role_id AND r.is_active
      JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id AND p.code = p_perm
      WHERE m.user_id = app_user_id() AND m.revoked_at IS NULL AND m.valid_from <= now() AND (m.valid_to IS NULL OR m.valid_to > now()) $$;

CREATE OR REPLACE FUNCTION app_permitted_companies(p_perm text) RETURNS SETOF uuid LANGUAGE sql STABLE ROWS 20 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT app_member_permitted_companies(p_perm)
      UNION SELECT c.id FROM companies c WHERE c.is_active AND app_is_admin() AND EXISTS (SELECT 1 FROM permissions WHERE code = p_perm) $$;

CREATE OR REPLACE FUNCTION app_member_companies(p_role text DEFAULT NULL) RETURNS SETOF uuid LANGUAGE sql STABLE ROWS 20 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT m.company_id FROM company_memberships m JOIN users u ON u.id = m.user_id AND u.is_active
      WHERE m.user_id = app_user_id() AND m.revoked_at IS NULL AND m.valid_from <= now() AND (m.valid_to IS NULL OR m.valid_to > now())
        AND (p_role IS NULL OR EXISTS (SELECT 1 FROM membership_roles mr JOIN roles r ON r.id = mr.role_id AND r.is_active
                                       WHERE mr.membership_id = m.id AND r.code = app_role_code(p_role)))
      UNION SELECT c.id FROM companies c WHERE app_is_admin() AND (p_role IS NULL OR c.is_active) $$;

-- Who acted is logged as ADMIN when the person had no role-based permission of their own in that company.
CREATE OR REPLACE FUNCTION wf_assert_actor(p_request uuid, p_stage text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; me uuid := app_user_id(); role_name text; perm text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT app_can_see_request(p_request) THEN RAISE EXCEPTION 'request not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO r FROM payment_requests WHERE id = p_request;
  perm := CASE p_stage WHEN 'VERIFICATION' THEN 'payment_request:verify' WHEN 'AUTHORIZATION' THEN 'payment_request:authenticate' ELSE 'payment_request:create' END;
  role_name := CASE p_stage WHEN 'VERIFICATION' THEN 'FINANCE_MANAGER' WHEN 'AUTHORIZATION' THEN 'OWNER' ELSE 'ACCOUNTANT' END;
  IF r.debtor_company_id NOT IN (SELECT app_permitted_companies(perm)) THEN
    RAISE EXCEPTION 'you do not have the % permission for this company', perm USING ERRCODE = '42501';
  END IF;
  IF r.debtor_company_id NOT IN (SELECT app_member_permitted_companies(perm)) THEN role_name := 'ADMIN'; END IF;
  IF p_stage = 'SUBMISSION' THEN
    IF r.created_by <> me THEN RAISE EXCEPTION 'only the creator can do this' USING ERRCODE = '42501'; END IF;
  ELSE
    IF r.created_by = me THEN RAISE EXCEPTION 'you created this request; the creator cannot verify or authenticate it' USING ERRCODE = '42501'; END IF;
    IF p_stage = 'VERIFICATION' AND me IN (SELECT wf_stage_actors(p_request, 'AUTHORIZATION')) THEN
      RAISE EXCEPTION 'you already acted at the authentication stage of this request' USING ERRCODE = '42501';
    END IF;
    IF p_stage = 'AUTHORIZATION' AND me IN (SELECT wf_stage_actors(p_request, 'VERIFICATION')) THEN
      RAISE EXCEPTION 'you already acted at the verification stage of this request' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN role_name;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Permissions that can never be given to a role
-- ---------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION role_permission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rc text; pc text;
BEGIN
  SELECT code INTO rc FROM roles WHERE id = NEW.role_id; SELECT code INTO pc FROM permissions WHERE id = NEW.permission_id;
  IF pc IN ('user:manage', 'company:manage') THEN
    RAISE EXCEPTION '% belongs to system administrators and cannot be given to a role', pc USING ERRCODE = '23514';
  END IF;
  IF rc = 'ACCOUNTANT' AND pc IN ('payment_request:verify', 'payment_request:authenticate', 'payment_request:reject', 'approval:view') THEN
    RAISE EXCEPTION 'Accountants cannot verify, authenticate or reject payments' USING ERRCODE = '23514';
  END IF;
  IF rc = 'FINANCE_MANAGER' AND pc = 'payment_request:authenticate' THEN
    RAISE EXCEPTION 'Finance Managers cannot authenticate payments' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER role_permissions_guard BEFORE INSERT ON role_permissions FOR EACH ROW EXECUTE FUNCTION role_permission_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Companies: list with TIN and phone, edit
-- ---------------------------------------------------------------------------------------------------------------------
DROP FUNCTION company_directory();
CREATE FUNCTION company_directory() RETURNS TABLE (id uuid, code text, legal_name text, is_active boolean, tin_number text, phone text)
LANGUAGE sql STABLE ROWS 20 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT c.id, c.code, c.legal_name, c.is_active, c.tin_number, c.phone FROM companies c WHERE app_user_id() IS NOT NULL ORDER BY c.legal_name $$;

CREATE FUNCTION admin_update_company(p_id uuid, p_name text, p_tin text, p_phone text, p_active boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o companies;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can edit companies' USING ERRCODE = '42501'; END IF;
  SELECT * INTO o FROM companies WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company not found' USING ERRCODE = 'P0002'; END IF;
  IF length(btrim(coalesce(p_name, ''))) = 0 THEN RAISE EXCEPTION 'the company name is required' USING ERRCODE = '23514'; END IF;
  IF length(btrim(coalesce(p_tin, ''))) = 0 THEN RAISE EXCEPTION 'the TIN number is required' USING ERRCODE = '23514'; END IF;
  IF length(btrim(coalesce(p_phone, ''))) = 0 THEN RAISE EXCEPTION 'the phone number is required' USING ERRCODE = '23514'; END IF;
  IF NOT p_active AND o.is_active AND EXISTS (SELECT 1 FROM payment_requests WHERE debtor_company_id = p_id AND workflow_state IN ('RESERVED','VERIFIED')) THEN
    RAISE EXCEPTION 'this company has payment requests waiting for approval; finish or cancel them before deactivating it' USING ERRCODE = '23514';
  END IF;
  UPDATE companies SET legal_name = btrim(p_name), tin_number = upper(btrim(p_tin)), phone = btrim(p_phone), is_active = p_active WHERE id = p_id;
  PERFORM treasury_audit(p_id, 'COMPANY_UPDATED', 'COMPANY', p_id,
    jsonb_build_object('name', jsonb_build_array(o.legal_name, btrim(p_name)), 'tin', jsonb_build_array(o.tin_number, upper(btrim(p_tin))),
                       'phone', jsonb_build_array(o.phone, btrim(p_phone)), 'active', jsonb_build_array(o.is_active, p_active)));
END $$;
REVOKE EXECUTE ON FUNCTION admin_update_company(uuid, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_update_company(uuid, text, text, text, boolean) TO abig_app;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. The Accountant's one-company limit cannot be configured away
-- ---------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION roles_accountant_limit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code = 'ACCOUNTANT' AND NEW.max_companies IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Accountants are restricted to exactly one company' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER roles_accountant_limit BEFORE INSERT OR UPDATE OF max_companies ON roles FOR EACH ROW EXECUTE FUNCTION roles_accountant_limit_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Supplier corrections: "in progress" now means the request holds reserved funds
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION supplier_update(p_id uuid, p_name text, p_tin text, p_active boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s suppliers;
BEGIN
  IF app_user_id() IS NULL OR NOT (app_has_role_anywhere('VERIFIER') OR app_has_role_anywhere('FINANCE_MANAGER')) THEN
    RAISE EXCEPTION 'only a verifier or finance manager can change a supplier' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM suppliers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'supplier not found' USING ERRCODE = 'P0002'; END IF;
  IF (btrim(p_name) <> s.legal_name OR upper(p_tin) <> s.tin OR NOT p_active)
     AND EXISTS (SELECT 1 FROM payment_requests r WHERE r.supplier_id = p_id AND r.workflow_state IN ('RESERVED','VERIFIED')) THEN
    RAISE EXCEPTION 'this supplier has requests in progress; finish or cancel them before changing its name, TIN or status' USING ERRCODE = '42501';
  END IF;
  UPDATE suppliers SET legal_name = btrim(p_name), tin = upper(p_tin), is_active = p_active WHERE id = p_id;
  PERFORM treasury_audit(NULL, 'SUPPLIER_CHANGED', 'SUPPLIER', p_id, jsonb_build_object('name', p_name, 'tin', upper(p_tin), 'active', p_active, 'was_name', s.legal_name, 'was_tin', s.tin));
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Background reminders on the new flow
-- ---------------------------------------------------------------------------------------------------------------------
-- Funds are reserved by the request itself and released the moment it is cancelled, returned, rejected or authenticated, so
-- there are no orphaned reservations to clean up any more (treasury_release_orphaned is no longer scheduled).
CREATE FUNCTION company_permission_users(p_company uuid, p_perm text) RETURNS SETOF uuid LANGUAGE sql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT DISTINCT m.user_id FROM company_memberships m JOIN users u ON u.id = m.user_id AND u.is_active
      JOIN membership_roles mr ON mr.membership_id = m.id JOIN roles r ON r.id = mr.role_id AND r.is_active
      JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id AND p.code = p_perm
      WHERE m.company_id = p_company AND m.revoked_at IS NULL AND m.valid_from <= now() AND (m.valid_to IS NULL OR m.valid_to > now()) $$;

-- One reminder a day for each request that is past its due date and still waiting for approval (its funds are held meanwhile).
CREATE FUNCTION enqueue_overdue_requests() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  INSERT INTO notification_outbox (event_type, request_id, payload)
  SELECT 'REQUEST_OVERDUE', r.id, jsonb_build_object('request_no', r.request_no, 'state', r.workflow_state::text, 'overdue_amount', sum(i.amount))
    FROM payment_requests r JOIN payment_installments i ON i.request_id = r.id
   WHERE r.workflow_state IN ('RESERVED','VERIFIED') AND i.due_date < current_date
     AND NOT EXISTS (SELECT 1 FROM notification_outbox o WHERE o.request_id = r.id AND o.event_type = 'REQUEST_OVERDUE' AND o.created_at > now() - interval '24 hours')
   GROUP BY r.id, r.request_no, r.workflow_state;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION enqueue_overdue_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_overdue_requests() TO abig_worker;

-- Overdue reminders go to whoever has to act next (Finance Managers while it waits for verification, Owners while it waits
-- for authentication) and to the creator.
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
    ids := ARRAY(SELECT x FROM company_permission_users(r.debtor_company_id,
                   CASE r.workflow_state WHEN 'RESERVED' THEN 'payment_request:verify' ELSE 'payment_request:authenticate' END) x WHERE x <> r.created_by) || r.created_by;
  ELSIF e.event_type IN ('REQUEST_AUTHORIZED','REQUEST_RESCHEDULE_NEEDED') THEN
    ids := ARRAY(SELECT x FROM company_role_users(r.debtor_company_id, 'TREASURY') x) || r.created_by;
  ELSE
    ids := ARRAY[r.created_by];
  END IF;
  RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
END $$;
