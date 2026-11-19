-- ABIG Finance - VAT and withholding tax on payment requests.
--
--   * A system administrator configures VAT rates (a default of 15%, a non-taxable 0% rate, and any others) and the withholding tax rate (3%)
--     and threshold. The threshold starts unset: withholding cannot be selected until an administrator sets it. No legal figure is assumed.
--   * A request records an immutable tax snapshot: how the amount was entered (before VAT, or the total including VAT), the amount entered, the
--     VAT rate's name and percentage, the withholding rate and threshold, and the figures calculated from them. A later change to the settings
--     never changes a request that was already submitted.
--   * The figures are calculated here, in numeric, never in the application:
--         amount entered before VAT:  before = entered;                         VAT = round(before x rate, 2);  gross = before + VAT
--         total entered (incl. VAT):  before = round(gross / (1 + rate), 2);    VAT = gross - before;           gross = entered
--         withholding (optional):     round(before x withholding rate, 2), only when before >= threshold; otherwise 0
--         net payment:                gross - withholding
--   * payment_requests.total_amount keeps its meaning: the net amount paid from the bank. It is what is reserved, debited and reconciled, exactly
--     as before. VAT and withholding are stored for reporting only. Nothing here touches balances, reservations, debits or reconciliation.
--   * Every calculated amount has exactly two decimals (round(x, 2), half away from zero), although the columns are numeric(19,4) like the others.
--   * Requests from before this migration keep no tax breakdown (all tax columns empty). Nothing is backfilled: whether their totals included VAT
--     is not known, and guessing would misstate them.
--   * A draft takes a fresh snapshot of the current settings whenever its tax inputs change or its creator saves it. After submission only a
--     reviewer's adjustment (wf_adjust) can change the inputs; it recalculates with the request's own withholding snapshot and audits each field.
--   * Recurring templates are not changed: the requests they create carry no tax breakdown, as before.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE tax_vat_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80 AND name = btrim(name) AND name !~ '[[:cntrl:]]'),
  rate_percent numeric(5,2) NOT NULL CHECK (rate_percent >= 0 AND rate_percent < 100),
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),        -- NULL only for the two rates created by this migration
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id),
  CONSTRAINT tax_vat_rates_default_active CHECK (NOT is_default OR is_active)
);
CREATE UNIQUE INDEX tax_vat_rates_name_once ON tax_vat_rates (lower(name));
CREATE UNIQUE INDEX tax_vat_rates_one_default ON tax_vat_rates (is_default) WHERE is_default;
CREATE TRIGGER tax_vat_rates_no_delete BEFORE DELETE ON tax_vat_rates FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tax_vat_rates_no_truncate BEFORE TRUNCATE ON tax_vat_rates FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

CREATE TABLE tax_withholding_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),      -- one row
  rate_percent numeric(5,2) NOT NULL CHECK (rate_percent > 0 AND rate_percent < 100),
  threshold_amount numeric(19,4) CHECK (threshold_amount IS NULL OR (threshold_amount >= 0 AND threshold_amount = round(threshold_amount, 2))),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);
CREATE TRIGGER tax_withholding_no_delete BEFORE DELETE ON tax_withholding_settings FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tax_withholding_no_truncate BEFORE TRUNCATE ON tax_withholding_settings FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

INSERT INTO tax_vat_rates (name, rate_percent, is_default) VALUES ('Standard VAT', 15, true), ('Non-taxable', 0, false);
INSERT INTO tax_withholding_settings (rate_percent, threshold_amount) VALUES (3, NULL);

-- No role reads or writes the settings directly: only through the functions below.
ALTER TABLE tax_vat_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_withholding_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tax_vat_rates, tax_withholding_settings FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. The request's tax snapshot
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE payment_requests
  ADD COLUMN amount_input_mode text CHECK (amount_input_mode IN ('BEFORE_VAT','TOTAL')),
  ADD COLUMN entered_amount numeric(19,4),
  ADD COLUMN vat_rate_id uuid REFERENCES tax_vat_rates(id),
  ADD COLUMN vat_rate_name text,
  ADD COLUMN vat_rate_percent numeric(5,2),
  ADD COLUMN amount_before_vat numeric(19,4),
  ADD COLUMN vat_amount numeric(19,4),
  ADD COLUMN gross_amount numeric(19,4),
  ADD COLUMN withholding_applied boolean,
  ADD COLUMN withholding_rate_percent numeric(5,2),
  ADD COLUMN withholding_threshold numeric(19,4),
  ADD COLUMN withholding_amount numeric(19,4);

-- Either no breakdown at all (requests from before tax configuration, and requests created by recurring templates), or a complete one that adds up.
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_tax_snapshot_chk CHECK (
  (amount_input_mode IS NULL AND entered_amount IS NULL AND vat_rate_id IS NULL AND vat_rate_name IS NULL AND vat_rate_percent IS NULL AND amount_before_vat IS NULL
     AND vat_amount IS NULL AND gross_amount IS NULL AND withholding_applied IS NULL AND withholding_rate_percent IS NULL AND withholding_threshold IS NULL AND withholding_amount IS NULL)
  OR (amount_input_mode IS NOT NULL AND entered_amount > 0 AND vat_rate_id IS NOT NULL AND vat_rate_name IS NOT NULL AND vat_rate_percent IS NOT NULL
     AND amount_before_vat > 0 AND vat_amount >= 0 AND gross_amount > 0 AND withholding_applied IS NOT NULL AND withholding_rate_percent IS NOT NULL AND withholding_amount >= 0
     AND entered_amount = round(entered_amount, 2) AND amount_before_vat = round(amount_before_vat, 2) AND vat_amount = round(vat_amount, 2)
     AND gross_amount = round(gross_amount, 2) AND withholding_amount = round(withholding_amount, 2) AND total_amount = round(total_amount, 2)
     AND gross_amount = amount_before_vat + vat_amount
     AND total_amount = gross_amount - withholding_amount
     AND (withholding_applied OR withholding_amount = 0)
     AND entered_amount = CASE amount_input_mode WHEN 'BEFORE_VAT' THEN amount_before_vat ELSE gross_amount END));

-- The creator writes only the inputs; the snapshot and the figures are set by the trigger below.
GRANT INSERT (amount_input_mode, entered_amount, vat_rate_id, withholding_applied), UPDATE (amount_input_mode, entered_amount, vat_rate_id, withholding_applied) ON payment_requests TO abig_app;
GRANT SELECT (amount_input_mode, entered_amount, vat_rate_id, vat_rate_name, vat_rate_percent, amount_before_vat, vat_amount, gross_amount,
              withholding_applied, withholding_rate_percent, withholding_threshold, withholding_amount) ON payment_requests TO abig_app;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. The calculation: one function, used by the trigger, the reviewer's adjustment and the tests
-- ---------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION tax_figures(p_mode text, p_entered numeric, p_vat_percent numeric, p_withholding boolean, p_wht_percent numeric, p_wht_threshold numeric,
                            OUT amount_before_vat numeric, OUT vat_amount numeric, OUT gross_amount numeric, OUT withholding_amount numeric, OUT net_amount numeric)
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('BEFORE_VAT','TOTAL') THEN RAISE EXCEPTION 'choose how the amount is entered: before VAT, or the total including VAT' USING ERRCODE = '23514'; END IF;
  IF p_entered IS NULL OR p_entered <= 0 THEN RAISE EXCEPTION 'the amount must be more than zero' USING ERRCODE = '23514'; END IF;
  IF p_entered <> round(p_entered, 2) THEN RAISE EXCEPTION 'amounts have at most two decimal places' USING ERRCODE = '23514'; END IF;
  IF p_vat_percent IS NULL OR p_vat_percent < 0 OR p_vat_percent >= 100 THEN RAISE EXCEPTION 'choose a VAT rate' USING ERRCODE = '23514'; END IF;
  -- round(x, 2) everywhere, also on values that are already whole cents, so every figure carries exactly two decimals.
  IF p_mode = 'BEFORE_VAT' THEN
    amount_before_vat := round(p_entered, 2);
    vat_amount := round(amount_before_vat * p_vat_percent / 100, 2);
    gross_amount := amount_before_vat + vat_amount;
  ELSE
    gross_amount := round(p_entered, 2);
    amount_before_vat := round(gross_amount / (1 + p_vat_percent / 100), 2);
    vat_amount := gross_amount - amount_before_vat;      -- the parts always add up to the total entered
  END IF;
  IF amount_before_vat <= 0 THEN RAISE EXCEPTION 'the amount is too small to split into an amount before VAT and VAT' USING ERRCODE = '23514'; END IF;
  withholding_amount := round(0::numeric, 2);
  IF coalesce(p_withholding, false) THEN
    IF p_wht_threshold IS NULL THEN
      RAISE EXCEPTION 'withholding tax cannot be applied until a system administrator sets the withholding threshold' USING ERRCODE = '23514';
    END IF;
    IF amount_before_vat < p_wht_threshold THEN
      RAISE EXCEPTION 'withholding tax applies only when the amount before VAT is at least ETB %; this amount before VAT is ETB %',
        to_char(p_wht_threshold, 'FM999,999,999,990.00'), to_char(amount_before_vat, 'FM999,999,999,990.00') USING ERRCODE = '23514';
    END IF;
    withholding_amount := round(amount_before_vat * p_wht_percent / 100, 2);
  END IF;
  net_amount := gross_amount - withholding_amount;
END $$;
GRANT EXECUTE ON FUNCTION tax_figures(text, numeric, numeric, boolean, numeric, numeric) TO abig_app;

-- Sets the snapshot and the figures. Runs before the funds guard (trigger names fire in order), so a recalculated net is what gets reserved.
--   * No breakdown: every tax column stays empty, and a breakdown once recorded cannot be removed.
--   * A draft (on insert, when its inputs change, or when its creator saves it, which sets app.tax_refresh): a fresh snapshot of the current
--     settings. The VAT rate must be active.
--   * After submission: only wf_adjust (app.tax_adjust) can change the inputs. It keeps the input mode and the withholding snapshot; a newly
--     chosen VAT rate brings its current name and percentage. Any other change to a tax column, or to the net total, is refused.
CREATE FUNCTION payment_request_tax_calc() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  drafting boolean; adjusting boolean; changed boolean := true; rate tax_vat_rates; w tax_withholding_settings; f record;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.amount_input_mode IS NOT NULL AND NEW.amount_input_mode IS NULL THEN
    RAISE EXCEPTION 'a request''s tax breakdown cannot be removed' USING ERRCODE = '42501';
  END IF;
  IF NEW.amount_input_mode IS NULL THEN
    NEW.entered_amount := NULL; NEW.vat_rate_id := NULL; NEW.vat_rate_name := NULL; NEW.vat_rate_percent := NULL; NEW.amount_before_vat := NULL; NEW.vat_amount := NULL;
    NEW.gross_amount := NULL; NEW.withholding_applied := NULL; NEW.withholding_rate_percent := NULL; NEW.withholding_threshold := NULL; NEW.withholding_amount := NULL;
    RETURN NEW;
  END IF;
  NEW.withholding_applied := coalesce(NEW.withholding_applied, false);
  IF TG_OP = 'UPDATE' THEN
    changed := NEW.amount_input_mode IS DISTINCT FROM OLD.amount_input_mode OR NEW.entered_amount IS DISTINCT FROM OLD.entered_amount
            OR NEW.vat_rate_id IS DISTINCT FROM OLD.vat_rate_id OR NEW.withholding_applied IS DISTINCT FROM OLD.withholding_applied;
  END IF;
  drafting := TG_OP = 'INSERT' OR (OLD.workflow_state = 'DRAFT' AND NEW.workflow_state = 'DRAFT');
  adjusting := TG_OP = 'UPDATE' AND current_setting('app.tax_adjust', true) = 'on' AND current_setting('app.wf', true) = 'on';

  IF drafting AND (changed OR current_setting('app.tax_refresh', true) = 'on') THEN
    SELECT * INTO rate FROM tax_vat_rates WHERE id = NEW.vat_rate_id;
    IF NOT FOUND OR NOT rate.is_active THEN RAISE EXCEPTION 'choose an active VAT rate' USING ERRCODE = '23514'; END IF;
    SELECT * INTO w FROM tax_withholding_settings;
    NEW.vat_rate_name := rate.name; NEW.vat_rate_percent := rate.rate_percent;
    NEW.withholding_rate_percent := w.rate_percent; NEW.withholding_threshold := w.threshold_amount;
  ELSIF adjusting AND changed THEN
    IF NEW.amount_input_mode IS DISTINCT FROM OLD.amount_input_mode THEN RAISE EXCEPTION 'how the amount was entered cannot be changed in an adjustment' USING ERRCODE = '23514'; END IF;
    IF NEW.vat_rate_id IS DISTINCT FROM OLD.vat_rate_id THEN
      SELECT * INTO rate FROM tax_vat_rates WHERE id = NEW.vat_rate_id;
      IF NOT FOUND OR NOT rate.is_active THEN RAISE EXCEPTION 'choose an active VAT rate' USING ERRCODE = '23514'; END IF;
      NEW.vat_rate_name := rate.name; NEW.vat_rate_percent := rate.rate_percent;
    ELSE
      NEW.vat_rate_name := OLD.vat_rate_name; NEW.vat_rate_percent := OLD.vat_rate_percent;
    END IF;
    NEW.withholding_rate_percent := OLD.withholding_rate_percent; NEW.withholding_threshold := OLD.withholding_threshold;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Nothing to recalculate: the snapshot, the figures and the net total stay exactly as they were.
    IF changed OR NEW.vat_rate_name IS DISTINCT FROM OLD.vat_rate_name OR NEW.vat_rate_percent IS DISTINCT FROM OLD.vat_rate_percent
       OR NEW.withholding_rate_percent IS DISTINCT FROM OLD.withholding_rate_percent OR NEW.withholding_threshold IS DISTINCT FROM OLD.withholding_threshold
       OR NEW.amount_before_vat IS DISTINCT FROM OLD.amount_before_vat OR NEW.vat_amount IS DISTINCT FROM OLD.vat_amount
       OR NEW.gross_amount IS DISTINCT FROM OLD.gross_amount OR NEW.withholding_amount IS DISTINCT FROM OLD.withholding_amount
       OR (OLD.amount_input_mode IS NOT NULL AND NEW.total_amount IS DISTINCT FROM OLD.total_amount) THEN
      IF OLD.workflow_state = 'DRAFT' THEN
        RAISE EXCEPTION 'the tax figures and the net total are calculated by the database from the amount entered, the VAT rate and withholding: change those instead' USING ERRCODE = '42501';
      END IF;
      RAISE EXCEPTION 'the tax figures of a submitted request change only through a reviewer''s adjustment' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  f := tax_figures(NEW.amount_input_mode, NEW.entered_amount, NEW.vat_rate_percent, NEW.withholding_applied, NEW.withholding_rate_percent, NEW.withholding_threshold);
  NEW.amount_before_vat := f.amount_before_vat; NEW.vat_amount := f.vat_amount; NEW.gross_amount := f.gross_amount;
  NEW.withholding_amount := f.withholding_amount; NEW.total_amount := f.net_amount;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_requests_amount_tax BEFORE INSERT OR UPDATE ON payment_requests FOR EACH ROW EXECUTE FUNCTION payment_request_tax_calc();

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Reading and changing the settings
-- ---------------------------------------------------------------------------------------------------------------------
-- What the request form needs: the active rates (default first) and the withholding settings. Any signed-in person.
CREATE FUNCTION tax_options() RETURNS TABLE (kind text, id uuid, name text, rate_percent numeric, is_default boolean, threshold_amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_user_id() IS NULL THEN RAISE EXCEPTION 'sign in first' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT 'VAT'::text, v.id, v.name, v.rate_percent::numeric, v.is_default, NULL::numeric FROM tax_vat_rates v WHERE v.is_active
    UNION ALL SELECT 'WITHHOLDING'::text, NULL::uuid, 'Withholding tax'::text, w.rate_percent::numeric, false, w.threshold_amount::numeric FROM tax_withholding_settings w
    ORDER BY 1, 5 DESC, 4, 3;
END $$;

-- Everything an administrator sees, inactive rates included.
CREATE FUNCTION admin_tax_settings() RETURNS TABLE (kind text, id uuid, name text, rate_percent numeric, is_active boolean, is_default boolean, threshold_amount numeric,
                                                    updated_at timestamptz, updated_by_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can see the tax settings' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT 'VAT'::text, v.id, v.name, v.rate_percent::numeric, v.is_active, v.is_default, NULL::numeric, v.updated_at, u.full_name
      FROM tax_vat_rates v LEFT JOIN users u ON u.id = v.updated_by
    UNION ALL SELECT 'WITHHOLDING'::text, NULL::uuid, 'Withholding tax'::text, w.rate_percent::numeric, true, false, w.threshold_amount::numeric, w.updated_at, u.full_name
      FROM tax_withholding_settings w LEFT JOIN users u ON u.id = w.updated_by
    ORDER BY 1, 6 DESC, 5 DESC, 4, 3;
END $$;

CREATE FUNCTION tax_check_percent(p numeric, p_allow_zero boolean) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p IS NULL OR p < 0 OR p >= 100 OR (p = 0 AND NOT p_allow_zero) THEN
    RAISE EXCEPTION 'enter a percentage %', CASE WHEN p_allow_zero THEN 'from 0 to less than 100' ELSE 'above 0 and below 100' END USING ERRCODE = '23514';
  END IF;
  IF p <> round(p, 2) THEN RAISE EXCEPTION 'a percentage has at most two decimal places' USING ERRCODE = '23514'; END IF;
END $$;

CREATE FUNCTION admin_vat_rate_add(p_name text, p_percent numeric) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can change the tax settings' USING ERRCODE = '42501'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'enter a name for the VAT rate' USING ERRCODE = '23514'; END IF;
  PERFORM tax_check_percent(p_percent, true);
  IF EXISTS (SELECT 1 FROM tax_vat_rates WHERE lower(name) = lower(v_name)) THEN RAISE EXCEPTION 'a VAT rate with this name already exists' USING ERRCODE = '23505'; END IF;
  INSERT INTO tax_vat_rates (name, rate_percent, created_by, updated_by) VALUES (v_name, p_percent, app_user_id(), app_user_id()) RETURNING id INTO v_id;
  PERFORM treasury_audit(NULL, 'TAX_VAT_RATE_ADDED', 'TAX_VAT_RATE', v_id, jsonb_build_object('new', jsonb_build_object('name', v_name, 'rate_percent', p_percent)));
  RETURN v_id;
END $$;

CREATE FUNCTION admin_vat_rate_update(p_id uuid, p_name text, p_percent numeric) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o tax_vat_rates; v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can change the tax settings' USING ERRCODE = '42501'; END IF;
  SELECT * INTO o FROM tax_vat_rates WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VAT rate not found' USING ERRCODE = 'P0002'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'enter a name for the VAT rate' USING ERRCODE = '23514'; END IF;
  PERFORM tax_check_percent(p_percent, true);
  IF EXISTS (SELECT 1 FROM tax_vat_rates WHERE lower(name) = lower(v_name) AND id <> p_id) THEN RAISE EXCEPTION 'a VAT rate with this name already exists' USING ERRCODE = '23505'; END IF;
  IF v_name = o.name AND p_percent = o.rate_percent THEN RAISE EXCEPTION 'nothing was changed' USING ERRCODE = '23514'; END IF;
  UPDATE tax_vat_rates SET name = v_name, rate_percent = p_percent, updated_at = now(), updated_by = app_user_id() WHERE id = p_id;
  -- Requests keep the name and percentage they recorded; only drafts saved from now on take the new ones.
  PERFORM treasury_audit(NULL, 'TAX_VAT_RATE_UPDATED', 'TAX_VAT_RATE', p_id, jsonb_build_object(
    'previous', jsonb_build_object('name', o.name, 'rate_percent', o.rate_percent), 'new', jsonb_build_object('name', v_name, 'rate_percent', p_percent)));
END $$;

CREATE FUNCTION admin_vat_rate_set_active(p_id uuid, p_active boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o tax_vat_rates;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can change the tax settings' USING ERRCODE = '42501'; END IF;
  SELECT * INTO o FROM tax_vat_rates WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VAT rate not found' USING ERRCODE = 'P0002'; END IF;
  IF p_active IS NULL OR o.is_active = p_active THEN RAISE EXCEPTION 'this VAT rate is already %', CASE WHEN o.is_active THEN 'active' ELSE 'inactive' END USING ERRCODE = '23514'; END IF;
  IF NOT p_active AND o.is_default THEN RAISE EXCEPTION 'the default VAT rate cannot be deactivated; make another rate the default first' USING ERRCODE = '23514'; END IF;
  UPDATE tax_vat_rates SET is_active = p_active, updated_at = now(), updated_by = app_user_id() WHERE id = p_id;
  PERFORM treasury_audit(NULL, CASE WHEN p_active THEN 'TAX_VAT_RATE_REACTIVATED' ELSE 'TAX_VAT_RATE_DEACTIVATED' END, 'TAX_VAT_RATE', p_id,
    jsonb_build_object('name', o.name, 'rate_percent', o.rate_percent, 'previous', jsonb_build_object('is_active', o.is_active), 'new', jsonb_build_object('is_active', p_active)));
END $$;

CREATE FUNCTION admin_vat_rate_set_default(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o tax_vat_rates; prev tax_vat_rates;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can change the tax settings' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM tax_vat_rates ORDER BY id FOR UPDATE;
  SELECT * INTO o FROM tax_vat_rates WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'VAT rate not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT o.is_active THEN RAISE EXCEPTION 'only an active VAT rate can be the default' USING ERRCODE = '23514'; END IF;
  IF o.is_default THEN RAISE EXCEPTION 'this VAT rate is already the default' USING ERRCODE = '23514'; END IF;
  SELECT * INTO prev FROM tax_vat_rates WHERE is_default;
  UPDATE tax_vat_rates SET is_default = false, updated_at = now(), updated_by = app_user_id() WHERE is_default;
  UPDATE tax_vat_rates SET is_default = true, updated_at = now(), updated_by = app_user_id() WHERE id = p_id;
  PERFORM treasury_audit(NULL, 'TAX_VAT_DEFAULT_CHANGED', 'TAX_VAT_RATE', p_id, jsonb_build_object(
    'previous', CASE WHEN prev.id IS NULL THEN NULL ELSE jsonb_build_object('id', prev.id, 'name', prev.name, 'rate_percent', prev.rate_percent) END,
    'new', jsonb_build_object('id', o.id, 'name', o.name, 'rate_percent', o.rate_percent)));
END $$;

CREATE FUNCTION admin_withholding_update(p_percent numeric, p_threshold numeric) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o tax_withholding_settings;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can change the tax settings' USING ERRCODE = '42501'; END IF;
  PERFORM tax_check_percent(p_percent, false);
  IF p_threshold IS NULL OR p_threshold < 0 THEN RAISE EXCEPTION 'enter the withholding threshold: the amount before VAT from which withholding can be applied (0 or more)' USING ERRCODE = '23514'; END IF;
  IF p_threshold <> round(p_threshold, 2) THEN RAISE EXCEPTION 'amounts have at most two decimal places' USING ERRCODE = '23514'; END IF;
  SELECT * INTO o FROM tax_withholding_settings FOR UPDATE;
  IF o.rate_percent = p_percent AND o.threshold_amount IS NOT DISTINCT FROM p_threshold THEN RAISE EXCEPTION 'nothing was changed' USING ERRCODE = '23514'; END IF;
  UPDATE tax_withholding_settings SET rate_percent = p_percent, threshold_amount = p_threshold, updated_at = now(), updated_by = app_user_id();
  PERFORM treasury_audit(NULL, 'TAX_WITHHOLDING_UPDATED', 'TAX_WITHHOLDING', NULL, jsonb_build_object(
    'previous', jsonb_build_object('rate_percent', o.rate_percent, 'threshold_amount', o.threshold_amount),
    'new', jsonb_build_object('rate_percent', p_percent, 'threshold_amount', p_threshold)));
END $$;

REVOKE EXECUTE ON FUNCTION tax_options(), admin_tax_settings(), admin_vat_rate_add(text, numeric), admin_vat_rate_update(uuid, text, numeric),
  admin_vat_rate_set_active(uuid, boolean), admin_vat_rate_set_default(uuid), admin_withholding_update(numeric, numeric), payment_request_tax_calc(),
  tax_check_percent(numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tax_options(), admin_tax_settings(), admin_vat_rate_add(text, numeric), admin_vat_rate_update(uuid, text, numeric),
  admin_vat_rate_set_active(uuid, boolean), admin_vat_rate_set_default(uuid), admin_withholding_update(numeric, numeric) TO abig_app;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Submitting: a draft cannot go forward with a VAT rate that was deactivated, and its installments have two decimals
-- ---------------------------------------------------------------------------------------------------------------------
-- Unchanged from 20261116000400 except the tax checks at the end.
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
    -- Bank details on a request are always the supplier's own verified and active ones: never an unrelated, unverified or deactivated account.
    PERFORM assert_supplier_destination(r);
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
  IF r.amount_input_mode IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM payment_installments WHERE request_id = p_request AND amount <> round(amount, 2)) THEN
      RAISE EXCEPTION 'installment amounts have at most two decimal places' USING ERRCODE = '23514';
    END IF;
    -- Only while it is still the creator's: a reviewer adjusting other fields of a submitted request is not stopped by a rate deactivated since.
    IF r.workflow_state IN ('DRAFT','SCHEDULED') AND NOT EXISTS (SELECT 1 FROM tax_vat_rates v WHERE v.id = r.vat_rate_id AND v.is_active) THEN
      RAISE EXCEPTION 'the VAT rate on this request (%) is no longer in use: edit the draft and choose an active VAT rate', r.vat_rate_name USING ERRCODE = '23514';
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. The reviewer's adjustment: tax inputs, recalculated with the request's own snapshot, every figure audited
-- ---------------------------------------------------------------------------------------------------------------------
-- Unchanged from 20261030000000 except:
--   * three more fields: entered_amount, vat_rate_id, withholding_applied (only on a request with a tax breakdown, whose total is then the
--     calculated net and cannot be set directly);
--   * the recalculated VAT, gross, withholding and net are written to adjustment_history next to the inputs;
--   * a request with one installment has it follow the new net; with several, the reviewer's installment amounts must add up to it.
CREATE OR REPLACE FUNCTION public.wf_adjust(p_request uuid, p_expected_version integer, p_changes jsonb, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r payment_requests; st text; stage text; role_name text; v int; corr uuid := gen_random_uuid(); k text;
  amount_changed boolean := false; payee_changed boolean := false; due_changed boolean := false; any_change boolean := false;
  el jsonb; inst payment_installments; new_amt numeric; new_due date; new_state text;
  n_total numeric; n_priority text; n_ref text; n_desc text; n_supplier uuid; n_bank uuid;
  taxed boolean; n_entered numeric; n_rate uuid; n_wht boolean; n_rate_pct numeric; n_rate_name text; f record; tax_changed boolean := false; n_inst int; n_seq int;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_changes) LOOP
    IF k NOT IN ('total_amount','priority','invoice_ref','description','supplier_id','supplier_bank_detail_id','installments','entered_amount','vat_rate_id','withholding_applied') THEN
      RAISE EXCEPTION 'field % cannot be adjusted', k USING ERRCODE = '23514';
    END IF;
  END LOOP;
  SELECT workflow_state INTO st FROM payment_requests WHERE id = p_request;
  stage := CASE st WHEN 'RESERVED' THEN 'VERIFICATION' WHEN 'VERIFIED' THEN 'AUTHORIZATION' END;
  IF stage IS NULL THEN RAISE EXCEPTION 'only a reserved or verified request can be adjusted' USING ERRCODE = '42501'; END IF;
  role_name := wf_assert_actor(p_request, stage);
  r := wf_lock(p_request, p_expected_version);
  v := r.version + 1; -- the single parent update below bumps the version once
  taxed := r.amount_input_mode IS NOT NULL;

  IF taxed AND p_changes ? 'total_amount' THEN
    RAISE EXCEPTION 'this request''s total is calculated from its tax breakdown: change the amount entered, the VAT rate or the withholding instead' USING ERRCODE = '23514';
  END IF;
  IF NOT taxed AND (p_changes ? 'entered_amount' OR p_changes ? 'vat_rate_id' OR p_changes ? 'withholding_applied') THEN
    RAISE EXCEPTION 'this request has no tax breakdown: it was created before tax configuration' USING ERRCODE = '23514';
  END IF;

  n_priority := COALESCE(p_changes->>'priority', r.priority);
  n_ref := COALESCE(p_changes->>'invoice_ref', r.invoice_ref);
  n_desc := COALESCE(p_changes->>'description', r.description);
  n_supplier := COALESCE((p_changes->>'supplier_id')::uuid, r.supplier_id);
  n_bank := COALESCE((p_changes->>'supplier_bank_detail_id')::uuid, r.supplier_bank_detail_id);
  IF taxed THEN
    n_entered := COALESCE((p_changes->>'entered_amount')::numeric, r.entered_amount);
    n_rate := COALESCE((p_changes->>'vat_rate_id')::uuid, r.vat_rate_id);
    n_wht := COALESCE((p_changes->>'withholding_applied')::boolean, r.withholding_applied);
    IF n_rate IS DISTINCT FROM r.vat_rate_id THEN
      SELECT name, rate_percent INTO n_rate_name, n_rate_pct FROM tax_vat_rates WHERE id = n_rate AND is_active;
      IF NOT FOUND THEN RAISE EXCEPTION 'choose an active VAT rate' USING ERRCODE = '23514'; END IF;
    ELSE n_rate_name := r.vat_rate_name; n_rate_pct := r.vat_rate_percent; END IF;
    -- The same calculation the trigger makes, with the request's own withholding snapshot: never the settings of today.
    f := tax_figures(r.amount_input_mode, n_entered, n_rate_pct, n_wht, r.withholding_rate_percent, r.withholding_threshold);
    n_total := f.net_amount;
    tax_changed := n_entered IS DISTINCT FROM r.entered_amount OR n_rate IS DISTINCT FROM r.vat_rate_id OR n_wht IS DISTINCT FROM r.withholding_applied;
  ELSE
    n_total := COALESCE((p_changes->>'total_amount')::numeric, r.total_amount);
  END IF;

  PERFORM set_config('app.wf', 'on', true);
  IF tax_changed THEN any_change := true;
    IF n_entered IS DISTINCT FROM r.entered_amount THEN
      INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
      VALUES (r.id, 'REQUEST', r.id, CASE r.amount_input_mode WHEN 'BEFORE_VAT' THEN 'entered_amount_before_vat' ELSE 'entered_amount_total' END, r.entered_amount::text, n_entered::text, p_reason, app_user_id(), role_name, stage, v, corr); END IF;
    IF n_rate IS DISTINCT FROM r.vat_rate_id THEN
      INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
      VALUES (r.id, 'REQUEST', r.id, 'vat_rate', r.vat_rate_name || ' (' || r.vat_rate_percent::text || '%)', n_rate_name || ' (' || n_rate_pct::text || '%)', p_reason, app_user_id(), role_name, stage, v, corr); END IF;
    IF n_wht IS DISTINCT FROM r.withholding_applied THEN
      INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
      VALUES (r.id, 'REQUEST', r.id, 'withholding_applied', CASE WHEN r.withholding_applied THEN 'yes' ELSE 'no' END, CASE WHEN n_wht THEN 'yes' ELSE 'no' END, p_reason, app_user_id(), role_name, stage, v, corr); END IF;
    INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
    SELECT r.id, 'REQUEST', r.id, x.field, x.o, x.n, p_reason, app_user_id(), role_name, stage, v, corr
      FROM (VALUES ('amount_before_vat', r.amount_before_vat::text, f.amount_before_vat::text), ('vat_amount', r.vat_amount::text, f.vat_amount::text),
                   ('gross_amount', r.gross_amount::text, f.gross_amount::text), ('withholding_amount', r.withholding_amount::text, f.withholding_amount::text)) AS x(field, o, n)
     WHERE x.o::numeric IS DISTINCT FROM x.n::numeric;
  END IF;
  IF n_total IS DISTINCT FROM r.total_amount THEN amount_changed := true; any_change := true;
    INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
    VALUES (r.id, 'REQUEST', r.id, 'total_amount', r.total_amount::text, n_total::text, p_reason, app_user_id(), role_name, stage, v, corr); END IF;
  IF n_supplier IS DISTINCT FROM r.supplier_id THEN payee_changed := true; any_change := true;
    INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
    VALUES (r.id, 'REQUEST', r.id, 'supplier_id', r.supplier_id::text, n_supplier::text, p_reason, app_user_id(), role_name, stage, v, corr); END IF;
  IF n_bank IS DISTINCT FROM r.supplier_bank_detail_id THEN payee_changed := true; any_change := true;
    INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
    VALUES (r.id, 'REQUEST', r.id, 'supplier_bank_detail_id', r.supplier_bank_detail_id::text, n_bank::text, p_reason, app_user_id(), role_name, stage, v, corr); END IF;
  IF n_priority IS DISTINCT FROM r.priority THEN any_change := true;
    INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
    VALUES (r.id, 'REQUEST', r.id, 'priority', r.priority, n_priority, p_reason, app_user_id(), role_name, stage, v, corr); END IF;
  IF n_ref IS DISTINCT FROM r.invoice_ref THEN any_change := true;
    INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
    VALUES (r.id, 'REQUEST', r.id, 'invoice_ref', r.invoice_ref, n_ref, p_reason, app_user_id(), role_name, stage, v, corr); END IF;
  IF n_desc IS DISTINCT FROM r.description THEN any_change := true;
    INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
    VALUES (r.id, 'REQUEST', r.id, 'description', r.description, n_desc, p_reason, app_user_id(), role_name, stage, v, corr); END IF;

  -- A single installment follows a recalculated net unless the reviewer gives its amount explicitly; with a new due date, or none, it still
  -- follows. An explicit amount is kept and must then equal the new net (assert_submittable below). With several installments, the reviewer
  -- divides the new net between them. Any refusal rolls back the whole adjustment: request, installments and history together.
  SELECT count(*), min(seq) INTO n_inst, n_seq FROM payment_installments WHERE request_id = p_request;
  IF taxed AND n_inst = 1 AND n_total IS DISTINCT FROM r.total_amount THEN
    IF NOT (p_changes ? 'installments') OR jsonb_typeof(p_changes->'installments') <> 'array' OR jsonb_array_length(p_changes->'installments') = 0 THEN
      p_changes := p_changes || jsonb_build_object('installments', jsonb_build_array(jsonb_build_object('seq', n_seq, 'amount', n_total)));
    ELSE
      p_changes := jsonb_set(p_changes, '{installments}', (
        SELECT jsonb_agg(CASE WHEN (e->>'seq')::int = n_seq AND (NOT (e ? 'amount') OR jsonb_typeof(e->'amount') = 'null') THEN e || jsonb_build_object('amount', n_total) ELSE e END ORDER BY o)
          FROM jsonb_array_elements(p_changes->'installments') WITH ORDINALITY AS x(e, o)));
    END IF;
  END IF;
  IF p_changes ? 'installments' THEN
    FOR el IN SELECT * FROM jsonb_array_elements(p_changes->'installments') LOOP
      SELECT * INTO inst FROM payment_installments WHERE request_id = p_request AND seq = (el->>'seq')::int FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'installment % does not exist', el->>'seq' USING ERRCODE = '23514'; END IF;
      new_amt := COALESCE((el->>'amount')::numeric, inst.amount);
      new_due := COALESCE((el->>'due_date')::date, inst.due_date);
      IF taxed AND new_amt <> round(new_amt, 2) THEN RAISE EXCEPTION 'installment amounts have at most two decimal places' USING ERRCODE = '23514'; END IF;
      IF new_amt IS DISTINCT FROM inst.amount THEN amount_changed := true; any_change := true;
        INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
        VALUES (r.id, 'INSTALLMENT', inst.id, 'amount', inst.amount::text, new_amt::text, p_reason, app_user_id(), role_name, stage, v, corr); END IF;
      IF new_due IS DISTINCT FROM inst.due_date THEN due_changed := true; any_change := true;
        INSERT INTO adjustment_history (request_id, entity_type, entity_id, field, old_value, new_value, reason, actor_id, actor_role, workflow_stage, request_version, correlation_id)
        VALUES (r.id, 'INSTALLMENT', inst.id, 'due_date', inst.due_date::text, new_due::text, p_reason, app_user_id(), role_name, stage, v, corr); END IF;
      UPDATE payment_installments SET amount = new_amt, due_date = new_due WHERE id = inst.id;
    END LOOP;
  END IF;
  IF NOT any_change THEN RAISE EXCEPTION 'nothing was changed' USING ERRCODE = '23514'; END IF;

  new_state := CASE WHEN (amount_changed OR payee_changed OR tax_changed) THEN 'RESERVED' ELSE st END;
  IF taxed THEN
    PERFORM set_config('app.tax_adjust', 'on', true);
    UPDATE payment_requests SET entered_amount = n_entered, vat_rate_id = n_rate, withholding_applied = n_wht, priority = n_priority, invoice_ref = n_ref, description = n_desc,
           supplier_id = n_supplier, supplier_bank_detail_id = n_bank, workflow_state = new_state::payment_request_status,
           verified_by = CASE WHEN new_state <> st THEN NULL ELSE verified_by END, verified_at = CASE WHEN new_state <> st THEN NULL ELSE verified_at END
     WHERE id = p_request;   -- the tax trigger sets the snapshot, the figures and total_amount (the net), the same values as f above
    PERFORM set_config('app.tax_adjust', 'off', true);
  ELSE
    UPDATE payment_requests SET total_amount = n_total, priority = n_priority, invoice_ref = n_ref, description = n_desc,
           supplier_id = n_supplier, supplier_bank_detail_id = n_bank, workflow_state = new_state::payment_request_status,
           -- a change that restarts the approval wipes the verification that no longer applies
           verified_by = CASE WHEN new_state <> st THEN NULL ELSE verified_by END, verified_at = CASE WHEN new_state <> st THEN NULL ELSE verified_at END
     WHERE id = p_request;
  END IF;
  PERFORM set_config('app.wf', 'off', true);
  PERFORM assert_submittable(p_request); -- totals add up, bank details verified for the (new) supplier, supplier active
  -- A new amount is re-checked against the account's available balance and the reservation is resized by the funds guard
  -- (it runs inside the UPDATE above), so an adjustment that cannot be funded is refused as a whole.

  PERFORM wf_log(p_request, v, stage, 'ADJUST', role_name, p_reason, corr);
  IF st = 'VERIFIED' AND new_state = 'RESERVED' THEN
    PERFORM wf_log(p_request, v, stage, 'INVALIDATE', role_name, 'amount or payee changed: restart at verification', corr);
  END IF;
  IF new_state = 'RESERVED' AND (amount_changed OR payee_changed OR tax_changed) THEN PERFORM wf_notify(p_request, 'REQUEST_RESTARTED', jsonb_build_object('reason', p_reason));
  ELSIF due_changed THEN PERFORM wf_notify(p_request, 'REQUEST_RESCHEDULE_NEEDED', jsonb_build_object('reason', p_reason));
  ELSE PERFORM wf_notify(p_request, 'REQUEST_ADJUSTED', jsonb_build_object('reason', p_reason)); END IF;
  RETURN v;
END $function$;
