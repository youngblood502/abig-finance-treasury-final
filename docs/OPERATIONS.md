# Operations guide

## What you need
ABIG Finance runs on PostgreSQL 18 everywhere: production, development and tests. `pg_dump` and `pg_restore` must be version 18 too.
One Linux server (2 CPU, 4 GB is plenty for this load), a domain name pointing at it, an email account for notifications (SMTP), and Docker with the compose plugin. The database, website, worker and HTTPS proxy all run from `docker-compose.yml`.

## First deployment
1. `cp .env.production.example .env.production` and fill in every value. Generate passwords with `openssl rand -base64 24` and the encryption key with `openssl rand -base64 32`. **Store the encryption key in your password vault**: without it, nobody's two-step verification can be read and everyone must be reset.
2. `docker compose --env-file .env.production up -d --build`. This builds the images, creates the database, applies every migration, gives the three application roles their passwords, and starts the site behind automatic HTTPS.
3. Create the first administrator (the command prints a temporary password once):
   `docker compose --env-file .env.production run --rm migrate node ops/bootstrap-admin.mjs you@yourcompany.com "Your Name"`
4. Open https://your-domain, sign in, choose a new password, set up two-step verification.
5. In Administration: add the companies, add people, give roles. Then, as the right people, enter suppliers, bank accounts and the first bank balances. Do not load demo data in production.

## Upgrading
**A server still on PostgreSQL 16.** PostgreSQL cannot open an older data folder, and the Compose volume now mounts at a different path, so changing the image alone will not work. Take a backup with `ops/backup.sh`, stop the stack, create a new empty volume, start the `db` service on version 18, restore the dump as described under Backups, then start the rest.
`git pull` (or unzip the new version), then `docker compose --env-file .env.production up -d --build`. Migrations run automatically and only once each. The runner stops, changing nothing, if an already-applied migration file was edited. **Take a backup before every upgrade.**

## Go-live: requests authenticated during testing
Agreed decision: these become Paid at go-live. No migration does this, so it never happens by itself. After a backup, run it once as the owner role, naming the person responsible:
`psql "$MIGRATION_DATABASE_URL" -c "SELECT mark_authenticated_paid_at_go_live('<user id>', 'Test data, marked Paid at go-live')"`
It moves no money (they were debited when authenticated), it is written to the audit trail, and the status is final. Run it only once real payments have not started: afterwards every authenticated request is treated as paid.

## Choosing a company

Someone with more than one company picks one, or "All my companies", at the top of the page. Lists, totals, reports and exports follow the choice. It only narrows what they see: the choice is checked on every request against their own companies, and row-level security still decides what is visible. An account shared with the chosen company is shown whole, because it has one balance.

## Shared accounts and privacy

A shared account has one balance, and each payment on it belongs to one company. Finance staff of the company that owns the account see everything, because they reconcile it. Others who may enter its balance see a payment's number, company, method and amount, so they can tick it, but not who it pays. Everyone else sees the balance and their own company's payments; other companies' payments are left out of the log. Group reporting on the owner company does not widen this. The balance itself cannot be hidden from those who share it, so anyone who sees it at two moments can work out the net change.

## The weekly cycle

Run the go-live step above before the first Monday opening. From then on each account runs in weeks, Monday to Sunday, in Addis Ababa time.

- **Opening.** The Accountant enters each account's figure on Monday. Payments carried over are listed for ticking. Balance checks are refused until the week has its opening.
- **Balance checks.** System balance = bank figure minus the authenticated payments not ticked as processed. Implied deposit = new system balance minus the previous one. Transfers and Telebirr are ticked by default, cheques are not, and cash is never listed. A negative implied deposit, one above the account's threshold (ETB 500,000 unless changed under Manage this account), and a balance that changed between weeks are flagged on the log.
- **Reconciliation.** The Accountant of the company that owns the account enters the statement's closing balance and deposits, matches payments, and adds charges and other items. For a cash account the count replaces the statement. Tick "a balance check already picked this up" on an item that an earlier check has already taken into the balance.
- **Two figures must be settled before it can be sent.** Balance difference = closing balance minus unmatched payments minus the system balance at the end of the week, minus the items that adjust the balance: it must be zero. Deposit difference = statement deposits minus implied deposits, plus the items a check already picked up: zero, or explained in writing. Every unmatched payment needs a reason to carry over.
- **Review and lock.** A Finance Manager of the owner company reviews, then locks or returns it. Nobody who worked on it can lock it. Matched payments become Paid at the lock, not at the match, because Paid is final and the review must be able to change the answer. Items that adjust the balance are posted at the lock, unless a bank figure entered in a later week already includes them.
- **After a lock.** The week never changes; a correction is a line in the next week. Anything that happens after the lock belongs to the next week, even if the calendar week has not ended. Weeks of one account lock in order. Unmatched payments stay outstanding and are flagged once 14 days have passed since authentication.

## Encryption key
People's ID numbers are encrypted with `APP_ENCRYPTION_KEY`, and duplicates are found with a hash built from the same key. Set the key before the first person is entered. Keep a copy somewhere safe, apart from the backups: without it, encrypted ID numbers cannot be read, and changing it makes existing ones unreadable and stops duplicates being found.

## Backups (do this before go-live)
`ops/backup.sh` writes a database dump and a copy of the uploaded invoices, with checksums, and removes copies older than 30 days. Run it from cron every night, as the owner of the backup folder:
`0 2 * * * MIGRATION_DATABASE_URL=... BACKUP_DIR=/var/backups/abig STORAGE_DIR=/path/to/storage /path/to/ops/backup.sh`
Set `BACKUP_GPG_RECIPIENT` to encrypt the files, and **copy the backup folder off the server** (a second location). A backup that lives only on the same disk is not a backup.
**Restore drill, monthly:** `ADMIN_DATABASE_URL=... BACKUP_DIR=... ops/restore-drill.sh` restores the newest dump into a scratch database, runs the money integrity checks and prints PASSED or FAILED. Do it once now, and after any change to the backup process.
To restore for real: create an empty database, `pg_restore --no-owner --dbname=... file.dump`, run `node ops/migrate.mjs --baseline` only if the dump has no `schema_migrations` table, unpack the files archive into the storage folder, then start the services.

## Checks you can run any time
- `npm run check:integrity` (or `psql -f ops/verify-integrity.sql`): every row it prints with a violation count above zero needs investigating. All zeros is healthy.
- `https://your-domain/api/health` answers `{"status":"ok"}`; point an uptime monitor at it.
- Administration shows recent sign-in activity; Reports, Audit trail shows who did what.
- Worker log lines are JSON; watch for `tick failed` (mail or database trouble). Notifications are retried with increasing delays and given up after 8 attempts; look in `notification_outbox` for rows with `dead_at` set.

## Security notes
- Sign-in: passwords of 12+ characters (hashed with scrypt), lock for 15 minutes after 5 wrong tries, 8-hour sessions that end after 30 idle minutes, two-step verification (required in production for finance roles and administrators), temporary passwords that must be changed. Sessions are random values stored only as hashes.
- Credentials sit behind their own database role; the website's role cannot read password hashes, two-step secrets or sessions. Company data is separated by row-level security in the database, so a bug in a screen cannot show one company another's records.
- History tables (approvals, adjustments, payments, ledger, audit, sign-in events) cannot be changed or deleted, even by the owner role without deliberately disabling safeguards.
- Expose only the proxy (ports 80 and 443). The app trusts the proxy's X-Forwarded-For header for the sign-in log; never publish the app container directly.
- Keep the server patched, restrict SSH to keys, and use the provider's firewall.

## Before you call it live (things software cannot do for you)
1. Treasury and Finance sign off the policy defaults listed in the README, in writing.
2. An independent security review or penetration test of the deployed site, and a decision on retention of invoices and audit records (Legal).
3. A tested backup copy stored somewhere other than the server, and one successful restore drill.
4. A pilot with real but low-risk data in two companies, reconciling balances and payments with the bank for a few weeks, before moving the group over.
5. A named person who owns the system: users, backups, upgrades, and reading the integrity check.

## Known limits
Bank balances and statements are entered by hand; there is no bank connection or automatic reconciliation. Account numbers are stored as last four digits only. Uploads are checked for type and size but not scanned for malware. Notifications are email only. The app has been tested with data volumes of a demo, not a load test; for ~15 companies it is expected to be comfortable but measure during the pilot.
