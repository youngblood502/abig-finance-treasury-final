-- ABIG Finance - Accountants can correct a supplier's name and TIN.
--
-- Accountants already add suppliers with supplier:manage, but could not fix a mistake or add a TIN they did not have at the time. They now can.
-- Whether a supplier is active stays with Verifiers and Finance Managers, and so does verifying or rejecting bank details, which this does not touch.
-- No role or permission changes: this reads the existing supplier:manage permission. supplier_update() stays the only way to change a supplier, because the
-- application role has no UPDATE on the table. The TIN's format check and uniqueness, and the rule against changing a supplier while its requests hold funds, stay.

-- p_active NULL keeps the status as it is, which is what an Accountant's form sends.
CREATE OR REPLACE FUNCTION supplier_update(p_id uuid, p_name text, p_tin text, p_active boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s suppliers; v_tin text := NULLIF(upper(btrim(p_tin)), ''); v_active boolean;
        reviewer boolean := app_has_role_anywhere('VERIFIER') OR app_has_role_anywhere('FINANCE_MANAGER');
BEGIN
  IF app_user_id() IS NULL OR NOT (reviewer OR EXISTS (SELECT 1 FROM app_permitted_companies('supplier:manage'))) THEN
    RAISE EXCEPTION 'you may not change suppliers' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM suppliers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'supplier not found' USING ERRCODE = 'P0002'; END IF;
  v_active := COALESCE(p_active, s.is_active);
  IF v_active <> s.is_active AND NOT reviewer THEN
    RAISE EXCEPTION 'only a verifier or finance manager can change a supplier''s status' USING ERRCODE = '42501';
  END IF;
  IF (btrim(p_name) <> s.legal_name OR v_tin IS DISTINCT FROM s.tin OR NOT v_active)
     AND EXISTS (SELECT 1 FROM payment_requests r WHERE r.supplier_id = p_id AND r.workflow_state IN ('RESERVED','VERIFIED')) THEN
    RAISE EXCEPTION 'this supplier has requests in progress; finish or cancel them before changing its name, TIN or status' USING ERRCODE = '42501';
  END IF;
  UPDATE suppliers SET legal_name = btrim(p_name), tin = v_tin, is_active = v_active WHERE id = p_id;
  PERFORM treasury_audit(NULL, 'SUPPLIER_CHANGED', 'SUPPLIER', p_id, jsonb_build_object('name', p_name, 'tin', v_tin, 'active', v_active, 'was_name', s.legal_name, 'was_tin', s.tin));
END $$;
