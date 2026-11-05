# Graph Report - abig-finance-treasury  (2026-11-05)

## Corpus Check
- 86 files · ~61,474 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: (none) 4, .example 2, .prisma 1)

## Summary
- 809 nodes · 2073 edges · 48 communities (34 shown, 14 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 30 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Session and RBAC Pages
- Integration Test Suite
- Auth and Admin Actions
- Documentation and Workflows
- Payment Workflow Actions
- Foundation Schema and Guards
- Roles and Memberships
- Suppliers and Requests Schema
- Workflow Schema and Adjustments
- Dev Dependencies
- Payment Request Approvals
- Treasury Reservations
- Treasury Refactor Schema
- TypeScript Compiler Config
- Companies and Installments
- NPM Scripts
- Runtime Dependencies
- Compose Database Service
- Bank Account Use Approvals
- Compose Migrate Service
- Scheduler and Cash Forecast
- Cash Ledger
- Request Reservation Guards
- Compose Service Topology
- Notification Outbox
- Workflow Adjust Function
- Users and Group Permissions
- Payments and Reversals
- Sessions and Auth Events
- Bank Balance History
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
- tsx Dependency
- React DOM Types
- smtp-server Types
- ABIG Brand Logo
- Supplier Bank Versioning

## God Nodes (most connected - your core abstractions)
1. `payment_requests` - 67 edges
2. `withUser()` - 51 edges
3. `users` - 41 edges
4. `currentUserId()` - 38 edges
5. `company_bank_accounts` - 36 edges
6. `payment_installments` - 33 edges
7. `requireMe()` - 31 edges
8. `Flash()` - 27 edges
9. `cash_reservations` - 20 edges
10. `admin()` - 20 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `memberships_reactivate` --triggers--> `company_memberships`  [EXTRACTED]
  abig-finance/prisma/migrations/20261027000000_treasury_refactor/migration.sql → abig-finance/prisma/migrations/20261012000000_foundation/migration.sql
- `app_can_snapshot()` --reads_from--> `company_bank_accounts`  [EXTRACTED]
  abig-finance/prisma/migrations/20261027000000_treasury_refactor/migration.sql → abig-finance/prisma/migrations/20261012000000_foundation/migration.sql
- `payment_request_account_guard()` --reads_from--> `company_bank_accounts`  [EXTRACTED]
  abig-finance/prisma/migrations/20261027000000_treasury_refactor/migration.sql → abig-finance/prisma/migrations/20261012000000_foundation/migration.sql

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]

## Communities (48 total, 14 thin omitted)

### Community 0 - "Session and RBAC Pages"
Cohesion: 0.07
Nodes (76): Password(), Security(), Accounts(), switchUser(), Admin(), GET(), dynamic, Approvals() (+68 more)

### Community 1 - "Integration Test Suite"
Cohesion: 0.05
Nodes (66): b, c, [email, ...nameParts], name, temp, c, hashPassword(), c (+58 more)

### Community 2 - "Auth and Admin Actions"
Cohesion: 0.09
Nodes (66): addGroupGrant(), admin(), audit(), createCompany(), createRole(), createUser(), done(), resetMfa() (+58 more)

### Community 3 - "Documentation and Workflows"
Cohesion: 0.05
Nodes (43): Encryption key (APP_ENCRYPTION_KEY), ops/backup.sh, Docker Compose deployment, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Migration runner (ops/migrate.mjs) (+35 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.13
Nodes (35): act(), addBankDetail(), addSupplier(), adjustRequest(), createRequest(), dbl(), decideBankDetail(), grantAccess() (+27 more)

### Community 5 - "Foundation Schema and Guards"
Cohesion: 0.10
Nodes (25): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_see_account(), app_can_snapshot() (+17 more)

### Community 6 - "Roles and Memberships"
Cohesion: 0.19
Nodes (21): company_memberships, app_member_companies(), app_permitted_companies(), assert_role_company_limit(), company_role_users(), membership_roles, memberships_reactivate_guard(), permissions (+13 more)

### Community 7 - "Suppliers and Requests Schema"
Cohesion: 0.15
Nodes (21): attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx, bank_detail_guard(), installment_guard() (+13 more)

### Community 8 - "Workflow Schema and Adjustments"
Cohesion: 0.12
Nodes (16): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+8 more)

### Community 9 - "Dev Dependencies"
Cohesion: 0.12
Nodes (22): devDependencies, esbuild@^0.24.0, prisma@^6.0.0, smtp-server@^3.19.22, @types/node@^22.0.0, @types/nodemailer@^8.0.2, @types/pg@^8.11.0, @types/qrcode@^1.5.6 (+14 more)

### Community 10 - "Payment Request Approvals"
Cohesion: 0.12
Nodes (16): app_can_edit_draft(), app_can_see_request(), payment_requests, payment_requests_company_state_idx, payment_requests_invoice_once, payment_requests_no_delete, assert_submittable(), wf_assert_actor() (+8 more)

### Community 11 - "Treasury Reservations"
Cohesion: 0.16
Nodes (17): access_revoked_release(), account_access_release, bank_balance_snapshots_audit, _cash_position(), cash_reservations, cash_reservations_account_idx, cash_reservations_guard, cash_reservations_one_active (+9 more)

### Community 12 - "Treasury Refactor Schema"
Cohesion: 0.12
Nodes (10): app_can_snapshot(), banks, membership_roles_limit, membership_roles_limit_guard(), memberships_reactivate, payment_request_account_guard(), payment_requests_debit_account_guard, register_bank_account() (+2 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "Companies and Installments"
Cohesion: 0.16
Nodes (17): companies, app_supplier_active_for(), company_suppliers, installments_guard, payment_installments, suppliers, installment_balances(), request_payment_status() (+9 more)

### Community 15 - "NPM Scripts"
Cohesion: 0.14
Nodes (14): scripts, bootstrap:admin, build, build:worker, check:integrity, db:demo, db:seed, demo:passwords (+6 more)

### Community 16 - "Runtime Dependencies"
Cohesion: 0.15
Nodes (13): dependencies, next@^15.2.0, nodemailer@^10.1.1, pg@^8.13.0, qrcode@^1.5.4, react@^19.0.0, react-dom@^19.0.0, zod@^3.23.0 (+5 more)

### Community 17 - "Compose Database Service"
Cohesion: 0.17
Nodes (12): environment, healthcheck, image, restart, volumes, POSTGRES_DB, POSTGRES_PASSWORD, interval (+4 more)

### Community 18 - "Bank Account Use Approvals"
Cohesion: 0.20
Nodes (12): app_can_manage_access(), company_bank_accounts, account_use_approvals, account_use_one_active, app_can_see_funding(), approvals_no_delete, assert_account_use(), owner_approve_account_use() (+4 more)

### Community 19 - "Compose Migrate Service"
Cohesion: 0.18
Nodes (11): condition, db, APP_DB_PASSWORD, AUTH_DB_PASSWORD, MIGRATION_DATABASE_URL, WORKER_DB_PASSWORD, command, depends_on (+3 more)

### Community 20 - "Scheduler and Cash Forecast"
Cohesion: 0.31
Nodes (8): cash_forecast_account_idx, cash_forecast_guard, cash_forecast_items, cash_forecast_no_delete, _forecast(), forecast_cancel(), forecast_guard(), treasury_recommend()

### Community 21 - "Cash Ledger"
Cohesion: 0.20
Nodes (7): cash_ledger_account_time_idx, cash_ledger_entries, ledger_append_only, ledger_no_truncate, treasury_manual_movement(), treasury_record_payment(), treasury_reverse_payment()

### Community 22 - "Request Reservation Guards"
Cohesion: 0.20
Nodes (6): app_can_edit_draft(), attachment_guard(), installment_guard(), payment_request_funds_guard(), payment_requests_funds_guard, wf_submit()

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 24 - "Notification Outbox"
Cohesion: 0.22
Nodes (9): notification_outbox, notification_outbox_pending_idx, outbox_claim(), outbox_complete(), outbox_fail(), outbox_recipients(), wf_notify(), outbox_recipients() (+1 more)

### Community 26 - "Users and Group Permissions"
Cohesion: 0.25
Nodes (8): app_group_companies(), app_is_admin(), app_member_companies(), group_grants_one_active, group_permission_grants, users, company_role_users(), roles_limit_change_guard()

### Community 27 - "Payments and Reversals"
Cohesion: 0.28
Nodes (9): installment_outstanding(), payment_reversals, payment_transactions, payment_transactions_installment_idx, payments_append_only, payments_no_truncate, reversals_append_only, reversals_no_truncate (+1 more)

### Community 28 - "Sessions and Auth Events"
Cohesion: 0.33
Nodes (7): auth_events, auth_events_append_only, auth_events_no_truncate, auth_events_time_idx, sessions, sessions_user_idx, set_treasury_settings()

### Community 29 - "Bank Balance History"
Cohesion: 0.36
Nodes (6): account_balance_history(), bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance()

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

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `graphify skill (root .claude)`, `graphify skill (abig-finance .claude)`, `Stale version refusal`, `Finance Manager role` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 210 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `Integration Test Suite` to `Runtime Dependencies`, `Dev Dependencies`, `Auth and Admin Actions`, `Session and RBAC Pages`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `graphify skill (root .claude)`, `graphify skill (abig-finance .claude)` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Session and RBAC Pages` be split into smaller, more focused modules?**
  _Cohesion score 0.0710633045318286 - nodes in this community are weakly interconnected._
- **Why does `payment_requests` connect `Payment Request Approvals` to `Foundation Schema and Guards`, `Roles and Memberships`, `Suppliers and Requests Schema`, `Workflow Schema and Adjustments`, `Treasury Reservations`, `Treasury Refactor Schema`, `Companies and Installments`, `Bank Account Use Approvals`, `Cash Ledger`, `Request Reservation Guards`, `Notification Outbox`, `Workflow Adjust Function`, `Users and Group Permissions`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Should `Integration Test Suite` be split into smaller, more focused modules?**
  _Cohesion score 0.05446727185857621 - nodes in this community are weakly interconnected._
- **Why does `users` connect `Users and Group Permissions` to `Foundation Schema and Guards`, `Roles and Memberships`, `Suppliers and Requests Schema`, `Workflow Schema and Adjustments`, `Payment Request Approvals`, `Treasury Reservations`, `Companies and Installments`, `Bank Account Use Approvals`, `Scheduler and Cash Forecast`, `Cash Ledger`, `Notification Outbox`, `Payments and Reversals`, `Sessions and Auth Events`, `Bank Balance History`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Should `Auth and Admin Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.08540540540540541 - nodes in this community are weakly interconnected._