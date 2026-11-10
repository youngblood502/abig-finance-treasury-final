# Graph Report - abig-finance-treasury  (2026-11-10)

## Corpus Check
- 215 files · ~182,028 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 6, .css 3, .example 2)

## Summary
- 1808 nodes · 6168 edges · 78 communities (57 shown, 21 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 90 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `dc4df0aa`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Button
- phase1.test.ts
- reports/page.tsx
- Corporate treasury refactor
- Payment Workflow Actions
- users
- side-panel.tsx
- Suppliers and Requests Schema
- 20261014000000_workflow/migration.sql
- package.json
- dashboard.ts
- 20261015000000_treasury/migration.sql
- 20261106000000_phase2_payees_accounts/migration.sql
- TypeScript Compiler Config
- account-numbers.test.ts
- NPM Scripts
- reports.ts
- Compose Database Service
- access-withdrawal-race.test.ts
- Compose Migrate Service
- admin.ts
- actAs
- 20261012000000_foundation/migration.sql
- Compose Service Topology
- Badge
- components.json
- wf_adjust
- Badge
- dependencies
- 20261105000100_phase1_money_logic/migration.sql
- Compose Proxy Service
- App Environment Variables
- Compose Volumes
- Compose Build Targets
- Worker Environment Variables
- table.ts
- Restore Drill Script
- Graphify Skill References
- Notifications Worker Doc
- Backup Script
- weekly-concurrency.test.ts
- helpers.ts
- ABIG Brand Logo
- Supplier Bank Versioning
- companies
- 20261107000000_phase3_weekly_treasury/migration.sql
- session.ts
- SubmitButton
- rows
- auth.ts
- 20261110000200_in_app_notifications/migration.sql
- recon-parts.tsx
- postcss.config.mjs
- phase1.test.ts
- phase2.test.ts
- format.ts
- recurring/page.tsx
- Operations guide
- Testing guide
- ops.test.ts
- next.config.ts
- tailwind-merge
- requests.ts
- prisma@^6.0.0
- smtp-server
- typescript@^5.6.0
- Removing the old treasury engine
- Docker Compose deployment
- Money rules live in the database
- notification-events.test.ts
- 20261016000000_scheduler/migration.sql

## God Nodes (most connected - your core abstractions)
1. `payment_requests` - 103 edges
2. `rows()` - 96 edges
3. `withUser()` - 86 edges
4. `Button()` - 85 edges
5. `etb()` - 70 edges
6. `Badge()` - 65 edges
7. `company_bank_accounts` - 63 edges
8. `currentUserId()` - 56 edges
9. `users` - 56 edges
10. `pg` - 52 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `tableCount()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/legacy-removal.test.ts → abig-finance/tests/helpers.ts
- `event()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/outbox-retention.test.ts → abig-finance/tests/helpers.ts
- `exists()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/outbox-retention.test.ts → abig-finance/tests/helpers.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (78 total, 21 thin omitted)

### Community 0 - "Button"
Cohesion: 0.13
Nodes (36): Activity(), AddAction(), Admin(), Companies(), Field(), Panel(), People(), Roles() (+28 more)

### Community 1 - "phase1.test.ts"
Cohesion: 0.07
Nodes (24): compose(), deliver(), Mail, makeSender(), Sender, tick(), every(), log() (+16 more)

### Community 2 - "reports/page.tsx"
Cohesion: 0.27
Nodes (22): Audit(), Cash(), Download(), FilterBar(), Outstanding(), Panel(), Payments(), Pending() (+14 more)

### Community 3 - "Corporate treasury refactor"
Cohesion: 0.14
Nodes (16): Corporate treasury refactor, 20261030000000_approvals, 20261031000000_rbac_admin, 20261029000000_request_reservation, Previous treasury engine (replaced), ABIG Corporate Treasury Requirement, update_bank_balance(), Authenticate debits the account (+8 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.08
Nodes (79): c, dir, files, act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine() (+71 more)

### Community 5 - "users"
Cohesion: 0.10
Nodes (35): app_member_companies(), company_memberships, users, company_role_users(), app_can_snapshot(), app_member_companies(), app_permitted_companies(), assert_role_company_limit() (+27 more)

### Community 6 - "side-panel.tsx"
Cohesion: 0.05
Nodes (64): setCompany(), switchUser(), accessLines(), dynamic, metadata, RootLayout(), AppShell(), ShellProps (+56 more)

### Community 7 - "Suppliers and Requests Schema"
Cohesion: 0.05
Nodes (51): app_can_edit_draft(), app_can_see_request(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx (+43 more)

### Community 8 - "20261014000000_workflow/migration.sql"
Cohesion: 0.06
Nodes (36): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+28 more)

### Community 9 - "package.json"
Cohesion: 0.09
Nodes (30): devDependencies, esbuild@^0.24.0, @fontsource-variable/figtree@^5.3.0, tailwindcss@4.2.4, @tailwindcss/postcss@4.2.4, tsx@^4.19.0, tw-animate-css@^1.4.0, @types/node@^22.0.0 (+22 more)

### Community 10 - "dashboard.ts"
Cohesion: 0.08
Nodes (50): Dashboard(), Panel(), QUEUE_COLUMNS, queueTable(), Section(), accountInCompany(), AccountRow, accountRows() (+42 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.07
Nodes (49): installments_guard, payment_installments, access_revoked_release(), account_access_release, account_use_approvals, account_use_one_active, app_can_see_funding(), approvals_no_delete (+41 more)

### Community 12 - "20261106000000_phase2_payees_accounts/migration.sql"
Cohesion: 0.07
Nodes (32): banks, register_bank_account(), app_person_active_for(), assert_method_fits_account(), company_bank_accounts_wallet_phone, payment_request_cash_processed(), payment_requests_cash_processed, payment_requests_person_invoice_once (+24 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "account-numbers.test.ts"
Cohesion: 0.09
Nodes (28): normalizeAccountNumber(), history(), personList(), ACCESS_LABEL, ACCESS_NOTE, accountDetail(), AccountFacts, AccountUser (+20 more)

### Community 15 - "NPM Scripts"
Cohesion: 0.14
Nodes (14): scripts, bootstrap:admin, build, build:worker, check:integrity, db:demo, db:seed, demo:passwords (+6 more)

### Community 16 - "reports.ts"
Cohesion: 0.09
Nodes (41): dynamic, GET(), money(), shown(), cell(), toCsv(), g, pool (+33 more)

### Community 17 - "Compose Database Service"
Cohesion: 0.17
Nodes (12): environment, healthcheck, image, restart, volumes, POSTGRES_DB, POSTGRES_PASSWORD, interval (+4 more)

### Community 18 - "access-withdrawal-race.test.ts"
Cohesion: 0.25
Nodes (12): attempt(), connect(), draft(), granted(), held(), must(), noStranded(), raced() (+4 more)

### Community 19 - "Compose Migrate Service"
Cohesion: 0.18
Nodes (11): condition, db, APP_DB_PASSWORD, AUTH_DB_PASSWORD, MIGRATION_DATABASE_URL, WORKER_DB_PASSWORD, command, depends_on (+3 more)

### Community 20 - "admin.ts"
Cohesion: 0.07
Nodes (28): System(), activity(), AdminChange, AdminCompany, AdminGrant, AdminMembership, AdminPermission, AdminUser (+20 more)

### Community 21 - "actAs"
Cohesion: 0.08
Nodes (18): files(), ADMIN_URL, root, run(), url(), event(), exists(), before (+10 more)

### Community 22 - "20261012000000_foundation/migration.sql"
Cohesion: 0.06
Nodes (46): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_manage_access(), app_can_see_account() (+38 more)

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 24 - "Badge"
Cohesion: 0.15
Nodes (29): COLUMNS, Line(), Payees(), PersonPanel(), versionLabel(), COLUMNS, Company, NameField() (+21 more)

### Community 25 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 27 - "Badge"
Cohesion: 0.12
Nodes (30): COLUMNS, Gallery(), PAYMENTS, ROWS, Section(), SWATCHES, Card(), Fact() (+22 more)

### Community 28 - "dependencies"
Cohesion: 0.10
Nodes (21): dependencies, class-variance-authority@^0.7.1, clsx@^2.1.1, lucide-react@^1.69.0, next@^15.2.0, nodemailer@^10.1.1, pg@^8.13.0, qrcode@^1.5.4 (+13 more)

### Community 29 - "20261105000100_phase1_money_logic/migration.sql"
Cohesion: 0.10
Nodes (12): wf_set_state(), mark_authenticated_paid_at_go_live(), outbox_recipients(), payment_request_funds_guard(), payment_requests_invoice_once, record_execution(), removed_owner_approval_settings, request_payment_status() (+4 more)

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

### Community 35 - "table.ts"
Cohesion: 0.33
Nodes (7): SearchableSelectProps, compare(), filterOptions(), SelectOption, sumRows(), TableQuery, tableView()

### Community 42 - "weekly-concurrency.test.ts"
Cohesion: 0.14
Nodes (18): BD_HAWASSA, addDetail(), addPerson(), asPerson(), balance(), state(), authenticated(), balance() (+10 more)

### Community 43 - "helpers.ts"
Cohesion: 0.15
Nodes (29): MY_COMPANIES_SQL, Tx, supplierList(), likePattern(), listRequests(), stopReason(), accountList(), ASKU (+21 more)

### Community 48 - "companies"
Cohesion: 0.09
Nodes (27): companies, app_supplier_active_for(), company_suppliers, suppliers, treasury_schedule_queue(), admin_create_company(), auth_events, auth_events_append_only (+19 more)

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.05
Nodes (45): account_balance_history(), bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), account_balance_history(), account_week_status() (+37 more)

### Community 50 - "session.ts"
Cohesion: 0.17
Nodes (35): Accounts(), COLUMNS, FILTERS, Approvals(), COLUMNS, EditRequest(), NewRequest(), COLUMNS (+27 more)

### Community 51 - "SubmitButton"
Cohesion: 0.13
Nodes (21): DemoControls(), OPTIONS, NewRequestForm(), newRow(), Step(), RegisterAccountForm(), ScheduleField(), BalanceCheckForm() (+13 more)

### Community 52 - "rows"
Cohesion: 0.06
Nodes (49): ledger(), refusedAfter(), actAs(), fn(), key(), mk(), rows(), account() (+41 more)

### Community 53 - "auth.ts"
Cohesion: 0.05
Nodes (93): Password(), Security(), addGroupGrant(), admin(), audit(), createCompany(), createRole(), createUser() (+85 more)

### Community 54 - "20261110000200_in_app_notifications/migration.sql"
Cohesion: 0.28
Nodes (4): notification_outbox_in_app_idx, user_notifications, user_notifications_unread_idx, user_notifications_user_idx

### Community 55 - "recon-parts.tsx"
Cohesion: 0.19
Nodes (22): Fact(), ReviewPanel(), LIMITED, Reconciliation(), CorrectStatement(), ReviewDecision(), SendForReview(), Column() (+14 more)

### Community 58 - "phase1.test.ts"
Cohesion: 0.22
Nodes (7): BD_ETHIO, enterFigure(), bal(), req(), setBalance(), shortfallEvents(), submitted()

### Community 59 - "phase2.test.ts"
Cohesion: 0.39
Nodes (6): BD_ADDIS, addAtt(), draft(), inst(), key(), ready()

### Community 61 - "format.ts"
Cohesion: 0.14
Nodes (25): AccountPanel(), canDo(), Line(), Section(), COLUMNS, DELIVERY_LABEL, Detail(), label() (+17 more)

### Community 62 - "recurring/page.tsx"
Cohesion: 0.20
Nodes (16): Amount(), COLUMNS, Line(), Recurring(), STATUS_VARIANT, Template, TemplateForm(), TemplatePanel() (+8 more)

### Community 63 - "Operations guide"
Cohesion: 0.27
Nodes (10): ops/backup.sh, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Operations guide, Restore drill (ops/restore-drill.sh), ABIG Finance (+2 more)

### Community 64 - "Testing guide"
Cohesion: 0.22
Nodes (10): Demo people, Local test copy setup, Testing guide, Things to try to break, UI and UX checklist, Workflow scenarios, company_bank_account_access, Legacy status and role mapping (+2 more)

### Community 65 - "ops.test.ts"
Cohesion: 0.24
Nodes (7): b, c, [email, ...nameParts], name, temp, c, hashPassword()

### Community 69 - "requests.ts"
Cohesion: 0.06
Nodes (38): GET(), NumberState, listFilters(), needsVerifying(), PaymentLine, PersonRow, PersonVersion, SupplierLink (+30 more)

### Community 73 - "Removing the old treasury engine"
Cohesion: 0.33
Nodes (5): Deployment approach: a fresh installation, Installing on the new server, Removing the old treasury engine, Safety checks in the migration, What the migration removes

### Community 74 - "Docker Compose deployment"
Cohesion: 0.40
Nodes (5): Encryption key (APP_ENCRYPTION_KEY), Docker Compose deployment, Migration runner (ops/migrate.mjs), Sign-in security policy, Built-in sign-in

### Community 77 - "notification-events.test.ts"
Cohesion: 0.29
Nodes (5): at(), day(), events(), revision(), to()

### Community 79 - "20261016000000_scheduler/migration.sql"
Cohesion: 0.20
Nodes (11): wf_adjust(), wf_return(), cash_forecast_account_idx, cash_forecast_guard, cash_forecast_items, cash_forecast_no_delete, _forecast(), forecast_add() (+3 more)

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `Finance Manager role`, `Owner role`, `Stale version refusal`, `ABIG Corporate Treasury Requirement` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 428 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `phase1.test.ts` to `ops.test.ts`, `Payment Workflow Actions`, `package.json`, `dashboard.ts`, `helpers.ts`, `weekly-concurrency.test.ts`, `notification-events.test.ts`, `account-numbers.test.ts`, `reports.ts`, `session.ts`, `access-withdrawal-race.test.ts`, `admin.ts`, `auth.ts`, `actAs`, `rows`, `phase1.test.ts`, `phase2.test.ts`, `dependencies`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `Finance Manager role`, `Owner role` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Button` be split into smaller, more focused modules?**
  _Cohesion score 0.1323671497584541 - nodes in this community are weakly interconnected._
- **Why does `rows()` connect `rows` to `phase1.test.ts`, `dashboard.ts`, `helpers.ts`, `weekly-concurrency.test.ts`, `notification-events.test.ts`, `account-numbers.test.ts`, `reports.ts`, `access-withdrawal-race.test.ts`, `admin.ts`, `actAs`, `phase1.test.ts`, `phase2.test.ts`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Should `phase1.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07179487179487179 - nodes in this community are weakly interconnected._
- **Why does `payment_requests` connect `Suppliers and Requests Schema` to `users`, `20261014000000_workflow/migration.sql`, `20261015000000_treasury/migration.sql`, `20261106000000_phase2_payees_accounts/migration.sql`, `20261016000000_scheduler/migration.sql`, `companies`, `20261107000000_phase3_weekly_treasury/migration.sql`, `20261012000000_foundation/migration.sql`, `20261110000200_in_app_notifications/migration.sql`, `wf_adjust`, `20261105000100_phase1_money_logic/migration.sql`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Should `Corporate treasury refactor` be split into smaller, more focused modules?**
  _Cohesion score 0.13725490196078433 - nodes in this community are weakly interconnected._