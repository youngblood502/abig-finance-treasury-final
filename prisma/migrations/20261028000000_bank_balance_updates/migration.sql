-- ABIG Finance - Bank balance updates (step 2).
-- An Accountant types in the overall amount that is in the bank; the system sets current_balance (available_balance follows,
-- it is generated) and writes one history row: when, new amount, previous amount, who. The old snapshot / ledger engine is not used.

CREATE TABLE bank_balance_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES company_bank_accounts(id),
  previous_balance numeric(19,4) NOT NULL,
  new_balance numeric(19,4) NOT NULL CHECK (new_balance >= 0),
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX bank_balance_history_account_id_updated_at_idx ON bank_balance_history (account_id, updated_at DESC);

-- Append-only, like the other audit tables.
CREATE FUNCTION bank_balance_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'the balance history cannot be changed' USING ERRCODE = '42501'; END $$;
CREATE TRIGGER bank_balance_history_no_change BEFORE UPDATE OR DELETE ON bank_balance_history FOR EACH ROW EXECUTE FUNCTION bank_balance_history_immutable();
CREATE TRIGGER bank_balance_history_no_truncate BEFORE TRUNCATE ON bank_balance_history FOR EACH STATEMENT EXECUTE FUNCTION bank_balance_history_immutable();

ALTER TABLE bank_balance_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY balance_history_read ON bank_balance_history FOR SELECT TO abig_app USING (app_can_see_account(account_id));
GRANT SELECT ON bank_balance_history TO abig_app;  -- rows are written only by update_bank_balance()

-- The only way to change current_balance. Needs the bank_balance:update permission in a company that is linked to the account
-- with the RECORD_SNAPSHOT right. The bank's figure cannot be entered below the funds already reserved.
CREATE FUNCTION update_bank_balance(p_account uuid, p_new numeric) RETURNS bank_balance_history
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a company_bank_accounts; h bank_balance_history; v_new numeric(19,4);
BEGIN
  IF app_user_id() IS NULL THEN RAISE EXCEPTION 'sign in first' USING ERRCODE = '42501'; END IF;
  IF p_new IS NULL THEN RAISE EXCEPTION 'enter the total amount that is in the bank account' USING ERRCODE = '23514'; END IF;
  v_new := round(p_new, 4);
  IF v_new < 0 THEN RAISE EXCEPTION 'the balance cannot be negative' USING ERRCODE = '23514'; END IF;
  IF NOT app_can_snapshot(p_account) THEN RAISE EXCEPTION 'you may not update the balance of this account' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM company_bank_accounts WHERE id = p_account FOR UPDATE;  -- two updates cannot both read the same "previous"
  IF v_new < a.reserved_balance THEN
    RAISE EXCEPTION 'The balance cannot be lowered below the funds already reserved (ETB %). Resolve the pending payment requests first.', to_char(a.reserved_balance, 'FM999,999,999,990.00') USING ERRCODE = '23514';
  END IF;
  UPDATE company_bank_accounts SET current_balance = v_new, balance_updated_at = clock_timestamp() WHERE id = p_account;
  INSERT INTO bank_balance_history (account_id, previous_balance, new_balance, updated_by) VALUES (p_account, a.current_balance, v_new, app_user_id()) RETURNING * INTO h;
  PERFORM treasury_audit(account_owner_company(p_account), 'BANK_BALANCE_UPDATED', 'BANK_ACCOUNT', p_account,
                         jsonb_build_object('previous', a.current_balance, 'new', v_new));
  RETURN h;
END $$;

-- History with the name of whoever updated it. Names are shown to everyone who can see the account, including other companies
-- that share it (they could not otherwise read the other company's users).
CREATE FUNCTION account_balance_history(p_account uuid, p_limit int DEFAULT 10)
RETURNS TABLE (id uuid, updated_at timestamptz, previous_balance numeric, new_balance numeric, updated_by uuid, updated_by_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT h.id, h.updated_at, h.previous_balance, h.new_balance, h.updated_by, u.full_name
        FROM bank_balance_history h JOIN users u ON u.id = h.updated_by
       WHERE h.account_id = p_account AND app_can_see_account(p_account)
       ORDER BY h.updated_at DESC, h.id DESC LIMIT LEAST(GREATEST(p_limit, 1), 100) $$;

REVOKE EXECUTE ON FUNCTION update_bank_balance(uuid, numeric), account_balance_history(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_bank_balance(uuid, numeric), account_balance_history(uuid, int) TO abig_app;
