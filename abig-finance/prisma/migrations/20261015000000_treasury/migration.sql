-- ABIG Finance - Phase 4: treasury core.
-- Policy defaults from blueprint section 2 are stored in treasury_settings and per account. Finance/Treasury must sign them off before go-live.
-- All money-moving writes go through the treasury_* functions; the app role has no INSERT/UPDATE on these tables.

CREATE TABLE treasury_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),                 -- single row
  stale_warn_hours int NOT NULL DEFAULT 24 CHECK (stale_warn_hours > 0),
  stale_block_hours int NOT NULL DEFAULT 72,
  allow_split_funding boolean NOT NULL DEFAULT false,            -- false: one funding account per installment
  CHECK (stale_block_hours >= stale_warn_hours)
);
INSERT INTO treasury_settings DEFAULT VALUES;

CREATE TABLE payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installment_id uuid NOT NULL REFERENCES payment_installments(id),
  account_id uuid NOT NULL REFERENCES company_bank_accounts(id),
  reservation_id uuid,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL DEFAULT 'ETB' CHECK (currency = 'ETB'),
  paid_at timestamptz NOT NULL,
  reference text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (account_id, reference)                                  -- the same bank reference cannot be recorded twice
);
CREATE INDEX payment_transactions_installment_idx ON payment_transactions (installment_id);

CREATE TABLE cash_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES company_bank_accounts(id),
  effective_at timestamptz NOT NULL,
  amount numeric(19,4) NOT NULL CHECK (amount <> 0),            -- signed: money out is negative
  currency char(3) NOT NULL DEFAULT 'ETB' CHECK (currency = 'ETB'),
  entry_type text NOT NULL CHECK (entry_type IN ('PAYMENT','REVERSAL','MANUAL')),
  payment_id uuid REFERENCES payment_transactions(id),
  reversal_of uuid UNIQUE REFERENCES cash_ledger_entries(id),
  description text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((entry_type = 'PAYMENT' AND amount < 0 AND payment_id IS NOT NULL)
      OR (entry_type = 'REVERSAL' AND amount > 0 AND reversal_of IS NOT NULL AND payment_id IS NOT NULL)
      OR (entry_type = 'MANUAL' AND payment_id IS NULL AND coalesce(btrim(description), '') <> ''))
);
CREATE INDEX cash_ledger_account_time_idx ON cash_ledger_entries (account_id, effective_at);

CREATE TABLE payment_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES payment_transactions(id), -- the original stays; one reversal each
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  reversed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE cash_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installment_id uuid NOT NULL REFERENCES payment_installments(id),
  account_id uuid NOT NULL REFERENCES company_bank_accounts(id),
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  consumed_amount numeric(19,4) NOT NULL DEFAULT 0 CHECK (consumed_amount >= 0 AND consumed_amount <= amount),
  currency char(3) NOT NULL DEFAULT 'ETB' CHECK (currency = 'ETB'),
  planned_date date NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CONSUMED','RELEASED')),
  override_reason text,                                           -- set when a stale-balance override was used
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  close_reason text
);
CREATE UNIQUE INDEX cash_reservations_one_active ON cash_reservations (installment_id, account_id) WHERE status = 'ACTIVE';
CREATE INDEX cash_reservations_account_idx ON cash_reservations (account_id) WHERE status = 'ACTIVE';
ALTER TABLE payment_transactions ADD FOREIGN KEY (reservation_id) REFERENCES cash_reservations(id);

CREATE TABLE idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

-- Only used when an account has owner_approval_required and the paying company is not the owner.
CREATE TABLE account_use_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES company_bank_accounts(id),
  installment_id uuid NOT NULL REFERENCES payment_installments(id),
  approved_by uuid NOT NULL REFERENCES users(id),
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  revoke_reason text
);
CREATE UNIQUE INDEX account_use_one_active ON account_use_approvals (account_id, installment_id) WHERE revoked_at IS NULL;

CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON payment_transactions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER payments_no_truncate BEFORE TRUNCATE ON payment_transactions FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON cash_ledger_entries FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_no_truncate BEFORE TRUNCATE ON cash_ledger_entries FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER reversals_append_only BEFORE UPDATE OR DELETE ON payment_reversals FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER reversals_no_truncate BEFORE TRUNCATE ON payment_reversals FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER reservations_no_delete BEFORE DELETE ON cash_reservations FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER reservations_no_truncate BEFORE TRUNCATE ON cash_reservations FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER approvals_no_delete BEFORE DELETE ON account_use_approvals FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER idempotency_no_delete BEFORE DELETE ON idempotency_keys FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------- Calculation ----------
CREATE TYPE cash_position AS (
  account_id uuid, snapshot_balance numeric, snapshot_as_of timestamptz, movements_after numeric, estimated_balance numeric,
  active_reserved numeric, min_buffer numeric, available numeric, snapshot_age_hours numeric, freshness text, provisional boolean);

-- Estimated balance = latest ACCEPTED snapshot + ledger movements STRICTLY AFTER the snapshot time.
-- Available = estimated - active reservations - minimum buffer. Without a snapshot nothing is available.
-- provisional = a newer, unaccepted snapshot exists.
CREATE FUNCTION _cash_position(p_account uuid) RETURNS SETOF cash_position LANGUAGE sql STABLE ROWS 1 SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH a AS (SELECT id, min_buffer FROM company_bank_accounts WHERE id = p_account),
  s AS (SELECT balance, as_of FROM bank_balance_snapshots WHERE account_id = p_account AND status = 'ACCEPTED' ORDER BY as_of DESC LIMIT 1),
  m AS (SELECT COALESCE(sum(l.amount), 0) AS amt FROM cash_ledger_entries l, s WHERE l.account_id = p_account AND l.effective_at > s.as_of),
  r AS (SELECT COALESCE(sum(amount - consumed_amount), 0) AS amt FROM cash_reservations WHERE account_id = p_account AND status = 'ACTIVE'),
  t AS (SELECT * FROM treasury_settings)
  SELECT a.id, s.balance, s.as_of, m.amt, COALESCE(s.balance, 0) + m.amt, r.amt, a.min_buffer,
         CASE WHEN s.as_of IS NULL THEN 0 ELSE s.balance + m.amt - r.amt - a.min_buffer END,
         round((extract(epoch FROM (now() - s.as_of)) / 3600)::numeric, 2),
         CASE WHEN s.as_of IS NULL THEN 'NONE'
              WHEN now() - s.as_of > t.stale_block_hours * interval '1 hour' THEN 'BLOCK'
              WHEN now() - s.as_of > t.stale_warn_hours * interval '1 hour' THEN 'WARN' ELSE 'OK' END,
         EXISTS (SELECT 1 FROM bank_balance_snapshots p WHERE p.account_id = p_account AND p.status = 'PROVISIONAL' AND (s.as_of IS NULL OR p.as_of > s.as_of))
  FROM a LEFT JOIN s ON true CROSS JOIN m CROSS JOIN r CROSS JOIN t $$;

-- Anyone who may see the account sees the same single position (shared accounts are counted once).
CREATE FUNCTION account_cash_position(p_account uuid) RETURNS SETOF cash_position LANGUAGE sql STABLE ROWS 1 SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT * FROM _cash_position(p_account) WHERE app_can_see_account(p_account) $$;

CREATE FUNCTION installment_outstanding(p_installment uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT i.amount - COALESCE((SELECT sum(p.amount) FROM payment_transactions p WHERE p.installment_id = i.id
          AND NOT EXISTS (SELECT 1 FROM payment_reversals x WHERE x.payment_id = p.id)), 0)
      FROM payment_installments i WHERE i.id = p_installment $$;

CREATE FUNCTION installment_balances(p_request uuid) RETURNS TABLE (installment_id uuid, seq int, due_date date, amount numeric, paid numeric, outstanding numeric, reserved numeric)
LANGUAGE sql STABLE ROWS 10 SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, i.seq, i.due_date, i.amount, i.amount - installment_outstanding(i.id), installment_outstanding(i.id),
         COALESCE((SELECT sum(c.amount - c.consumed_amount) FROM cash_reservations c WHERE c.installment_id = i.id AND c.status = 'ACTIVE'), 0)
  FROM payment_installments i WHERE i.request_id = p_request AND app_can_see_request(p_request) ORDER BY i.seq $$;

-- Derived summary: PAID only when every installment is settled.
CREATE FUNCTION request_payment_status(p_request uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN count(*) = 0 THEN NULL WHEN bool_and(installment_outstanding(i.id) = 0) THEN 'PAID'
              WHEN bool_or(installment_outstanding(i.id) < i.amount) THEN 'PARTIALLY_PAID' ELSE 'UNPAID' END
  FROM payment_installments i WHERE i.request_id = p_request AND app_can_see_request(p_request) $$;

-- ---------- Helpers ----------
CREATE FUNCTION treasury_audit(p_company uuid, p_action text, p_entity_type text, p_entity uuid, p_meta jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ INSERT INTO audit_events (actor_id, company_id, action, entity_type, entity_id, metadata) VALUES (app_user_id(), p_company, p_action, p_entity_type, p_entity, p_meta) $$;

-- The acting person must hold TREASURY in the debtor company, and the request must be authorized.
CREATE FUNCTION treasury_context(p_installment uuid) RETURNS payment_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests;
BEGIN
  IF app_user_id() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT q.* INTO r FROM payment_installments i JOIN payment_requests q ON q.id = i.request_id WHERE i.id = p_installment;
  IF NOT FOUND OR NOT app_can_see_request(r.id) THEN RAISE EXCEPTION 'installment not found' USING ERRCODE = 'P0002'; END IF;
  IF r.debtor_company_id NOT IN (SELECT app_member_companies('TREASURY')) THEN RAISE EXCEPTION 'you do not hold the TREASURY role for this company' USING ERRCODE = '42501'; END IF;
  IF r.workflow_state <> 'AUTHORIZED' THEN RAISE EXCEPTION 'only an authorized request can be funded or paid' USING ERRCODE = '42501'; END IF;
  RETURN r;
END $$;

-- The paying company must be the owner or hold a USE grant; if the account needs owner approval, that approval must exist.
CREATE FUNCTION assert_account_use(p_account uuid, p_installment uuid, p_company uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a company_bank_accounts;
BEGIN
  SELECT * INTO a FROM company_bank_accounts WHERE id = p_account;
  IF NOT FOUND OR NOT a.is_active THEN RAISE EXCEPTION 'the account is not available' USING ERRCODE = '42501'; END IF;
  IF a.owner_company_id <> p_company AND NOT (p_company IN (SELECT app_granted_companies(p_account, 'USE'))) THEN
    RAISE EXCEPTION 'your company has no access to this account' USING ERRCODE = '42501';
  END IF;
  IF a.owner_approval_required AND a.owner_company_id <> p_company AND NOT EXISTS
     (SELECT 1 FROM account_use_approvals x WHERE x.account_id = p_account AND x.installment_id = p_installment AND x.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'the account owner must approve this use first' USING ERRCODE = '42501';
  END IF;
END $$;

-- ---------- Reservation integrity (enforced for every insert, whoever makes it) ----------
CREATE FUNCTION reservation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pos cash_position; outstanding numeric; reserved_inst numeric; other int; split boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ACTIVE' OR NEW.consumed_amount <> 0 THEN RAISE EXCEPTION 'a new reservation must be active and unconsumed' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM company_bank_accounts WHERE id = NEW.account_id AND is_active FOR UPDATE; -- one pool per account: serialize here
    IF NOT FOUND THEN RAISE EXCEPTION 'the account is not available' USING ERRCODE = '23514'; END IF;
    outstanding := installment_outstanding(NEW.installment_id);
    SELECT COALESCE(sum(amount - consumed_amount), 0), count(*) INTO reserved_inst, other FROM cash_reservations WHERE installment_id = NEW.installment_id AND status = 'ACTIVE';
    SELECT allow_split_funding INTO split FROM treasury_settings;
    IF NOT split AND other > 0 THEN RAISE EXCEPTION 'this installment already has an active reservation (split funding is not enabled)' USING ERRCODE = '23514'; END IF;
    IF NEW.amount > outstanding - reserved_inst THEN
      RAISE EXCEPTION 'the amount exceeds what is still unreserved on this installment (%)', outstanding - reserved_inst USING ERRCODE = '23514';
    END IF;
    IF NOT split AND NEW.amount <> outstanding THEN RAISE EXCEPTION 'reserve the full outstanding amount (%) from one account', outstanding USING ERRCODE = '23514'; END IF;
    SELECT * INTO pos FROM _cash_position(NEW.account_id);
    IF NEW.amount > pos.available THEN
      RAISE EXCEPTION 'shortfall: % available on this account, % needed', pos.available, NEW.amount USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'consumed_amount' - 'closed_at' - 'close_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'consumed_amount' - 'closed_at' - 'close_reason') THEN
    RAISE EXCEPTION 'a reservation cannot be edited; release it and make a new one' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'ACTIVE' THEN RAISE EXCEPTION 'a closed reservation cannot change' USING ERRCODE = '42501'; END IF;
  IF NEW.consumed_amount < OLD.consumed_amount THEN RAISE EXCEPTION 'consumption cannot be undone' USING ERRCODE = '42501'; END IF;
  IF NEW.status = 'RELEASED' AND coalesce(btrim(NEW.close_reason), '') = '' THEN RAISE EXCEPTION 'a release needs a reason' USING ERRCODE = '23514'; END IF;
  IF NEW.status = 'CONSUMED' AND NEW.consumed_amount <> NEW.amount THEN RAISE EXCEPTION 'only a fully consumed reservation can be marked consumed' USING ERRCODE = '23514'; END IF;
  IF NEW.status = 'ACTIVE' AND NEW.consumed_amount >= NEW.amount THEN RAISE EXCEPTION 'a fully consumed reservation must be marked consumed' USING ERRCODE = '23514'; END IF;
  IF NEW.status <> 'ACTIVE' AND NEW.closed_at IS NULL THEN NEW.closed_at := now(); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cash_reservations_guard BEFORE INSERT OR UPDATE ON cash_reservations FOR EACH ROW EXECUTE FUNCTION reservation_guard();

-- Revoking a company's access releases that company's active reservations on the account (history is kept).
CREATE FUNCTION access_revoked_release() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE cash_reservations c SET status = 'RELEASED', close_reason = 'account access revoked', closed_at = now()
  FROM payment_installments i JOIN payment_requests r ON r.id = i.request_id
  WHERE c.installment_id = i.id AND c.account_id = NEW.account_id AND c.status = 'ACTIVE' AND r.debtor_company_id = NEW.company_id;
  RETURN NULL;
END $$;
CREATE TRIGGER account_access_release AFTER UPDATE ON company_bank_account_access FOR EACH ROW
  WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL) EXECUTE FUNCTION access_revoked_release();

CREATE FUNCTION snapshot_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO audit_events (actor_id, company_id, action, entity_type, entity_id, metadata)
  SELECT NEW.entered_by, a.owner_company_id, 'BALANCE_SNAPSHOT_RECORDED', 'BANK_ACCOUNT', a.id,
         jsonb_build_object('as_of', NEW.as_of, 'balance', NEW.balance, 'status', NEW.status) FROM company_bank_accounts a WHERE a.id = NEW.account_id;
  RETURN NULL;
END $$;
CREATE TRIGGER bank_balance_snapshots_audit AFTER INSERT ON bank_balance_snapshots FOR EACH ROW EXECUTE FUNCTION snapshot_audit();

-- ---------- Treasury actions ----------
-- Confirms funding for one installment: date + account + amount. Rechecks access, owner approval, balance freshness and available cash.
CREATE FUNCTION treasury_reserve(p_installment uuid, p_account uuid, p_amount numeric, p_planned_date date, p_override_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; pos cash_position; warning text; ov text; rid uuid;
BEGIN
  r := treasury_context(p_installment);
  PERFORM assert_account_use(p_account, p_installment, r.debtor_company_id);
  PERFORM 1 FROM payment_installments WHERE id = p_installment FOR UPDATE;   -- lock order: installment, then account
  PERFORM 1 FROM company_bank_accounts WHERE id = p_account FOR UPDATE;
  SELECT * INTO pos FROM _cash_position(p_account);
  IF pos.freshness = 'NONE' THEN RAISE EXCEPTION 'this account has no balance snapshot yet' USING ERRCODE = '23514'; END IF;
  IF pos.freshness = 'BLOCK' THEN
    IF length(btrim(coalesce(p_override_reason, ''))) < 3 THEN
      RAISE EXCEPTION 'the balance is % hours old; record a new snapshot or give an override reason', pos.snapshot_age_hours USING ERRCODE = '23514';
    END IF;
    ov := p_override_reason; warning := format('stale balance override: %s hours old', pos.snapshot_age_hours);
  ELSIF pos.freshness = 'WARN' THEN warning := format('the balance is %s hours old', pos.snapshot_age_hours); END IF;
  INSERT INTO cash_reservations (installment_id, account_id, amount, planned_date, override_reason, created_by)
  VALUES (p_installment, p_account, p_amount, p_planned_date, ov, app_user_id()) RETURNING id INTO rid;
  PERFORM treasury_audit(r.debtor_company_id, CASE WHEN ov IS NULL THEN 'CASH_RESERVED' ELSE 'CASH_RESERVED_STALE_OVERRIDE' END, 'CASH_RESERVATION', rid,
         jsonb_build_object('installment', p_installment, 'account', p_account, 'amount', p_amount, 'planned_date', p_planned_date, 'override_reason', ov));
  RETURN jsonb_build_object('reservation_id', rid, 'warning', warning, 'available_after', pos.available - p_amount);
END $$;

CREATE FUNCTION treasury_release(p_reservation uuid, p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c cash_reservations; r payment_requests;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  SELECT * INTO c FROM cash_reservations WHERE id = p_reservation;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation not found' USING ERRCODE = 'P0002'; END IF;
  SELECT q.* INTO r FROM payment_installments i JOIN payment_requests q ON q.id = i.request_id WHERE i.id = c.installment_id;
  IF NOT app_can_see_request(r.id) THEN RAISE EXCEPTION 'reservation not found' USING ERRCODE = 'P0002'; END IF;
  IF r.debtor_company_id NOT IN (SELECT app_member_companies('TREASURY')) THEN RAISE EXCEPTION 'you do not hold the TREASURY role for this company' USING ERRCODE = '42501'; END IF;
  UPDATE cash_reservations SET status = 'RELEASED', close_reason = p_reason, closed_at = now() WHERE id = p_reservation;
  PERFORM treasury_audit(r.debtor_company_id, 'CASH_RELEASED', 'CASH_RESERVATION', p_reservation, jsonb_build_object('reason', p_reason, 'amount', c.amount - c.consumed_amount));
END $$;

-- Records an actual payment: transaction + ledger movement + reservation consumption in one transaction.
-- Safe to retry with the same idempotency key (same payload returns the first result; different payload is refused).
CREATE FUNCTION treasury_record_payment(p_installment uuid, p_account uuid, p_amount numeric, p_paid_at timestamptz, p_reference text, p_idem_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; v_scope text := app_user_id()::text; h text; n int; k idempotency_keys; res cash_reservations; pid uuid; lid uuid;
        consumed numeric := 0; outstanding numeric; v_result jsonb;
BEGIN
  IF app_user_id() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF length(coalesce(p_idem_key, '')) < 8 THEN RAISE EXCEPTION 'an idempotency key of at least 8 characters is required' USING ERRCODE = '23514'; END IF;
  h := md5(concat_ws('|', p_installment, p_account, p_amount::text, p_paid_at::text, coalesce(p_reference, '')));
  INSERT INTO idempotency_keys (scope, key, request_hash) VALUES (v_scope, p_idem_key, h) ON CONFLICT (scope, key) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN -- a concurrent duplicate waits here until the first call commits
    SELECT * INTO k FROM idempotency_keys WHERE idempotency_keys.scope = v_scope AND idempotency_keys.key = p_idem_key;
    IF k.request_hash <> h THEN RAISE EXCEPTION 'this idempotency key was already used with a different request' USING ERRCODE = '22023'; END IF;
    RETURN k.result || jsonb_build_object('replayed', true);
  END IF;

  r := treasury_context(p_installment);
  PERFORM assert_account_use(p_account, p_installment, r.debtor_company_id);
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'the amount must be above zero' USING ERRCODE = '23514'; END IF;
  IF p_paid_at > now() + interval '1 minute' THEN RAISE EXCEPTION 'a payment cannot be dated in the future' USING ERRCODE = '23514'; END IF;
  PERFORM 1 FROM payment_installments WHERE id = p_installment FOR UPDATE;
  PERFORM 1 FROM company_bank_accounts WHERE id = p_account FOR UPDATE;
  outstanding := installment_outstanding(p_installment);
  IF p_amount > outstanding THEN RAISE EXCEPTION 'the payment (%) is more than the outstanding amount (%)', p_amount, outstanding USING ERRCODE = '23514'; END IF;

  SELECT * INTO res FROM cash_reservations WHERE installment_id = p_installment AND account_id = p_account AND status = 'ACTIVE' FOR UPDATE;
  IF FOUND THEN consumed := LEAST(p_amount, res.amount - res.consumed_amount); END IF;

  INSERT INTO payment_transactions (installment_id, account_id, reservation_id, amount, paid_at, reference, created_by)
  VALUES (p_installment, p_account, res.id, p_amount, p_paid_at, nullif(btrim(p_reference), ''), app_user_id()) RETURNING id INTO pid;
  INSERT INTO cash_ledger_entries (account_id, effective_at, amount, entry_type, payment_id, description, created_by)
  VALUES (p_account, p_paid_at, -p_amount, 'PAYMENT', pid, 'Payment for ' || r.request_no, app_user_id()) RETURNING id INTO lid;
  IF consumed > 0 THEN
    UPDATE cash_reservations SET consumed_amount = consumed_amount + consumed,
           status = CASE WHEN consumed_amount + consumed >= amount THEN 'CONSUMED' ELSE 'ACTIVE' END WHERE id = res.id;
  END IF;
  PERFORM treasury_audit(r.debtor_company_id, 'PAYMENT_RECORDED', 'PAYMENT', pid,
          jsonb_build_object('installment', p_installment, 'account', p_account, 'amount', p_amount, 'reference', p_reference));
  v_result := jsonb_build_object('payment_id', pid, 'ledger_entry_id', lid, 'outstanding', outstanding - p_amount,
            'unreserved_amount', p_amount - consumed, 'request_status', request_payment_status(r.id), 'replayed', false);
  UPDATE idempotency_keys i SET result = v_result WHERE i.scope = v_scope AND i.key = p_idem_key;
  RETURN v_result;
END $$;

-- Compensating entry: the original payment and ledger movement stay; outstanding is recalculated. A consumed reservation is not revived.
CREATE FUNCTION treasury_reverse_payment(p_payment uuid, p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p payment_transactions; r payment_requests; orig uuid; lid uuid;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  IF app_user_id() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM payment_transactions WHERE id = p_payment;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment not found' USING ERRCODE = 'P0002'; END IF;
  SELECT q.* INTO r FROM payment_installments i JOIN payment_requests q ON q.id = i.request_id WHERE i.id = p.installment_id;
  IF NOT app_can_see_request(r.id) THEN RAISE EXCEPTION 'payment not found' USING ERRCODE = 'P0002'; END IF;
  IF r.debtor_company_id NOT IN (SELECT app_member_companies('TREASURY')) THEN RAISE EXCEPTION 'you do not hold the TREASURY role for this company' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM payment_installments WHERE id = p.installment_id FOR UPDATE;
  PERFORM 1 FROM company_bank_accounts WHERE id = p.account_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM payment_reversals WHERE payment_id = p_payment) THEN RAISE EXCEPTION 'this payment was already reversed' USING ERRCODE = '23505'; END IF;
  SELECT id INTO orig FROM cash_ledger_entries WHERE payment_id = p_payment AND entry_type = 'PAYMENT';
  INSERT INTO payment_reversals (payment_id, reason, reversed_by) VALUES (p_payment, p_reason, app_user_id());
  INSERT INTO cash_ledger_entries (account_id, effective_at, amount, entry_type, payment_id, reversal_of, description, created_by)
  VALUES (p.account_id, clock_timestamp(), p.amount, 'REVERSAL', p_payment, orig, 'Reversal: ' || p_reason, app_user_id()) RETURNING id INTO lid;
  PERFORM treasury_audit(r.debtor_company_id, 'PAYMENT_REVERSED', 'PAYMENT', p_payment, jsonb_build_object('reason', p_reason, 'amount', p.amount));
  RETURN jsonb_build_object('ledger_entry_id', lid, 'outstanding', installment_outstanding(p.installment_id), 'request_status', request_payment_status(r.id));
END $$;

-- Bank charges, receipts and other movements that are not request payments. Needs a reason.
CREATE FUNCTION treasury_manual_movement(p_account uuid, p_amount numeric, p_effective_at timestamptz, p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE lid uuid;
BEGIN
  IF app_user_id() IS NULL OR NOT app_can_snapshot(p_account) THEN RAISE EXCEPTION 'you may not record cash movements on this account' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  IF p_amount IS NULL OR p_amount = 0 THEN RAISE EXCEPTION 'the amount cannot be zero' USING ERRCODE = '23514'; END IF;
  IF p_effective_at > now() + interval '1 minute' THEN RAISE EXCEPTION 'a movement cannot be dated in the future' USING ERRCODE = '23514'; END IF;
  PERFORM 1 FROM company_bank_accounts WHERE id = p_account FOR UPDATE;
  INSERT INTO cash_ledger_entries (account_id, effective_at, amount, entry_type, description, created_by)
  VALUES (p_account, p_effective_at, p_amount, 'MANUAL', p_reason, app_user_id()) RETURNING id INTO lid;
  PERFORM treasury_audit((SELECT owner_company_id FROM company_bank_accounts WHERE id = p_account), 'CASH_MOVEMENT_RECORDED', 'BANK_ACCOUNT', p_account,
         jsonb_build_object('amount', p_amount, 'effective_at', p_effective_at, 'reason', p_reason));
  RETURN lid;
END $$;

-- ---------- Accounts and owner approval ----------
CREATE FUNCTION register_bank_account(p_owner uuid, p_bank text, p_label text, p_last4 text, p_enc bytea, p_buffer numeric, p_owner_approval boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF app_user_id() IS NULL OR p_owner NOT IN (SELECT app_member_companies('ACCOUNT_OWNER')) THEN RAISE EXCEPTION 'you may not register accounts for this company' USING ERRCODE = '42501'; END IF;
  INSERT INTO company_bank_accounts (owner_company_id, bank_name, account_label, account_last4, account_number_enc, min_buffer, owner_approval_required)
  VALUES (p_owner, p_bank, p_label, p_last4, p_enc, COALESCE(p_buffer, 0), COALESCE(p_owner_approval, false)) RETURNING company_bank_accounts.id INTO v_id;
  PERFORM treasury_audit(p_owner, 'BANK_ACCOUNT_REGISTERED', 'BANK_ACCOUNT', v_id, jsonb_build_object('bank', p_bank, 'label', p_label));
  RETURN v_id;
END $$;

CREATE FUNCTION set_account_policy(p_account uuid, p_buffer numeric, p_owner_approval boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_user_id() IS NULL OR NOT app_can_manage_access(p_account) THEN RAISE EXCEPTION 'only the account owner can change account policy' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM company_bank_accounts WHERE id = p_account FOR UPDATE;
  UPDATE company_bank_accounts SET min_buffer = COALESCE(p_buffer, min_buffer), owner_approval_required = COALESCE(p_owner_approval, owner_approval_required) WHERE id = p_account;
  PERFORM treasury_audit((SELECT owner_company_id FROM company_bank_accounts WHERE id = p_account), 'BANK_ACCOUNT_POLICY_CHANGED', 'BANK_ACCOUNT', p_account,
         jsonb_build_object('min_buffer', p_buffer, 'owner_approval_required', p_owner_approval));
END $$;

CREATE FUNCTION owner_approve_account_use(p_installment uuid, p_account uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF app_user_id() IS NULL OR NOT app_can_manage_access(p_account) THEN RAISE EXCEPTION 'only the account owner can approve use of this account' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM payment_installments i JOIN payment_requests r ON r.id = i.request_id WHERE i.id = p_installment AND r.workflow_state = 'AUTHORIZED') THEN
    RAISE EXCEPTION 'only an installment of an authorized request can be approved' USING ERRCODE = '42501';
  END IF;
  INSERT INTO account_use_approvals (account_id, installment_id, approved_by) VALUES (p_account, p_installment, app_user_id()) RETURNING account_use_approvals.id INTO v_id;
  PERFORM treasury_audit((SELECT owner_company_id FROM company_bank_accounts WHERE id = p_account), 'ACCOUNT_USE_APPROVED', 'ACCOUNT_USE_APPROVAL', v_id, jsonb_build_object('installment', p_installment));
  RETURN v_id;
END $$;

CREATE FUNCTION owner_revoke_account_use(p_approval uuid, p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a account_use_approvals;
BEGIN
  SELECT * INTO a FROM account_use_approvals WHERE id = p_approval;
  IF NOT FOUND OR app_user_id() IS NULL OR NOT app_can_manage_access(a.account_id) THEN RAISE EXCEPTION 'approval not found' USING ERRCODE = 'P0002'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  UPDATE account_use_approvals SET revoked_at = now(), revoked_by = app_user_id(), revoke_reason = p_reason WHERE id = p_approval AND revoked_at IS NULL;
END $$;

-- Worker job: release active reservations whose account was deactivated or whose company lost (or let expire) its access.
CREATE FUNCTION treasury_release_orphaned() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  UPDATE cash_reservations c SET status = 'RELEASED', close_reason = 'account no longer usable by the paying company', closed_at = now()
  FROM payment_installments i JOIN payment_requests r ON r.id = i.request_id, company_bank_accounts a
  WHERE c.installment_id = i.id AND a.id = c.account_id AND c.status = 'ACTIVE'
    AND (NOT a.is_active OR (a.owner_company_id <> r.debtor_company_id AND NOT EXISTS
         (SELECT 1 FROM company_bank_account_access g WHERE g.account_id = a.id AND g.company_id = r.debtor_company_id AND g.revoked_at IS NULL
            AND g.valid_from <= now() AND (g.valid_to IS NULL OR g.valid_to > now()) AND 'USE' = ANY (g.permissions))));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ---------- Visibility ----------
CREATE FUNCTION app_can_see_funding(p_installment uuid, p_account uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM payment_installments i WHERE i.id = p_installment AND app_can_see_request(i.request_id))
          OR EXISTS (SELECT 1 FROM company_bank_accounts a WHERE a.id = p_account AND a.owner_company_id IN (SELECT app_readable_companies())) $$;

ALTER TABLE cash_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_use_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY; -- no policy: not visible to the app role

CREATE POLICY ledger_read ON cash_ledger_entries FOR SELECT TO abig_app USING (app_can_see_account(account_id));
CREATE POLICY reservations_read ON cash_reservations FOR SELECT TO abig_app USING (app_can_see_account(account_id) AND app_can_see_funding(installment_id, account_id));
CREATE POLICY payments_read ON payment_transactions FOR SELECT TO abig_app USING (app_can_see_account(account_id) AND app_can_see_funding(installment_id, account_id));
CREATE POLICY reversals_read ON payment_reversals FOR SELECT TO abig_app
  USING (EXISTS (SELECT 1 FROM payment_transactions p WHERE p.id = payment_id AND app_can_see_account(p.account_id) AND app_can_see_funding(p.installment_id, p.account_id)));
CREATE POLICY approvals_read ON account_use_approvals FOR SELECT TO abig_app USING (app_can_see_funding(installment_id, account_id));

GRANT SELECT ON treasury_settings, cash_ledger_entries, cash_reservations, payment_transactions, payment_reversals, account_use_approvals TO abig_app;

REVOKE EXECUTE ON FUNCTION _cash_position(uuid), installment_outstanding(uuid), treasury_audit(uuid, text, text, uuid, jsonb), treasury_context(uuid),
  assert_account_use(uuid, uuid, uuid), treasury_release_orphaned() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION treasury_release_orphaned() TO abig_worker;
