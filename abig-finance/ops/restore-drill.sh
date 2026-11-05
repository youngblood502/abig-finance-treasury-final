#!/usr/bin/env bash
# Proves a backup can be restored: restores the newest dump into a throw-away database and runs the integrity checks.
# Run it monthly and after every change to the backup process.
#   ADMIN_DATABASE_URL=postgresql://postgres:pw@host:5432/postgres BACKUP_DIR=/var/backups/abig ./ops/restore-drill.sh
set -euo pipefail
: "${ADMIN_DATABASE_URL:?connection to the maintenance database with CREATEDB rights}" "${BACKUP_DIR:?set BACKUP_DIR}"
DUMP=$(ls -1t "$BACKUP_DIR"/abig-db-*.dump 2>/dev/null | head -1 || true)
if [ -z "$DUMP" ]; then echo "No unencrypted dump found in $BACKUP_DIR (decrypt the .gpg file first)."; exit 2; fi
SCRATCH="abig_restore_drill_$(date -u +%s)"; HERE=$(cd "$(dirname "$0")" && pwd)
BASE="${ADMIN_DATABASE_URL%/*}"
psql "$ADMIN_DATABASE_URL" -qc "CREATE DATABASE $SCRATCH"
cleanup() { psql "$ADMIN_DATABASE_URL" -qc "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null 2>&1 || true; }; trap cleanup EXIT
echo "Restoring $(basename "$DUMP") into $SCRATCH ..."
pg_restore --no-owner --dbname="$BASE/$SCRATCH" "$DUMP" 2>&1 | grep -v "already exists" || true
echo "Row counts:"; psql "$BASE/$SCRATCH" -Atc "SELECT 'requests', count(*) FROM payment_requests UNION ALL SELECT 'payments', count(*) FROM payment_transactions UNION ALL SELECT 'ledger entries', count(*) FROM cash_ledger_entries UNION ALL SELECT 'audit events', count(*) FROM audit_events" | sed 's/|/: /;s/^/  /'
echo "Integrity checks:"; OUT=$(psql "$BASE/$SCRATCH" -At -F'|' -f "$HERE/verify-integrity.sql")
echo "$OUT" | awk -F'|' '{printf "  %-4s %s\n", ($2==0?"ok":"FAIL"), $1 " (" $2 ")"}'
if echo "$OUT" | awk -F'|' '$2>0{f=1} END{exit !f}'; then echo "DRILL FAILED"; exit 1; fi
echo "DRILL PASSED: the backup restores and the money checks are clean."
