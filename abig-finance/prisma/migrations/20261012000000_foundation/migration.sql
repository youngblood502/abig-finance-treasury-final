-- ABIG Finance - Phase 1 foundation: tables, constraints, RLS, append-only guards.
-- Run as the migration/owner role. The app connects as abig_app (NOBYPASSRLS, not the table owner).

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'abig_app') THEN
    CREATE ROLE abig_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
-- Small, frequent queries: JIT compilation costs more than it saves.
ALTER ROLE abig_app SET jit = off;

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  legal_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  full_name text NOT NULL,
  password_hash text,
  is_system_admin boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  user_id uuid NOT NULL REFERENCES users(id),
  roles text[] NOT NULL CHECK (cardinality(roles) > 0 AND roles <@ ARRAY['INPUTTER','VERIFIER','AUTHENTICATOR','TREASURY','FINANCE_MANAGER','ACCOUNT_OWNER']),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX company_memberships_one_active ON company_memberships (company_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX company_memberships_user_idx ON company_memberships (user_id);

-- Group reporting is explicit and per company. It never grants approval or payment rights.
CREATE TABLE group_permission_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  permission text NOT NULL CHECK (permission IN ('GROUP_REPORT_VIEW')),
  company_id uuid NOT NULL REFERENCES companies(id),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX group_grants_one_active ON group_permission_grants (user_id, permission, company_id) WHERE revoked_at IS NULL;

CREATE TABLE company_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_company_id uuid NOT NULL REFERENCES companies(id),
  bank_name text NOT NULL,
  account_label text NOT NULL,
  account_last4 char(4) NOT NULL,
  account_number_enc bytea,
  currency char(3) NOT NULL DEFAULT 'ETB' CHECK (currency = 'ETB'),
  is_active boolean NOT NULL DEFAULT true,
  min_buffer numeric(19,4) NOT NULL DEFAULT 0 CHECK (min_buffer >= 0),
  owner_approval_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per grant. Re-granting after revocation inserts a new row; old rows stay.
CREATE TABLE company_bank_account_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES company_bank_accounts(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  permissions text[] NOT NULL DEFAULT ARRAY['USE'] CHECK (cardinality(permissions) > 0 AND permissions <@ ARRAY['USE','RECORD_SNAPSHOT']),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  granted_by uuid NOT NULL REFERENCES users(id),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX account_access_one_active ON company_bank_account_access (account_id, company_id) WHERE revoked_at IS NULL;
CREATE INDEX account_access_account_idx ON company_bank_account_access (account_id);

-- A snapshot is a baseline, not a movement. Append-only.
CREATE TABLE bank_balance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES company_bank_accounts(id),
  as_of timestamptz NOT NULL,
  balance numeric(19,4) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'ETB' CHECK (currency = 'ETB'),
  status text NOT NULL DEFAULT 'ACCEPTED' CHECK (status IN ('ACCEPTED','PROVISIONAL')),
  entered_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, as_of)
);
CREATE INDEX snapshots_account_asof_idx ON bank_balance_snapshots (account_id, as_of DESC);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL REFERENCES users(id),
  company_id uuid REFERENCES companies(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid()
);
CREATE INDEX audit_company_time_idx ON audit_events (company_id, occurred_at DESC);

-- ---------- Context and authorization helpers ----------
-- SECURITY DEFINER functions run as the owner and bypass RLS, so policies cannot recurse.
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app_is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM users WHERE id = app_user_id() AND is_system_admin AND is_active) $$;

CREATE FUNCTION app_member_companies(p_role text DEFAULT NULL) RETURNS SETOF uuid LANGUAGE sql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT m.company_id FROM company_memberships m JOIN users u ON u.id = m.user_id AND u.is_active
      WHERE m.user_id = app_user_id() AND m.revoked_at IS NULL AND m.valid_from <= now() AND (m.valid_to IS NULL OR m.valid_to > now())
        AND (p_role IS NULL OR p_role = ANY (m.roles)) $$;

CREATE FUNCTION app_group_companies() RETURNS SETOF uuid LANGUAGE sql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT g.company_id FROM group_permission_grants g JOIN users u ON u.id = g.user_id AND u.is_active
      WHERE g.user_id = app_user_id() AND g.permission = 'GROUP_REPORT_VIEW' AND g.revoked_at IS NULL
        AND g.valid_from <= now() AND (g.valid_to IS NULL OR g.valid_to > now()) $$;

CREATE FUNCTION app_readable_companies() RETURNS SETOF uuid LANGUAGE sql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT app_member_companies() UNION SELECT app_group_companies() $$;

CREATE FUNCTION app_granted_companies(p_account uuid, p_perm text DEFAULT 'USE') RETURNS SETOF uuid LANGUAGE sql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT company_id FROM company_bank_account_access
      WHERE account_id = p_account AND revoked_at IS NULL AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())
        AND p_perm = ANY (permissions) $$;

-- Implicit-owner rule: the legal owner always has access. Granting access to the owner company is rejected by a trigger.
CREATE FUNCTION app_can_see_account(p_account uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM company_bank_accounts a WHERE a.id = p_account AND a.owner_company_id IN (SELECT app_readable_companies()))
          OR EXISTS (SELECT 1 FROM app_granted_companies(p_account) g WHERE g IN (SELECT app_readable_companies())) $$;

CREATE FUNCTION app_can_snapshot(p_account uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM company_bank_accounts a WHERE a.id = p_account AND a.is_active AND a.owner_company_id IN (SELECT app_member_companies('TREASURY')))
          OR EXISTS (SELECT 1 FROM app_granted_companies(p_account, 'RECORD_SNAPSHOT') g WHERE g IN (SELECT app_member_companies('TREASURY'))) $$;

CREATE FUNCTION app_can_manage_access(p_account uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM company_bank_accounts a WHERE a.id = p_account AND a.owner_company_id IN (SELECT app_member_companies('ACCOUNT_OWNER'))) $$;

-- Companies that share an account the user can see (so debtor and owner names can be shown together).
CREATE FUNCTION app_related_companies() RETURNS SETOF uuid LANGUAGE sql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT a.owner_company_id FROM company_bank_accounts a WHERE app_can_see_account(a.id)
      UNION SELECT g.company_id FROM company_bank_account_access g WHERE g.revoked_at IS NULL AND app_can_see_account(g.account_id) $$;

-- ---------- Triggers ----------
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501'; END $$;

CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER snapshots_append_only BEFORE UPDATE OR DELETE ON bank_balance_snapshots FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER snapshots_no_truncate BEFORE TRUNCATE ON bank_balance_snapshots FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER account_access_no_delete BEFORE DELETE ON company_bank_account_access FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER account_access_no_truncate BEFORE TRUNCATE ON company_bank_account_access FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Grants are immutable except for a one-way revocation.
CREATE FUNCTION account_access_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.company_id = (SELECT owner_company_id FROM company_bank_accounts WHERE id = NEW.account_id) THEN
      RAISE EXCEPTION 'the owner company already has implicit access; do not grant it' USING ERRCODE = '23514';
    END IF;
    IF app_user_id() IS NOT NULL THEN NEW.granted_by := app_user_id(); END IF;
    NEW.revoked_at := NULL; NEW.revoked_by := NULL;
    RETURN NEW;
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'a revoked grant is immutable' USING ERRCODE = '42501'; END IF;
  IF NEW.revoked_at IS NULL OR (to_jsonb(NEW) - 'revoked_at' - 'revoked_by') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at' - 'revoked_by') THEN
    RAISE EXCEPTION 'a grant can only be revoked, not edited' USING ERRCODE = '42501';
  END IF;
  NEW.revoked_at := now(); NEW.revoked_by := app_user_id();
  RETURN NEW;
END $$;
CREATE TRIGGER account_access_guard_trg BEFORE INSERT OR UPDATE ON company_bank_account_access FOR EACH ROW EXECUTE FUNCTION account_access_guard();

-- ---------- Row-level security ----------
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_permission_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_bank_account_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_balance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY companies_read ON companies FOR SELECT TO abig_app
  USING (id IN (SELECT app_readable_companies()) OR id IN (SELECT app_related_companies()) OR app_is_admin());

CREATE POLICY users_read ON users FOR SELECT TO abig_app
  USING (id = app_user_id() OR app_is_admin()
         OR id IN (SELECT user_id FROM company_memberships WHERE company_id IN (SELECT app_member_companies())));
CREATE POLICY users_admin_insert ON users FOR INSERT TO abig_app WITH CHECK (app_is_admin());
CREATE POLICY users_admin_update ON users FOR UPDATE TO abig_app USING (app_is_admin()) WITH CHECK (app_is_admin());

CREATE POLICY memberships_read ON company_memberships FOR SELECT TO abig_app
  USING (user_id = app_user_id() OR app_is_admin() OR company_id IN (SELECT app_member_companies()));
CREATE POLICY memberships_admin_insert ON company_memberships FOR INSERT TO abig_app WITH CHECK (app_is_admin());
CREATE POLICY memberships_admin_update ON company_memberships FOR UPDATE TO abig_app USING (app_is_admin()) WITH CHECK (app_is_admin());

CREATE POLICY group_grants_read ON group_permission_grants FOR SELECT TO abig_app USING (user_id = app_user_id() OR app_is_admin());
CREATE POLICY group_grants_admin_insert ON group_permission_grants FOR INSERT TO abig_app WITH CHECK (app_is_admin());
CREATE POLICY group_grants_admin_update ON group_permission_grants FOR UPDATE TO abig_app USING (app_is_admin()) WITH CHECK (app_is_admin());

CREATE POLICY accounts_read ON company_bank_accounts FOR SELECT TO abig_app USING (app_can_see_account(id));

CREATE POLICY access_read ON company_bank_account_access FOR SELECT TO abig_app USING (app_can_see_account(account_id));
CREATE POLICY access_insert ON company_bank_account_access FOR INSERT TO abig_app WITH CHECK (app_can_manage_access(account_id));
CREATE POLICY access_revoke ON company_bank_account_access FOR UPDATE TO abig_app USING (app_can_manage_access(account_id)) WITH CHECK (app_can_manage_access(account_id));

CREATE POLICY snapshots_read ON bank_balance_snapshots FOR SELECT TO abig_app USING (app_can_see_account(account_id));
CREATE POLICY snapshots_insert ON bank_balance_snapshots FOR INSERT TO abig_app WITH CHECK (app_can_snapshot(account_id) AND entered_by = app_user_id());

CREATE POLICY audit_insert ON audit_events FOR INSERT TO abig_app WITH CHECK (actor_id = app_user_id());
CREATE POLICY audit_read ON audit_events FOR SELECT TO abig_app
  USING (actor_id = app_user_id()
         OR company_id IN (SELECT app_member_companies('FINANCE_MANAGER'))
         OR company_id IN (SELECT app_group_companies())
         OR (company_id IS NULL AND app_is_admin()));

-- ---------- Privileges (least privilege; no DELETE anywhere) ----------
GRANT USAGE ON SCHEMA public TO abig_app;
GRANT SELECT ON companies, company_memberships, group_permission_grants, company_bank_accounts,
                company_bank_account_access, bank_balance_snapshots, audit_events TO abig_app;
GRANT SELECT (id, email, full_name, is_system_admin, is_active, created_at) ON users TO abig_app; -- never password_hash
GRANT INSERT ON users, company_memberships, group_permission_grants, company_bank_account_access,
                bank_balance_snapshots, audit_events TO abig_app;
GRANT UPDATE (full_name, is_active, is_system_admin) ON users TO abig_app;
GRANT UPDATE (roles, valid_to, revoked_at) ON company_memberships TO abig_app;
GRANT UPDATE (valid_to, revoked_at) ON group_permission_grants TO abig_app;
GRANT UPDATE (revoked_at, revoked_by) ON company_bank_account_access TO abig_app;
