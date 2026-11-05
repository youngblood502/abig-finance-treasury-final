# Graph Report - abig-finance-treasury  (2026-11-05)

## Corpus Check
- 96 files · ~80,644 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 10 file(s) not represented in the graph (top: (none) 6, .example 2, .prisma 1)

## Summary
- 921 nodes · 2485 edges · 51 communities (35 shown, 16 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 46 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d8a89b15`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Session and RBAC Pages
- phase1.test.ts
- Auth and Admin Actions
- Documentation and Workflows
- Payment Workflow Actions
- Foundation Schema and Guards
- Roles and Memberships
- Suppliers and Requests Schema
- Workflow Schema and Adjustments
- Dev Dependencies
- Payment Request Approvals
- 20261015000000_treasury/migration.sql
- 20261106000000_phase2_payees_accounts/migration.sql
- TypeScript Compiler Config
- helpers.ts
- NPM Scripts
- Runtime Dependencies
- Compose Database Service
- payees.test.ts
- Compose Migrate Service
- Scheduler and Cash Forecast
- pg
- Request Reservation Guards
- Compose Service Topology
- @types/nodemailer@^8.0.2
- Workflow Adjust Function
- @types/react@^19.0.0
- typescript@^5.6.0
- Sessions and Auth Events
- 20261105000100_phase1_money_logic/migration.sql
- Compose Proxy Service
- App Environment Variables
- Compose Volumes
- Compose Build Targets
- Worker Environment Variables
- Next.js Config and CSP
- Restore Drill Script
- Graphify Skill References
- Notifications Worker Doc
- Backup Script
- React DOM Types
- vitest
- ABIG Brand Logo
- Supplier Bank Versioning
- treasury.test.ts
- bank_balance_history
- phase2.test.ts

## God Nodes (most connected - your core abstractions)
1. `payment_requests` - 79 edges
2. `withUser()` - 57 edges
3. `users` - 44 edges
4. `company_bank_accounts` - 43 edges
5. `currentUserId()` - 40 edges
6. `payment_installments` - 34 edges
7. `requireMe()` - 33 edges
8. `rows()` - 29 edges
9. `Flash()` - 29 edges
10. `pg` - 24 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `company_bank_accounts_wallet_phone` --indexes--> `company_bank_accounts`  [EXTRACTED]
  abig-finance/prisma/migrations/20261106000000_phase2_payees_accounts/migration.sql → abig-finance/prisma/migrations/20261012000000_foundation/migration.sql
- `payment_requests_person_invoice_once` --indexes--> `payment_requests`  [EXTRACTED]
  abig-finance/prisma/migrations/20261106000000_phase2_payees_accounts/migration.sql → abig-finance/prisma/migrations/20261013000000_suppliers_requests/migration.sql
- `assert_method_fits_account()` --reads_from--> `company_bank_accounts`  [EXTRACTED]
  abig-finance/prisma/migrations/20261106000000_phase2_payees_accounts/migration.sql → abig-finance/prisma/migrations/20261012000000_foundation/migration.sql

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (51 total, 16 thin omitted)

### Community 0 - "Session and RBAC Pages"
Cohesion: 0.07
Nodes (89): Password(), Security(), Accounts(), switchUser(), Admin(), GET(), dynamic, Approvals() (+81 more)

### Community 1 - "phase1.test.ts"
Cohesion: 0.11
Nodes (18): nodemailer@^10.1.1, compose(), Mail, makeSender(), OutboxEvent, Sender, SUBJECTS, tick() (+10 more)

### Community 2 - "Auth and Admin Actions"
Cohesion: 0.08
Nodes (67): addGroupGrant(), admin(), audit(), createCompany(), createRole(), createUser(), done(), resetMfa() (+59 more)

### Community 3 - "Documentation and Workflows"
Cohesion: 0.05
Nodes (43): Encryption key (APP_ENCRYPTION_KEY), ops/backup.sh, Docker Compose deployment, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Migration runner (ops/migrate.mjs) (+35 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.09
Nodes (55): act(), addBankDetail(), addPerson(), addPersonDetail(), addSupplier(), adjustRequest(), createAndSubmitRequest(), createRequest() (+47 more)

### Community 5 - "Foundation Schema and Guards"
Cohesion: 0.08
Nodes (36): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_manage_access(), app_can_see_account() (+28 more)

### Community 6 - "Roles and Memberships"
Cohesion: 0.11
Nodes (33): app_member_companies(), company_memberships, users, company_role_users(), app_member_companies(), app_permitted_companies(), assert_role_company_limit(), company_role_users() (+25 more)

### Community 7 - "Suppliers and Requests Schema"
Cohesion: 0.10
Nodes (29): app_can_edit_draft(), app_can_see_request(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx (+21 more)

### Community 8 - "Workflow Schema and Adjustments"
Cohesion: 0.10
Nodes (22): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+14 more)

### Community 9 - "Dev Dependencies"
Cohesion: 0.13
Nodes (20): devDependencies, esbuild@^0.24.0, prisma@^6.0.0, smtp-server@^3.19.22, tsx@^4.19.0, @types/node@^22.0.0, @types/pg@^8.11.0, @types/qrcode@^1.5.6 (+12 more)

### Community 10 - "Payment Request Approvals"
Cohesion: 0.16
Nodes (13): payment_requests, outbox_recipients(), wf_assert_actor(), wf_lock(), wf_submit(), outbox_recipients(), account_balance_history(), app_actionable_requests() (+5 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.09
Nodes (37): payment_installments, access_revoked_release(), account_access_release, app_can_see_funding(), cash_ledger_account_time_idx, cash_ledger_entries, _cash_position(), cash_reservations (+29 more)

### Community 12 - "20261106000000_phase2_payees_accounts/migration.sql"
Cohesion: 0.13
Nodes (19): app_person_active_for(), assert_method_fits_account(), assert_submittable(), company_bank_accounts_wallet_phone, payment_request_cash_processed(), payment_requests_cash_processed, payment_requests_person_invoice_once, person_detail_add() (+11 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "helpers.ts"
Cohesion: 0.19
Nodes (14): ASKU, BERBERO, BERBERO_ID, fails(), key(), MkOpts, root, S_ETHIO (+6 more)

### Community 15 - "NPM Scripts"
Cohesion: 0.14
Nodes (14): scripts, bootstrap:admin, build, build:worker, check:integrity, db:demo, db:seed, demo:passwords (+6 more)

### Community 16 - "Runtime Dependencies"
Cohesion: 0.18
Nodes (11): dependencies, next@^15.2.0, pg@^8.13.0, qrcode@^1.5.4, react@^19.0.0, react-dom@^19.0.0, zod@^3.23.0, qrcode (+3 more)

### Community 17 - "Compose Database Service"
Cohesion: 0.17
Nodes (12): environment, healthcheck, image, restart, volumes, POSTGRES_DB, POSTGRES_PASSWORD, interval (+4 more)

### Community 18 - "payees.test.ts"
Cohesion: 0.17
Nodes (13): AWASH, CBE, rows(), user, addDetail(), addPerson(), balance(), state() (+5 more)

### Community 19 - "Compose Migrate Service"
Cohesion: 0.18
Nodes (11): condition, db, APP_DB_PASSWORD, AUTH_DB_PASSWORD, MIGRATION_DATABASE_URL, WORKER_DB_PASSWORD, command, depends_on (+3 more)

### Community 20 - "Scheduler and Cash Forecast"
Cohesion: 0.18
Nodes (15): account_use_approvals, account_use_one_active, approvals_no_delete, assert_account_use(), owner_revoke_account_use(), cash_forecast_account_idx, cash_forecast_guard, cash_forecast_items (+7 more)

### Community 21 - "pg"
Cohesion: 0.16
Nodes (12): b, c, [email, ...nameParts], name, temp, c, hashPassword(), ADMIN_URL (+4 more)

### Community 22 - "Request Reservation Guards"
Cohesion: 0.20
Nodes (6): app_can_edit_draft(), attachment_guard(), installment_guard(), payment_request_funds_guard(), payment_requests_funds_guard, wf_submit()

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 28 - "Sessions and Auth Events"
Cohesion: 0.16
Nodes (17): companies, app_supplier_active_for(), company_suppliers, suppliers, treasury_schedule_queue(), admin_create_company(), auth_events, auth_events_append_only (+9 more)

### Community 29 - "20261105000100_phase1_money_logic/migration.sql"
Cohesion: 0.12
Nodes (13): wf_set_state(), banks, mark_authenticated_paid_at_go_live(), outbox_recipients(), payment_request_funds_guard(), payment_requests_invoice_once, record_execution(), register_bank_account() (+5 more)

### Community 30 - "Compose Proxy Service"
Cohesion: 0.25
Nodes (8): APP_DOMAIN, depends_on, environment, image, ports, restart, volumes, proxy

### Community 31 - "App Environment Variables"
Cohesion: 0.33
Nodes (6): environment, APP_ENCRYPTION_KEY, AUTH_DATABASE_URL, DATABASE_URL, REQUIRE_MFA, STORAGE_DIR

### Community 32 - "Compose Volumes"
Cohesion: 0.40
Nodes (4): volumes, caddydata, dbdata, storage

### Community 33 - "Compose Build Targets"
Cohesion: 0.60
Nodes (5): build, context, target, build, build

### Community 34 - "Worker Environment Variables"
Cohesion: 0.40
Nodes (5): APP_URL, MAIL_FROM, SMTP_URL, WORKER_DATABASE_URL, environment

### Community 43 - "vitest"
Cohesion: 0.16
Nodes (8): c, dir, files, files(), before, ids, snapshot(), vitest

### Community 48 - "treasury.test.ts"
Cohesion: 0.26
Nodes (12): actAs(), authorized(), fn(), mk(), inbox, submitted(), sub(), submitted() (+4 more)

### Community 49 - "bank_balance_history"
Cohesion: 0.24
Nodes (7): account_balance_history(), bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), update_bank_balance()

### Community 50 - "phase2.test.ts"
Cohesion: 0.29
Nodes (8): BD_ADDIS, BD_HAWASSA, S_ADDIS, addAtt(), draft(), inst(), key(), ready()

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)`, `Migration runner (ops/migrate.mjs)`, `Local test copy setup` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 230 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `pg` to `Session and RBAC Pages`, `phase1.test.ts`, `Auth and Admin Actions`, `Dev Dependencies`, `vitest`, `helpers.ts`, `Runtime Dependencies`, `treasury.test.ts`, `payees.test.ts`, `phase2.test.ts`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Session and RBAC Pages` be split into smaller, more focused modules?**
  _Cohesion score 0.06707988980716253 - nodes in this community are weakly interconnected._
- **Why does `payment_requests` connect `Payment Request Approvals` to `Foundation Schema and Guards`, `Roles and Memberships`, `Suppliers and Requests Schema`, `Workflow Schema and Adjustments`, `20261015000000_treasury/migration.sql`, `20261106000000_phase2_payees_accounts/migration.sql`, `Scheduler and Cash Forecast`, `Request Reservation Guards`, `Workflow Adjust Function`, `Sessions and Auth Events`, `20261105000100_phase1_money_logic/migration.sql`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Should `phase1.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10507246376811594 - nodes in this community are weakly interconnected._
- **Why does `users` connect `Roles and Memberships` to `Foundation Schema and Guards`, `Suppliers and Requests Schema`, `Workflow Schema and Adjustments`, `Payment Request Approvals`, `20261015000000_treasury/migration.sql`, `20261106000000_phase2_payees_accounts/migration.sql`, `bank_balance_history`, `Scheduler and Cash Forecast`, `Sessions and Auth Events`, `20261105000100_phase1_money_logic/migration.sql`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Should `Auth and Admin Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.08385964912280702 - nodes in this community are weakly interconnected._