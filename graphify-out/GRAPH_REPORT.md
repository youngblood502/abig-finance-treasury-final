# Graph Report - abig-finance-treasury  (2026-11-09)

## Corpus Check
- 198 files · ~164,864 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 6, .css 3, .example 2)

## Summary
- 1683 nodes · 5728 edges · 71 communities (55 shown, 16 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 82 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `02b7ad6f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- admin/page.tsx
- phase1.test.ts
- etb
- Corporate treasury refactor
- Payment Workflow Actions
- users
- SidePanel
- Suppliers and Requests Schema
- Workflow Schema and Adjustments
- package.json
- app/page.tsx
- 20261015000000_treasury/migration.sql
- 20261106000000_phase2_payees_accounts/migration.sql
- TypeScript Compiler Config
- account-numbers.test.ts
- NPM Scripts
- layout.tsx
- Compose Database Service
- access-withdrawal-race.test.ts
- Compose Migrate Service
- Button
- shared-account-privacy.test.ts
- 20261012000000_foundation/migration.sql
- Compose Service Topology
- Badge
- components.json
- 20261016000000_scheduler/migration.sql
- Badge
- suppliers
- 20261105000100_phase1_money_logic/migration.sql
- Compose Proxy Service
- App Environment Variables
- Compose Volumes
- Compose Build Targets
- Worker Environment Variables
- reports/page.tsx
- Restore Drill Script
- Graphify Skill References
- Notifications Worker Doc
- Backup Script
- Operations guide
- helpers.ts
- ABIG Brand Logo
- Supplier Bank Versioning
- companies
- 20261107000000_phase3_weekly_treasury/migration.sql
- session.ts
- cn
- weekly-treasury.test.ts
- auth.ts
- Testing guide
- phase2.test.ts
- postcss.config.mjs
- 20261109000800_more_notifications/migration.sql
- company.ts
- theme.test.ts
- form.tsx
- weekly-concurrency.test.ts
- Docker Compose deployment
- Money rules live in the database
- ops.test.ts
- next.config.ts
- requests.ts
- treasury-screens.ts
- health/route.ts

## God Nodes (most connected - your core abstractions)
1. `payment_requests` - 95 edges
2. `Button()` - 80 edges
3. `rows()` - 79 edges
4. `withUser()` - 77 edges
5. `etb()` - 67 edges
6. `Badge()` - 61 edges
7. `company_bank_accounts` - 60 edges
8. `users` - 52 edges
9. `currentUserId()` - 51 edges
10. `pg` - 47 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `dbl()` --indirect_call--> `translate()`  [INFERRED]
  abig-finance/src/app/actions.ts → abig-finance/src/lib/errors.ts
- `events()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/notification-events.test.ts → abig-finance/tests/helpers.ts
- `revision()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/notification-events.test.ts → abig-finance/tests/helpers.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (71 total, 16 thin omitted)

### Community 0 - "admin/page.tsx"
Cohesion: 0.06
Nodes (55): Activity(), AddAction(), Admin(), Companies(), Field(), Panel(), People(), Roles() (+47 more)

### Community 1 - "phase1.test.ts"
Cohesion: 0.06
Nodes (30): compose(), deliver(), Mail, makeSender(), NOTES, OutboxEvent, Sender, SUBJECTS (+22 more)

### Community 2 - "etb"
Cohesion: 0.12
Nodes (42): cells(), COLUMNS, Partial(), WeekOverview(), LIMITED, Reconciliation(), CorrectStatement(), ReviewDecision() (+34 more)

### Community 3 - "Corporate treasury refactor"
Cohesion: 0.14
Nodes (16): Corporate treasury refactor, 20261030000000_approvals, 20261031000000_rbac_admin, 20261029000000_request_reservation, Previous treasury engine (replaced), ABIG Corporate Treasury Requirement, update_bank_balance(), Authenticate debits the account (+8 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.07
Nodes (78): act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine(), addSupplier(), adjustRequest(), createAndSubmitRequest() (+70 more)

### Community 5 - "users"
Cohesion: 0.10
Nodes (35): app_member_companies(), company_memberships, users, company_role_users(), app_can_snapshot(), app_member_companies(), app_permitted_companies(), assert_role_company_limit() (+27 more)

### Community 6 - "SidePanel"
Cohesion: 0.25
Nodes (15): Brand(), MobileNav(), ICONS, SidebarNav(), Sidebar(), Sheet(), SheetContent(), SheetDescription() (+7 more)

### Community 7 - "Suppliers and Requests Schema"
Cohesion: 0.06
Nodes (41): app_can_edit_draft(), app_can_see_request(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx (+33 more)

### Community 8 - "Workflow Schema and Adjustments"
Cohesion: 0.07
Nodes (30): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+22 more)

### Community 9 - "package.json"
Cohesion: 0.05
Nodes (60): dependencies, class-variance-authority@^0.7.1, clsx@^2.1.1, lucide-react@^1.69.0, next@^15.2.0, nodemailer@^10.1.1, pg@^8.13.0, qrcode@^1.5.4 (+52 more)

### Community 10 - "app/page.tsx"
Cohesion: 0.16
Nodes (29): Dashboard(), Panel(), QUEUE_COLUMNS, queueTable(), Section(), accountInCompany(), AccountRow, accountRows() (+21 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.07
Nodes (47): installments_guard, payment_installments, access_revoked_release(), account_access_release, account_use_approvals, account_use_one_active, app_can_see_funding(), approvals_no_delete (+39 more)

### Community 12 - "20261106000000_phase2_payees_accounts/migration.sql"
Cohesion: 0.11
Nodes (21): app_person_active_for(), assert_method_fits_account(), assert_submittable(), company_bank_accounts_wallet_phone, payment_request_cash_processed(), payment_requests_cash_processed, payment_requests_person_invoice_once, payment_requests_person_payee_idx (+13 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "account-numbers.test.ts"
Cohesion: 0.10
Nodes (36): GET(), money(), shown(), normalizeAccountNumber(), MY_COMPANIES_SQL, cell(), toCsv(), addisIso() (+28 more)

### Community 15 - "NPM Scripts"
Cohesion: 0.14
Nodes (14): scripts, bootstrap:admin, build, build:worker, check:integrity, db:demo, db:seed, demo:passwords (+6 more)

### Community 16 - "layout.tsx"
Cohesion: 0.17
Nodes (12): accessLines(), dynamic, metadata, RootLayout(), navFor(), ROLE_LABEL(), devUsers(), getMe() (+4 more)

### Community 17 - "Compose Database Service"
Cohesion: 0.17
Nodes (12): environment, healthcheck, image, restart, volumes, POSTGRES_DB, POSTGRES_PASSWORD, interval (+4 more)

### Community 18 - "access-withdrawal-race.test.ts"
Cohesion: 0.25
Nodes (12): attempt(), connect(), draft(), granted(), held(), must(), noStranded(), raced() (+4 more)

### Community 19 - "Compose Migrate Service"
Cohesion: 0.18
Nodes (11): condition, db, APP_DB_PASSWORD, AUTH_DB_PASSWORD, MIGRATION_DATABASE_URL, WORKER_DB_PASSWORD, command, depends_on (+3 more)

### Community 20 - "Button"
Cohesion: 0.11
Nodes (34): DemoConfirm(), DemoControls(), OPTIONS, AccountPanel(), canDo(), Line(), Section(), RegisterAccountForm() (+26 more)

### Community 21 - "shared-account-privacy.test.ts"
Cohesion: 0.07
Nodes (18): c, dir, files, files(), ADMIN_URL, root, run(), url() (+10 more)

### Community 22 - "20261012000000_foundation/migration.sql"
Cohesion: 0.08
Nodes (35): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_manage_access(), app_can_see_account() (+27 more)

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 24 - "Badge"
Cohesion: 0.13
Nodes (35): COLUMNS, Line(), Payees(), PersonPanel(), versionLabel(), COLUMNS, Company, NameField() (+27 more)

### Community 25 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 26 - "20261016000000_scheduler/migration.sql"
Cohesion: 0.16
Nodes (11): cash_forecast_account_idx, cash_forecast_guard, cash_forecast_items, cash_forecast_no_delete, _forecast(), forecast_add(), forecast_cancel(), forecast_guard() (+3 more)

### Community 27 - "Badge"
Cohesion: 0.09
Nodes (41): COLUMNS, Gallery(), PAYMENTS, ROWS, Section(), SWATCHES, Card(), Fact() (+33 more)

### Community 28 - "suppliers"
Cohesion: 0.08
Nodes (23): app_supplier_active_for(), bank_detail_guard(), company_suppliers, supplier_bank_details, supplier_bank_details_guard, supplier_bank_details_no_delete, supplier_bank_one_verified, suppliers (+15 more)

### Community 29 - "20261105000100_phase1_money_logic/migration.sql"
Cohesion: 0.09
Nodes (16): wf_set_state(), banks, mark_authenticated_paid_at_go_live(), outbox_recipients(), payment_request_funds_guard(), payment_requests_invoice_once, record_execution(), register_bank_account() (+8 more)

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

### Community 35 - "reports/page.tsx"
Cohesion: 0.18
Nodes (29): Audit(), Cash(), Download(), FilterBar(), Outstanding(), Panel(), Payments(), Pending() (+21 more)

### Community 42 - "Operations guide"
Cohesion: 0.27
Nodes (10): ops/backup.sh, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Operations guide, Restore drill (ops/restore-drill.sh), ABIG Finance (+2 more)

### Community 43 - "helpers.ts"
Cohesion: 0.18
Nodes (28): g, Tx, stopReason(), accountDetail(), accountList(), ASKU, authorized(), AWASH (+20 more)

### Community 48 - "companies"
Cohesion: 0.17
Nodes (11): companies, admin_create_company(), auth_events, auth_events_append_only, auth_events_no_truncate, auth_events_time_idx, company_directory(), report_outstanding() (+3 more)

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.05
Nodes (45): account_balance_history(), bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), account_balance_history(), account_week_status() (+37 more)

### Community 50 - "session.ts"
Cohesion: 0.09
Nodes (59): Accounts(), COLUMNS, FILTERS, setCompany(), Approvals(), COLUMNS, Fact(), ReviewPanel() (+51 more)

### Community 51 - "cn"
Cohesion: 0.35
Nodes (11): THEME_KEY, ThemeMenuItem(), initials(), UserMenu(), DropdownMenu(), DropdownMenuContent(), DropdownMenuItem(), DropdownMenuLabel() (+3 more)

### Community 52 - "weekly-treasury.test.ts"
Cohesion: 0.10
Nodes (34): actAs(), fn(), key(), mk(), rows(), account(), before, ids (+26 more)

### Community 53 - "auth.ts"
Cohesion: 0.08
Nodes (74): Password(), Security(), addGroupGrant(), admin(), audit(), createCompany(), createRole(), createUser() (+66 more)

### Community 54 - "Testing guide"
Cohesion: 0.22
Nodes (10): Demo people, Local test copy setup, Testing guide, Things to try to break, UI and UX checklist, Workflow scenarios, company_bank_account_access, Legacy status and role mapping (+2 more)

### Community 55 - "phase2.test.ts"
Cohesion: 0.33
Nodes (7): BD_ADDIS, BD_HAWASSA, addAtt(), draft(), inst(), key(), ready()

### Community 58 - "20261109000800_more_notifications/migration.sql"
Cohesion: 0.19
Nodes (12): account_access_notify, enqueue_missing_openings(), notify_account_access(), notify_person_details_pending(), notify_supplier_details_pending(), notify_user_account(), person_payment_details_notify, public.lock_week() (+4 more)

### Community 59 - "company.ts"
Cohesion: 0.29
Nodes (9): AppShell(), ShellProps, CompanySwitcher(), DevBanner(), Header(), label(), TableLabels(), ALL_COMPANIES (+1 more)

### Community 60 - "theme.test.ts"
Cohesion: 0.28
Nodes (7): channel(), contrast(), css, luminance(), SHAPES, TEXT, themes

### Community 61 - "form.tsx"
Cohesion: 0.24
Nodes (11): NewRequestForm(), newRow(), Step(), SearchableSelect(), SearchableSelectProps, METHODS_FOR_KIND, compare(), filterOptions() (+3 more)

### Community 62 - "weekly-concurrency.test.ts"
Cohesion: 0.15
Nodes (17): addDetail(), addPerson(), asPerson(), balance(), state(), authenticated(), balance(), monday() (+9 more)

### Community 63 - "Docker Compose deployment"
Cohesion: 0.40
Nodes (5): Encryption key (APP_ENCRYPTION_KEY), Docker Compose deployment, Migration runner (ops/migrate.mjs), Sign-in security policy, Built-in sign-in

### Community 65 - "ops.test.ts"
Cohesion: 0.24
Nodes (7): b, c, [email, ...nameParts], name, temp, c, hashPassword()

### Community 69 - "requests.ts"
Cohesion: 0.08
Nodes (33): revealAccountNumber(), RevealResult, AccountNumber(), HIDE_AFTER_MS, maskNumber(), RevealNumber(), isNumberKind(), NumberKind (+25 more)

### Community 72 - "treasury-screens.ts"
Cohesion: 0.12
Nodes (16): ACCESS_LABEL, ACCESS_NOTE, AccountFacts, AccountUser, DUE_OPTIONS, FigureInput, LogRow, OutstandingRow (+8 more)

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)`, `Migration runner (ops/migrate.mjs)`, `Local test copy setup` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 388 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `helpers.ts` to `admin/page.tsx`, `ops.test.ts`, `phase1.test.ts`, `package.json`, `app/page.tsx`, `account-numbers.test.ts`, `session.ts`, `access-withdrawal-race.test.ts`, `weekly-treasury.test.ts`, `auth.ts`, `shared-account-privacy.test.ts`, `phase2.test.ts`, `Badge`, `weekly-concurrency.test.ts`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `admin/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.05789235639981909 - nodes in this community are weakly interconnected._
- **Why does `payment_requests` connect `Suppliers and Requests Schema` to `users`, `Workflow Schema and Adjustments`, `20261015000000_treasury/migration.sql`, `20261106000000_phase2_payees_accounts/migration.sql`, `companies`, `20261107000000_phase3_weekly_treasury/migration.sql`, `20261012000000_foundation/migration.sql`, `20261016000000_scheduler/migration.sql`, `suppliers`, `20261105000100_phase1_money_logic/migration.sql`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Should `phase1.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0613107822410148 - nodes in this community are weakly interconnected._
- **Why does `users` connect `users` to `20261109000800_more_notifications/migration.sql`, `Suppliers and Requests Schema`, `Workflow Schema and Adjustments`, `20261015000000_treasury/migration.sql`, `20261106000000_phase2_payees_accounts/migration.sql`, `companies`, `20261107000000_phase3_weekly_treasury/migration.sql`, `20261012000000_foundation/migration.sql`, `20261016000000_scheduler/migration.sql`, `suppliers`, `20261105000100_phase1_money_logic/migration.sql`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Should `etb` be split into smaller, more focused modules?**
  _Cohesion score 0.12025901942645699 - nodes in this community are weakly interconnected._