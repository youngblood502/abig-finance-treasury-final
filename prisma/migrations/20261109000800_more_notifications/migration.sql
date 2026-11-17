-- ABIG Finance - Notifications for events that had none. They use the existing outbox: each is written in the same transaction as the action that
-- causes it, and recipients are resolved by outbox_recipients when the worker sends it, so access removed in between is respected.
--
--   REQUEST_PAID                    lock_week marks the request Paid              the request's creator (the existing default rule)
--   RECONCILIATION_SUBMITTED        submit_reconciliation                         reconciliation:lock holders of the owning company who did not work on
--                                                                                 the week (lock_week refuses those); nobody once it is no longer awaiting
--                                                                                 review or was sent again (a newer revision has its own event)
--   RECONCILIATION_RETURNED         return_reconciliation                         whoever sent it and whoever started it, if they still hold reconciliation:prepare
--   RECONCILIATION_LOCKED           lock_week                                     the same
--   ACCOUNT_OPENING_OVERDUE         enqueue_missing_openings (worker, hourly)     bank_balance:update holders of companies that may enter the account's
--                                   once Monday (Addis Ababa) has ended with no   balance (RECORD_SNAPSHOT); nobody once the opening is in.
--                                   opening for the account's week                Once per account and week.
--   SUPPLIER_BANK_DETAILS_PENDING   a supplier bank detail version is entered     payment_request:verify holders of companies with a live link to the supplier
--                                                                                 (ACTIVE, supplier active), except whoever entered it; nobody once decided
--   PERSON_DETAILS_PENDING          a person's payment detail version is entered  payment_request:verify holders of the person's company, except whoever
--                                                                                 entered it; nobody once decided
--   ACCOUNT_ACCESS_GRANTED          another company is given access to an account bank_account:view holders of that company
--   ACCOUNT_ACCESS_WITHDRAWN        that access is withdrawn                      the same
--   USER_LOCKED                     an account locks after repeated failed sign-ins   the user
--   PASSWORD_RESET_COMPLETED        the user sets their own password after an        the user
--                                   administrator's reset
--
-- Payloads carry names, labels, dates and the return reason only: never an account number, encrypted value, ID number or amount.
-- Entries made without a signed-in user (seed data, operator scripts) do not notify. Nothing about payments, reconciliation, access, sign-in or
-- approval rules changes, and the delivery engine (claims, leases, retries) is untouched.

-- An event without a request was allowed only for ACCOUNT_SHORTFALL. The new events about weeks, accounts, bank details and users have none.
ALTER TABLE notification_outbox DROP CONSTRAINT notification_outbox_subject_chk;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_subject_chk CHECK (request_id IS NOT NULL OR event_type IN (
  'ACCOUNT_SHORTFALL', 'RECONCILIATION_SUBMITTED', 'RECONCILIATION_RETURNED', 'RECONCILIATION_LOCKED', 'ACCOUNT_OPENING_OVERDUE',
  'SUPPLIER_BANK_DETAILS_PENDING', 'PERSON_DETAILS_PENDING', 'ACCOUNT_ACCESS_GRANTED', 'ACCOUNT_ACCESS_WITHDRAWN', 'USER_LOCKED', 'PASSWORD_RESET_COMPLETED'));

-- What a reconciliation email needs to know about its week.
CREATE FUNCTION recon_notice(w treasury_weeks) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT jsonb_build_object('week_id', w.id, 'account_id', w.account_id, 'week_start', w.week_start,
                                'account_label', (SELECT account_label FROM company_bank_accounts WHERE id = w.account_id), 'path', '/treasury/week/' || w.id) $$;
REVOKE EXECUTE ON FUNCTION recon_notice(treasury_weeks) FROM PUBLIC;

-- ---------- Request paid (one per request, when the week that pays it is locked) and reconciliation locked ----------
CREATE OR REPLACE FUNCTION public.lock_week(p_week uuid, p_expected_revision integer)
 RETURNS treasury_weeks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    PERFORM wf_notify(m.request_id, 'REQUEST_PAID');
    PERFORM treasury_audit(m.company_id, 'PAYMENT_MARKED_PAID', 'PAYMENT_REQUEST', m.request_id, jsonb_build_object('week', p_week, 'statement_date', m.statement_date, 'amount', m.amount));
  END LOOP;

  UPDATE treasury_weeks SET status = 'LOCKED', locked_by = me, locked_at = clock_timestamp(), system_balance = f.system_balance, unmatched_total = f.unmatched_total,
         implied_deposits_total = f.implied_total, adjustments_total = f.adjust_total, adjustment_posted = posted, balance_difference = f.balance_difference, deposit_difference = f.deposit_difference
   WHERE id = p_week RETURNING * INTO w;
  INSERT INTO notification_outbox (event_type, payload) VALUES ('RECONCILIATION_LOCKED', recon_notice(w));
  PERFORM treasury_audit(account_owner_company(w.account_id), 'WEEK_LOCKED', 'TREASURY_WEEK', p_week,
    jsonb_build_object('week', w.week_start, 'system_balance', f.system_balance, 'unmatched', f.unmatched_total, 'adjustments', f.adjust_total, 'adjustment_posted', posted, 'deposit_difference', f.deposit_difference));
  RETURN w;
END $function$;

-- ---------- Reconciliation submitted ----------
CREATE OR REPLACE FUNCTION public.submit_reconciliation(p_week uuid, p_expected_revision integer, p_carry_reasons jsonb DEFAULT '{}'::jsonb, p_deposit_explanation text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  INSERT INTO notification_outbox (event_type, payload) VALUES ('RECONCILIATION_SUBMITTED', recon_notice(w) || jsonb_build_object('revision', w.revision));
  PERFORM treasury_audit(account_owner_company(w.account_id), 'RECONCILIATION_SUBMITTED', 'TREASURY_WEEK', p_week, jsonb_build_object('week', w.week_start));
  RETURN w.revision;
END $function$;

-- ---------- Reconciliation returned ----------
CREATE OR REPLACE FUNCTION public.return_reconciliation(p_week uuid, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE w treasury_weeks;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'a reason is required' USING ERRCODE = '23514'; END IF;
  w := recon_lock(p_week);
  PERFORM assert_can_review(w);
  UPDATE reconciliation_lines SET voided_by = app_user_id(), voided_at = clock_timestamp(), void_reason = 'Returned for changes' WHERE week_id = p_week AND kind = 'CARRY' AND voided_at IS NULL;
  -- Told to the person who sent it, captured before the return clears it.
  INSERT INTO notification_outbox (event_type, payload) VALUES ('RECONCILIATION_RETURNED', recon_notice(w) || jsonb_build_object('reason', btrim(p_reason), 'prepared_by', w.prepared_by));
  UPDATE treasury_weeks SET prepared_by = NULL, prepared_at = NULL, return_reason = btrim(p_reason), revision = revision + 1 WHERE id = p_week RETURNING * INTO w;
  PERFORM treasury_audit(account_owner_company(w.account_id), 'RECONCILIATION_RETURNED', 'TREASURY_WEEK', p_week, jsonb_build_object('reason', btrim(p_reason)));
  RETURN w.revision;
END $function$;

-- ---------- Recipients: the existing rules are unchanged; the new events are resolved before them ----------
CREATE OR REPLACE FUNCTION public.outbox_recipients(p_event uuid)
 RETURNS TABLE(user_id uuid, email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER ROWS 10
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE e notification_outbox; r payment_requests; ids uuid[]; w treasury_weeks; owner_c uuid; acct uuid; sd supplier_bank_details; pd person_payment_details; pc uuid;
BEGIN
  SELECT * INTO e FROM notification_outbox WHERE id = p_event;
  IF e.event_type = 'ACCOUNT_SHORTFALL' THEN
    -- Finance Managers of every company linked to the account: a shared account's shortfall affects all of them.
    ids := ARRAY(SELECT DISTINCT x FROM company_bank_account_access g CROSS JOIN LATERAL company_role_users(g.company_id, 'VERIFIER') x
                  WHERE g.account_id = (e.payload->>'account_id')::uuid AND g.revoked_at IS NULL);
    RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
    RETURN;
  END IF;
  IF e.event_type IN ('RECONCILIATION_SUBMITTED','RECONCILIATION_RETURNED','RECONCILIATION_LOCKED') THEN
    SELECT * INTO w FROM treasury_weeks WHERE id = (e.payload->>'week_id')::uuid;
    owner_c := account_owner_company(w.account_id);
    IF e.event_type = 'RECONCILIATION_SUBMITTED' THEN
      -- Reviewers who may lock it: not anyone who worked on it, and nobody once it was returned or locked. A submission that was returned and
      -- sent again has a newer revision and its own event, so the older one goes to nobody.
      ids := CASE WHEN w.status = 'RECONCILING' AND w.prepared_at IS NOT NULL AND w.revision = (e.payload->>'revision')::int THEN
               ARRAY(SELECT x FROM company_permission_users(owner_c, 'reconciliation:lock') x
                      WHERE x IS DISTINCT FROM w.prepared_by AND x IS DISTINCT FROM w.started_by
                        AND NOT EXISTS (SELECT 1 FROM reconciliation_lines l WHERE l.week_id = w.id AND l.created_by = x))
             ELSE '{}'::uuid[] END;
    ELSE
      ids := ARRAY(SELECT x FROM company_permission_users(owner_c, 'reconciliation:prepare') x
                    WHERE x = (e.payload->>'prepared_by')::uuid OR x = w.prepared_by OR x = w.started_by);
    END IF;
    RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
    RETURN;
  END IF;
  IF e.event_type = 'ACCOUNT_OPENING_OVERDUE' THEN
    acct := (e.payload->>'account_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM company_bank_accounts a WHERE a.id = acct AND a.is_active)
       OR EXISTS (SELECT 1 FROM treasury_weeks t WHERE t.account_id = acct AND t.week_start = (e.payload->>'week_start')::date AND t.opening_entry_id IS NOT NULL) THEN
      RETURN;
    END IF;
    ids := ARRAY(SELECT DISTINCT x FROM app_granted_companies(acct, 'RECORD_SNAPSHOT') g CROSS JOIN LATERAL company_permission_users(g, 'bank_balance:update') x);
    RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
    RETURN;
  END IF;
  IF e.event_type = 'SUPPLIER_BANK_DETAILS_PENDING' THEN
    SELECT * INTO sd FROM supplier_bank_details WHERE id = (e.payload->>'detail_id')::uuid;
    IF NOT FOUND OR sd.status <> 'PENDING' THEN RETURN; END IF;
    ids := ARRAY(SELECT DISTINCT x FROM company_suppliers cs CROSS JOIN LATERAL company_permission_users(cs.company_id, 'payment_request:verify') x
                  WHERE cs.supplier_id = sd.supplier_id AND app_supplier_active_for(cs.company_id, sd.supplier_id) AND x <> sd.created_by);
    RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
    RETURN;
  END IF;
  IF e.event_type = 'PERSON_DETAILS_PENDING' THEN
    SELECT * INTO pd FROM person_payment_details WHERE id = (e.payload->>'detail_id')::uuid;
    IF NOT FOUND OR pd.status <> 'PENDING' THEN RETURN; END IF;
    SELECT company_id INTO pc FROM person_payees WHERE id = pd.person_id;
    ids := ARRAY(SELECT x FROM company_permission_users(pc, 'payment_request:verify') x WHERE x <> pd.created_by);
    RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
    RETURN;
  END IF;
  IF e.event_type IN ('ACCOUNT_ACCESS_GRANTED','ACCOUNT_ACCESS_WITHDRAWN') THEN
    ids := ARRAY(SELECT x FROM company_permission_users((e.payload->>'company_id')::uuid, 'bank_account:view') x);
    RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
    RETURN;
  END IF;
  IF e.event_type IN ('USER_LOCKED','PASSWORD_RESET_COMPLETED') THEN
    RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = (e.payload->>'user_id')::uuid;
    RETURN;
  END IF;
  SELECT * INTO r FROM payment_requests WHERE id = e.request_id;
  IF e.event_type IN ('REQUEST_SUBMITTED','REQUEST_RESTARTED') THEN
    ids := ARRAY(SELECT x FROM company_role_users(r.debtor_company_id, 'VERIFIER') x
                 WHERE x <> r.created_by AND x NOT IN (SELECT wf_stage_actors(r.id, 'AUTHORIZATION')));
  ELSIF e.event_type = 'REQUEST_VERIFIED' THEN
    ids := ARRAY(SELECT x FROM company_role_users(r.debtor_company_id, 'AUTHENTICATOR') x
                 WHERE x <> r.created_by AND x NOT IN (SELECT wf_stage_actors(r.id, 'VERIFICATION')));
  ELSIF e.event_type = 'REQUEST_OVERDUE' THEN
    ids := ARRAY(SELECT x FROM company_permission_users(r.debtor_company_id,
                   CASE r.workflow_state WHEN 'RESERVED' THEN 'payment_request:verify' ELSE 'payment_request:authenticate' END) x WHERE x <> r.created_by) || r.created_by;
  ELSIF e.event_type IN ('REQUEST_AUTHORIZED','REQUEST_RESCHEDULE_NEEDED') THEN
    ids := ARRAY(SELECT x FROM company_role_users(r.debtor_company_id, 'TREASURY') x) || r.created_by;
  ELSE
    ids := ARRAY[r.created_by];
  END IF;
  RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.is_active AND u.id = ANY (ids) ORDER BY u.email;
END $function$;

-- ---------- Opening overdue: queued by the worker every hour, once per account and week ----------
CREATE UNIQUE INDEX notification_outbox_opening_overdue_once ON notification_outbox ((payload->>'account_id'), (payload->>'week_start')) WHERE event_type = 'ACCOUNT_OPENING_OVERDUE';

CREATE FUNCTION enqueue_missing_openings() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET "TimeZone" = 'Africa/Addis_Ababa' AS $$
DECLARE n int;
BEGIN
  INSERT INTO notification_outbox (event_type, payload)
  SELECT 'ACCOUNT_OPENING_OVERDUE', jsonb_build_object('account_id', a.id, 'account_label', a.account_label, 'week_start', x.wk, 'path', '/treasury/' || a.id)
    FROM company_bank_accounts a CROSS JOIN LATERAL (SELECT treasury_week_start(a.id) AS wk) x
   WHERE a.is_active AND addis_day(treasury_now()) > x.wk
     AND NOT EXISTS (SELECT 1 FROM treasury_weeks t WHERE t.account_id = a.id AND t.week_start = x.wk AND t.opening_entry_id IS NOT NULL)
  ON CONFLICT ((payload->>'account_id'), (payload->>'week_start')) WHERE event_type = 'ACCOUNT_OPENING_OVERDUE' DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ---------- Bank details waiting for verification ----------
CREATE FUNCTION notify_supplier_details_pending() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_user_id() IS NOT NULL AND NEW.status = 'PENDING' THEN
    INSERT INTO notification_outbox (event_type, payload)
    SELECT 'SUPPLIER_BANK_DETAILS_PENDING', jsonb_build_object('detail_id', NEW.id, 'supplier_id', NEW.supplier_id, 'supplier_name', s.legal_name, 'version', NEW.version, 'path', '/suppliers')
      FROM suppliers s WHERE s.id = NEW.supplier_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER supplier_bank_details_notify AFTER INSERT ON supplier_bank_details FOR EACH ROW EXECUTE FUNCTION notify_supplier_details_pending();

CREATE FUNCTION notify_person_details_pending() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_user_id() IS NOT NULL AND NEW.status = 'PENDING' THEN
    INSERT INTO notification_outbox (event_type, payload)
    SELECT 'PERSON_DETAILS_PENDING', jsonb_build_object('detail_id', NEW.id, 'person_id', NEW.person_id, 'person_name', p.full_name, 'kind', NEW.kind, 'version', NEW.version, 'path', '/payees')
      FROM person_payees p WHERE p.id = NEW.person_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER person_payment_details_notify AFTER INSERT ON person_payment_details FOR EACH ROW EXECUTE FUNCTION notify_person_details_pending();

-- ---------- Account access given to, or withdrawn from, another company (not the owner's own link) ----------
CREATE FUNCTION notify_account_access() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t text;
BEGIN
  IF app_user_id() IS NULL OR NEW.is_owner THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' AND NEW.revoked_at IS NULL THEN t := 'ACCOUNT_ACCESS_GRANTED';
  ELSIF TG_OP = 'UPDATE' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN t := 'ACCOUNT_ACCESS_WITHDRAWN';
  ELSE RETURN NULL; END IF;
  INSERT INTO notification_outbox (event_type, payload)
  SELECT t, jsonb_build_object('access_id', NEW.id, 'account_id', NEW.account_id, 'account_label', a.account_label, 'company_id', NEW.company_id, 'company_name', c.legal_name, 'path', '/accounts')
    FROM company_bank_accounts a, companies c WHERE a.id = NEW.account_id AND c.id = NEW.company_id;
  RETURN NULL;
END $$;
CREATE TRIGGER account_access_notify AFTER INSERT OR UPDATE OF revoked_at ON company_bank_account_access FOR EACH ROW EXECUTE FUNCTION notify_account_access();

-- ---------- The user's own account: locked, and a reset password replaced ----------
CREATE FUNCTION notify_user_account() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Only the moment it becomes locked: a lock that is already in force is not reported again.
  IF NEW.locked_until IS NOT NULL AND NEW.locked_until > now() AND (OLD.locked_until IS NULL OR OLD.locked_until <= now()) THEN
    INSERT INTO notification_outbox (event_type, payload) VALUES ('USER_LOCKED', jsonb_build_object('user_id', NEW.id, 'path', '/login'));
  END IF;
  IF OLD.must_change_password AND NOT NEW.must_change_password AND NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    INSERT INTO notification_outbox (event_type, payload) VALUES ('PASSWORD_RESET_COMPLETED', jsonb_build_object('user_id', NEW.id, 'path', '/login'));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER users_notify AFTER UPDATE OF locked_until, must_change_password ON users FOR EACH ROW EXECUTE FUNCTION notify_user_account();

-- ---------- Grants ----------
REVOKE EXECUTE ON FUNCTION enqueue_missing_openings(), notify_supplier_details_pending(), notify_person_details_pending(), notify_account_access(), notify_user_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_missing_openings() TO abig_worker;
