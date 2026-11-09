# Graph Report - abig-finance-treasury  (2026-11-09)

## Corpus Check
- 191 files · ~155,641 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 6, .css 3, .example 2)

## Summary
- 1619 nodes · 5512 edges · 76 communities (58 shown, 18 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 81 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2713c05c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- admin/page.tsx
- phase1.test.ts
- Operations guide
- Operations guide
- Payment Workflow Actions
- users
- layout.tsx
- Suppliers and Requests Schema
- Workflow Schema and Adjustments
- package.json
- app/page.tsx
- 20261015000000_treasury/migration.sql
- 20261106000000_phase2_payees_accounts/migration.sql
- TypeScript Compiler Config
- company-deactivation.test.ts
- NPM Scripts
- Runtime Dependencies
- Compose Database Service
- account-numbers.test.ts
- Compose Migrate Service
- form.tsx
- requests/[id]/page.tsx
- 20261012000000_foundation/migration.sql
- Compose Service Topology
- Badge
- components.json
- 20261016000000_scheduler/migration.sql
- currentUserId
- companies
- 20261105000100_phase1_money_logic/migration.sql
- Compose Proxy Service
- App Environment Variables
- Compose Volumes
- Compose Build Targets
- Worker Environment Variables
- DataTable
- Restore Drill Script
- Graphify Skill References
- Notifications Worker Doc
- Backup Script
- crypto.ts
- helpers.ts
- ABIG Brand Logo
- Supplier Bank Versioning
- Button
- 20261107000000_phase3_weekly_treasury/migration.sql
- treasury-screens.ts
- reports.ts
- weekly-treasury.test.ts
- auth.ts
- auth-actions.ts
- mk
- postcss.config.mjs
- access-withdrawal-race.test.ts
- format.ts
- tailwind-merge
- prisma@^6.0.0
- weekly-concurrency.test.ts
- smtp-server
- typescript@^5.6.0
- shared-account-privacy.test.ts
- reports/page.tsx
- payee-screens.ts
- crypto.ts
- requests.ts
- Badge
- session.ts
- phase1.test.ts
- table.ts
- health/route.ts
- next.config.ts

## God Nodes (most connected - your core abstractions)
1. `payment_requests` - 95 edges
2. `Button()` - 77 edges
3. `withUser()` - 76 edges
4. `rows()` - 73 edges
5. `etb()` - 67 edges
6. `Badge()` - 58 edges
7. `company_bank_accounts` - 55 edges
8. `currentUserId()` - 51 edges
9. `users` - 50 edges
10. `requireMe()` - 45 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `deliveries()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/outbox-delivery.test.ts → abig-finance/tests/helpers.ts
- `state()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/phase3.test.ts → abig-finance/tests/helpers.ts
- `actions()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/phase3.test.ts → abig-finance/tests/helpers.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (76 total, 18 thin omitted)

### Community 0 - "admin/page.tsx"
Cohesion: 0.08
Nodes (69): addGroupGrant(), admin(), audit(), createCompany(), createRole(), createUser(), done(), resetMfa() (+61 more)

### Community 1 - "phase1.test.ts"
Cohesion: 0.10
Nodes (18): compose(), deliver(), Mail, makeSender(), OutboxEvent, Sender, SUBJECTS, tick() (+10 more)

### Community 2 - "Operations guide"
Cohesion: 0.11
Nodes (18): Encryption key (APP_ENCRYPTION_KEY), ops/backup.sh, Docker Compose deployment, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Migration runner (ops/migrate.mjs) (+10 more)

### Community 3 - "Operations guide"
Cohesion: 0.10
Nodes (25): Demo people, Local test copy setup, Testing guide, Things to try to break, UI and UX checklist, Workflow scenarios, company_bank_account_access, Corporate treasury refactor (+17 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.09
Nodes (64): act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine(), addSupplier(), adjustRequest(), createAndSubmitRequest() (+56 more)

### Community 5 - "users"
Cohesion: 0.09
Nodes (37): app_is_admin(), app_member_companies(), company_memberships, company_memberships_one_active, company_memberships_user_idx, users, company_role_users(), app_can_snapshot() (+29 more)

### Community 6 - "layout.tsx"
Cohesion: 0.08
Nodes (42): switchUser(), AppShell(), ShellProps, Brand(), CompanySwitcher(), DevBanner(), Header(), MobileNav() (+34 more)

### Community 7 - "Suppliers and Requests Schema"
Cohesion: 0.06
Nodes (50): app_can_edit_draft(), app_can_see_request(), app_supplier_active_for(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate (+42 more)

### Community 8 - "Workflow Schema and Adjustments"
Cohesion: 0.07
Nodes (33): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+25 more)

### Community 9 - "package.json"
Cohesion: 0.09
Nodes (30): devDependencies, esbuild@^0.24.0, @fontsource-variable/figtree@^5.3.0, tailwindcss@4.2.4, @tailwindcss/postcss@4.2.4, tsx@^4.19.0, tw-animate-css@^1.4.0, @types/node@^22.0.0 (+22 more)

### Community 10 - "app/page.tsx"
Cohesion: 0.08
Nodes (46): setCompany(), accessLines(), dynamic, metadata, RootLayout(), Dashboard(), Panel(), QUEUE_COLUMNS (+38 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.08
Nodes (46): installments_guard, payment_installments, access_revoked_release(), account_access_release, account_use_approvals, account_use_one_active, app_can_see_funding(), approvals_no_delete (+38 more)

### Community 12 - "20261106000000_phase2_payees_accounts/migration.sql"
Cohesion: 0.07
Nodes (32): banks, register_bank_account(), app_person_active_for(), assert_method_fits_account(), assert_submittable(), company_bank_accounts_wallet_phone, payment_request_cash_processed(), payment_requests_cash_processed (+24 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "company-deactivation.test.ts"
Cohesion: 0.16
Nodes (31): MY_COMPANIES_SQL, g, Tx, stopReason(), refusedAfter(), actAs(), ASKU, authorized() (+23 more)

### Community 15 - "NPM Scripts"
Cohesion: 0.14
Nodes (14): scripts, bootstrap:admin, build, build:worker, check:integrity, db:demo, db:seed, demo:passwords (+6 more)

### Community 16 - "Runtime Dependencies"
Cohesion: 0.10
Nodes (21): dependencies, class-variance-authority@^0.7.1, clsx@^2.1.1, lucide-react@^1.69.0, next@^15.2.0, nodemailer@^10.1.1, pg@^8.13.0, qrcode@^1.5.4 (+13 more)

### Community 17 - "Compose Database Service"
Cohesion: 0.17
Nodes (12): environment, healthcheck, image, restart, volumes, POSTGRES_DB, POSTGRES_PASSWORD, interval (+4 more)

### Community 18 - "account-numbers.test.ts"
Cohesion: 0.12
Nodes (23): normalizeAccountNumber(), reconciliationWeek(), auditRows(), cashRows(), ReportFilters, likePattern(), listRequests(), loadRequest() (+15 more)

### Community 19 - "Compose Migrate Service"
Cohesion: 0.18
Nodes (11): condition, db, APP_DB_PASSWORD, AUTH_DB_PASSWORD, MIGRATION_DATABASE_URL, WORKER_DB_PASSWORD, command, depends_on (+3 more)

### Community 20 - "form.tsx"
Cohesion: 0.17
Nodes (19): OPTIONS, NewRequestForm(), newRow(), Step(), RegisterAccountForm(), AdjustForm(), AdjustFormProps, BalanceCheckFormProps (+11 more)

### Community 21 - "requests/[id]/page.tsx"
Cohesion: 0.12
Nodes (34): Accounts(), COLUMNS, FILTERS, Card(), Fact(), INSTALLMENTS, RequestDetail(), AccountPanel() (+26 more)

### Community 22 - "20261012000000_foundation/migration.sql"
Cohesion: 0.08
Nodes (33): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_manage_access(), app_can_see_account() (+25 more)

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 24 - "Badge"
Cohesion: 0.17
Nodes (25): COLUMNS, Line(), Payees(), PersonPanel(), versionLabel(), COLUMNS, Company, NameField() (+17 more)

### Community 25 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 26 - "20261016000000_scheduler/migration.sql"
Cohesion: 0.16
Nodes (11): cash_forecast_account_idx, cash_forecast_guard, cash_forecast_items, cash_forecast_no_delete, _forecast(), forecast_add(), forecast_cancel(), forecast_guard() (+3 more)

### Community 27 - "currentUserId"
Cohesion: 0.20
Nodes (27): Approvals(), COLUMNS, Fact(), ReviewPanel(), EditRequest(), NewRequest(), COLUMNS, Requests() (+19 more)

### Community 28 - "companies"
Cohesion: 0.16
Nodes (12): companies, admin_create_company(), auth_events, auth_events_append_only, auth_events_no_truncate, auth_events_time_idx, company_directory(), report_outstanding() (+4 more)

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

### Community 35 - "DataTable"
Cohesion: 0.11
Nodes (33): cells(), COLUMNS, Partial(), WeekOverview(), Column(), count(), DifferenceCard(), Line() (+25 more)

### Community 42 - "crypto.ts"
Cohesion: 0.21
Nodes (14): revealAccountNumber(), RevealResult, isNumberKind(), NumberKind, REVEAL, revealNumber(), blindIndex(), decryptSecret() (+6 more)

### Community 43 - "helpers.ts"
Cohesion: 0.29
Nodes (8): BD_ADDIS, BD_HAWASSA, S_ADDIS, addAtt(), draft(), inst(), key(), ready()

### Community 48 - "Button"
Cohesion: 0.16
Nodes (24): DemoConfirm(), DemoControls(), COLUMNS, Gallery(), PAYMENTS, ROWS, Section(), SWATCHES (+16 more)

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.05
Nodes (45): account_balance_history(), bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), account_balance_history(), account_week_status() (+37 more)

### Community 50 - "treasury-screens.ts"
Cohesion: 0.13
Nodes (20): ACCESS_LABEL, ACCESS_NOTE, accountDetail(), AccountFacts, AccountUser, DUE_OPTIONS, dueBucket(), FigureInput (+12 more)

### Community 51 - "reports.ts"
Cohesion: 0.11
Nodes (28): GET(), money(), shown(), cell(), toCsv(), addisIso(), amount2(), WeekOverviewRow (+20 more)

### Community 52 - "weekly-treasury.test.ts"
Cohesion: 0.10
Nodes (27): rows(), addDetail(), addPerson(), balance(), state(), account(), before, ids (+19 more)

### Community 53 - "auth.ts"
Cohesion: 0.22
Nodes (18): adminResetTotp(), adminSetPassword(), adminUnlock(), assertAdmin(), event(), g, IDLE_MINUTES, LOCK_MINUTES (+10 more)

### Community 54 - "auth-actions.ts"
Cohesion: 0.19
Nodes (14): Security(), back(), changePasswordAction(), disableMfaAction(), enableMfaAction(), loginAction(), logoutAction(), startMfaAction() (+6 more)

### Community 55 - "mk"
Cohesion: 0.36
Nodes (6): key(), mk(), actions(), state(), sub(), submitted()

### Community 58 - "access-withdrawal-race.test.ts"
Cohesion: 0.25
Nodes (12): attempt(), connect(), draft(), granted(), held(), must(), noStranded(), raced() (+4 more)

### Community 59 - "format.ts"
Cohesion: 0.14
Nodes (18): BalanceLogEntry, COLUMNS, DataColumn, DataFilter, DataRow, DataTableProps, StatusBadge(), ACCOUNT_KINDS (+10 more)

### Community 62 - "weekly-concurrency.test.ts"
Cohesion: 0.26
Nodes (13): asPerson(), authenticated(), balance(), monday(), newAccount(), once(), person(), prepared() (+5 more)

### Community 65 - "shared-account-privacy.test.ts"
Cohesion: 0.08
Nodes (22): b, c, [email, ...nameParts], name, temp, c, hashPassword(), c (+14 more)

### Community 66 - "reports/page.tsx"
Cohesion: 0.36
Nodes (17): Audit(), Cash(), Download(), FilterBar(), Outstanding(), Panel(), Payments(), Pending() (+9 more)

### Community 67 - "payee-screens.ts"
Cohesion: 0.15
Nodes (17): NumberState, canChangeSupplierStatus(), history(), listFilters(), needsVerifying(), PaymentLine, personList(), PersonRow (+9 more)

### Community 68 - "crypto.ts"
Cohesion: 0.32
Nodes (12): changePassword(), base32(), COMMON, hashPassword(), newTotpSecret(), passwordProblem(), scrypt(), totpAt() (+4 more)

### Community 69 - "requests.ts"
Cohesion: 0.12
Nodes (16): ACTION_LABEL, AdjustmentRow, AGE_OPTIONS, ApprovalRow, FIELD_LABEL, FileRow, HistoryEntry, InstallmentRow (+8 more)

### Community 70 - "Badge"
Cohesion: 0.36
Nodes (10): Card(), PaymentLine(), TreasuryAccount(), ShortfallChip(), BalanceCheckForm(), Line(), BalanceLog(), Badge() (+2 more)

### Community 71 - "session.ts"
Cohesion: 0.25
Nodes (8): Password(), COOKIE, FINANCE_ROLES, getMe(), getSession(), LEGACY_ROLE, load(), SessionInfo

### Community 72 - "phase1.test.ts"
Cohesion: 0.20
Nodes (8): BD_ETHIO, enterFigure(), S_ETHIO_ID, bal(), req(), setBalance(), shortfallEvents(), submitted()

### Community 73 - "table.ts"
Cohesion: 0.33
Nodes (7): SearchableSelectProps, compare(), filterOptions(), SelectOption, sumRows(), TableQuery, tableView()

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)`, `Migration runner (ops/migrate.mjs)`, `Local test copy setup` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 370 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `shared-account-privacy.test.ts` to `phase1.test.ts`, `session.ts`, `phase1.test.ts`, `package.json`, `app/page.tsx`, `helpers.ts`, `company-deactivation.test.ts`, `Runtime Dependencies`, `account-numbers.test.ts`, `treasury-screens.ts`, `weekly-treasury.test.ts`, `auth.ts`, `mk`, `access-withdrawal-race.test.ts`, `format.ts`, `weekly-concurrency.test.ts`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `admin/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07758907758907758 - nodes in this community are weakly interconnected._
- **Why does `payment_requests` connect `Suppliers and Requests Schema` to `users`, `Workflow Schema and Adjustments`, `20261015000000_treasury/migration.sql`, `20261106000000_phase2_payees_accounts/migration.sql`, `20261107000000_phase3_weekly_treasury/migration.sql`, `20261012000000_foundation/migration.sql`, `20261016000000_scheduler/migration.sql`, `companies`, `20261105000100_phase1_money_logic/migration.sql`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Should `phase1.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0960591133004926 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `company-deactivation.test.ts` to `shared-account-privacy.test.ts`, `phase1.test.ts`, `crypto.ts`, `layout.tsx`, `phase1.test.ts`, `package.json`, `app/page.tsx`, `helpers.ts`, `account-numbers.test.ts`, `reports.ts`, `weekly-treasury.test.ts`, `treasury-screens.ts`, `mk`, `access-withdrawal-race.test.ts`, `format.ts`, `weekly-concurrency.test.ts`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Should `Operations guide` be split into smaller, more focused modules?**
  _Cohesion score 0.1067193675889328 - nodes in this community are weakly interconnected._