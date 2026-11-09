# Graph Report - abig-finance-treasury  (2026-11-09)

## Corpus Check
- 183 files · ~145,177 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 6, .css 3, .example 2)

## Summary
- 1557 nodes · 5282 edges · 68 communities (53 shown, 15 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 79 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `242026a9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- admin/page.tsx
- phase1.test.ts
- session.ts
- Documentation and Workflows
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
- helpers.ts
- NPM Scripts
- Runtime Dependencies
- Compose Database Service
- side-panel.tsx
- Compose Migrate Service
- form.tsx
- etb
- 20261012000000_foundation/migration.sql
- Compose Service Topology
- Badge
- components.json
- 20261016000000_scheduler/migration.sql
- suppliers/page.tsx
- companies
- 20261105000100_phase1_money_logic/migration.sql
- Compose Proxy Service
- App Environment Variables
- Compose Volumes
- Compose Build Targets
- Worker Environment Variables
- data-table.tsx
- Restore Drill Script
- Graphify Skill References
- Notifications Worker Doc
- Backup Script
- wf_adjust
- helpers.ts
- ABIG Brand Logo
- Supplier Bank Versioning
- reconciliation.ts
- 20261107000000_phase3_weekly_treasury/migration.sql
- treasury-screens.ts
- reports/page.tsx
- weekly-treasury.test.ts
- mail.ts
- sidebar-nav.tsx
- requests/[id]/page.tsx
- postcss.config.mjs
- access-withdrawal-race.test.ts
- phase2.test.ts
- company.ts
- health/route.ts
- weekly-concurrency.test.ts
- user-menu.tsx
- shared-account-privacy.test.ts
- status-tracker.tsx
- theme.test.ts
- next.config.ts

## God Nodes (most connected - your core abstractions)
1. `payment_requests` - 95 edges
2. `Button()` - 75 edges
3. `withUser()` - 73 edges
4. `rows()` - 68 edges
5. `etb()` - 67 edges
6. `Badge()` - 58 edges
7. `company_bank_accounts` - 53 edges
8. `currentUserId()` - 49 edges
9. `users` - 49 edges
10. `requireMe()` - 45 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `seen()` --indirect_call--> `week()`  [INFERRED]
  abig-finance/tests/company-deactivation.test.ts → abig-finance/src/app/actions.ts
- `bal()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/phase1.test.ts → abig-finance/tests/helpers.ts
- `req()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/phase1.test.ts → abig-finance/tests/helpers.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (68 total, 15 thin omitted)

### Community 0 - "admin/page.tsx"
Cohesion: 0.07
Nodes (71): addGroupGrant(), admin(), audit(), createCompany(), createRole(), createUser(), done(), resetMfa() (+63 more)

### Community 1 - "phase1.test.ts"
Cohesion: 0.17
Nodes (11): compose(), tick(), enterFigure(), fn(), S_ETHIO_ID, inbox, bal(), req() (+3 more)

### Community 2 - "session.ts"
Cohesion: 0.08
Nodes (54): Password(), Security(), back(), changePasswordAction(), disableMfaAction(), enableMfaAction(), loginAction(), startMfaAction() (+46 more)

### Community 3 - "Documentation and Workflows"
Cohesion: 0.05
Nodes (43): Encryption key (APP_ENCRYPTION_KEY), ops/backup.sh, Docker Compose deployment, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Migration runner (ops/migrate.mjs) (+35 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.05
Nodes (96): act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine(), addSupplier(), adjustRequest(), createAndSubmitRequest() (+88 more)

### Community 5 - "users"
Cohesion: 0.10
Nodes (34): app_member_companies(), company_memberships, users, company_role_users(), app_can_snapshot(), app_member_companies(), app_permitted_companies(), assert_role_company_limit() (+26 more)

### Community 6 - "layout.tsx"
Cohesion: 0.15
Nodes (14): setCompany(), accessLines(), dynamic, metadata, RootLayout(), myCompanies, navFor(), ROLE_LABEL() (+6 more)

### Community 7 - "Suppliers and Requests Schema"
Cohesion: 0.07
Nodes (34): app_can_edit_draft(), app_can_see_request(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx (+26 more)

### Community 8 - "Workflow Schema and Adjustments"
Cohesion: 0.08
Nodes (35): payment_requests, adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events (+27 more)

### Community 9 - "package.json"
Cohesion: 0.08
Nodes (36): devDependencies, esbuild@^0.24.0, @fontsource-variable/figtree@^5.3.0, prisma@^6.0.0, smtp-server@^3.19.22, tailwindcss@4.2.4, @tailwindcss/postcss@4.2.4, tsx@^4.19.0 (+28 more)

### Community 10 - "app/page.tsx"
Cohesion: 0.14
Nodes (29): Dashboard(), Panel(), QUEUE_COLUMNS, queueTable(), Section(), accountInCompany(), AccountRow, accountRows() (+21 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.08
Nodes (45): payment_installments, access_revoked_release(), account_access_release, account_use_approvals, account_use_one_active, app_can_see_funding(), approvals_no_delete, assert_account_use() (+37 more)

### Community 12 - "20261106000000_phase2_payees_accounts/migration.sql"
Cohesion: 0.11
Nodes (21): app_person_active_for(), assert_method_fits_account(), assert_submittable(), company_bank_accounts_wallet_phone, payment_request_cash_processed(), payment_requests_cash_processed, payment_requests_person_invoice_once, payment_requests_person_payee_idx (+13 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "helpers.ts"
Cohesion: 0.24
Nodes (18): g, Tx, STATE_LABEL, TIME_ZONE, stopReason(), ASKU, authorized(), AWASH (+10 more)

### Community 15 - "NPM Scripts"
Cohesion: 0.14
Nodes (14): scripts, bootstrap:admin, build, build:worker, check:integrity, db:demo, db:seed, demo:passwords (+6 more)

### Community 16 - "Runtime Dependencies"
Cohesion: 0.09
Nodes (22): dependencies, class-variance-authority@^0.7.1, clsx@^2.1.1, lucide-react@^1.69.0, next@^15.2.0, pg@^8.13.0, qrcode@^1.5.4, @radix-ui/react-dialog@^1.3.1 (+14 more)

### Community 17 - "Compose Database Service"
Cohesion: 0.17
Nodes (12): environment, healthcheck, image, restart, volumes, POSTGRES_DB, POSTGRES_PASSWORD, interval (+4 more)

### Community 18 - "side-panel.tsx"
Cohesion: 0.42
Nodes (8): MobileNav(), Sheet(), SheetContent(), SheetDescription(), SheetOverlay(), SheetTitle(), SheetTrigger(), lucide-react

### Community 19 - "Compose Migrate Service"
Cohesion: 0.18
Nodes (11): condition, db, APP_DB_PASSWORD, AUTH_DB_PASSWORD, MIGRATION_DATABASE_URL, WORKER_DB_PASSWORD, command, depends_on (+3 more)

### Community 20 - "form.tsx"
Cohesion: 0.15
Nodes (22): DemoControls(), OPTIONS, NewRequestForm(), newRow(), Step(), RegisterAccountForm(), AddPersonForm(), METHODS (+14 more)

### Community 21 - "etb"
Cohesion: 0.14
Nodes (28): ROWS, EditRequest(), Card(), PaymentLine(), TreasuryAccount(), AccountPanel(), canDo(), Line() (+20 more)

### Community 22 - "20261012000000_foundation/migration.sql"
Cohesion: 0.08
Nodes (35): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_manage_access(), app_can_see_account() (+27 more)

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 24 - "Badge"
Cohesion: 0.13
Nodes (30): COLUMNS, Line(), Payees(), PersonPanel(), versionLabel(), SupplierPanel(), MethodList(), PayeeTabs() (+22 more)

### Community 25 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 26 - "20261016000000_scheduler/migration.sql"
Cohesion: 0.31
Nodes (9): cash_forecast_account_idx, cash_forecast_guard, cash_forecast_items, cash_forecast_no_delete, _forecast(), forecast_add(), forecast_cancel(), forecast_guard() (+1 more)

### Community 27 - "suppliers/page.tsx"
Cohesion: 0.18
Nodes (34): Accounts(), COLUMNS, FILTERS, Approvals(), COLUMNS, NewRequest(), COLUMNS, Requests() (+26 more)

### Community 28 - "companies"
Cohesion: 0.10
Nodes (20): companies, app_supplier_active_for(), company_suppliers, suppliers, treasury_schedule_queue(), admin_create_company(), auth_events, auth_events_append_only (+12 more)

### Community 29 - "20261105000100_phase1_money_logic/migration.sql"
Cohesion: 0.09
Nodes (15): wf_set_state(), banks, mark_authenticated_paid_at_go_live(), outbox_recipients(), payment_request_funds_guard(), payment_requests_invoice_once, record_execution(), register_bank_account() (+7 more)

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

### Community 35 - "data-table.tsx"
Cohesion: 0.31
Nodes (8): DataFilter, DataRow, DataTableProps, compare(), sumRows(), TableQuery, TableRow, tableView()

### Community 43 - "helpers.ts"
Cohesion: 0.12
Nodes (22): BD_ADDIS, BD_HAWASSA, BERBERO_ID, fails(), key(), mk(), MkOpts, root (+14 more)

### Community 48 - "reconciliation.ts"
Cohesion: 0.10
Nodes (51): Fact(), ReviewPanel(), DemoConfirm(), cells(), COLUMNS, Partial(), WeekOverview(), LIMITED (+43 more)

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.05
Nodes (44): account_balance_history(), bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), account_balance_history(), account_week_status() (+36 more)

### Community 50 - "treasury-screens.ts"
Cohesion: 0.12
Nodes (23): ACCESS_LABEL, ACCESS_NOTE, accountDetail(), AccountFacts, accountList(), AccountRow, AccountUser, DUE_OPTIONS (+15 more)

### Community 51 - "reports/page.tsx"
Cohesion: 0.10
Nodes (51): GET(), money(), shown(), Audit(), Cash(), Download(), FilterBar(), Outstanding() (+43 more)

### Community 52 - "weekly-treasury.test.ts"
Cohesion: 0.09
Nodes (30): ledger(), refusedAfter(), actAs(), rows(), addDetail(), addPerson(), balance(), state() (+22 more)

### Community 53 - "mail.ts"
Cohesion: 0.18
Nodes (11): nodemailer@^10.1.1, Mail, makeSender(), OutboxEvent, Sender, SUBJECTS, every(), log() (+3 more)

### Community 54 - "sidebar-nav.tsx"
Cohesion: 0.35
Nodes (7): ShellProps, Brand(), ICONS, SidebarNav(), Sidebar(), isCurrentPath(), NavItem

### Community 55 - "requests/[id]/page.tsx"
Cohesion: 0.15
Nodes (23): COLUMNS, Gallery(), PAYMENTS, Section(), SWATCHES, Card(), Fact(), INSTALLMENTS (+15 more)

### Community 58 - "access-withdrawal-race.test.ts"
Cohesion: 0.25
Nodes (12): attempt(), connect(), draft(), granted(), held(), must(), noStranded(), raced() (+4 more)

### Community 59 - "phase2.test.ts"
Cohesion: 0.16
Nodes (11): b, c, [email, ...nameParts], name, temp, c, hashPassword(), ADMIN_URL (+3 more)

### Community 60 - "company.ts"
Cohesion: 0.23
Nodes (11): switchUser(), AppShell(), CompanySwitcher(), DevBanner(), Header(), label(), TableLabels(), ALL_COMPANIES (+3 more)

### Community 62 - "weekly-concurrency.test.ts"
Cohesion: 0.26
Nodes (13): asPerson(), authenticated(), balance(), monday(), newAccount(), once(), person(), prepared() (+5 more)

### Community 64 - "user-menu.tsx"
Cohesion: 0.34
Nodes (11): logoutAction(), THEME_KEY, ThemeMenuItem(), initials(), UserMenu(), DropdownMenu(), DropdownMenuContent(), DropdownMenuItem() (+3 more)

### Community 65 - "shared-account-privacy.test.ts"
Cohesion: 0.09
Nodes (14): c, dir, files, files(), before, ids, snapshot(), askuNo() (+6 more)

### Community 69 - "status-tracker.tsx"
Cohesion: 0.36
Nodes (6): ENDED_STATES, STEPS, StepStatus, TrackerStep, trackerSteps(), trackerSummary()

### Community 70 - "theme.test.ts"
Cohesion: 0.28
Nodes (7): channel(), contrast(), css, luminance(), SHAPES, TEXT, themes

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `ABIG Corporate Treasury Requirement`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)`, `Migration runner (ops/migrate.mjs)` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 357 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `helpers.ts` to `shared-account-privacy.test.ts`, `session.ts`, `phase1.test.ts`, `package.json`, `helpers.ts`, `Runtime Dependencies`, `treasury-screens.ts`, `reports/page.tsx`, `weekly-treasury.test.ts`, `mail.ts`, `access-withdrawal-race.test.ts`, `phase2.test.ts`, `weekly-concurrency.test.ts`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `ABIG Corporate Treasury Requirement`, `/api/health` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `admin/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07191358024691358 - nodes in this community are weakly interconnected._
- **Why does `payment_requests` connect `Workflow Schema and Adjustments` to `users`, `Suppliers and Requests Schema`, `wf_adjust`, `20261015000000_treasury/migration.sql`, `20261106000000_phase2_payees_accounts/migration.sql`, `20261107000000_phase3_weekly_treasury/migration.sql`, `20261012000000_foundation/migration.sql`, `companies`, `20261105000100_phase1_money_logic/migration.sql`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Should `session.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08391608391608392 - nodes in this community are weakly interconnected._
- **Why does `rows()` connect `weekly-treasury.test.ts` to `phase1.test.ts`, `shared-account-privacy.test.ts`, `helpers.ts`, `helpers.ts`, `treasury-screens.ts`, `reports/page.tsx`, `access-withdrawal-race.test.ts`, `phase2.test.ts`, `weekly-concurrency.test.ts`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Should `Documentation and Workflows` be split into smaller, more focused modules?**
  _Cohesion score 0.054693877551020405 - nodes in this community are weakly interconnected._