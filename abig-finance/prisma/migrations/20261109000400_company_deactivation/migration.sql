-- ABIG Finance - Deactivating a company closes it to new use. It never hides its records or stops work already under way.
--
-- What deactivation did before this migration:
--   Company members   no change. Their access follows their memberships, which do not look at whether the company is active.
--   Administrators    lost the company from app_permitted_companies, so app_account_access() fell to TICK or NONE on every account the company owns.
--                     The account's balance log, outstanding payments and reconciliation weeks, locked ones included, were shown to them as to an outsider.
--                     The company's audit entries dropped out of their audit trail altogether (audit_read).
--   Authenticated     payments that were debited but not yet paid did not stop it, so a company could be closed with money still going out.
--
-- What changes:
--   1. An administrator reads every owned account in full, and every company's audit entries, as before deactivation. Only what is shown changes: who may prepare, lock, check a balance
--      or change access is decided by app_has_permission and app_can_snapshot, which are not touched.
--   2. Deactivation is refused while the company has a request that is held, verified or authenticated and not yet paid, or a reconciliation in
--      progress on an account it owns. Drafts, returned, rejected, cancelled and paid requests do not stop it.
-- Nothing stored is changed: no request, balance, week, line or audit event.

CREATE OR REPLACE FUNCTION app_account_access(p_account uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT CASE
    WHEN app_is_admin() AND account_owner_company(p_account) IS NOT NULL THEN 'FULL'
    WHEN account_owner_company(p_account) IN (SELECT app_permitted_companies('reconciliation:view') UNION SELECT app_permitted_companies('reconciliation:prepare') UNION SELECT app_permitted_companies('reconciliation:lock')) THEN 'FULL'
    WHEN app_can_snapshot(p_account) THEN 'TICK'
    ELSE 'NONE' END $$;

-- The audit trail: administrators read every company's entries, as they did while it was active. app_member_companies('FINANCE_MANAGER') gives them active
-- companies only, so a deactivated company's history dropped out of their view. Everyone else reads exactly as before.
DROP POLICY audit_read ON audit_events;
CREATE POLICY audit_read ON audit_events FOR SELECT TO abig_app
  USING (actor_id = app_user_id()
         OR company_id IN (SELECT app_member_companies('FINANCE_MANAGER'))
         OR company_id IN (SELECT app_group_companies())
         OR app_is_admin());

CREATE OR REPLACE FUNCTION admin_update_company(p_id uuid, p_name text, p_tin text, p_phone text, p_active boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o companies; n int;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can edit companies' USING ERRCODE = '42501'; END IF;
  SELECT * INTO o FROM companies WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company not found' USING ERRCODE = 'P0002'; END IF;
  IF length(btrim(coalesce(p_name, ''))) = 0 THEN RAISE EXCEPTION 'the company name is required' USING ERRCODE = '23514'; END IF;
  IF length(btrim(coalesce(p_tin, ''))) = 0 THEN RAISE EXCEPTION 'the TIN number is required' USING ERRCODE = '23514'; END IF;
  IF length(btrim(coalesce(p_phone, ''))) = 0 THEN RAISE EXCEPTION 'the phone number is required' USING ERRCODE = '23514'; END IF;
  IF NOT p_active AND o.is_active THEN
    IF EXISTS (SELECT 1 FROM payment_requests WHERE debtor_company_id = p_id AND workflow_state IN ('RESERVED','VERIFIED')) THEN
      RAISE EXCEPTION 'this company has payment requests waiting for approval; finish or cancel them before deactivating it' USING ERRCODE = '23514';
    END IF;
    SELECT count(*) INTO n FROM payment_requests WHERE debtor_company_id = p_id AND workflow_state = 'AUTHENTICATED';
    IF n > 0 THEN
      RAISE EXCEPTION 'this company has % authenticated payment(s) not yet paid; they must be paid and reconciled before it is deactivated', n USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM treasury_weeks w JOIN company_bank_account_access g ON g.account_id = w.account_id AND g.is_owner AND g.revoked_at IS NULL
                WHERE g.company_id = p_id AND w.status = 'RECONCILING') THEN
      RAISE EXCEPTION 'a reconciliation is in progress on an account this company owns; lock it before deactivating the company' USING ERRCODE = '23514';
    END IF;
  END IF;
  UPDATE companies SET legal_name = btrim(p_name), tin_number = upper(btrim(p_tin)), phone = btrim(p_phone), is_active = p_active WHERE id = p_id;
  PERFORM treasury_audit(p_id, 'COMPANY_UPDATED', 'COMPANY', p_id,
    jsonb_build_object('name', jsonb_build_array(o.legal_name, btrim(p_name)), 'tin', jsonb_build_array(o.tin_number, upper(btrim(p_tin))),
                       'phone', jsonb_build_array(o.phone, btrim(p_phone)), 'active', jsonb_build_array(o.is_active, p_active)));
END $$;
