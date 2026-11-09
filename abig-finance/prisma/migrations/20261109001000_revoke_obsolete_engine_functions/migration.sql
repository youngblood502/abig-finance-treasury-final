-- ABIG Finance - Phase 6 Task 3A: the old engine's scheduler and money functions can no longer be called by the application or the worker.
--
-- These belong to the engine that the treasury refactor and Phases 1-3 replaced (reservations on payment_requests, balance checks, weekly
-- reconciliation). Nothing calls them any more:
--   * no application code, operator script, test or document refers to any of them;
--   * no view uses them, and the only database caller is treasury_confirm_schedule calling treasury_reserve, both in this list;
--   * the worker's jobs are enqueue_overdue_requests, enqueue_missing_openings and purge_expired_sessions, not the two old worker functions below.
-- Several are already broken: treasury_schedule_queue and treasury_enqueue_overdue use the AUTHORIZED status, which no longer exists, and most of
-- the others read or write the old tables (cash_reservations, cash_ledger_entries, cash_forecast_items, payment_transactions, payment_reversals).
-- Most were still callable by everyone through PostgreSQL's default PUBLIC grant, so PUBLIC is revoked as well as the two roles.
--
-- Nothing is dropped: the functions and the old tables stay until the clean-up task removes them after a final backup. The owner can still run
-- them. Trigger functions are not touched (a trigger runs whatever the caller's EXECUTE rights), and no other function's permissions change.

REVOKE EXECUTE ON FUNCTION
  account_forecast(uuid, integer),
  forecast_add(uuid, text, numeric, date, text),
  forecast_cancel(uuid, text),
  installment_balances(uuid),
  report_outstanding(),
  report_payments(date, date),
  treasury_confirm_schedule(uuid, uuid, date, text, numeric),
  treasury_enqueue_overdue(),
  treasury_manual_movement(uuid, numeric, timestamptz, text),
  treasury_recommend(uuid),
  treasury_record_payment(uuid, uuid, numeric, timestamptz, text, text),
  treasury_release(uuid, text),
  treasury_release_orphaned(),
  treasury_reserve(uuid, uuid, numeric, date, text),
  treasury_reverse_payment(uuid, text),
  treasury_schedule_queue()
FROM PUBLIC, abig_app, abig_worker;
