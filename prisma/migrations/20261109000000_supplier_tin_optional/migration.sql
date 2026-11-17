-- ABIG Finance - A supplier's TIN becomes optional.
--
-- Not every supplier the group pays has a TIN at hand, and a supplier could not be registered without one. An empty TIN is now stored as NULL.
-- A TIN that is entered still has to pass the format check, and is still unique: UNIQUE treats NULLs as different, so any number of suppliers may have none.
-- No existing row changes, and nothing else depends on the column: payment workflow, bank detail verification and the rule against changing a supplier
-- while its requests hold funds all stay as they are. Without a TIN there is no duplicate check on that supplier.

ALTER TABLE suppliers ALTER COLUMN tin DROP NOT NULL;

-- Empty means no TIN. Clearing or adding one counts as a change while requests hold funds, as changing it always has.
CREATE OR REPLACE FUNCTION supplier_update(p_id uuid, p_name text, p_tin text, p_active boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s suppliers; v_tin text := NULLIF(upper(btrim(p_tin)), '');
BEGIN
  IF app_user_id() IS NULL OR NOT (app_has_role_anywhere('VERIFIER') OR app_has_role_anywhere('FINANCE_MANAGER')) THEN
    RAISE EXCEPTION 'only a verifier or finance manager can change a supplier' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM suppliers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'supplier not found' USING ERRCODE = 'P0002'; END IF;
  IF (btrim(p_name) <> s.legal_name OR v_tin IS DISTINCT FROM s.tin OR NOT p_active)
     AND EXISTS (SELECT 1 FROM payment_requests r WHERE r.supplier_id = p_id AND r.workflow_state IN ('RESERVED','VERIFIED')) THEN
    RAISE EXCEPTION 'this supplier has requests in progress; finish or cancel them before changing its name, TIN or status' USING ERRCODE = '42501';
  END IF;
  UPDATE suppliers SET legal_name = btrim(p_name), tin = v_tin, is_active = p_active WHERE id = p_id;
  PERFORM treasury_audit(NULL, 'SUPPLIER_CHANGED', 'SUPPLIER', p_id, jsonb_build_object('name', p_name, 'tin', v_tin, 'active', p_active, 'was_name', s.legal_name, 'was_tin', s.tin));
END $$;
