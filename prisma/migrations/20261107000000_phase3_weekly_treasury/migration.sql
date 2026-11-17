-- ABIG Finance - Treasury Phase 3: balance checks and weekly reconciliation.
--
--   * Each account runs in weeks, Monday to Sunday, in Addis Ababa time. A week opens with an opening balance.
--   * A balance check enters what the bank says:
--         system balance  = bank figure - authenticated payments the bank has not processed yet
--         implied deposit = new system balance - previous system balance
--   * bank_balance_history is the full balance log. Every entry belongs to a week.
--   * The Accountant of the company that owns an account prepares its reconciliation, and a Finance Manager of that company reviews and
--     locks it. No one locks work they prepared. A shared account is reconciled once, and each payment names the company responsible.
--   * Matched payments become Paid when the week locks: Paid is final, so it waits for the review. Unmatched payments carry over.
--   * A locked week cannot change. Anything that happens after the lock belongs to the next week.
--
-- Lock order: the account row first, then the week, then payments. Every function that moves a balance or touches a week takes the account
-- row first, so a balance check, an authentication and a lock on one account run one at a time. The workflow locks a VERIFIED request and then
-- the account; the functions here only lock AUTHENTICATED requests after the account, and those two sets never overlap, so they cannot deadlock.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Time
-- ---------------------------------------------------------------------------------------------------------------------
-- The one clock for weekly rules. Tests replace this function in their own database to move through weeks.
CREATE FUNCTION treasury_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT clock_timestamp() $$;
CREATE FUNCTION addis_day(p timestamptz) RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT (p AT TIME ZONE 'Africa/Addis_Ababa')::date $$;
CREATE FUNCTION week_monday(p_day date) RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT p_day - (extract(isodow FROM p_day)::int - 1) $$;
CREATE FUNCTION etb_text(p numeric) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'ETB ' || to_char(p, 'FM999,999,999,990.00') $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Who may do what
-- ---------------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, resource, action, description) VALUES
  ('reconciliation:view',    'reconciliation', 'view',    'See weekly reconciliations'),
  ('reconciliation:prepare', 'reconciliation', 'prepare', 'Prepare the weekly reconciliation of an account'),
  ('reconciliation:lock',    'reconciliation', 'lock',    'Review and lock a reconciled week');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON
     (r.code = 'ACCOUNTANT' AND p.code IN ('reconciliation:view','reconciliation:prepare'))
  OR (r.code = 'FINANCE_MANAGER' AND p.code IN ('reconciliation:view','reconciliation:lock'))
  OR (r.code = 'OWNER' AND p.code = 'reconciliation:view');

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. The balance log and the weeks
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TYPE balance_entry_kind AS ENUM ('OPENING','CHECK','PAYMENT','CANCEL_RELEASE','RECONCILIATION_ADJUSTMENT');
CREATE TYPE treasury_week_status AS ENUM ('OPEN','RECONCILING','LOCKED');
CREATE TYPE reconciliation_line_kind AS ENUM ('PAYMENT','BANK_CHARGE','OTHER','CARRY');

CREATE TABLE treasury_weeks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES company_bank_accounts(id),
  week_start date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  status treasury_week_status NOT NULL DEFAULT 'OPEN',
  opening_entry_id uuid REFERENCES bank_balance_history(id),
  statement_closing_balance numeric(19,4) CHECK (statement_closing_balance >= 0),
  statement_deposits_total numeric(19,4) CHECK (statement_deposits_total >= 0),
  deposit_explanation text,
  revision int NOT NULL DEFAULT 0,          -- changes with every edit, so a review always locks exactly what was reviewed
  started_by uuid REFERENCES users(id),
  started_at timestamptz,
  prepared_by uuid REFERENCES users(id),
  prepared_at timestamptz,
  return_reason text,
  system_balance numeric(19,4),             -- the figures below are fixed at the lock
  unmatched_total numeric(19,4),
  implied_deposits_total numeric(19,4),
  adjustments_total numeric(19,4),
  adjustment_posted boolean,
  balance_difference numeric(19,4),
  deposit_difference numeric(19,4),
  locked_by uuid REFERENCES users(id),
  locked_at timestamptz,
  UNIQUE (account_id, week_start),
  CONSTRAINT treasury_weeks_locked_chk CHECK (status <> 'LOCKED' OR (
    locked_by IS NOT NULL AND locked_at IS NOT NULL AND prepared_by IS NOT NULL AND locked_by <> prepared_by AND balance_difference = 0
    AND statement_closing_balance IS NOT NULL AND statement_deposits_total IS NOT NULL
    AND (deposit_difference = 0 OR btrim(coalesce(deposit_explanation, '')) <> '')))
);

CREATE FUNCTION treasury_weeks_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'LOCKED' THEN RAISE EXCEPTION 'this week is locked and cannot be changed' USING ERRCODE = '42501'; END IF;
  IF NEW.account_id <> OLD.account_id OR NEW.week_start <> OLD.week_start THEN RAISE EXCEPTION 'a week cannot move to another account or date' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER treasury_weeks_guard BEFORE UPDATE ON treasury_weeks FOR EACH ROW EXECUTE FUNCTION treasury_weeks_guard();
CREATE TRIGGER treasury_weeks_no_delete BEFORE DELETE ON treasury_weeks FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER treasury_weeks_no_truncate BEFORE TRUNCATE ON treasury_weeks FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

ALTER TABLE company_bank_accounts ADD COLUMN large_deposit_threshold numeric(19,4) NOT NULL DEFAULT 500000 CHECK (large_deposit_threshold > 0);

-- A system balance can be below zero (an uncashed cheque, and the bank's figure then falls), so the log must be able to say so.
ALTER TABLE bank_balance_history DROP CONSTRAINT bank_balance_history_new_balance_check;
ALTER TABLE bank_balance_history
  ADD COLUMN entry_kind balance_entry_kind NOT NULL DEFAULT 'CHECK',
  ADD COLUMN week_id uuid REFERENCES treasury_weeks(id),      -- empty only on entries from before this migration
  ADD COLUMN bank_figure numeric(19,4),
  ADD COLUMN outstanding_total numeric(19,4),
  ADD COLUMN implied_deposit numeric(19,4),
  ADD COLUMN anomalies text[] NOT NULL DEFAULT '{}';
CREATE INDEX bank_balance_history_week_idx ON bank_balance_history (week_id, updated_at DESC);
CREATE UNIQUE INDEX bank_balance_history_one_debit ON bank_balance_history (request_id) WHERE request_id IS NOT NULL;

-- Past entries keep every recorded figure. They only gain what kind of entry they were, and past hand-entered figures were the bank's figure.
ALTER TABLE bank_balance_history DISABLE TRIGGER bank_balance_history_no_change;
UPDATE bank_balance_history SET entry_kind = 'PAYMENT' WHERE request_id IS NOT NULL;
UPDATE bank_balance_history SET bank_figure = new_balance WHERE request_id IS NULL;
ALTER TABLE bank_balance_history ENABLE TRIGGER bank_balance_history_no_change;

-- One row per authenticated payment shown during a check: what the system suggested and what the Accountant said.
CREATE TABLE balance_check_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES bank_balance_history(id),
  account_id uuid NOT NULL REFERENCES company_bank_accounts(id),
  request_id uuid NOT NULL REFERENCES payment_requests(id),
  company_id uuid NOT NULL REFERENCES companies(id),         -- the company responsible for the payment
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  default_processed boolean NOT NULL,
  processed boolean NOT NULL,
  UNIQUE (entry_id, request_id)
);
CREATE INDEX balance_check_items_request_idx ON balance_check_items (request_id);
CREATE TRIGGER balance_check_items_no_change BEFORE UPDATE OR DELETE ON balance_check_items FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER balance_check_items_no_truncate BEFORE TRUNCATE ON balance_check_items FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- PAYMENT: a payment found on the statement. CARRY: a payment that was not, and why. BANK_CHARGE and OTHER: the statement's other items.
-- amount: for payments the payment's total; otherwise the effect on the balance, so a charge is negative.
-- already_in_balance: a balance check has picked the item up already, so it explains the deposit comparison and does not move the balance.
CREATE TABLE reconciliation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id uuid NOT NULL REFERENCES treasury_weeks(id),
  account_id uuid NOT NULL REFERENCES company_bank_accounts(id),
  kind reconciliation_line_kind NOT NULL,
  request_id uuid REFERENCES payment_requests(id),
  company_id uuid NOT NULL REFERENCES companies(id),         -- the company responsible for the payment; the owner for other items
  statement_date date,
  reference text,
  amount numeric(19,4) NOT NULL,
  already_in_balance boolean NOT NULL DEFAULT false,
  reason text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  voided_by uuid REFERENCES users(id),
  voided_at timestamptz,
  void_reason text,
  CONSTRAINT reconciliation_lines_request_chk CHECK ((kind IN ('PAYMENT','CARRY')) = (request_id IS NOT NULL)),
  CONSTRAINT reconciliation_lines_payment_chk CHECK (kind <> 'PAYMENT' OR (statement_date IS NOT NULL AND amount > 0)),
  CONSTRAINT reconciliation_lines_reason_chk CHECK (kind = 'PAYMENT' OR length(btrim(coalesce(reason, ''))) >= 3),
  CONSTRAINT reconciliation_lines_charge_chk CHECK (kind <> 'BANK_CHARGE' OR amount < 0),
  CONSTRAINT reconciliation_lines_other_chk CHECK (kind <> 'OTHER' OR amount <> 0),
  CONSTRAINT reconciliation_lines_void_chk CHECK ((voided_at IS NULL) = (voided_by IS NULL))
);
CREATE INDEX reconciliation_lines_week_idx ON reconciliation_lines (week_id);
CREATE UNIQUE INDEX reconciliation_lines_match_once ON reconciliation_lines (request_id) WHERE kind = 'PAYMENT' AND voided_at IS NULL;
CREATE UNIQUE INDEX reconciliation_lines_carry_once ON reconciliation_lines (week_id, request_id) WHERE kind = 'CARRY' AND voided_at IS NULL;

CREATE FUNCTION reconciliation_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s treasury_week_status;
BEGIN
  SELECT status INTO s FROM treasury_weeks WHERE id = NEW.week_id;
  IF s = 'LOCKED' THEN RAISE EXCEPTION 'this week is locked and cannot be changed' USING ERRCODE = '42501'; END IF;
  IF s <> 'RECONCILING' THEN RAISE EXCEPTION 'start the reconciliation first' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'UPDATE' AND (OLD.voided_at IS NOT NULL OR to_jsonb(NEW) - ARRAY['voided_by','voided_at','void_reason'] <> to_jsonb(OLD) - ARRAY['voided_by','voided_at','void_reason']) THEN
    RAISE EXCEPTION 'a reconciliation line is never edited: remove it and add a new one' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reconciliation_lines_guard BEFORE INSERT OR UPDATE ON reconciliation_lines FOR EACH ROW EXECUTE FUNCTION reconciliation_lines_guard();
CREATE TRIGGER reconciliation_lines_no_delete BEFORE DELETE ON reconciliation_lines FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER reconciliation_lines_no_truncate BEFORE TRUNCATE ON reconciliation_lines FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

ALTER TABLE payment_requests
  ADD CONSTRAINT payment_requests_balance_check_fkey FOREIGN KEY (balance_check_id) REFERENCES bank_balance_history(id),
  ADD CONSTRAINT payment_requests_reconciliation_fkey FOREIGN KEY (reconciliation_id) REFERENCES treasury_weeks(id);
CREATE INDEX payment_requests_outstanding_idx ON payment_requests (debit_account_id) WHERE workflow_state = 'AUTHENTICATED';

-- Weeks are visible to everyone who sees the account. Payment lines stay with the company responsible, the company that owns the account,
-- and those who enter its balance, because they have to tick those payments.
CREATE FUNCTION app_can_see_line(p_company uuid, p_account uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT p_company IN (SELECT app_readable_companies()) OR account_owner_company(p_account) IN (SELECT app_readable_companies()) OR app_can_snapshot(p_account) $$;
ALTER TABLE treasury_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_check_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY treasury_weeks_read ON treasury_weeks FOR SELECT TO abig_app USING (app_can_see_account(account_id));
CREATE POLICY balance_check_items_read ON balance_check_items FOR SELECT TO abig_app USING (app_can_see_line(company_id, account_id));
CREATE POLICY reconciliation_lines_read ON reconciliation_lines FOR SELECT TO abig_app USING (app_can_see_line(company_id, account_id));
GRANT SELECT ON treasury_weeks, balance_check_items, reconciliation_lines TO abig_app;  -- written only by the functions below

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Which week an entry belongs to
-- ---------------------------------------------------------------------------------------------------------------------
-- The calendar week, unless it is locked already: whatever happens after a lock falls into the following week.
CREATE FUNCTION treasury_week_start(p_account uuid) RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT GREATEST(week_monday(addis_day(treasury_now())), (SELECT max(week_start) + 7 FROM treasury_weeks WHERE account_id = p_account AND status = 'LOCKED')) $$;
ALTER FUNCTION treasury_week_start(uuid) VOLATILE;

-- The caller holds the account lock.
CREATE FUNCTION treasury_week_for(p_account uuid) RETURNS treasury_weeks LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE wk date := treasury_week_start(p_account); w treasury_weeks;
BEGIN
  INSERT INTO treasury_weeks (account_id, week_start) VALUES (p_account, wk) ON CONFLICT (account_id, week_start) DO NOTHING;
  SELECT * INTO w FROM treasury_weeks WHERE account_id = p_account AND week_start = wk;
  RETURN w;
END $$;

-- Every entry belongs to a week, whichever path wrote it, so the authentication debit needs no change here.
CREATE FUNCTION bank_balance_history_stamp() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.request_id IS NOT NULL THEN NEW.entry_kind := 'PAYMENT'; END IF;
  IF NEW.week_id IS NULL THEN NEW.week_id := (treasury_week_for(NEW.account_id)).id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_balance_history_stamp BEFORE INSERT ON bank_balance_history FOR EACH ROW EXECUTE FUNCTION bank_balance_history_stamp();

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Balance checks
-- ---------------------------------------------------------------------------------------------------------------------
-- A shortfall that appears or grows is audited and sent to the Finance Managers, whichever entry caused it.
CREATE FUNCTION note_shortfall(a company_bank_accounts, b company_bank_accounts) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF b.shortfall_amount > a.shortfall_amount THEN
    PERFORM treasury_audit(account_owner_company(b.id), 'ACCOUNT_SHORTFALL_DETECTED', 'BANK_ACCOUNT', b.id,
                           jsonb_build_object('balance', b.current_balance, 'reserved', b.reserved_balance, 'shortfall', b.shortfall_amount));
    INSERT INTO notification_outbox (event_type, payload)
    VALUES ('ACCOUNT_SHORTFALL', jsonb_build_object('account_id', b.id, 'account_label', b.account_label, 'balance', b.current_balance,
                                                    'reserved', b.reserved_balance, 'shortfall_amount', b.shortfall_amount));
  END IF;
END $$;

-- p_processed: the payments ticked as processed by the bank. p_shown: the payments the screen listed. When given, a list that has changed
-- since the page loaded is refused, so nobody ticks against an old list while someone else authenticates or checks at the same moment.
CREATE FUNCTION record_figure(p_kind balance_entry_kind, p_account uuid, p_figure numeric, p_processed uuid[], p_shown uuid[]) RETURNS bank_balance_history
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a company_bank_accounts; b company_bank_accounts; w treasury_weeks; h bank_balance_history; v_fig numeric(19,4); v_out numeric(19,4); v_new numeric(19,4);
        v_implied numeric(19,4); flags text[] := '{}'; ticked uuid[] := COALESCE(p_processed, '{}');
BEGIN
  IF app_user_id() IS NULL THEN RAISE EXCEPTION 'sign in first' USING ERRCODE = '42501'; END IF;
  IF p_figure IS NULL THEN RAISE EXCEPTION 'enter the total amount that is in the bank account' USING ERRCODE = '23514'; END IF;
  v_fig := round(p_figure, 4);
  IF v_fig < 0 THEN RAISE EXCEPTION 'the balance cannot be negative' USING ERRCODE = '23514'; END IF;
  IF NOT app_can_snapshot(p_account) THEN RAISE EXCEPTION 'you may not update the balance of this account' USING ERRCODE = '42501'; END IF;

  SELECT * INTO a FROM company_bank_accounts WHERE id = p_account FOR UPDATE;   -- two checks cannot read the same "previous"
  w := treasury_week_for(p_account);
  IF p_kind = 'OPENING' AND w.opening_entry_id IS NOT NULL THEN RAISE EXCEPTION 'this week already has its opening balance; enter a balance check instead' USING ERRCODE = '23514'; END IF;
  IF p_kind = 'CHECK' AND w.opening_entry_id IS NULL THEN RAISE EXCEPTION 'record this week''s opening balance first' USING ERRCODE = '23514'; END IF;

  IF p_shown IS NOT NULL AND EXISTS (
       (SELECT r.id FROM payment_requests r WHERE r.debit_account_id = p_account AND r.workflow_state = 'AUTHENTICATED' AND r.bank_processed_at IS NULL
        EXCEPT SELECT unnest(p_shown))
       UNION ALL
       (SELECT unnest(p_shown)
        EXCEPT SELECT r.id FROM payment_requests r WHERE r.debit_account_id = p_account AND r.workflow_state = 'AUTHENTICATED' AND r.bank_processed_at IS NULL)) THEN
    RAISE EXCEPTION 'the list of outstanding payments has changed since this page was opened; open it again and review the ticks' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ticked) x WHERE NOT EXISTS (SELECT 1 FROM payment_requests r WHERE r.id = x AND r.debit_account_id = p_account AND r.workflow_state = 'AUTHENTICATED' AND r.bank_processed_at IS NULL)) THEN
    RAISE EXCEPTION 'a ticked payment is not outstanding on this account' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(sum(r.total_amount), 0) INTO v_out FROM payment_requests r
   WHERE r.debit_account_id = p_account AND r.workflow_state = 'AUTHENTICATED' AND r.bank_processed_at IS NULL AND NOT (r.id = ANY (ticked));
  v_new := v_fig - v_out;
  IF p_kind = 'CHECK' THEN
    v_implied := v_new - a.current_balance;
    IF v_implied < 0 THEN flags := flags || 'NEGATIVE_DEPOSIT'::text; END IF;
    IF v_implied > a.large_deposit_threshold THEN flags := flags || 'LARGE_DEPOSIT'::text; END IF;
  ELSIF v_new <> a.current_balance AND EXISTS (SELECT 1 FROM bank_balance_history x WHERE x.account_id = p_account AND x.entry_kind = 'OPENING') THEN
    flags := flags || 'OPENING_CHANGED'::text;   -- the balance moved between weeks with no check to see it
  END IF;

  UPDATE company_bank_accounts SET current_balance = v_new, balance_updated_at = clock_timestamp() WHERE id = p_account RETURNING * INTO b;
  INSERT INTO bank_balance_history (account_id, previous_balance, new_balance, updated_by, entry_kind, week_id, bank_figure, outstanding_total, implied_deposit, anomalies)
  VALUES (p_account, a.current_balance, v_new, app_user_id(), p_kind, w.id, v_fig, v_out, v_implied, flags) RETURNING * INTO h;

  INSERT INTO balance_check_items (entry_id, account_id, request_id, company_id, amount, default_processed, processed)
  SELECT h.id, p_account, r.id, r.debtor_company_id, r.total_amount, r.payment_method IN ('TRANSFER','TELEBIRR'), r.id = ANY (ticked)
    FROM payment_requests r WHERE r.debit_account_id = p_account AND r.workflow_state = 'AUTHENTICATED' AND r.bank_processed_at IS NULL;
  IF cardinality(ticked) > 0 THEN
    PERFORM set_config('app.wf', 'on', true);
    UPDATE payment_requests SET bank_processed_at = clock_timestamp(), bank_processed_by = app_user_id(), balance_check_id = h.id WHERE id = ANY (ticked);
    PERFORM set_config('app.wf', 'off', true);
  END IF;
  IF p_kind = 'OPENING' THEN UPDATE treasury_weeks SET opening_entry_id = h.id WHERE id = w.id; END IF;

  PERFORM treasury_audit(account_owner_company(p_account), 'BANK_BALANCE_UPDATED', 'BANK_ACCOUNT', p_account,
    jsonb_build_object('kind', p_kind, 'figure', v_fig, 'outstanding', v_out, 'previous', a.current_balance, 'new', v_new, 'implied_deposit', v_implied, 'shortfall', b.shortfall_amount, 'anomalies', flags));
  PERFORM note_shortfall(a, b);
  RETURN h;
END $$;

CREATE FUNCTION record_opening_balance(p_account uuid, p_figure numeric, p_processed uuid[] DEFAULT '{}', p_shown uuid[] DEFAULT NULL) RETURNS bank_balance_history
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT record_figure('OPENING', p_account, p_figure, p_processed, p_shown) $$;
CREATE FUNCTION record_balance_check(p_account uuid, p_figure numeric, p_processed uuid[] DEFAULT '{}', p_shown uuid[] DEFAULT NULL) RETURNS bank_balance_history
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT record_figure('CHECK', p_account, p_figure, p_processed, p_shown) $$;

-- update_bank_balance is retired: it set a figure with no outstanding payments, no week and no lock. Tests and the application use the two above.
DROP FUNCTION update_bank_balance(uuid, numeric);

-- A wrong tick makes the implied deposit too low. It can be undone until the payment is matched or its check's week is locked. The balance stays
-- as it is until the next check, which lists the payment again.
CREATE FUNCTION undo_processed_tick(p_request uuid, p_reason text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r payment_requests; v int;
BEGIN
  IF app_user_id() IS NULL THEN RAISE EXCEPTION 'sign in first' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  SELECT * INTO r FROM payment_requests WHERE id = p_request;
  IF NOT FOUND OR r.debit_account_id IS NULL OR NOT app_can_snapshot(r.debit_account_id) THEN RAISE EXCEPTION 'you may not change this payment' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM company_bank_accounts WHERE id = r.debit_account_id FOR UPDATE;
  SELECT * INTO r FROM payment_requests WHERE id = p_request FOR UPDATE;
  IF r.workflow_state <> 'AUTHENTICATED' OR r.bank_processed_at IS NULL THEN RAISE EXCEPTION 'this payment is not ticked as processed' USING ERRCODE = '23514'; END IF;
  IF r.payment_method = 'CASH' THEN RAISE EXCEPTION 'a cash payment is processed when it is paid out' USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM reconciliation_lines l WHERE l.request_id = p_request AND l.kind = 'PAYMENT' AND l.voided_at IS NULL) THEN
    RAISE EXCEPTION 'this payment is matched to the statement; remove the match first' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM bank_balance_history h JOIN treasury_weeks w ON w.id = h.week_id WHERE h.id = r.balance_check_id AND w.status = 'LOCKED') THEN
    RAISE EXCEPTION 'this week is locked and cannot be changed' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.wf', 'on', true);
  UPDATE payment_requests SET bank_processed_at = NULL, bank_processed_by = NULL, balance_check_id = NULL WHERE id = p_request RETURNING version INTO v;
  PERFORM set_config('app.wf', 'off', true);
  PERFORM treasury_audit(r.debtor_company_id, 'PROCESSED_TICK_UNDONE', 'PAYMENT_REQUEST', p_request, jsonb_build_object('reason', btrim(p_reason), 'balance_check', r.balance_check_id));
  RETURN v;
END $$;

CREATE FUNCTION set_large_deposit_threshold(p_account uuid, p_amount numeric) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE old numeric;
BEGIN
  IF app_user_id() IS NULL OR NOT app_can_manage_access(p_account) THEN RAISE EXCEPTION 'only the account owner can change account policy' USING ERRCODE = '42501'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'the amount must be more than zero' USING ERRCODE = '23514'; END IF;
  SELECT large_deposit_threshold INTO old FROM company_bank_accounts WHERE id = p_account FOR UPDATE;
  UPDATE company_bank_accounts SET large_deposit_threshold = p_amount WHERE id = p_account;
  PERFORM treasury_audit(account_owner_company(p_account), 'BANK_ACCOUNT_POLICY_CHANGED', 'BANK_ACCOUNT', p_account, jsonb_build_object('large_deposit_threshold', p_amount, 'previous', old));
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Weekly reconciliation
-- ---------------------------------------------------------------------------------------------------------------------
-- Takes the account lock, then the week. Everything that touches a reconciliation starts here.
CREATE FUNCTION recon_lock(p_week uuid) RETURNS treasury_weeks LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w treasury_weeks;
BEGIN
  IF app_user_id() IS NULL THEN RAISE EXCEPTION 'sign in first' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM treasury_weeks WHERE id = p_week;
  IF NOT FOUND THEN RAISE EXCEPTION 'week not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM company_bank_accounts WHERE id = w.account_id FOR UPDATE;
  SELECT * INTO w FROM treasury_weeks WHERE id = p_week FOR UPDATE;
  RETURN w;
END $$;

-- The Accountant's step: open for changes, and only by the company that owns the account.
CREATE FUNCTION recon_for_edit(p_week uuid) RETURNS treasury_weeks LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w treasury_weeks;
BEGIN
  w := recon_lock(p_week);
  IF NOT app_has_permission(account_owner_company(w.account_id), 'reconciliation:prepare') THEN
    RAISE EXCEPTION 'only an Accountant of the company that owns this account can prepare its reconciliation' USING ERRCODE = '42501';
  END IF;
  IF w.status = 'LOCKED' THEN RAISE EXCEPTION 'this week is locked and cannot be changed' USING ERRCODE = '42501'; END IF;
  IF w.status = 'OPEN' THEN RAISE EXCEPTION 'start the reconciliation first' USING ERRCODE = '23514'; END IF;
  IF w.prepared_at IS NOT NULL THEN RAISE EXCEPTION 'this reconciliation is with the Finance Manager; it must be returned before it can change' USING ERRCODE = '42501'; END IF;
  UPDATE treasury_weeks SET revision = revision + 1 WHERE id = p_week RETURNING * INTO w;
  RETURN w;
END $$;

-- The payments a week answers for: still Authenticated, and debited in this week or before. A payment debited later is next week's.
CREATE FUNCTION recon_candidates(w treasury_weeks) RETURNS SETOF payment_requests LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.* FROM payment_requests r
   WHERE r.debit_account_id = w.account_id AND r.workflow_state = 'AUTHENTICATED'
     AND COALESCE((SELECT t.week_start FROM bank_balance_history h JOIN treasury_weeks t ON t.id = h.week_id WHERE h.request_id = r.id), w.week_start) <= w.week_start $$;

-- The two questions a reconciliation answers. See docs/OPERATIONS.md.
--   balance_difference = statement closing - unmatched payments - system balance - items that will adjust the balance    (must be zero)
--   deposit_difference = statement deposits - implied deposits + items a check already picked up                         (zero, or explained)
CREATE FUNCTION recon_figures(w treasury_weeks, OUT system_balance numeric, OUT unmatched_total numeric, OUT implied_total numeric, OUT adjust_total numeric, OUT known_total numeric,
                              OUT balance_difference numeric, OUT deposit_difference numeric) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  SELECT h.new_balance INTO system_balance FROM bank_balance_history h WHERE h.week_id = w.id AND h.entry_kind <> 'RECONCILIATION_ADJUSTMENT' ORDER BY h.updated_at DESC, h.id DESC LIMIT 1;
  SELECT COALESCE(sum(c.total_amount), 0) INTO unmatched_total FROM recon_candidates(w) c
   WHERE NOT EXISTS (SELECT 1 FROM reconciliation_lines l WHERE l.request_id = c.id AND l.week_id = w.id AND l.kind = 'PAYMENT' AND l.voided_at IS NULL);
  SELECT COALESCE(sum(h.implied_deposit), 0) INTO implied_total FROM bank_balance_history h WHERE h.week_id = w.id AND h.entry_kind = 'CHECK';
  SELECT COALESCE(sum(l.amount) FILTER (WHERE NOT l.already_in_balance), 0), COALESCE(sum(l.amount) FILTER (WHERE l.already_in_balance), 0) INTO adjust_total, known_total
    FROM reconciliation_lines l WHERE l.week_id = w.id AND l.kind IN ('BANK_CHARGE','OTHER') AND l.voided_at IS NULL;
  balance_difference := w.statement_closing_balance - unmatched_total - system_balance - adjust_total;
  deposit_difference := w.statement_deposits_total - implied_total + known_total;
END $$;

-- Starts the week's reconciliation, or corrects the statement's figures while it is being prepared.
CREATE FUNCTION start_reconciliation(p_account uuid, p_week_start date, p_closing numeric, p_deposits numeric) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w treasury_weeks;
BEGIN
  IF app_user_id() IS NULL THEN RAISE EXCEPTION 'sign in first' USING ERRCODE = '42501'; END IF;
  IF NOT app_has_permission(account_owner_company(p_account), 'reconciliation:prepare') THEN
    RAISE EXCEPTION 'only an Accountant of the company that owns this account can prepare its reconciliation' USING ERRCODE = '42501';
  END IF;
  IF p_closing IS NULL OR p_closing < 0 OR p_deposits IS NULL OR p_deposits < 0 THEN RAISE EXCEPTION 'enter the statement''s closing balance and total deposits' USING ERRCODE = '23514'; END IF;
  PERFORM 1 FROM company_bank_accounts WHERE id = p_account FOR UPDATE;
  SELECT * INTO w FROM treasury_weeks WHERE account_id = p_account AND week_start = p_week_start FOR UPDATE;
  IF NOT FOUND OR w.opening_entry_id IS NULL THEN RAISE EXCEPTION 'this week has no opening balance to reconcile from' USING ERRCODE = '23514'; END IF;
  IF w.status = 'LOCKED' THEN RAISE EXCEPTION 'this week is locked and cannot be changed' USING ERRCODE = '42501'; END IF;
  IF w.prepared_at IS NOT NULL THEN RAISE EXCEPTION 'this reconciliation is with the Finance Manager; it must be returned before it can change' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM treasury_weeks e WHERE e.account_id = p_account AND e.week_start < w.week_start AND e.status <> 'LOCKED' AND e.opening_entry_id IS NOT NULL) THEN
    RAISE EXCEPTION 'an earlier week on this account is not locked yet; weeks are reconciled in order' USING ERRCODE = '23514';
  END IF;
  UPDATE treasury_weeks SET status = 'RECONCILING', statement_closing_balance = round(p_closing, 4), statement_deposits_total = round(p_deposits, 4), revision = revision + 1,
         started_by = COALESCE(started_by, app_user_id()), started_at = COALESCE(started_at, clock_timestamp()) WHERE id = w.id;
  PERFORM treasury_audit(account_owner_company(p_account), 'RECONCILIATION_STARTED', 'TREASURY_WEEK', w.id, jsonb_build_object('week', p_week_start, 'closing', p_closing, 'deposits', p_deposits));
  RETURN w.id;
END $$;

-- Tick a payment found on the statement. It becomes Paid when the week locks.
CREATE FUNCTION match_payment(p_week uuid, p_request uuid, p_statement_date date, p_reference text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w treasury_weeks; r payment_requests; v uuid;
BEGIN
  w := recon_for_edit(p_week);
  IF p_statement_date IS NULL THEN RAISE EXCEPTION 'enter the date on the statement' USING ERRCODE = '23514'; END IF;
  SELECT c.* INTO r FROM recon_candidates(w) c WHERE c.id = p_request;
  IF NOT FOUND THEN RAISE EXCEPTION 'this payment is not outstanding on this account for this week' USING ERRCODE = '23514'; END IF;
  IF p_statement_date > w.week_start + 6 OR p_statement_date < addis_day(r.authenticated_at) THEN
    RAISE EXCEPTION 'the statement date must be between the day the payment was authenticated and the end of this week' USING ERRCODE = '23514';
  END IF;
  INSERT INTO reconciliation_lines (week_id, account_id, kind, request_id, company_id, statement_date, reference, amount, created_by)
  VALUES (p_week, w.account_id, 'PAYMENT', p_request, r.debtor_company_id, p_statement_date, NULLIF(btrim(p_reference), ''), r.total_amount, app_user_id()) RETURNING id INTO v;
  PERFORM treasury_audit(r.debtor_company_id, 'PAYMENT_MATCHED', 'PAYMENT_REQUEST', p_request, jsonb_build_object('week', p_week, 'statement_date', p_statement_date, 'amount', r.total_amount));
  RETURN v;
END $$;

-- p_amount: a charge is entered as a positive amount. Other items carry their sign: positive adds to the balance.
CREATE FUNCTION add_reconciliation_line(p_week uuid, p_kind text, p_amount numeric, p_reason text, p_statement_date date DEFAULT NULL, p_reference text DEFAULT NULL, p_already_in_balance boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w treasury_weeks; v uuid; amt numeric(19,4); own uuid;
BEGIN
  w := recon_for_edit(p_week);
  IF p_kind NOT IN ('BANK_CHARGE','OTHER') THEN RAISE EXCEPTION 'a line is a bank charge or another item' USING ERRCODE = '23514'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  IF p_amount IS NULL OR p_amount = 0 THEN RAISE EXCEPTION 'enter the amount' USING ERRCODE = '23514'; END IF;
  IF p_kind = 'BANK_CHARGE' AND p_amount < 0 THEN RAISE EXCEPTION 'enter a bank charge as a positive amount' USING ERRCODE = '23514'; END IF;
  amt := round(CASE p_kind WHEN 'BANK_CHARGE' THEN -p_amount ELSE p_amount END, 4);
  own := account_owner_company(w.account_id);
  INSERT INTO reconciliation_lines (week_id, account_id, kind, company_id, statement_date, reference, amount, already_in_balance, reason, created_by)
  VALUES (p_week, w.account_id, p_kind::reconciliation_line_kind, own, p_statement_date, NULLIF(btrim(p_reference), ''), amt, COALESCE(p_already_in_balance, false), btrim(p_reason), app_user_id()) RETURNING id INTO v;
  PERFORM treasury_audit(own, 'RECONCILIATION_LINE_ADDED', 'TREASURY_WEEK', p_week, jsonb_build_object('line', v, 'kind', p_kind, 'amount', amt, 'reason', btrim(p_reason)));
  RETURN v;
END $$;

-- A mistaken match or line. Kept on the record; it just stops counting.
CREATE FUNCTION remove_reconciliation_line(p_line uuid, p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE l reconciliation_lines; w treasury_weeks;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  SELECT * INTO l FROM reconciliation_lines WHERE id = p_line;
  IF NOT FOUND THEN RAISE EXCEPTION 'line not found' USING ERRCODE = 'P0002'; END IF;
  w := recon_for_edit(l.week_id);
  IF l.kind = 'CARRY' THEN RAISE EXCEPTION 'this line is removed when the reconciliation is returned' USING ERRCODE = '23514'; END IF;
  UPDATE reconciliation_lines SET voided_by = app_user_id(), voided_at = clock_timestamp(), void_reason = btrim(p_reason) WHERE id = p_line AND voided_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'this line has already been removed' USING ERRCODE = '23514'; END IF;
  PERFORM treasury_audit(l.company_id, 'RECONCILIATION_LINE_REMOVED', 'TREASURY_WEEK', l.week_id, jsonb_build_object('line', p_line, 'reason', btrim(p_reason)));
END $$;

-- The Accountant hands the reconciliation over. Every difference must be explained first, and every unmatched payment needs its reason.
-- p_carry_reasons: {"<request id>": "why it was not on this statement"}
CREATE FUNCTION submit_reconciliation(p_week uuid, p_expected_revision int, p_carry_reasons jsonb DEFAULT '{}', p_deposit_explanation text DEFAULT NULL) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w treasury_weeks; f record; c payment_requests; why text; expl text := NULLIF(btrim(p_deposit_explanation), '');
BEGIN
  w := recon_for_edit(p_week);
  IF w.revision - 1 <> p_expected_revision THEN RAISE EXCEPTION 'this reconciliation has changed since it was opened; open it again' USING ERRCODE = '40001'; END IF;
  SELECT * INTO f FROM recon_figures(w);
  IF f.balance_difference <> 0 THEN RAISE EXCEPTION 'the balance is out by %: explain the difference with a line and a reason', etb_text(f.balance_difference) USING ERRCODE = '23514'; END IF;
  IF f.deposit_difference <> 0 AND expl IS NULL THEN RAISE EXCEPTION 'statement deposits differ from the implied deposits by %: explain the difference', etb_text(f.deposit_difference) USING ERRCODE = '23514'; END IF;
  FOR c IN SELECT x.* FROM recon_candidates(w) x
            WHERE NOT EXISTS (SELECT 1 FROM reconciliation_lines l WHERE l.request_id = x.id AND l.week_id = w.id AND l.kind = 'PAYMENT' AND l.voided_at IS NULL) ORDER BY x.authenticated_at, x.id LOOP
    why := btrim(coalesce(p_carry_reasons ->> c.id::text, ''));
    IF length(why) < 3 THEN RAISE EXCEPTION 'give a reason for carrying % into next week', c.request_no USING ERRCODE = '23514'; END IF;
    INSERT INTO reconciliation_lines (week_id, account_id, kind, request_id, company_id, amount, reason, created_by)
    VALUES (p_week, w.account_id, 'CARRY', c.id, c.debtor_company_id, c.total_amount, why, app_user_id());
  END LOOP;
  UPDATE treasury_weeks SET prepared_by = app_user_id(), prepared_at = clock_timestamp(), deposit_explanation = expl, return_reason = NULL WHERE id = p_week RETURNING * INTO w;
  PERFORM treasury_audit(account_owner_company(w.account_id), 'RECONCILIATION_SUBMITTED', 'TREASURY_WEEK', p_week, jsonb_build_object('week', w.week_start));
  RETURN w.revision;
END $$;

CREATE FUNCTION assert_can_review(w treasury_weeks) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app_has_permission(account_owner_company(w.account_id), 'reconciliation:lock') THEN
    RAISE EXCEPTION 'only a Finance Manager of the company that owns this account can review its reconciliation' USING ERRCODE = '42501';
  END IF;
  IF w.status = 'LOCKED' THEN RAISE EXCEPTION 'this week is locked and cannot be changed' USING ERRCODE = '42501'; END IF;
  IF w.status <> 'RECONCILING' OR w.prepared_at IS NULL THEN RAISE EXCEPTION 'the Accountant has not sent this reconciliation for review' USING ERRCODE = '23514'; END IF;
END $$;

CREATE FUNCTION return_reconciliation(p_week uuid, p_reason text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w treasury_weeks;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  w := recon_lock(p_week);
  PERFORM assert_can_review(w);
  UPDATE reconciliation_lines SET voided_by = app_user_id(), voided_at = clock_timestamp(), void_reason = 'Returned for changes' WHERE week_id = p_week AND kind = 'CARRY' AND voided_at IS NULL;
  UPDATE treasury_weeks SET prepared_by = NULL, prepared_at = NULL, return_reason = btrim(p_reason), revision = revision + 1 WHERE id = p_week RETURNING * INTO w;
  PERFORM treasury_audit(account_owner_company(w.account_id), 'RECONCILIATION_RETURNED', 'TREASURY_WEEK', p_week, jsonb_build_object('reason', btrim(p_reason)));
  RETURN w.revision;
END $$;

-- Reconciliation is now the way to Paid, and a payment names the week that confirmed it. Going Paid also settles the working mark.
DROP FUNCTION wf_mark_paid(uuid, uuid);
CREATE FUNCTION wf_mark_paid(p_request uuid, p_actor uuid, p_week uuid DEFAULT NULL) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v int;
BEGIN
  PERFORM set_config('app.wf', 'on', true); PERFORM set_config('app.paid', 'on', true);
  UPDATE payment_requests SET workflow_state = 'PAID', paid_at = clock_timestamp(), paid_by = p_actor, reconciliation_id = p_week,
         bank_processed_at = COALESCE(bank_processed_at, clock_timestamp()), bank_processed_by = COALESCE(bank_processed_by, p_actor)
   WHERE id = p_request RETURNING version INTO v;
  PERFORM set_config('app.paid', 'off', true); PERFORM set_config('app.wf', 'off', true);
  RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION wf_mark_paid(uuid, uuid, uuid) FROM PUBLIC;

-- The Finance Manager locks exactly the revision reviewed. The figures are worked out again here, under the account lock, because a payment or a
-- balance check may have landed since the Accountant finished. Items that adjust the balance are posted now, unless a bank figure entered in a
-- later week has already included them: posting them again would count them twice.
CREATE FUNCTION lock_week(p_week uuid, p_expected_revision int) RETURNS treasury_weeks LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w treasury_weeks; f record; a company_bank_accounts; b company_bank_accounts; me uuid := app_user_id(); posted boolean := false; m reconciliation_lines;
BEGIN
  w := recon_lock(p_week);
  PERFORM assert_can_review(w);
  IF me = w.prepared_by OR me = w.started_by OR EXISTS (SELECT 1 FROM reconciliation_lines l WHERE l.week_id = p_week AND l.created_by = me) THEN
    RAISE EXCEPTION 'someone else must review this: you worked on this reconciliation' USING ERRCODE = '42501';
  END IF;
  IF w.revision <> p_expected_revision THEN RAISE EXCEPTION 'this reconciliation has changed since it was opened; open it again' USING ERRCODE = '40001'; END IF;
  IF EXISTS (SELECT 1 FROM treasury_weeks e WHERE e.account_id = w.account_id AND e.week_start < w.week_start AND e.status <> 'LOCKED' AND e.opening_entry_id IS NOT NULL) THEN
    RAISE EXCEPTION 'an earlier week on this account is not locked yet; weeks are reconciled in order' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO f FROM recon_figures(w);
  IF f.balance_difference <> 0 THEN RAISE EXCEPTION 'the balance has moved by % since this was prepared; return it to the Accountant', etb_text(f.balance_difference) USING ERRCODE = '23514'; END IF;
  IF f.deposit_difference <> 0 AND w.deposit_explanation IS NULL THEN RAISE EXCEPTION 'the deposit difference of % is not explained; return it to the Accountant', etb_text(f.deposit_difference) USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM recon_candidates(w) c WHERE NOT EXISTS (SELECT 1 FROM reconciliation_lines l WHERE l.request_id = c.id AND l.week_id = p_week AND l.kind IN ('PAYMENT','CARRY') AND l.voided_at IS NULL)) THEN
    RAISE EXCEPTION 'a payment was authenticated after this was prepared; return it to the Accountant' USING ERRCODE = '23514';
  END IF;

  IF f.adjust_total <> 0 AND NOT EXISTS (SELECT 1 FROM bank_balance_history h JOIN treasury_weeks t ON t.id = h.week_id
                                          WHERE h.account_id = w.account_id AND t.week_start > w.week_start AND h.entry_kind IN ('OPENING','CHECK')) THEN
    SELECT * INTO a FROM company_bank_accounts WHERE id = w.account_id;
    UPDATE company_bank_accounts SET current_balance = current_balance + f.adjust_total, balance_updated_at = clock_timestamp() WHERE id = a.id RETURNING * INTO b;
    INSERT INTO bank_balance_history (account_id, previous_balance, new_balance, updated_by, entry_kind, week_id)
    VALUES (a.id, a.current_balance, b.current_balance, me, 'RECONCILIATION_ADJUSTMENT', p_week);
    PERFORM note_shortfall(a, b);
    posted := true;
  END IF;

  FOR m IN SELECT * FROM reconciliation_lines l WHERE l.week_id = p_week AND l.kind = 'PAYMENT' AND l.voided_at IS NULL ORDER BY l.request_id LOOP
    PERFORM 1 FROM payment_requests WHERE id = m.request_id FOR UPDATE;
    PERFORM wf_mark_paid(m.request_id, me, p_week);
    PERFORM treasury_audit(m.company_id, 'PAYMENT_MARKED_PAID', 'PAYMENT_REQUEST', m.request_id, jsonb_build_object('week', p_week, 'statement_date', m.statement_date, 'amount', m.amount));
  END LOOP;

  UPDATE treasury_weeks SET status = 'LOCKED', locked_by = me, locked_at = clock_timestamp(), system_balance = f.system_balance, unmatched_total = f.unmatched_total,
         implied_deposits_total = f.implied_total, adjustments_total = f.adjust_total, adjustment_posted = posted, balance_difference = f.balance_difference, deposit_difference = f.deposit_difference
   WHERE id = p_week RETURNING * INTO w;
  PERFORM treasury_audit(account_owner_company(w.account_id), 'WEEK_LOCKED', 'TREASURY_WEEK', p_week,
    jsonb_build_object('week', w.week_start, 'system_balance', f.system_balance, 'unmatched', f.unmatched_total, 'adjustments', f.adjust_total, 'adjustment_posted', posted, 'deposit_difference', f.deposit_difference));
  RETURN w;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. What the screens read
-- ---------------------------------------------------------------------------------------------------------------------
-- Every authenticated payment on an account, with the company responsible. Those who enter the balance or belong to the owner company see all of
-- them, since they tick and match them; a company sharing the account sees its own. Flagged once outstanding for 14 days.
CREATE FUNCTION outstanding_payments(p_account uuid) RETURNS TABLE (id uuid, request_no text, company_id uuid, company text, payee text, method text, amount numeric, cheque_no text, bank_reference text,
    authenticated_at timestamptz, processed_at timestamptz, age_days int, overdue boolean, carried boolean, default_processed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id, r.request_no, r.debtor_company_id, c.legal_name, COALESCE(s.legal_name, p.full_name), r.payment_method::text, r.total_amount, r.cheque_no, r.bank_reference, r.authenticated_at, r.bank_processed_at,
         a.age, a.age >= 14,
         COALESCE((SELECT t.week_start FROM bank_balance_history h JOIN treasury_weeks t ON t.id = h.week_id WHERE h.request_id = r.id), '-infinity') < week_monday(addis_day(treasury_now())),
         r.payment_method IN ('TRANSFER','TELEBIRR')
    FROM payment_requests r JOIN companies c ON c.id = r.debtor_company_id LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN person_payees p ON p.id = r.person_payee_id
         CROSS JOIN LATERAL (SELECT GREATEST(addis_day(treasury_now()) - addis_day(r.authenticated_at), 0) AS age) a
   WHERE r.debit_account_id = p_account AND r.workflow_state = 'AUTHENTICATED' AND app_can_see_account(p_account) AND app_can_see_line(r.debtor_company_id, p_account)
   ORDER BY r.authenticated_at, r.id $$;
ALTER FUNCTION outstanding_payments(uuid) VOLATILE;

-- One row per account the person can see: this week's state and what still needs doing.
CREATE FUNCTION account_week_status() RETURNS TABLE (account_id uuid, account_label text, week_id uuid, week_start date, status text, has_opening boolean, last_figure_at timestamptz,
    outstanding_count int, overdue_count int, can_check boolean, can_prepare boolean, can_review boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.account_label, w.id, x.wk, COALESCE(w.status::text, 'OPEN'), w.opening_entry_id IS NOT NULL,
         (SELECT max(h.updated_at) FROM bank_balance_history h WHERE h.account_id = a.id AND h.entry_kind IN ('OPENING','CHECK')),
         (SELECT count(*)::int FROM outstanding_payments(a.id)), (SELECT count(*)::int FROM outstanding_payments(a.id) o WHERE o.overdue),
         app_can_snapshot(a.id), app_has_permission(account_owner_company(a.id), 'reconciliation:prepare'), app_has_permission(account_owner_company(a.id), 'reconciliation:lock')
    FROM company_bank_accounts a CROSS JOIN LATERAL (SELECT treasury_week_start(a.id) AS wk) x LEFT JOIN treasury_weeks w ON w.account_id = a.id AND w.week_start = x.wk
   WHERE a.is_active AND app_can_see_account(a.id) ORDER BY a.account_label $$;
ALTER FUNCTION account_week_status() VOLATILE;

-- A reconciliation as it stands, with the figures worked out for an open one and as locked for a locked one.
CREATE FUNCTION reconciliation_summary(p_week uuid) RETURNS TABLE (week_id uuid, account_id uuid, account_label text, week_start date, status text, revision int, closing numeric, deposits numeric, deposit_explanation text, return_reason text,
    prepared_by uuid, prepared_by_name text, prepared_at timestamptz, locked_by_name text, locked_at timestamptz, system_balance numeric, unmatched_total numeric, implied_total numeric, adjust_total numeric, known_total numeric, balance_difference numeric, deposit_difference numeric,
    can_prepare boolean, can_review boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w treasury_weeks; f record;
BEGIN
  SELECT * INTO w FROM treasury_weeks x WHERE x.id = p_week;
  IF NOT FOUND OR NOT app_can_see_account(w.account_id) THEN RETURN; END IF;
  SELECT * INTO f FROM recon_figures(w);
  RETURN QUERY SELECT w.id, w.account_id, a.account_label, w.week_start, w.status::text, w.revision, w.statement_closing_balance, w.statement_deposits_total, w.deposit_explanation, w.return_reason,
    w.prepared_by, (SELECT u.full_name FROM users u WHERE u.id = w.prepared_by), w.prepared_at, (SELECT u.full_name FROM users u WHERE u.id = w.locked_by), w.locked_at,
    COALESCE(w.system_balance, f.system_balance), COALESCE(w.unmatched_total, f.unmatched_total), COALESCE(w.implied_deposits_total, f.implied_total), COALESCE(w.adjustments_total, f.adjust_total), f.known_total,
    COALESCE(w.balance_difference, f.balance_difference), COALESCE(w.deposit_difference, f.deposit_difference),
    app_has_permission(account_owner_company(w.account_id), 'reconciliation:prepare'), app_has_permission(account_owner_company(w.account_id), 'reconciliation:lock')
    FROM company_bank_accounts a WHERE a.id = w.account_id;
END $$;

-- The payments of a reconciliation, matched or not, and for a locked week those it confirmed and carried. Shared accounts show the company responsible.
CREATE FUNCTION reconciliation_payments(p_week uuid) RETURNS TABLE (id uuid, request_no text, company text, payee text, method text, amount numeric, cheque_no text, bank_reference text, authenticated_at timestamptz,
    age_days int, overdue boolean, line_id uuid, statement_date date, reference text, carry_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w treasury_weeks;
BEGIN
  SELECT * INTO w FROM treasury_weeks x WHERE x.id = p_week;
  IF NOT FOUND OR NOT app_can_see_account(w.account_id) THEN RETURN; END IF;
  RETURN QUERY
  SELECT r.id, r.request_no, c.legal_name, COALESCE(s.legal_name, p.full_name), r.payment_method::text, r.total_amount, r.cheque_no, r.bank_reference, r.authenticated_at,
         GREATEST(addis_day(treasury_now()) - addis_day(r.authenticated_at), 0), addis_day(treasury_now()) - addis_day(r.authenticated_at) >= 14 AND r.workflow_state = 'AUTHENTICATED',
         m.id, m.statement_date, m.reference, cr.reason
    FROM payment_requests r JOIN companies c ON c.id = r.debtor_company_id LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN person_payees p ON p.id = r.person_payee_id
         LEFT JOIN reconciliation_lines m ON m.request_id = r.id AND m.week_id = p_week AND m.kind = 'PAYMENT' AND m.voided_at IS NULL
         LEFT JOIN reconciliation_lines cr ON cr.request_id = r.id AND cr.week_id = p_week AND cr.kind = 'CARRY' AND cr.voided_at IS NULL
   WHERE app_can_see_line(r.debtor_company_id, w.account_id)
     AND (m.id IS NOT NULL OR cr.id IS NOT NULL OR (w.status <> 'LOCKED' AND r.id IN (SELECT y.id FROM recon_candidates(w) y)))
   ORDER BY r.authenticated_at, r.id;
END $$;

ALTER FUNCTION reconciliation_summary(uuid) VOLATILE;
ALTER FUNCTION reconciliation_payments(uuid) VOLATILE;

DROP FUNCTION account_balance_history(uuid, int);
CREATE FUNCTION account_balance_history(p_account uuid, p_limit int DEFAULT 10)
RETURNS TABLE (id uuid, updated_at timestamptz, previous_balance numeric, new_balance numeric, updated_by uuid, updated_by_name text, request_no text, entry_kind text, bank_figure numeric, outstanding_total numeric, implied_deposit numeric, anomalies text[], week_start date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT h.id, h.updated_at, h.previous_balance, h.new_balance, h.updated_by, u.full_name, r.request_no, h.entry_kind::text, h.bank_figure, h.outstanding_total, h.implied_deposit, h.anomalies, t.week_start
        FROM bank_balance_history h JOIN users u ON u.id = h.updated_by LEFT JOIN payment_requests r ON r.id = h.request_id LEFT JOIN treasury_weeks t ON t.id = h.week_id
       WHERE h.account_id = p_account AND app_can_see_account(p_account)
       ORDER BY h.updated_at DESC, h.id DESC LIMIT LEAST(GREATEST(p_limit, 1), 100) $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. Who may run what
-- ---------------------------------------------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION treasury_week_for(uuid), record_figure(balance_entry_kind, uuid, numeric, uuid[], uuid[]), recon_lock(uuid), recon_for_edit(uuid), recon_candidates(treasury_weeks),
  recon_figures(treasury_weeks), assert_can_review(treasury_weeks), note_shortfall(company_bank_accounts, company_bank_accounts) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_opening_balance(uuid, numeric, uuid[], uuid[]), record_balance_check(uuid, numeric, uuid[], uuid[]), undo_processed_tick(uuid, text), set_large_deposit_threshold(uuid, numeric),
  start_reconciliation(uuid, date, numeric, numeric), match_payment(uuid, uuid, date, text), add_reconciliation_line(uuid, text, numeric, text, date, text, boolean), remove_reconciliation_line(uuid, text),
  submit_reconciliation(uuid, int, jsonb, text), return_reconciliation(uuid, text), lock_week(uuid, int), outstanding_payments(uuid), account_week_status(), reconciliation_summary(uuid), reconciliation_payments(uuid),
  account_balance_history(uuid, int), app_can_see_line(uuid, uuid), treasury_week_start(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_opening_balance(uuid, numeric, uuid[], uuid[]), record_balance_check(uuid, numeric, uuid[], uuid[]), undo_processed_tick(uuid, text), set_large_deposit_threshold(uuid, numeric),
  start_reconciliation(uuid, date, numeric, numeric), match_payment(uuid, uuid, date, text), add_reconciliation_line(uuid, text, numeric, text, date, text, boolean), remove_reconciliation_line(uuid, text),
  submit_reconciliation(uuid, int, jsonb, text), return_reconciliation(uuid, text), lock_week(uuid, int), outstanding_payments(uuid), account_week_status(), reconciliation_summary(uuid), reconciliation_payments(uuid),
  account_balance_history(uuid, int), app_can_see_line(uuid, uuid), treasury_week_start(uuid) TO abig_app;
