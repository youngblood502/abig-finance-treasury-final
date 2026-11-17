# Removing the old treasury engine

The old engine's tables are removed by the migration `20261110000400_remove_legacy_engine`, as part of the normal migration sequence.

## Deployment approach: a fresh installation

ABIG Finance is deployed to a new Ubuntu server with a new, empty PostgreSQL database. `ops/migrate.mjs` applies every migration in `prisma/migrations` from the beginning. Earlier migrations create the old engine's tables; on a new database they never hold data, and `20261110000400` then removes them.

The old live database is **not** migrated. Keep its final backup, made with `ops/backup.sh` on the old server, as an archive for as long as your record-keeping rules require. Nothing in this repository reads it.

## What the migration removes

| Kind | Objects |
|---|---|
| Tables (the six in the development plan) | `cash_reservations`, `cash_ledger_entries`, `payment_transactions`, `payment_reversals`, `bank_balance_snapshots`, `account_use_approvals`, with their row-level security policies, grants, guard and append-only triggers |
| Trigger on a live table | `account_access_release` on `company_bank_account_access`. It only closed rows in `cash_reservations`. A request releases its own held funds, and withdrawing access is refused while funds are held (`20261109000200_access_withdrawal_held_funds`) |
| Functions (22) | `treasury_confirm_schedule`, `treasury_schedule_queue`, `treasury_recommend`, `treasury_reserve`, `treasury_release`, `treasury_record_payment`, `treasury_reverse_payment`, `treasury_manual_movement`, `treasury_release_orphaned`, `treasury_enqueue_overdue`, `report_outstanding`, `report_payments`, `installment_balances`, `installment_outstanding`, `account_forecast`, `_forecast`, `account_cash_position`, `_cash_position`, `assert_account_use`, `access_revoked_release`, `reservation_guard`, `snapshot_audit` |
| Type | `cash_position` |

Kept on purpose: `cash_forecast_items` (with `forecast_add`, `forecast_cancel`, `forecast_guard`), `idempotency_keys` and `removed_owner_approval_settings`.

## Safety checks in the migration

Before it drops anything, the migration stops the whole migration run (nothing is changed) if:

1. any of the six tables holds a row;
2. a function other than the 22 listed uses one of the six tables;
3. a view uses one of the six tables;
4. a table that stays has a foreign key to one of the six tables.

Tables, functions and the type are dropped with `RESTRICT`, so any other unexpected dependency also stops it.

On a fresh installation all four checks pass. If the migration is ever run against a database that was used and still holds old-engine rows, it refuses; those rows would have to be reviewed and archived first, which this project does not plan to do.

## Installing on the new server

1. Create the database and roles, and set `MIGRATION_DATABASE_URL` to the owner role.
2. Run `node ops/migrate.mjs`. It applies every migration once, `20261110000400` included, and refuses to continue if an applied migration was edited.
3. Run `ops/verify-integrity.sql`: every line must show 0.
4. Set up `ops/backup.sh` and run `ops/restore-drill.sh` once the first backup exists. The drill counts current tables (requests, balance entries, reconciliation lines, notifications, audit events) and runs the integrity checks.
