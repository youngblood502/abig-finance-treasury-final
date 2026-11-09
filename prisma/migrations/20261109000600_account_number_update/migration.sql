-- ABIG Finance - Entering the full number of an existing company bank account, and revealing supplier numbers only through a live supplier link.
--
-- 1. set_account_number(account, last4, encrypted, replace_last4)
--    Accounts registered before full numbers were kept have only their last four digits. The account owner's managers (bank_account:manage on the
--    owning company, as for registering an account and its settings) may now enter or correct the full number. Only the number and its last four
--    digits change: the account keeps its id, owner, access grants, balance, reservations and history. The application encrypts the number; the
--    application role still cannot read or write the column itself. If the number entered ends in different digits from the ones on record, the
--    caller must say so (replace_last4), so that a typing mistake cannot silently relabel an account. Each change is audited as ACCOUNT_NUMBER_SET
--    with the last four digits before and after, never the number.
--
-- 2. Supplier reveal follows the existing meaning of "this company uses this supplier" (app_supplier_active_for, as used to submit requests):
--    the link is ACTIVE and the supplier is active. Before, any link counted, so a company whose link was made INACTIVE or BLOCKED, or a supplier that
--    was deactivated, still let members reveal its bank numbers. Verifying, rejecting and entering bank details are not changed.

CREATE OR REPLACE FUNCTION app_supplier_reveal_company(p_detail uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT cs.company_id FROM supplier_bank_details d JOIN company_suppliers cs ON cs.supplier_id = d.supplier_id
       WHERE d.id = p_detail AND app_user_id() IS NOT NULL AND cs.company_id IN (SELECT app_member_companies())
         AND app_supplier_active_for(cs.company_id, d.supplier_id)
         AND (app_has_permission(cs.company_id, 'payment_request:verify') OR app_has_permission(cs.company_id, 'payment_request:authenticate')
              OR app_has_permission(cs.company_id, 'supplier:manage'))
       ORDER BY cs.created_at, cs.company_id LIMIT 1 $$;

CREATE FUNCTION set_account_number(p_account uuid, p_last4 text, p_enc text, p_replace_last4 boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a company_bank_accounts; v_owner uuid;
BEGIN
  v_owner := account_owner_company(p_account);
  IF app_user_id() IS NULL OR v_owner IS NULL OR NOT app_has_permission(v_owner, 'bank_account:manage') THEN
    RAISE EXCEPTION 'only a manager of the company that owns this account can change its number' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO a FROM company_bank_accounts WHERE id = p_account FOR UPDATE;
  IF a.account_kind <> 'BANK' THEN RAISE EXCEPTION 'only a bank account has an account number' USING ERRCODE = '23514'; END IF;
  IF coalesce(p_last4, '') !~ '^[0-9]{4}$' OR coalesce(p_enc, '') NOT LIKE 'v1:%' THEN RAISE EXCEPTION 'the full account number is required' USING ERRCODE = '23514'; END IF;
  IF p_last4 <> a.account_last4 AND NOT coalesce(p_replace_last4, false) THEN
    RAISE EXCEPTION 'the number entered ends in %, but this account is recorded as ending in %; confirm that the account number itself is changing', p_last4, a.account_last4
      USING ERRCODE = '23514';
  END IF;
  UPDATE company_bank_accounts SET account_number_enc = p_enc, account_last4 = p_last4 WHERE id = p_account;
  PERFORM treasury_audit(v_owner, 'ACCOUNT_NUMBER_SET', 'BANK_ACCOUNT', p_account,
    jsonb_build_object('previous_last4', a.account_last4, 'last4', p_last4, 'had_full_number', a.account_number_enc IS NOT NULL));
END $$;

REVOKE EXECUTE ON FUNCTION set_account_number(uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_account_number(uuid, text, text, boolean) TO abig_app;
