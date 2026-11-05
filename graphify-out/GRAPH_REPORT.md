# Graph Report - abig-finance-treasury  (2026-11-05)

## Corpus Check
- 90 files · ~70,410 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 10 file(s) not represented in the graph (top: (none) 6, .example 2, .prisma 1)

## Summary
- 852 nodes · 2223 edges · 47 communities (31 shown, 16 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 30 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `02f75c87`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

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
- 20261015000000_treasury/migration.sql
- admin-actions.ts
- TypeScript Compiler Config
- suppliers
- NPM Scripts
- Runtime Dependencies
- Compose Database Service
- Bank Account Use Approvals
- Compose Migrate Service
- Scheduler and Cash Forecast
- supplier_bank_details
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
- ABIG Brand Logo
- Supplier Bank Versioning

## God Nodes (most connected - your core abstractions)
1. `payment_requests` - 72 edges
2. `withUser()` - 51 edges
3. `users` - 42 edges
4. `company_bank_accounts` - 40 edges
5. `currentUserId()` - 38 edges
6. `payment_installments` - 33 edges
7. `requireMe()` - 31 edges
8. `Flash()` - 27 edges
9. `etb()` - 23 edges
10. `rows()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `payment_requests_invoice_once` --indexes--> `payment_requests`  [EXTRACTED]
  abig-finance/prisma/migrations/20261105000100_phase1_money_logic/migration.sql → abig-finance/prisma/migrations/20261013000000_suppliers_requests/migration.sql
- `payment_request_funds_guard()` --reads_from--> `company_bank_accounts`  [EXTRACTED]
  abig-finance/prisma/migrations/20261105000100_phase1_money_logic/migration.sql → abig-finance/prisma/migrations/20261012000000_foundation/migration.sql
- `removed_owner_approval_settings` --references--> `company_bank_accounts`  [EXTRACTED]
  abig-finance/prisma/migrations/20261105000100_phase1_money_logic/migration.sql → abig-finance/prisma/migrations/20261012000000_foundation/migration.sql

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (47 total, 16 thin omitted)

### Community 0 - "Session and RBAC Pages"
Cohesion: 0.07
Nodes (84): Password(), Security(), Accounts(), switchUser(), Admin(), GET(), dynamic, Approvals() (+76 more)

### Community 1 - "Integration Test Suite"
Cohesion: 0.05
Nodes (77): b, c, [email, ...nameParts], name, temp, c, hashPassword(), c (+69 more)

### Community 2 - "Auth and Admin Actions"
Cohesion: 0.11
Nodes (45): back(), changePasswordAction(), disableMfaAction(), enableMfaAction(), loginAction(), Login(), adminResetTotp(), adminSetPassword() (+37 more)

### Community 3 - "Documentation and Workflows"
Cohesion: 0.05
Nodes (43): Encryption key (APP_ENCRYPTION_KEY), ops/backup.sh, Docker Compose deployment, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Migration runner (ops/migrate.mjs) (+35 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.13
Nodes (36): act(), addBankDetail(), addSupplier(), adjustRequest(), createRequest(), dbl(), decideBankDetail(), grantAccess() (+28 more)

### Community 5 - "Foundation Schema and Guards"
Cohesion: 0.09
Nodes (29): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_see_account(), app_can_snapshot() (+21 more)

### Community 6 - "Roles and Memberships"
Cohesion: 0.10
Nodes (35): app_member_companies(), company_memberships, users, company_role_users(), app_can_snapshot(), app_member_companies(), app_permitted_companies(), assert_role_company_limit() (+27 more)

### Community 7 - "Suppliers and Requests Schema"
Cohesion: 0.12
Nodes (22): app_can_edit_draft(), app_can_see_request(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx (+14 more)

### Community 8 - "Workflow Schema and Adjustments"
Cohesion: 0.10
Nodes (21): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+13 more)

### Community 9 - "Dev Dependencies"
Cohesion: 0.13
Nodes (20): devDependencies, esbuild@^0.24.0, prisma@^6.0.0, smtp-server@^3.19.22, tsx@^4.19.0, @types/node@^22.0.0, @types/pg@^8.11.0, @types/qrcode@^1.5.6 (+12 more)

### Community 10 - "Payment Request Approvals"
Cohesion: 0.17
Nodes (12): payment_requests, outbox_recipients(), wf_assert_actor(), wf_lock(), wf_submit(), outbox_recipients(), account_balance_history(), app_actionable_requests() (+4 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.09
Nodes (33): access_revoked_release(), account_access_release, bank_balance_snapshots_audit, cash_ledger_account_time_idx, cash_ledger_entries, _cash_position(), cash_reservations, cash_reservations_account_idx (+25 more)

### Community 12 - "admin-actions.ts"
Cohesion: 0.30
Nodes (21): addGroupGrant(), admin(), audit(), createCompany(), createRole(), createUser(), done(), resetMfa() (+13 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "suppliers"
Cohesion: 0.33
Nodes (6): app_supplier_active_for(), company_suppliers, suppliers, treasury_schedule_queue(), admin_create_company(), supplier_update()

### Community 15 - "NPM Scripts"
Cohesion: 0.14
Nodes (14): scripts, bootstrap:admin, build, build:worker, check:integrity, db:demo, db:seed, demo:passwords (+6 more)

### Community 16 - "Runtime Dependencies"
Cohesion: 0.18
Nodes (11): dependencies, next@^15.2.0, pg@^8.13.0, qrcode@^1.5.4, react@^19.0.0, react-dom@^19.0.0, zod@^3.23.0, qrcode (+3 more)

### Community 17 - "Compose Database Service"
Cohesion: 0.17
Nodes (12): environment, healthcheck, image, restart, volumes, POSTGRES_DB, POSTGRES_PASSWORD, interval (+4 more)

### Community 18 - "Bank Account Use Approvals"
Cohesion: 0.14
Nodes (16): app_can_manage_access(), company_bank_accounts, payment_installments, account_use_approvals, account_use_one_active, app_can_see_funding(), approvals_no_delete, assert_account_use() (+8 more)

### Community 19 - "Compose Migrate Service"
Cohesion: 0.18
Nodes (11): condition, db, APP_DB_PASSWORD, AUTH_DB_PASSWORD, MIGRATION_DATABASE_URL, WORKER_DB_PASSWORD, command, depends_on (+3 more)

### Community 20 - "Scheduler and Cash Forecast"
Cohesion: 0.31
Nodes (9): cash_forecast_account_idx, cash_forecast_guard, cash_forecast_items, cash_forecast_no_delete, _forecast(), forecast_cancel(), forecast_guard(), treasury_confirm_schedule() (+1 more)

### Community 21 - "supplier_bank_details"
Cohesion: 0.29
Nodes (7): bank_detail_guard(), supplier_bank_details, supplier_bank_details_guard, supplier_bank_details_no_delete, supplier_bank_one_verified, assert_submittable(), assert_submittable()

### Community 22 - "Request Reservation Guards"
Cohesion: 0.20
Nodes (6): app_can_edit_draft(), attachment_guard(), installment_guard(), payment_request_funds_guard(), payment_requests_funds_guard, wf_submit()

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 28 - "Sessions and Auth Events"
Cohesion: 0.23
Nodes (11): companies, auth_events, auth_events_append_only, auth_events_no_truncate, auth_events_time_idx, company_directory(), report_outstanding(), report_payments() (+3 more)

### Community 29 - "20261105000100_phase1_money_logic/migration.sql"
Cohesion: 0.09
Nodes (19): wf_set_state(), banks, account_balance_history(), bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance() (+11 more)

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
- **19 isolated node(s):** `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)`, `Migration runner (ops/migrate.mjs)`, `Local test copy setup` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 218 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `Integration Test Suite` to `Runtime Dependencies`, `Dev Dependencies`, `Auth and Admin Actions`, `Session and RBAC Pages`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Session and RBAC Pages` be split into smaller, more focused modules?**
  _Cohesion score 0.06731634182908545 - nodes in this community are weakly interconnected._
- **Why does `payment_requests` connect `Payment Request Approvals` to `Foundation Schema and Guards`, `Roles and Memberships`, `Suppliers and Requests Schema`, `Workflow Schema and Adjustments`, `20261015000000_treasury/migration.sql`, `suppliers`, `Bank Account Use Approvals`, `supplier_bank_details`, `Request Reservation Guards`, `Workflow Adjust Function`, `Sessions and Auth Events`, `20261105000100_phase1_money_logic/migration.sql`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Should `Integration Test Suite` be split into smaller, more focused modules?**
  _Cohesion score 0.05001730702665282 - nodes in this community are weakly interconnected._
- **Why does `users` connect `Roles and Memberships` to `Foundation Schema and Guards`, `Suppliers and Requests Schema`, `Workflow Schema and Adjustments`, `Payment Request Approvals`, `20261015000000_treasury/migration.sql`, `suppliers`, `Bank Account Use Approvals`, `Scheduler and Cash Forecast`, `supplier_bank_details`, `Sessions and Auth Events`, `20261105000100_phase1_money_logic/migration.sql`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Should `Auth and Admin Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.10901960784313726 - nodes in this community are weakly interconnected._