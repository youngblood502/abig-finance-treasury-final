-- ABIG Finance - Corporate treasury refactor (step 1 of 3: data model).
-- Mirrors prisma/schema.prisma after the treasury refactor.
--
--   1. companies:          name, TIN and phone are mandatory
--   2. banks + accounts:   a bank account can belong to many companies (junction company_bank_account_access, owner = is_owner row)
--   3. company_bank_accounts: current_balance, reserved_balance, available_balance (generated)
--   4. payment_requests:   status enum (DRAFT, SCHEDULED, RESERVED, VERIFIED, AUTHENTICATED, REJECTED), debit account,
--                          verifier / authenticator foreign keys
--   5. RBAC:               roles, permissions, role_permissions, membership_roles (Accountant limited to 1 company)
--
-- !! DO NOT APPLY TO A LIVE DATABASE ON ITS OWN. The workflow, treasury and scheduler SQL functions from migrations
-- !! 20261014..20261020 still use the old states (SUBMITTED, AUTHORIZED, RETURNED, CANCELLED), owner_company_id and
-- !! bank_name; they are rewritten in the next steps. Until then they fail when called.
--
-- Runs in one transaction (ops/migrate.mjs). Any problem with existing data aborts the whole migration.

-- =====================================================================================================================
-- 1. Companies: name, TIN number, phone are mandatory
-- =====================================================================================================================
ALTER TABLE companies ADD COLUMN tin_number text, ADD COLUMN phone text;

-- Existing companies have neither. Give them RANDOM PLACEHOLDERS (10-digit TIN, +2519xxxxxxxx phone).
-- Replace them with the real values; they carry no meaning.
DO $$
DECLARE c record; t text; n int := 0;
BEGIN
  FOR c IN SELECT id FROM companies WHERE tin_number IS NULL OR phone IS NULL ORDER BY created_at, id LOOP
    LOOP
      t := (1000000000 + floor(random() * 9000000000))::bigint::text;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM companies WHERE tin_number = t);
    END LOOP;
    UPDATE companies SET tin_number = COALESCE(tin_number, t),
                         phone = COALESCE(phone, '+2519' || lpad(floor(random() * 100000000)::bigint::text, 8, '0'))
     WHERE id = c.id;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'companies: % existing compan(ies) received placeholder TIN and phone values', n;
END $$;

ALTER TABLE companies
  ALTER COLUMN tin_number SET NOT NULL,
  ALTER COLUMN phone SET NOT NULL,
  ADD CONSTRAINT companies_tin_number_key UNIQUE (tin_number),
  ADD CONSTRAINT companies_name_chk  CHECK (btrim(legal_name) <> ''),
  ADD CONSTRAINT companies_tin_chk   CHECK (tin_number ~ '^[0-9A-Za-z-]{6,20}$'),  -- same rule as suppliers.tin; Finance to confirm
  ADD CONSTRAINT companies_phone_chk CHECK (phone ~ '^\+?[0-9 ()-]{7,20}$');

DROP FUNCTION admin_create_company(text, text);
CREATE FUNCTION admin_create_company(p_code text, p_name text, p_tin text, p_phone text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can add companies' USING ERRCODE = '42501'; END IF;
  IF p_code !~ '^[A-Z0-9_]{2,20}$' THEN RAISE EXCEPTION 'the company code must be 2 to 20 capital letters, digits or underscores' USING ERRCODE = '23514'; END IF;
  IF length(btrim(coalesce(p_name, ''))) = 0 THEN RAISE EXCEPTION 'the company name is required' USING ERRCODE = '23514'; END IF;
  IF length(btrim(coalesce(p_tin, ''))) = 0 THEN RAISE EXCEPTION 'the TIN number is required' USING ERRCODE = '23514'; END IF;
  IF length(btrim(coalesce(p_phone, ''))) = 0 THEN RAISE EXCEPTION 'the phone number is required' USING ERRCODE = '23514'; END IF;
  INSERT INTO companies (code, legal_name, tin_number, phone) VALUES (p_code, btrim(p_name), upper(btrim(p_tin)), btrim(p_phone)) RETURNING companies.id INTO v_id;
  PERFORM treasury_audit(v_id, 'COMPANY_CREATED', 'COMPANY', v_id, jsonb_build_object('code', p_code, 'name', p_name, 'tin', upper(btrim(p_tin))));
  RETURN v_id;
END $$;

-- =====================================================================================================================
-- 2. RBAC: roles, permissions, role_permissions, membership_roles
-- =====================================================================================================================
-- Admin is not a role row: it stays users.is_system_admin (global, not tied to a company).
CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  description text,
  max_companies int CHECK (max_companies IS NULL OR max_companies >= 1),  -- NULL = unlimited
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  resource text NOT NULL,
  action text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permissions_resource_action_key UNIQUE (resource, action),
  CHECK (code = resource || ':' || action)
);
CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id),
  permission_id uuid NOT NULL REFERENCES permissions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX role_permissions_permission_id_idx ON role_permissions (permission_id);
CREATE TABLE membership_roles (
  membership_id uuid NOT NULL REFERENCES company_memberships(id),
  role_id uuid NOT NULL REFERENCES roles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, role_id)
);
CREATE INDEX membership_roles_role_id_idx ON membership_roles (role_id);

INSERT INTO roles (code, name, description, max_companies, is_system) VALUES
  ('ACCOUNTANT',      'Accountant',      'Updates bank balances, manages vendors, recurring payments and entries, creates payment requests. One company only.', 1, true),
  ('FINANCE_MANAGER', 'Finance Manager', 'Reviews and verifies payment requests. Number of companies is set on the role (unlimited by default).', NULL, true),
  ('OWNER',           'Owner',           'Reviews verified requests and authenticates payments. Can view every module; cannot administer users.', NULL, true);

INSERT INTO permissions (code, resource, action, description) VALUES
  ('dashboard:view',            'dashboard',         'view',         'See the dashboard and consolidated balances'),
  ('bank_account:view',         'bank_account',      'view',         'See banks and bank accounts'),
  ('bank_account:manage',       'bank_account',      'manage',       'Create, update and delete banks and bank accounts; share an account with other companies'),
  ('bank_balance:update',       'bank_balance',      'update',       'Enter the latest actual bank balance'),
  ('transaction:manage',        'transaction',       'manage',       'Manage transaction entries'),
  ('payment_request:view',      'payment_request',   'view',         'See payment requests'),
  ('payment_request:create',    'payment_request',   'create',       'Create payment requests'),
  ('payment_request:update',    'payment_request',   'update',       'Edit draft payment requests'),
  ('payment_request:delete',    'payment_request',   'delete',       'Delete draft payment requests'),
  ('payment_request:schedule',  'payment_request',   'schedule',     'Schedule a request into the verification queue'),
  ('payment_request:verify',    'payment_request',   'verify',       'Verify a payment request'),
  ('payment_request:authenticate','payment_request', 'authenticate', 'Authenticate a verified payment request (final approval)'),
  ('payment_request:reject',    'payment_request',   'reject',       'Reject a payment request'),
  ('approval:view',             'approval',          'view',         'See the approvals queue'),
  ('recurring_payment:view',    'recurring_payment', 'view',         'See recurring payment templates'),
  ('recurring_payment:manage',  'recurring_payment', 'manage',       'Create, update and delete recurring payment templates'),
  ('supplier:view',             'supplier',          'view',         'See vendors'),
  ('supplier:manage',           'supplier',          'manage',       'Create, update and delete vendors and their bank details'),
  ('company:view',              'company',           'view',         'See company profiles'),
  ('company:manage',            'company',           'manage',       'Create, update and delete companies'),
  ('report:view',               'report',            'view',         'See reports'),
  ('user:manage',               'user',              'manage',       'Create users, roles and permissions');

-- Accountant: scoped to one company, works on balances / vendors / recurring / requests. No verify, authenticate or user admin.
-- Finance Manager: reviews and verifies. No authenticate, no user admin.
-- Owner: sees every module, authenticates or rejects, manages accounts. Does not enter balances, create requests or administer users.
-- company:manage and user:manage are not given to any role: they belong to the system administrator.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON
     (r.code = 'ACCOUNTANT' AND p.code IN ('dashboard:view','bank_account:view','bank_balance:update','transaction:manage',
        'payment_request:view','payment_request:create','payment_request:update','payment_request:delete','payment_request:schedule',
        'recurring_payment:view','recurring_payment:manage','supplier:view','supplier:manage','report:view'))
  OR (r.code = 'FINANCE_MANAGER' AND p.code IN ('dashboard:view','bank_account:view','payment_request:view','payment_request:verify',
        'payment_request:reject','approval:view','recurring_payment:view','supplier:view','supplier:manage','company:view','report:view'))
  OR (r.code = 'OWNER' AND (p.action = 'view' OR p.code IN ('payment_request:authenticate','payment_request:reject','bank_account:manage')));

-- Old roles -> new roles. INPUTTER and TREASURY -> ACCOUNTANT; VERIFIER and FINANCE_MANAGER -> FINANCE_MANAGER;
-- AUTHENTICATOR and ACCOUNT_OWNER -> OWNER. Kept as a function so old SQL that still asks for the old names keeps resolving
-- until it is rewritten (TRANSITIONAL: remove it with the last caller).
CREATE FUNCTION app_role_code(p text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT CASE upper(p) WHEN 'INPUTTER' THEN 'ACCOUNTANT' WHEN 'TREASURY' THEN 'ACCOUNTANT'
                           WHEN 'VERIFIER' THEN 'FINANCE_MANAGER' WHEN 'AUTHENTICATOR' THEN 'OWNER' WHEN 'ACCOUNT_OWNER' THEN 'OWNER'
                           ELSE upper(p) END $$;

-- Enforces Role.max_companies: a user may hold the role in at most that many companies (revoked memberships do not count).
CREATE FUNCTION assert_role_company_limit(p_membership uuid, p_role uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m company_memberships; r roles; n int; who text;
BEGIN
  SELECT * INTO r FROM roles WHERE id = p_role;
  IF r.max_companies IS NULL THEN RETURN; END IF;
  SELECT * INTO m FROM company_memberships WHERE id = p_membership;
  IF m.revoked_at IS NOT NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('role-limit:' || m.user_id::text, 0));  -- two concurrent grants cannot both pass
  SELECT count(DISTINCT cm.company_id) INTO n FROM membership_roles mr JOIN company_memberships cm ON cm.id = mr.membership_id
   WHERE mr.role_id = p_role AND cm.user_id = m.user_id AND cm.revoked_at IS NULL AND cm.company_id <> m.company_id;
  IF n + 1 > r.max_companies THEN
    SELECT email INTO who FROM users WHERE id = m.user_id;
    RAISE EXCEPTION 'role % is limited to % company(ies); % already holds it in % other compan(ies)', r.code, r.max_companies, who, n USING ERRCODE = '23514';
  END IF;
END $$;

CREATE FUNCTION membership_roles_limit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM assert_role_company_limit(NEW.membership_id, NEW.role_id); RETURN NEW; END $$;
CREATE TRIGGER membership_roles_limit BEFORE INSERT OR UPDATE ON membership_roles FOR EACH ROW EXECUTE FUNCTION membership_roles_limit_guard();

-- A revoked membership cannot be quietly brought back past the limit.
CREATE FUNCTION memberships_reactivate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x uuid;
BEGIN
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
    FOR x IN SELECT role_id FROM membership_roles WHERE membership_id = NEW.id LOOP PERFORM assert_role_company_limit(NEW.id, x); END LOOP;
  END IF;
  RETURN NEW;
END $$;
-- (assert_role_company_limit reads the membership row, so this must run AFTER the update is visible)
CREATE TRIGGER memberships_reactivate AFTER UPDATE OF revoked_at ON company_memberships FOR EACH ROW EXECUTE FUNCTION memberships_reactivate_guard();

-- Lowering a role's limit below what is already in use is refused.
CREATE FUNCTION roles_limit_change_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bad text;
BEGIN
  IF NEW.max_companies IS NOT NULL AND NEW.max_companies IS DISTINCT FROM OLD.max_companies THEN
    SELECT u.email INTO bad FROM membership_roles mr JOIN company_memberships cm ON cm.id = mr.membership_id AND cm.revoked_at IS NULL JOIN users u ON u.id = cm.user_id
     WHERE mr.role_id = NEW.id GROUP BY u.email HAVING count(DISTINCT cm.company_id) > NEW.max_companies LIMIT 1;
    IF bad IS NOT NULL THEN RAISE EXCEPTION 'cannot limit role % to % company(ies): % already holds it in more', NEW.code, NEW.max_companies, bad USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER roles_limit_change BEFORE UPDATE OF max_companies ON roles FOR EACH ROW EXECUTE FUNCTION roles_limit_change_guard();

-- Move the old roles[] column into membership_roles, then drop it. This fails loudly if existing data breaks a limit
-- (for example an Accountant who was INPUTTER or TREASURY in two companies).
INSERT INTO membership_roles (membership_id, role_id)
SELECT DISTINCT m.id, r.id FROM company_memberships m CROSS JOIN LATERAL unnest(m.roles) AS x(old_role) JOIN roles r ON r.code = app_role_code(x.old_role);
ALTER TABLE company_memberships DROP COLUMN roles;

-- Role lookups used by every existing policy / function: same signature, now backed by membership_roles.
CREATE OR REPLACE FUNCTION app_member_companies(p_role text DEFAULT NULL) RETURNS SETOF uuid LANGUAGE sql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT m.company_id FROM company_memberships m JOIN users u ON u.id = m.user_id AND u.is_active
      WHERE m.user_id = app_user_id() AND m.revoked_at IS NULL AND m.valid_from <= now() AND (m.valid_to IS NULL OR m.valid_to > now())
        AND (p_role IS NULL OR EXISTS (SELECT 1 FROM membership_roles mr JOIN roles r ON r.id = mr.role_id AND r.is_active
                                       WHERE mr.membership_id = m.id AND r.code = app_role_code(p_role))) $$;

CREATE OR REPLACE FUNCTION company_role_users(p_company uuid, p_role text) RETURNS SETOF uuid LANGUAGE sql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT m.user_id FROM company_memberships m JOIN users u ON u.id = m.user_id AND u.is_active
      WHERE m.company_id = p_company AND m.revoked_at IS NULL AND m.valid_from <= now() AND (m.valid_to IS NULL OR m.valid_to > now())
        AND EXISTS (SELECT 1 FROM membership_roles mr JOIN roles r ON r.id = mr.role_id AND r.is_active
                    WHERE mr.membership_id = m.id AND r.code = app_role_code(p_role)) $$;

-- New, permission-based checks (use these in the rewritten functions instead of role names).
CREATE FUNCTION app_permitted_companies(p_perm text) RETURNS SETOF uuid LANGUAGE sql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT DISTINCT m.company_id FROM company_memberships m JOIN users u ON u.id = m.user_id AND u.is_active
      JOIN membership_roles mr ON mr.membership_id = m.id JOIN roles r ON r.id = mr.role_id AND r.is_active
      JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id AND p.code = p_perm
      WHERE m.user_id = app_user_id() AND m.revoked_at IS NULL AND m.valid_from <= now() AND (m.valid_to IS NULL OR m.valid_to > now()) $$;

CREATE FUNCTION app_has_permission(p_company uuid, p_perm text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT app_is_admin() OR p_company IN (SELECT app_permitted_companies(p_perm)) $$;

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY roles_read ON roles FOR SELECT TO abig_app USING (app_user_id() IS NOT NULL);
CREATE POLICY roles_admin_insert ON roles FOR INSERT TO abig_app WITH CHECK (app_is_admin() AND NOT is_system);
CREATE POLICY roles_admin_update ON roles FOR UPDATE TO abig_app USING (app_is_admin()) WITH CHECK (app_is_admin());
CREATE POLICY permissions_read ON permissions FOR SELECT TO abig_app USING (app_user_id() IS NOT NULL);
CREATE POLICY role_permissions_read ON role_permissions FOR SELECT TO abig_app USING (app_user_id() IS NOT NULL);
CREATE POLICY role_permissions_admin_insert ON role_permissions FOR INSERT TO abig_app WITH CHECK (app_is_admin());
CREATE POLICY role_permissions_admin_delete ON role_permissions FOR DELETE TO abig_app USING (app_is_admin());
CREATE POLICY membership_roles_read ON membership_roles FOR SELECT TO abig_app
  USING (EXISTS (SELECT 1 FROM company_memberships m WHERE m.id = membership_id));  -- same visibility as the membership itself
CREATE POLICY membership_roles_admin_insert ON membership_roles FOR INSERT TO abig_app WITH CHECK (app_is_admin());
CREATE POLICY membership_roles_admin_delete ON membership_roles FOR DELETE TO abig_app USING (app_is_admin());
GRANT SELECT ON roles, permissions, role_permissions, membership_roles TO abig_app;
GRANT INSERT ON roles, role_permissions, membership_roles TO abig_app;
GRANT UPDATE (name, description, max_companies, is_active) ON roles TO abig_app;
GRANT DELETE ON role_permissions, membership_roles TO abig_app;

-- =====================================================================================================================
-- 3. Banks, and bank accounts shared by many companies
-- =====================================================================================================================
CREATE TABLE banks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  code text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT banks_name_key UNIQUE (name),
  CONSTRAINT banks_code_key UNIQUE (code)
);
INSERT INTO banks (name) SELECT DISTINCT btrim(bank_name) FROM company_bank_accounts;
ALTER TABLE company_bank_accounts ADD COLUMN bank_id uuid;
UPDATE company_bank_accounts a SET bank_id = b.id FROM banks b WHERE b.name = btrim(a.bank_name);
ALTER TABLE company_bank_accounts ALTER COLUMN bank_id SET NOT NULL,
  ADD CONSTRAINT company_bank_accounts_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES banks(id);
CREATE INDEX company_bank_accounts_bank_id_idx ON company_bank_accounts (bank_id);
ALTER TABLE banks ENABLE ROW LEVEL SECURITY;
CREATE POLICY banks_read ON banks FOR SELECT TO abig_app USING (app_user_id() IS NOT NULL);
GRANT SELECT ON banks TO abig_app;  -- banks are created through register_bank_account() or by an administrator

-- The junction already exists (company_bank_account_access). Ownership becomes a row in it instead of a column on the account.
ALTER TABLE company_bank_account_access ADD COLUMN is_owner boolean NOT NULL DEFAULT false;

-- The old guard refused a grant to the owner company and read owner_company_id; replace it before backfilling.
CREATE OR REPLACE FUNCTION account_access_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF app_user_id() IS NOT NULL THEN NEW.granted_by := app_user_id(); END IF;
    NEW.revoked_at := NULL; NEW.revoked_by := NULL;
    RETURN NEW;
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'a revoked grant is immutable' USING ERRCODE = '42501'; END IF;
  IF OLD.is_owner THEN RAISE EXCEPTION 'the owner link of an account cannot be revoked' USING ERRCODE = '42501'; END IF;
  IF NEW.revoked_at IS NULL OR (to_jsonb(NEW) - 'revoked_at' - 'revoked_by') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at' - 'revoked_by') THEN
    RAISE EXCEPTION 'a grant can only be revoked, not edited' USING ERRCODE = '42501';
  END IF;
  NEW.revoked_at := now(); NEW.revoked_by := app_user_id();
  RETURN NEW;
END $$;

-- One owner link per account, then backfill it from owner_company_id.
CREATE UNIQUE INDEX account_access_one_owner ON company_bank_account_access (account_id) WHERE is_owner AND revoked_at IS NULL;
INSERT INTO company_bank_account_access (account_id, company_id, is_owner, permissions, valid_from, granted_by)
SELECT a.id, a.owner_company_id, true, ARRAY['USE','RECORD_SNAPSHOT'], a.created_at,
       COALESCE((SELECT id FROM users WHERE is_system_admin ORDER BY created_at LIMIT 1), (SELECT id FROM users ORDER BY created_at LIMIT 1))
  FROM company_bank_accounts a;

-- Helpers that used owner_company_id, now answered from the junction.
CREATE FUNCTION account_owner_company(p_account uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT company_id FROM company_bank_account_access WHERE account_id = p_account AND is_owner AND revoked_at IS NULL $$;

CREATE OR REPLACE FUNCTION app_can_see_account(p_account uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM app_granted_companies(p_account, 'USE') g WHERE g IN (SELECT app_readable_companies())) $$;

-- Recording a balance needs the bank_balance:update permission in a company linked to the account with RECORD_SNAPSHOT.
CREATE OR REPLACE FUNCTION app_can_snapshot(p_account uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM company_bank_accounts a WHERE a.id = p_account AND a.is_active)
          AND EXISTS (SELECT 1 FROM app_granted_companies(p_account, 'RECORD_SNAPSHOT') g WHERE g IN (SELECT app_permitted_companies('bank_balance:update'))) $$;

-- Managing sharing needs bank_account:manage in the OWNER company of the account.
CREATE OR REPLACE FUNCTION app_can_manage_access(p_account uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT account_owner_company(p_account) IN (SELECT app_permitted_companies('bank_account:manage')) $$;

CREATE OR REPLACE FUNCTION app_related_companies() RETURNS SETOF uuid LANGUAGE sql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT g.company_id FROM company_bank_account_access g WHERE g.revoked_at IS NULL AND app_can_see_account(g.account_id) $$;

DROP FUNCTION register_bank_account(uuid, text, text, text, bytea, numeric, boolean);
CREATE FUNCTION register_bank_account(p_owner uuid, p_bank text, p_label text, p_last4 text, p_enc bytea, p_buffer numeric, p_owner_approval boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_bank uuid;
BEGIN
  IF app_user_id() IS NULL OR NOT app_has_permission(p_owner, 'bank_account:manage') THEN RAISE EXCEPTION 'you may not register accounts for this company' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_bank, ''))) = 0 THEN RAISE EXCEPTION 'the bank is required' USING ERRCODE = '23514'; END IF;
  INSERT INTO banks (name) VALUES (btrim(p_bank)) ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_bank FROM banks WHERE name = btrim(p_bank);
  INSERT INTO company_bank_accounts (bank_id, account_label, account_last4, account_number_enc, min_buffer, owner_approval_required)
  VALUES (v_bank, p_label, p_last4, p_enc, COALESCE(p_buffer, 0), COALESCE(p_owner_approval, false)) RETURNING company_bank_accounts.id INTO v_id;
  INSERT INTO company_bank_account_access (account_id, company_id, is_owner, permissions, granted_by)
  VALUES (v_id, p_owner, true, ARRAY['USE','RECORD_SNAPSHOT'], app_user_id());
  PERFORM treasury_audit(p_owner, 'BANK_ACCOUNT_REGISTERED', 'BANK_ACCOUNT', v_id, jsonb_build_object('bank', p_bank, 'label', p_label));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION set_account_policy(p_account uuid, p_buffer numeric, p_owner_approval boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_user_id() IS NULL OR NOT app_can_manage_access(p_account) THEN RAISE EXCEPTION 'only the account owner can change account policy' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM company_bank_accounts WHERE id = p_account FOR UPDATE;
  UPDATE company_bank_accounts SET min_buffer = COALESCE(p_buffer, min_buffer), owner_approval_required = COALESCE(p_owner_approval, owner_approval_required) WHERE id = p_account;
  PERFORM treasury_audit(account_owner_company(p_account), 'BANK_ACCOUNT_POLICY_CHANGED', 'BANK_ACCOUNT', p_account,
         jsonb_build_object('min_buffer', p_buffer, 'owner_approval_required', p_owner_approval));
END $$;

ALTER TABLE company_bank_accounts DROP COLUMN owner_company_id, DROP COLUMN bank_name;

-- =====================================================================================================================
-- 4. Bank account balances: current, reserved, available
-- =====================================================================================================================
ALTER TABLE company_bank_accounts
  ADD COLUMN current_balance numeric(19,4) NOT NULL DEFAULT 0,            -- typed in by the Accountant (the bank's actual figure)
  ADD COLUMN reserved_balance numeric(19,4) NOT NULL DEFAULT 0 CONSTRAINT company_bank_accounts_reserved_chk CHECK (reserved_balance >= 0),
  ADD COLUMN balance_updated_at timestamptz,
  ADD COLUMN available_balance numeric(19,4) GENERATED ALWAYS AS (current_balance - reserved_balance) STORED;

-- Starting values come from the old engine: latest accepted snapshot + later ledger movements, and the funds still locked
-- by active reservations. (The old minimum buffer is NOT subtracted any more; min_buffer stays as its own column.)
UPDATE company_bank_accounts a SET
  current_balance   = (SELECT estimated_balance FROM _cash_position(a.id)),
  balance_updated_at = (SELECT snapshot_as_of FROM _cash_position(a.id)),
  reserved_balance  = (SELECT active_reserved FROM _cash_position(a.id))
WHERE EXISTS (SELECT 1 FROM bank_balance_snapshots s WHERE s.account_id = a.id AND s.status = 'ACCEPTED');

-- =====================================================================================================================
-- 5. Payment requests: status enum, debit account, verifier and authenticator
-- =====================================================================================================================
CREATE TYPE payment_request_status AS ENUM ('DRAFT','SCHEDULED','RESERVED','VERIFIED','AUTHENTICATED','REJECTED');

-- Objects that depend on the old text column are dropped first and recreated below.
DROP POLICY requests_read ON payment_requests;
DROP POLICY requests_insert ON payment_requests;
DROP POLICY requests_update_draft ON payment_requests;
DROP INDEX payment_requests_invoice_once;
DROP INDEX payment_requests_company_state_idx;
ALTER TABLE payment_requests DROP CONSTRAINT payment_requests_workflow_state_check;
ALTER TABLE payment_requests ALTER COLUMN workflow_state DROP DEFAULT;

-- Old state -> new state: SUBMITTED -> RESERVED, AUTHORIZED -> AUTHENTICATED, RETURNED -> DRAFT, CANCELLED -> REJECTED.
ALTER TABLE payment_requests ALTER COLUMN workflow_state TYPE payment_request_status USING (
  CASE workflow_state WHEN 'SUBMITTED' THEN 'RESERVED' WHEN 'AUTHORIZED' THEN 'AUTHENTICATED'
                      WHEN 'RETURNED' THEN 'DRAFT' WHEN 'CANCELLED' THEN 'REJECTED' ELSE workflow_state END)::payment_request_status;
ALTER TABLE payment_requests ALTER COLUMN workflow_state SET DEFAULT 'DRAFT';

ALTER TABLE payment_requests
  ADD COLUMN debit_account_id uuid,
  ADD COLUMN verified_by uuid,
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN authenticated_by uuid,
  ADD COLUMN authenticated_at timestamptz,
  ADD CONSTRAINT payment_requests_debit_account_id_fkey FOREIGN KEY (debit_account_id) REFERENCES company_bank_accounts(id),
  ADD CONSTRAINT payment_requests_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES users(id),
  ADD CONSTRAINT payment_requests_authenticated_by_fkey FOREIGN KEY (authenticated_by) REFERENCES users(id);

-- The backfills below are data corrections, not workflow steps: keep the request guard and event log out of them.
-- (Their functions still know only the old states and are rewritten in the next step.)
ALTER TABLE payment_requests DISABLE TRIGGER payment_requests_guard;
ALTER TABLE payment_requests DISABLE TRIGGER payment_requests_events;

-- Who verified / authenticated, taken from the approval history (only for requests currently in that stage).
UPDATE payment_requests r SET verified_by = e.actor_id, verified_at = e.occurred_at
  FROM (SELECT DISTINCT ON (request_id) request_id, actor_id, occurred_at FROM approval_events WHERE stage = 'VERIFICATION' AND action = 'VERIFY' ORDER BY request_id, occurred_at DESC) e
 WHERE e.request_id = r.id AND r.workflow_state IN ('VERIFIED','AUTHENTICATED');
UPDATE payment_requests r SET authenticated_by = e.actor_id, authenticated_at = e.occurred_at
  FROM (SELECT DISTINCT ON (request_id) request_id, actor_id, occurred_at FROM approval_events WHERE stage = 'AUTHORIZATION' AND action = 'AUTHORIZE' ORDER BY request_id, occurred_at DESC) e
 WHERE e.request_id = r.id AND r.workflow_state = 'AUTHENTICATED';

-- Debit account for requests the old engine already funded or paid: the account of the latest payment, else of the active reservation.
UPDATE payment_requests r SET debit_account_id = x.account_id
  FROM (SELECT DISTINCT ON (i.request_id) i.request_id, COALESCE(p.account_id, c.account_id) AS account_id
          FROM payment_installments i
          LEFT JOIN LATERAL (SELECT account_id FROM payment_transactions WHERE installment_id = i.id ORDER BY created_at DESC LIMIT 1) p ON true
          LEFT JOIN LATERAL (SELECT account_id FROM cash_reservations WHERE installment_id = i.id AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1) c ON true
         WHERE COALESCE(p.account_id, c.account_id) IS NOT NULL ORDER BY i.request_id, i.seq) x
 WHERE x.request_id = r.id;

ALTER TABLE payment_requests ENABLE TRIGGER payment_requests_guard;
ALTER TABLE payment_requests ENABLE TRIGGER payment_requests_events;

-- Rules. The debit-account rule is NOT VALID: requests that were in flight before this migration have no account yet;
-- they cannot be updated until someone picks one, and new rows are checked at once.
ALTER TABLE payment_requests
  ADD CONSTRAINT payment_requests_debit_account_chk CHECK (workflow_state IN ('DRAFT','SCHEDULED','REJECTED') OR debit_account_id IS NOT NULL) NOT VALID,
  ADD CONSTRAINT payment_requests_verifier_chk CHECK (verified_by IS NULL OR verified_by <> created_by),
  ADD CONSTRAINT payment_requests_authenticator_chk CHECK (authenticated_by IS NULL OR (authenticated_by <> created_by AND authenticated_by IS DISTINCT FROM verified_by));

CREATE UNIQUE INDEX payment_requests_invoice_once ON payment_requests (supplier_id, lower(invoice_ref))
  WHERE invoice_ref IS NOT NULL AND workflow_state NOT IN ('DRAFT','REJECTED');
CREATE INDEX payment_requests_debtor_company_id_workflow_state_idx ON payment_requests (debtor_company_id, workflow_state);
CREATE INDEX payment_requests_debit_account_id_workflow_state_idx ON payment_requests (debit_account_id, workflow_state);

-- A request may only debit an account its company is linked to (USE), and the account must be active.
CREATE FUNCTION payment_request_account_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.debit_account_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.debit_account_id IS DISTINCT FROM OLD.debit_account_id) THEN
    IF NOT EXISTS (SELECT 1 FROM company_bank_accounts a WHERE a.id = NEW.debit_account_id AND a.is_active)
       OR NEW.debtor_company_id NOT IN (SELECT app_granted_companies(NEW.debit_account_id, 'USE')) THEN
      RAISE EXCEPTION 'the debit account is not available to this company' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_requests_debit_account_guard BEFORE INSERT OR UPDATE ON payment_requests FOR EACH ROW EXECUTE FUNCTION payment_request_account_guard();

-- Policies, as before but on the new states (RETURNED no longer exists: a request sent back is a DRAFT again).
CREATE POLICY requests_read ON payment_requests FOR SELECT TO abig_app
  USING (debtor_company_id IN (SELECT app_readable_companies()) AND (workflow_state <> 'DRAFT' OR created_by = app_user_id()));
CREATE POLICY requests_insert ON payment_requests FOR INSERT TO abig_app
  WITH CHECK (debtor_company_id IN (SELECT app_permitted_companies('payment_request:create')) AND created_by = app_user_id()
              AND workflow_state = 'DRAFT' AND app_supplier_active_for(debtor_company_id, supplier_id));
CREATE POLICY requests_update_draft ON payment_requests FOR UPDATE TO abig_app
  USING (created_by = app_user_id() AND workflow_state = 'DRAFT' AND debtor_company_id IN (SELECT app_permitted_companies('payment_request:update')))
  WITH CHECK (created_by = app_user_id());
GRANT INSERT (debit_account_id) ON payment_requests TO abig_app;
GRANT UPDATE (debit_account_id) ON payment_requests TO abig_app;
-- verified_by / verified_at / authenticated_by / authenticated_at are written only by the (SECURITY DEFINER) workflow functions.

-- Reserved funds now belong to the new states: reserved_balance must equal the amount locked by RESERVED and VERIFIED requests
-- (plus, until the old engine is retired, its active reservations loaded above). Keeping it in step is part of the workflow rewrite.

-- =====================================================================================================================
-- Report: what still has to be rewritten (functions are not checked when created, so this is the only place it shows)
-- =====================================================================================================================
DO $$
DECLARE f record; n int; bad int;
BEGIN
  FOR f IN SELECT p.proname FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
            WHERE s.nspname = 'public' AND p.prokind = 'f'
              AND (p.prosrc ~ 'owner_company_id' OR p.prosrc ~ '(''SUBMITTED''|''AUTHORIZED''|''RETURNED''|''CANCELLED'')' OR p.prosrc ~ 'm\.roles')
            ORDER BY p.proname LOOP
    RAISE NOTICE 'still uses the old model: %()', f.proname;
  END LOOP;
  SELECT count(*) INTO bad FROM payment_requests WHERE workflow_state NOT IN ('DRAFT','SCHEDULED','REJECTED') AND debit_account_id IS NULL;
  IF bad > 0 THEN RAISE NOTICE '% in-flight payment request(s) have no debit account yet; choose one before they can be updated', bad; END IF;
END $$;
