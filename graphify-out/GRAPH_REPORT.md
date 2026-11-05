# Graph Report - abig-finance-treasury  (2026-11-05)

## Corpus Check
- 103 files · ~97,631 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 10 file(s) not represented in the graph (top: (none) 6, .example 2, .prisma 1)

## Summary
- 1044 nodes · 2900 edges · 54 communities (38 shown, 16 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 49 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `041316f7`
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
- rows
- pg
- Request Reservation Guards
- Compose Service Topology
- @types/nodemailer@^8.0.2
- 20261027000000_treasury_refactor/migration.sql
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
- vitest
- 20261107000000_phase3_weekly_treasury/migration.sql
- company_bank_accounts
- weekly-concurrency.test.ts
- phase1.test.ts
- pg_temp.give

## God Nodes (most connected - your core abstractions)
1. `payment_requests` - 90 edges
2. `withUser()` - 64 edges
3. `company_bank_accounts` - 52 edges
4. `users` - 47 edges
5. `currentUserId()` - 46 edges
6. `rows()` - 45 edges
7. `requireMe()` - 39 edges
8. `Flash()` - 35 edges
9. `payment_installments` - 34 edges
10. `act()` - 29 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `payment_requests_outstanding_idx` --indexes--> `payment_requests`  [EXTRACTED]
  abig-finance/prisma/migrations/20261107000000_phase3_weekly_treasury/migration.sql → abig-finance/prisma/migrations/20261013000000_suppliers_requests/migration.sql
- `admin()` --indirect_call--> `translate()`  [INFERRED]
  abig-finance/src/app/admin-actions.ts → abig-finance/src/lib/errors.ts
- `addDetail()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/payees.test.ts → abig-finance/tests/helpers.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (54 total, 16 thin omitted)

### Community 0 - "Session and RBAC Pages"
Cohesion: 0.07
Nodes (94): Password(), Security(), Accounts(), switchUser(), Admin(), GET(), dynamic, Approvals() (+86 more)

### Community 1 - "phase1.test.ts"
Cohesion: 0.16
Nodes (15): nodemailer@^10.1.1, compose(), Mail, makeSender(), OutboxEvent, Sender, SUBJECTS, tick() (+7 more)

### Community 2 - "Auth and Admin Actions"
Cohesion: 0.08
Nodes (72): addGroupGrant(), admin(), audit(), createCompany(), createRole(), createUser(), done(), resetMfa() (+64 more)

### Community 3 - "Documentation and Workflows"
Cohesion: 0.05
Nodes (43): Encryption key (APP_ENCRYPTION_KEY), ops/backup.sh, Docker Compose deployment, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Migration runner (ops/migrate.mjs) (+35 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.08
Nodes (70): act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine(), addSupplier(), adjustRequest(), createAndSubmitRequest() (+62 more)

### Community 5 - "Foundation Schema and Guards"
Cohesion: 0.10
Nodes (27): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_granted_companies(), app_group_companies() (+19 more)

### Community 6 - "Roles and Memberships"
Cohesion: 0.18
Nodes (25): app_member_companies(), company_memberships, users, company_role_users(), app_member_companies(), app_permitted_companies(), assert_role_company_limit(), company_role_users() (+17 more)

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
Cohesion: 0.17
Nodes (12): payment_requests, outbox_recipients(), wf_assert_actor(), wf_lock(), wf_submit(), outbox_recipients(), account_balance_history(), app_actionable_requests() (+4 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.05
Nodes (57): installments_guard, payment_installments, access_revoked_release(), account_access_release, account_use_approvals, account_use_one_active, app_can_see_funding(), approvals_no_delete (+49 more)

### Community 12 - "20261106000000_phase2_payees_accounts/migration.sql"
Cohesion: 0.12
Nodes (19): app_person_active_for(), assert_method_fits_account(), company_bank_accounts_wallet_phone, payment_request_cash_processed(), payment_requests_cash_processed, payment_requests_person_invoice_once, payment_requests_person_payee_idx, person_detail_add() (+11 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "helpers.ts"
Cohesion: 0.13
Nodes (23): ASKU, BD_ADDIS, BD_HAWASSA, BERBERO, BERBERO_ID, fails(), key(), MkOpts (+15 more)

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
Cohesion: 0.29
Nodes (4): addDetail(), addPerson(), balance(), state()

### Community 19 - "Compose Migrate Service"
Cohesion: 0.18
Nodes (11): condition, db, APP_DB_PASSWORD, AUTH_DB_PASSWORD, MIGRATION_DATABASE_URL, WORKER_DB_PASSWORD, command, depends_on (+3 more)

### Community 20 - "rows"
Cohesion: 0.19
Nodes (17): actAs(), rows(), at(), balance(), check(), clockSql(), day(), lock() (+9 more)

### Community 21 - "pg"
Cohesion: 0.16
Nodes (11): b, c, [email, ...nameParts], name, temp, c, hashPassword(), ADMIN_URL (+3 more)

### Community 22 - "Request Reservation Guards"
Cohesion: 0.20
Nodes (6): app_can_edit_draft(), attachment_guard(), installment_guard(), payment_request_funds_guard(), payment_requests_funds_guard, wf_submit()

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 25 - "20261027000000_treasury_refactor/migration.sql"
Cohesion: 0.12
Nodes (9): banks, membership_roles_limit, membership_roles_limit_guard(), memberships_reactivate, payment_requests_debit_account_guard, register_bank_account(), roles_limit_change, register_bank_account() (+1 more)

### Community 28 - "Sessions and Auth Events"
Cohesion: 0.17
Nodes (18): companies, app_supplier_active_for(), company_suppliers, suppliers, owner_pending_approvals(), admin_create_company(), auth_events, auth_events_append_only (+10 more)

### Community 29 - "20261105000100_phase1_money_logic/migration.sql"
Cohesion: 0.14
Nodes (11): wf_set_state(), account_balance_history(), mark_authenticated_paid_at_go_live(), outbox_recipients(), payment_request_funds_guard(), payment_requests_invoice_once, record_execution(), removed_owner_approval_settings (+3 more)

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
Nodes (7): c, dir, files, files(), before, ids, snapshot()

### Community 48 - "vitest"
Cohesion: 0.14
Nodes (21): authorized(), AWASH, CBE, fn(), mk(), account(), before, ids (+13 more)

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.06
Nodes (39): bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), account_balance_history(), account_week_status(), balance_check_items (+31 more)

### Community 50 - "company_bank_accounts"
Cohesion: 0.13
Nodes (11): app_can_manage_access(), app_can_see_account(), app_can_snapshot(), company_bank_accounts, bank_balance_snapshots_audit, snapshot_audit(), app_can_snapshot(), payment_request_account_guard() (+3 more)

### Community 51 - "weekly-concurrency.test.ts"
Cohesion: 0.26
Nodes (13): asPerson(), authenticated(), balance(), monday(), newAccount(), once(), person(), prepared() (+5 more)

### Community 52 - "phase1.test.ts"
Cohesion: 0.22
Nodes (7): BD_ETHIO, enterFigure(), S_ETHIO_ID, bal(), req(), setBalance(), shortfallEvents()

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)`, `Migration runner (ops/migrate.mjs)`, `Local test copy setup` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 252 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `phase1.test.ts` to `Session and RBAC Pages`, `Auth and Admin Actions`, `Dev Dependencies`, `vitest`, `helpers.ts`, `Runtime Dependencies`, `vitest`, `payees.test.ts`, `weekly-concurrency.test.ts`, `phase1.test.ts`, `pg`, `rows`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Session and RBAC Pages` be split into smaller, more focused modules?**
  _Cohesion score 0.06831395348837209 - nodes in this community are weakly interconnected._
- **Why does `payment_requests` connect `Payment Request Approvals` to `Foundation Schema and Guards`, `Roles and Memberships`, `Suppliers and Requests Schema`, `Workflow Schema and Adjustments`, `20261015000000_treasury/migration.sql`, `20261106000000_phase2_payees_accounts/migration.sql`, `20261107000000_phase3_weekly_treasury/migration.sql`, `Request Reservation Guards`, `20261027000000_treasury_refactor/migration.sql`, `Sessions and Auth Events`, `20261105000100_phase1_money_logic/migration.sql`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Should `Auth and Admin Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.07846018219218337 - nodes in this community are weakly interconnected._
- **Why does `next` connect `Session and RBAC Pages` to `Auth and Admin Actions`, `Next.js Config and CSP`, `Payment Workflow Actions`, `Dev Dependencies`, `Runtime Dependencies`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Should `Documentation and Workflows` be split into smaller, more focused modules?**
  _Cohesion score 0.054693877551020405 - nodes in this community are weakly interconnected._