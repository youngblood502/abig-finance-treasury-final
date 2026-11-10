# Graph Report - abig-finance-treasury  (2026-11-10)

## Corpus Check
- 231 files · ~189,538 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 6, .css 3, .example 2)

## Summary
- 1893 nodes · 6390 edges · 80 communities (62 shown, 18 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 100 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `70528d6a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Button
- phase1.test.ts
- currentUserId
- Corporate treasury refactor
- Payment Workflow Actions
- users
- cn
- Suppliers and Requests Schema
- 20261014000000_workflow/migration.sql
- package.json
- app/page.tsx
- 20261015000000_treasury/migration.sql
- 20261106000000_phase2_payees_accounts/migration.sql
- TypeScript Compiler Config
- rows
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
- reveal-number.tsx
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
- treasury-screens.ts
- accounts/page.tsx
- rows
- auth.ts
- 20261110000200_in_app_notifications/migration.sql
- Badge
- postcss.config.mjs
- account-numbers.test.ts
- phase2.test.ts
- loading-states.test.ts
- Badge
- Operations guide
- Testing guide
- ops.test.ts
- page-loading.test.ts
- notification-bell.tsx
- requests/[id]/page.tsx
- scheduled-payments.test.ts
- status-tracker.tsx
- theme.test.ts
- Removing the old treasury engine
- Docker Compose deployment
- Money rules live in the database
- next.config.ts
- notification-events.test.ts
- 20261016000000_scheduler/migration.sql
- health/route.ts

## God Nodes (most connected - your core abstractions)
1. `payment_requests` - 103 edges
2. `rows()` - 101 edges
3. `withUser()` - 86 edges
4. `Button()` - 83 edges
5. `etb()` - 70 edges
6. `Badge()` - 65 edges
7. `company_bank_accounts` - 63 edges
8. `currentUserId()` - 56 edges
9. `users` - 56 edges
10. `SubmitButton()` - 55 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `deliveries()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/outbox-delivery.test.ts → abig-finance/tests/helpers.ts
- `audits()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/account-numbers.test.ts → abig-finance/tests/helpers.ts
- `reveal()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/account-numbers.test.ts → abig-finance/tests/helpers.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (80 total, 18 thin omitted)

### Community 0 - "Button"
Cohesion: 0.14
Nodes (36): Activity(), AddAction(), Admin(), Companies(), Field(), Panel(), People(), Roles() (+28 more)

### Community 1 - "phase1.test.ts"
Cohesion: 0.08
Nodes (20): compose(), deliver(), Mail, makeSender(), Sender, tick(), every(), log() (+12 more)

### Community 2 - "currentUserId"
Cohesion: 0.13
Nodes (39): Password(), Security(), Approvals(), EditRequest(), NewRequest(), COLUMNS, Requests(), Card() (+31 more)

### Community 3 - "Corporate treasury refactor"
Cohesion: 0.14
Nodes (16): Corporate treasury refactor, 20261030000000_approvals, 20261031000000_rbac_admin, 20261029000000_request_reservation, Previous treasury engine (replaced), ABIG Corporate Treasury Requirement, update_bank_balance(), Authenticate debits the account (+8 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.09
Nodes (76): act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine(), addSupplier(), adjustRequest(), afterSave() (+68 more)

### Community 5 - "users"
Cohesion: 0.10
Nodes (35): app_member_companies(), company_memberships, users, company_role_users(), app_can_snapshot(), app_member_companies(), app_permitted_companies(), assert_role_company_limit() (+27 more)

### Community 6 - "cn"
Cohesion: 0.26
Nodes (14): Brand(), MobileNav(), ICONS, SidebarNav(), Sidebar(), Sheet(), SheetContent(), SheetDescription() (+6 more)

### Community 7 - "Suppliers and Requests Schema"
Cohesion: 0.05
Nodes (51): app_can_edit_draft(), app_can_see_request(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx (+43 more)

### Community 8 - "20261014000000_workflow/migration.sql"
Cohesion: 0.06
Nodes (36): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+28 more)

### Community 9 - "package.json"
Cohesion: 0.08
Nodes (36): devDependencies, esbuild@^0.24.0, @fontsource-variable/figtree@^5.3.0, prisma@^6.0.0, smtp-server@^3.19.22, tailwindcss@4.2.4, @tailwindcss/postcss@4.2.4, tsx@^4.19.0 (+28 more)

### Community 10 - "app/page.tsx"
Cohesion: 0.05
Nodes (70): setCompany(), switchUser(), Dashboard(), Panel(), QUEUE_COLUMNS, queueTable(), Section(), AppShell() (+62 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.07
Nodes (49): installments_guard, payment_installments, access_revoked_release(), account_access_release, account_use_approvals, account_use_one_active, app_can_see_funding(), approvals_no_delete (+41 more)

### Community 12 - "20261106000000_phase2_payees_accounts/migration.sql"
Cohesion: 0.07
Nodes (32): banks, register_bank_account(), app_person_active_for(), assert_method_fits_account(), company_bank_accounts_wallet_phone, payment_request_cash_processed(), payment_requests_cash_processed, payment_requests_person_invoice_once (+24 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "rows"
Cohesion: 0.08
Nodes (32): account(), attempt(), history(), outbox(), state(), twice(), BD_HAWASSA, rows() (+24 more)

### Community 15 - "NPM Scripts"
Cohesion: 0.14
Nodes (14): scripts, bootstrap:admin, build, build:worker, check:integrity, db:demo, db:seed, demo:passwords (+6 more)

### Community 16 - "reports.ts"
Cohesion: 0.11
Nodes (48): GET(), money(), shown(), Audit(), Cash(), Download(), FilterBar(), Outstanding() (+40 more)

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
Nodes (32): System(), COLUMNS, DELIVERY_LABEL, Line(), STATUS_VARIANT, activity(), AdminChange, AdminCompany (+24 more)

### Community 21 - "actAs"
Cohesion: 0.08
Nodes (13): c, dir, files, files(), ADMIN_URL, root, run(), url() (+5 more)

### Community 22 - "20261012000000_foundation/migration.sql"
Cohesion: 0.06
Nodes (46): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_manage_access(), app_can_see_account() (+38 more)

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 24 - "Badge"
Cohesion: 0.13
Nodes (36): COLUMNS, Line(), Payees(), PersonPanel(), versionLabel(), COLUMNS, Company, NameField() (+28 more)

### Community 25 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 27 - "reveal-number.tsx"
Cohesion: 0.20
Nodes (14): revealAccountNumber(), RevealResult, HIDE_AFTER_MS, maskNumber(), RevealNumber(), isNumberKind(), NumberKind, NumberState (+6 more)

### Community 28 - "dependencies"
Cohesion: 0.08
Nodes (25): dependencies, class-variance-authority@^0.7.1, clsx@^2.1.1, lucide-react@^1.69.0, next@^15.2.0, nodemailer@^10.1.1, pg@^8.13.0, qrcode@^1.5.4 (+17 more)

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
Cohesion: 0.31
Nodes (8): SearchableSelect(), SearchableSelectProps, compare(), filterOptions(), SelectOption, sumRows(), TableQuery, tableView()

### Community 42 - "weekly-concurrency.test.ts"
Cohesion: 0.26
Nodes (13): asPerson(), authenticated(), balance(), monday(), newAccount(), once(), person(), prepared() (+5 more)

### Community 43 - "helpers.ts"
Cohesion: 0.13
Nodes (30): Tx, ASKU, BD_ETHIO, BERBERO, BERBERO_ID, CBE, fails(), MkOpts (+22 more)

### Community 48 - "companies"
Cohesion: 0.09
Nodes (27): companies, app_supplier_active_for(), company_suppliers, suppliers, treasury_schedule_queue(), admin_create_company(), auth_events, auth_events_append_only (+19 more)

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.05
Nodes (45): account_balance_history(), bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), account_balance_history(), account_week_status() (+37 more)

### Community 50 - "treasury-screens.ts"
Cohesion: 0.13
Nodes (20): ACCESS_LABEL, ACCESS_NOTE, accountDetail(), AccountFacts, AccountUser, DUE_OPTIONS, dueBucket(), FigureInput (+12 more)

### Community 51 - "accounts/page.tsx"
Cohesion: 0.12
Nodes (27): Accounts(), COLUMNS, FILTERS, OPTIONS, NewRequestForm(), newRow(), Step(), AccountPanel() (+19 more)

### Community 52 - "rows"
Cohesion: 0.09
Nodes (29): actAs(), authorized(), AWASH, enterFigure(), fn(), key(), mk(), bal() (+21 more)

### Community 53 - "auth.ts"
Cohesion: 0.06
Nodes (85): addGroupGrant(), admin(), audit(), createCompany(), createRole(), createUser(), done(), resetMfa() (+77 more)

### Community 54 - "20261110000200_in_app_notifications/migration.sql"
Cohesion: 0.28
Nodes (4): notification_outbox_in_app_idx, user_notifications, user_notifications_unread_idx, user_notifications_user_idx

### Community 55 - "Badge"
Cohesion: 0.10
Nodes (46): cells(), COLUMNS, Partial(), LIMITED, Reconciliation(), PositionBar(), CorrectStatement(), ReviewDecision() (+38 more)

### Community 58 - "account-numbers.test.ts"
Cohesion: 0.11
Nodes (21): normalizeAccountNumber(), MY_COMPANIES_SQL, likePattern(), listRequests(), loadRequest(), maskRequest(), parseRequestFilters(), stopReason() (+13 more)

### Community 59 - "phase2.test.ts"
Cohesion: 0.39
Nodes (6): BD_ADDIS, addAtt(), draft(), inst(), key(), ready()

### Community 61 - "loading-states.test.ts"
Cohesion: 0.15
Nodes (13): ExportButton(), useSubmitGuard(), DownloadResult, fetchCsv(), MESSAGES, claimSubmission(), createSubmitLock(), lockFor() (+5 more)

### Community 62 - "Badge"
Cohesion: 0.08
Nodes (40): DemoControls(), COLUMNS, Gallery(), PAYMENTS, ROWS, Section(), SWATCHES, Amount() (+32 more)

### Community 63 - "Operations guide"
Cohesion: 0.27
Nodes (10): ops/backup.sh, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Operations guide, Restore drill (ops/restore-drill.sh), ABIG Finance (+2 more)

### Community 64 - "Testing guide"
Cohesion: 0.22
Nodes (10): Demo people, Local test copy setup, Testing guide, Things to try to break, UI and UX checklist, Workflow scenarios, company_bank_account_access, Legacy status and role mapping (+2 more)

### Community 65 - "ops.test.ts"
Cohesion: 0.24
Nodes (7): b, c, [email, ...nameParts], name, temp, c, hashPassword()

### Community 66 - "page-loading.test.ts"
Cohesion: 0.07
Nodes (30): Loading(), dynamic, metadata, RootLayout(), Loading(), Loading(), Loading(), Loading() (+22 more)

### Community 68 - "notification-bell.tsx"
Cohesion: 0.36
Nodes (13): NotificationBell(), OpenButton, THEME_KEY, ThemeMenuItem(), initials(), UserMenu(), DropdownMenu(), DropdownMenuContent() (+5 more)

### Community 69 - "requests/[id]/page.tsx"
Cohesion: 0.10
Nodes (31): COLUMNS, Fact(), ReviewPanel(), Card(), Fact(), INSTALLMENTS, RequestDetail(), Reason() (+23 more)

### Community 70 - "scheduled-payments.test.ts"
Cohesion: 0.22
Nodes (8): clock(), day(), draft(), events(), release(), req(), reserved(), to()

### Community 71 - "status-tracker.tsx"
Cohesion: 0.36
Nodes (7): StatusTracker(), ENDED_STATES, STEPS, StepStatus, TrackerStep, trackerSteps(), trackerSummary()

### Community 72 - "theme.test.ts"
Cohesion: 0.28
Nodes (7): channel(), contrast(), css, luminance(), SHAPES, TEXT, themes

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
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 453 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `helpers.ts` to `phase1.test.ts`, `package.json`, `app/page.tsx`, `rows`, `reports.ts`, `access-withdrawal-race.test.ts`, `admin.ts`, `actAs`, `weekly-concurrency.test.ts`, `treasury-screens.ts`, `rows`, `auth.ts`, `Badge`, `account-numbers.test.ts`, `phase2.test.ts`, `loading-states.test.ts`, `page-loading.test.ts`, `scheduled-payments.test.ts`, `theme.test.ts`, `notification-events.test.ts`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `Finance Manager role`, `Owner role` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Button` be split into smaller, more focused modules?**
  _Cohesion score 0.1393939393939394 - nodes in this community are weakly interconnected._
- **Why does `pg` connect `helpers.ts` to `phase1.test.ts`, `currentUserId`, `package.json`, `app/page.tsx`, `rows`, `access-withdrawal-race.test.ts`, `admin.ts`, `actAs`, `dependencies`, `weekly-concurrency.test.ts`, `treasury-screens.ts`, `rows`, `auth.ts`, `Badge`, `account-numbers.test.ts`, `phase2.test.ts`, `ops.test.ts`, `scheduled-payments.test.ts`, `notification-events.test.ts`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Should `phase1.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08021390374331551 - nodes in this community are weakly interconnected._
- **Why does `payment_requests` connect `Suppliers and Requests Schema` to `users`, `20261014000000_workflow/migration.sql`, `20261015000000_treasury/migration.sql`, `20261106000000_phase2_payees_accounts/migration.sql`, `20261016000000_scheduler/migration.sql`, `companies`, `20261107000000_phase3_weekly_treasury/migration.sql`, `20261012000000_foundation/migration.sql`, `20261110000200_in_app_notifications/migration.sql`, `wf_adjust`, `20261105000100_phase1_money_logic/migration.sql`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Should `currentUserId` be split into smaller, more focused modules?**
  _Cohesion score 0.12772133526850507 - nodes in this community are weakly interconnected._