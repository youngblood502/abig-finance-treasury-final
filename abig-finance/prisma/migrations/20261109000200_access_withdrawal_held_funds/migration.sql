-- ABIG Finance - A company's access to an account cannot be withdrawn while its requests hold funds there.
--
-- Withdrawing access left a Reserved or Verified request stranded: verifying and authenticating it are refused because the company no longer has the account,
-- its funds stayed reserved against the owner's balance, and only the company itself could clear them by cancelling. The request must now be finished or
-- cancelled first, as with a supplier that has requests in progress. Authenticated and Paid payments do not block this: they hold no reservation, they stay on
-- the record, and the account's owner still reconciles them. No grant, reservation, balance or request changes here.

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
  -- The account lock is the one every reservation takes, so a reservation in flight is either seen here or waits for this to finish.
  PERFORM 1 FROM company_bank_accounts WHERE id = OLD.account_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM payment_requests r WHERE r.debit_account_id = OLD.account_id AND r.debtor_company_id = OLD.company_id AND r.workflow_state IN ('RESERVED','VERIFIED')) THEN
    RAISE EXCEPTION 'this company has requests holding funds on this account; finish or cancel them before withdrawing its access' USING ERRCODE = '23514';
  END IF;
  NEW.revoked_at := now(); NEW.revoked_by := app_user_id();
  RETURN NEW;
END $$;
