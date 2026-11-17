#!/usr/bin/env bash
# Daily backup: database dump + uploaded invoice files, with checksums and retention.
#   MIGRATION_DATABASE_URL=... BACKUP_DIR=/var/backups/abig STORAGE_DIR=/var/lib/abig/storage ./ops/backup.sh
# Optional: BACKUP_GPG_RECIPIENT=key-id encrypts both files; BACKUP_KEEP_DAYS (default 30).
set -euo pipefail
: "${MIGRATION_DATABASE_URL:?set MIGRATION_DATABASE_URL}" "${BACKUP_DIR:?set BACKUP_DIR}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$BACKUP_DIR"; umask 077
DB="$BACKUP_DIR/abig-db-$STAMP.dump"; FILES="$BACKUP_DIR/abig-files-$STAMP.tar.gz"
pg_dump --format=custom --no-owner --file="$DB" "$MIGRATION_DATABASE_URL"
if [ -n "${STORAGE_DIR:-}" ] && [ -d "$STORAGE_DIR" ]; then tar -C "$STORAGE_DIR" -czf "$FILES" . ; fi
if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
  for f in "$DB" "$FILES"; do [ -f "$f" ] && gpg --batch --yes --trust-model always -r "$BACKUP_GPG_RECIPIENT" -o "$f.gpg" -e "$f" && rm -f "$f"; done
fi
( cd "$BACKUP_DIR" && sha256sum abig-*-"$STAMP"* > "SHA256SUMS-$STAMP" )
find "$BACKUP_DIR" -type f -name 'abig-*' -mtime +"${BACKUP_KEEP_DAYS:-30}" -delete
find "$BACKUP_DIR" -type f -name 'SHA256SUMS-*' -mtime +"${BACKUP_KEEP_DAYS:-30}" -delete
echo "Backup written: $STAMP"; ls -1 "$BACKUP_DIR" | grep "$STAMP"
