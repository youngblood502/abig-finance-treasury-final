# Removing the old treasury engine

The prepared script is `ops/pending/remove-legacy-engine.sql`. It is **not** a migration yet, so `ops/migrate.mjs` does not run it. It drops six tables, one trigger on a live table, 22 functions and one type, and cannot be undone except by restoring a backup. Do the steps below in order.

## What it removes

| Kind | Objects |
|---|---|
| Tables (the six in the development plan) | `cash_reservations`, `cash_ledger_entries`, `payment_transactions`, `payment_reversals`, `bank_balance_snapshots`, `account_use_approvals`, with their row-level security policies, grants, guard and append-only triggers |
| Trigger on a live table | `account_access_release` on `company_bank_account_access`. It only closed rows in `cash_reservations`; since the treasury refactor a request releases its own held funds, and withdrawing access is refused while funds are held (`20261109000200_access_withdrawal_held_funds`) |
| Functions | `treasury_confirm_schedule`, `treasury_schedule_queue`, `treasury_recommend`, `treasury_reserve`, `treasury_release`, `treasury_record_payment`, `treasury_reverse_payment`, `treasury_manual_movement`, `treasury_release_orphaned`, `treasury_enqueue_overdue`, `report_outstanding`, `report_payments`, `installment_balances`, `installment_outstanding`, `account_forecast`, `_forecast`, `account_cash_position`, `_cash_position`, `assert_account_use`, `access_revoked_release`, `reservation_guard`, `snapshot_audit` |
| Type | `cash_position` |

None of these is used by the application, the worker, a view or a current database function. No table that stays has a foreign key to the six tables. Task 3A (`20261109001000`) already removed EXECUTE on the callable functions.

Left for a separate decision: `cash_forecast_items` (with `forecast_add`, `forecast_cancel`, `forecast_guard`), `idempotency_keys` (only the removed `treasury_record_payment` used it) and `removed_owner_approval_settings` (kept on purpose as the record of a removed setting).

## 1. Back up and prove the backup restores

```bash
ops/backup.sh
ops/restore-drill.sh <the new dump>
```

Keep this dump until the change has been live for at least one full weekly reconciliation.

## 2. Check, read only, that the live tables are empty

Run as a read-only session on the live database (the operator does this; it is never done from a development session):

```sql
BEGIN READ ONLY;
SELECT 'cash_reservations' AS t, count(*) FROM cash_reservations
UNION ALL SELECT 'cash_ledger_entries', count(*) FROM cash_ledger_entries
UNION ALL SELECT 'payment_transactions', count(*) FROM payment_transactions
UNION ALL SELECT 'payment_reversals', count(*) FROM payment_reversals
UNION ALL SELECT 'bank_balance_snapshots', count(*) FROM bank_balance_snapshots
UNION ALL SELECT 'account_use_approvals', count(*) FROM account_use_approvals;
ROLLBACK;
```

Every count must be 0. If any is not, stop: those rows are history from the old engine and must be reviewed and archived first. The script refuses to run on a non-empty table anyway.

## 3. Update the restore drill

`ops/restore-drill.sh` counts `payment_transactions` and `cash_ledger_entries`. In the same change that applies the script, replace those two counts with current tables, for example:

```bash
SELECT 'requests', count(*) FROM payment_requests UNION ALL SELECT 'balance entries', count(*) FROM bank_balance_history UNION ALL SELECT 'reconciliation lines', count(*) FROM reconciliation_lines UNION ALL SELECT 'audit events', count(*) FROM audit_events
```

## 4. Rehearse on a restored copy

1. Copy the script to `prisma/migrations/<timestamp>_remove_legacy_engine/migration.sql`.
2. Restore the backup into a scratch database and run `ops/migrate.mjs` against it.
3. Run `ops/verify-integrity.sql`: every line must show 0.
4. Click through a submission, a verification, an authentication, a balance check, a reconciliation lock and withdrawing an account's access.

## 5. Apply

In a quiet period, with the worker stopped: run `ops/migrate.mjs`, run `ops/verify-integrity.sql`, start the worker. To go back, restore the step 1 backup.
