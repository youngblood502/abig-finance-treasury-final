-- ABIG Finance - Phase 6 Task 4 (part 2): remove the old treasury engine.
--
-- PREPARED, NOT APPLIED. This file is deliberately outside prisma/migrations, so ops/migrate.mjs never runs it. It drops tables and functions
-- and cannot be undone except by restoring a backup. Follow docs/LEGACY-CLEANUP.md first: a verified backup, the read-only emptiness checks on the
-- live database, and a rehearsal on a restored copy. To apply it, copy it into a new prisma/migrations/<timestamp>_remove_legacy_engine folder.
--
-- What it removes (the six tables named in the development plan, and everything that depends on them):
--   Tables     cash_reservations, cash_ledger_entries, payment_transactions, payment_reversals, bank_balance_snapshots, account_use_approvals
--              (their row-level security policies, grants, guard and append-only triggers go with them)
--   Trigger    account_access_release on company_bank_account_access (a live table): it only closed rows in cash_reservations; held funds are
--              released by the request itself since the treasury refactor (20261109000200_access_withdrawal_held_funds)
--   Functions  20 functions that read or write those tables, listed below; none is called by the application, the worker, a view or a current
--              function (Task 3A already revoked EXECUTE on the callable ones)
--   Type       cash_position (returned only by _cash_position and account_cash_position)
-- Not removed here (separate decisions): cash_forecast_items with forecast_add, forecast_cancel and forecast_guard; idempotency_keys (used only by the
-- removed treasury_record_payment); removed_owner_approval_settings (kept on purpose as the record of a removed setting).

-- ---------- Preconditions: stop unless the tables are empty and nothing else depends on them ----------
DO $$
DECLARE t text; n bigint; extra text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cash_reservations','cash_ledger_entries','payment_transactions','payment_reversals','bank_balance_snapshots','account_use_approvals'] LOOP
    EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
    IF n > 0 THEN RAISE EXCEPTION 'legacy table % still has % row(s); it must be empty (and backed up) before removal', t, n; END IF;
  END LOOP;
  -- Any function outside the list below that mentions one of the tables would break: stop instead.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO extra FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
     AND pg_get_functiondef(p.oid) ~ '\m(cash_reservations|cash_ledger_entries|payment_transactions|payment_reversals|bank_balance_snapshots|account_use_approvals)\M'
     AND p.proname NOT IN ('_cash_position','account_cash_position','_forecast','account_forecast','installment_outstanding','installment_balances','assert_account_use',
                           'access_revoked_release','reservation_guard','snapshot_audit','treasury_reserve','treasury_release','treasury_record_payment',
                           'treasury_reverse_payment','treasury_manual_movement','treasury_release_orphaned','treasury_recommend','treasury_schedule_queue',
                           'treasury_confirm_schedule','treasury_enqueue_overdue','report_outstanding','report_payments');
  IF extra IS NOT NULL THEN RAISE EXCEPTION 'unexpected functions still use the legacy tables: %', extra; END IF;
  -- No view, and no foreign key from a table that stays.
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public'
               AND definition ~ '\m(cash_reservations|cash_ledger_entries|payment_transactions|payment_reversals|bank_balance_snapshots|account_use_approvals)\M') THEN
    RAISE EXCEPTION 'a view still uses the legacy tables';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint k WHERE k.contype = 'f'
               AND k.confrelid::regclass::text IN ('cash_reservations','cash_ledger_entries','payment_transactions','payment_reversals','bank_balance_snapshots','account_use_approvals')
               AND k.conrelid::regclass::text NOT IN ('cash_reservations','cash_ledger_entries','payment_transactions','payment_reversals','bank_balance_snapshots','account_use_approvals')) THEN
    RAISE EXCEPTION 'a table that stays still has a foreign key to a legacy table';
  END IF;
END $$;

-- ---------- The live table's trigger that wrote to cash_reservations ----------
DROP TRIGGER account_access_release ON company_bank_account_access;

-- ---------- Functions that use the legacy tables (callers first) ----------
DROP FUNCTION treasury_confirm_schedule(uuid, uuid, date, text, numeric);
DROP FUNCTION treasury_schedule_queue();
DROP FUNCTION treasury_recommend(uuid);
DROP FUNCTION treasury_reserve(uuid, uuid, numeric, date, text);
DROP FUNCTION treasury_release(uuid, text);
DROP FUNCTION treasury_record_payment(uuid, uuid, numeric, timestamptz, text, text);
DROP FUNCTION treasury_reverse_payment(uuid, text);
DROP FUNCTION treasury_manual_movement(uuid, numeric, timestamptz, text);
DROP FUNCTION treasury_release_orphaned();
DROP FUNCTION treasury_enqueue_overdue();
DROP FUNCTION report_outstanding();
DROP FUNCTION report_payments(date, date);
DROP FUNCTION installment_balances(uuid);
DROP FUNCTION account_forecast(uuid, integer);
DROP FUNCTION _forecast(uuid, integer);
DROP FUNCTION account_cash_position(uuid);
DROP FUNCTION assert_account_use(uuid, uuid, uuid);
DROP FUNCTION access_revoked_release();

-- ---------- The six tables (referencing tables first; RESTRICT, so anything unexpected stops it) ----------
DROP TABLE payment_reversals RESTRICT;
DROP TABLE cash_ledger_entries RESTRICT;
DROP TABLE payment_transactions RESTRICT;
DROP TABLE account_use_approvals RESTRICT;
DROP TABLE cash_reservations RESTRICT;
DROP TABLE bank_balance_snapshots RESTRICT;

-- ---------- What only the tables used ----------
DROP FUNCTION reservation_guard();
DROP FUNCTION snapshot_audit();
DROP FUNCTION installment_outstanding(uuid);
DROP FUNCTION _cash_position(uuid);
DROP TYPE cash_position RESTRICT;
