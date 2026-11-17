-- ABIG Finance - A reservation and a withdrawal of access cannot pass each other.
--
-- Both now decide under the same lock, the bank account's row. Whichever takes it first finishes, and the other then sees the result:
--   reservation first   the withdrawal waits, finds the funds held, and is refused (account_access_guard, 20261109000200).
--   withdrawal first    the reservation waits, finds the access gone, and is refused here, with nothing reserved.
-- Before this, a reservation checked access before taking the lock, so a withdrawal could commit between the two and leave a request holding funds on an account
-- its company could no longer use. This is the one place every new hold passes through: submitting, moving a held request to another account, or holding more.
-- Each check is its own statement in a volatile function, so at READ COMMITTED it sees what committed while it waited for the lock.
-- Only the check is added. Every calculation, the order of the locks and all messages stay as they were. Reserving less, keeping a hold unchanged, and
-- authenticating or cancelling a held request are not new holds and are not affected.

CREATE OR REPLACE FUNCTION payment_request_funds_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE old_hold boolean := false; new_hold boolean; a company_bank_accounts;
BEGIN
  new_hold := NEW.workflow_state IN ('RESERVED','VERIFIED');
  IF TG_OP = 'UPDATE' THEN old_hold := OLD.workflow_state IN ('RESERVED','VERIFIED') AND OLD.debit_account_id IS NOT NULL; END IF;

  -- VERIFIED -> AUTHENTICATED: debit. Only a verified request, with both approvers recorded, and with its lock still in place.
  -- Still allowed during a shortfall if the balance covers this payment: it lowers the balance and the reserved funds alike.
  IF NEW.workflow_state = 'AUTHENTICATED' AND (TG_OP = 'INSERT' OR OLD.workflow_state <> 'AUTHENTICATED') THEN
    IF TG_OP = 'INSERT' OR OLD.workflow_state <> 'VERIFIED' THEN RAISE EXCEPTION 'only a verified request can be authenticated' USING ERRCODE = '42501'; END IF;
    IF NEW.verified_by IS NULL OR NEW.authenticated_by IS NULL THEN RAISE EXCEPTION 'the verifier and the authenticator must be recorded' USING ERRCODE = '42501'; END IF;
    IF NEW.debit_account_id IS NULL THEN RAISE EXCEPTION 'this request has no debit account; return it to its creator to choose one' USING ERRCODE = '23514'; END IF;
    IF NOT old_hold OR NEW.debit_account_id <> OLD.debit_account_id OR NEW.total_amount <> OLD.total_amount THEN
      RAISE EXCEPTION 'the funds for this request are not reserved as approved' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO a FROM company_bank_accounts WHERE id = NEW.debit_account_id FOR UPDATE;
    IF NEW.total_amount > a.current_balance THEN
      RAISE EXCEPTION 'The account balance (ETB %) is lower than the amount (ETB %). Update the bank balance first.',
        to_char(a.current_balance, 'FM999,999,999,990.00'), to_char(NEW.total_amount, 'FM999,999,999,990.00') USING ERRCODE = '23514';
    END IF;
    UPDATE company_bank_accounts SET current_balance = current_balance - NEW.total_amount, reserved_balance = reserved_balance - NEW.total_amount,
           balance_updated_at = clock_timestamp() WHERE id = a.id;
    INSERT INTO bank_balance_history (account_id, previous_balance, new_balance, updated_by, request_id)
    VALUES (a.id, a.current_balance, a.current_balance - NEW.total_amount, NEW.authenticated_by, NEW.id);
    RETURN NEW;
  END IF;

  IF NOT old_hold AND NOT new_hold THEN RETURN NEW; END IF;
  IF new_hold AND NEW.debit_account_id IS NULL THEN RAISE EXCEPTION 'choose the bank account the payment will be debited from' USING ERRCODE = '23514'; END IF;
  -- Nothing moves when the lock stays exactly as it was (for example RESERVED -> VERIFIED).
  IF old_hold AND new_hold AND NEW.debit_account_id = OLD.debit_account_id AND NEW.total_amount = OLD.total_amount THEN RETURN NEW; END IF;

  -- Lock the account rows in a fixed order so two requests cannot deadlock each other.
  PERFORM 1 FROM company_bank_accounts WHERE id IN (CASE WHEN old_hold THEN OLD.debit_account_id END, CASE WHEN new_hold THEN NEW.debit_account_id END) ORDER BY id FOR UPDATE;

  -- Reserving less on the same account only gives money back, so it is always allowed, even during a shortfall.
  IF old_hold AND new_hold AND NEW.debit_account_id = OLD.debit_account_id AND NEW.total_amount < OLD.total_amount THEN
    UPDATE company_bank_accounts SET reserved_balance = reserved_balance - (OLD.total_amount - NEW.total_amount) WHERE id = NEW.debit_account_id;
    RETURN NEW;
  END IF;

  -- Checked here, under the account lock, and not only before it: a withdrawal of this company's access takes the same lock, so it has either committed
  -- and is seen now, or it waits and then sees these funds held.
  IF new_hold AND NEW.debtor_company_id NOT IN (SELECT app_granted_companies(NEW.debit_account_id, 'USE')) THEN
    RAISE EXCEPTION 'the debit account is not available to this company' USING ERRCODE = '23514';
  END IF;

  IF new_hold THEN
    SELECT * INTO a FROM company_bank_accounts WHERE id = NEW.debit_account_id;
    IF a.shortfall_amount > 0 THEN
      RAISE EXCEPTION 'This account is in shortfall: its balance (ETB %) is ETB % below the reserved funds (ETB %). New submissions are blocked until the shortfall is cleared.',
        to_char(a.current_balance, 'FM999,999,999,990.00'), to_char(a.shortfall_amount, 'FM999,999,999,990.00'), to_char(a.reserved_balance, 'FM999,999,999,990.00') USING ERRCODE = '23514';
    END IF;
  END IF;
  IF old_hold THEN
    UPDATE company_bank_accounts SET reserved_balance = reserved_balance - OLD.total_amount WHERE id = OLD.debit_account_id;
  END IF;
  IF new_hold THEN
    SELECT * INTO a FROM company_bank_accounts WHERE id = NEW.debit_account_id;
    IF NEW.total_amount > a.available_balance THEN
      RAISE EXCEPTION 'The requested amount (ETB %) is more than the available balance (ETB %) on this account, which keeps a minimum buffer of ETB %.',
        to_char(NEW.total_amount, 'FM999,999,999,990.00'), to_char(a.available_balance, 'FM999,999,999,990.00'), to_char(a.min_buffer, 'FM999,999,999,990.00') USING ERRCODE = '23514';
    END IF;
    UPDATE company_bank_accounts SET reserved_balance = reserved_balance + NEW.total_amount WHERE id = NEW.debit_account_id;
  END IF;
  RETURN NEW;
END $$;
