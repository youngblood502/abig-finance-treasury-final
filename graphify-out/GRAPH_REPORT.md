# Graph Report - abig-finance-treasury  (2026-11-07)

## Corpus Check
- 175 files · ~135,384 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 6, .css 3, .example 2)

## Summary
- 1470 nodes · 4773 edges · 66 communities (49 shown, 17 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 67 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1c6f5f9f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- form.tsx
- phase1.test.ts
- Auth and Admin Actions
- Documentation and Workflows
- Payment Workflow Actions
- users
- Button
- Suppliers and Requests Schema
- Workflow Schema and Adjustments
- Dev Dependencies
- app/page.tsx
- 20261015000000_treasury/migration.sql
- 20261106000000_phase2_payees_accounts/migration.sql
- TypeScript Compiler Config
- helpers.ts
- NPM Scripts
- Runtime Dependencies
- Compose Database Service
- cn
- Compose Migrate Service
- account-panel.tsx
- pg
- 20261012000000_foundation/migration.sql
- Compose Service Topology
- payees/page.tsx
- components.json
- 20261016000000_scheduler/migration.sql
- session.ts
- companies
- 20261105000100_phase1_money_logic/migration.sql
- Compose Proxy Service
- App Environment Variables
- Compose Volumes
- Compose Build Targets
- Worker Environment Variables
- Badge
- Restore Drill Script
- Graphify Skill References
- Notifications Worker Doc
- Backup Script
- wf_adjust
- weekly-treasury.test.ts
- ABIG Brand Logo
- Supplier Bank Versioning
- reconciliation.ts
- 20261107000000_phase3_weekly_treasury/migration.sql
- smtp-server
- format.ts
- weekly-treasury.test.ts
- @fontsource-variable/figtree
- tailwindcss@4.2.4
- approvals/page.tsx
- postcss.config.mjs
- rows
- shared-account-privacy.test.ts
- payee-screens.ts
- health/route.ts
- weekly-concurrency.test.ts
- treasury.ts
- csv.ts
- next.config.ts

## God Nodes (most connected - your core abstractions)
1. `payment_requests` - 94 edges
2. `withUser()` - 68 edges
3. `rows()` - 64 edges
4. `etb()` - 63 edges
5. `Button()` - 62 edges
6. `company_bank_accounts` - 53 edges
7. `currentUserId()` - 49 edges
8. `users` - 49 edges
9. `Badge()` - 47 edges
10. `requireMe()` - 43 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `bal()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/phase1.test.ts → abig-finance/tests/helpers.ts
- `req()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/phase1.test.ts → abig-finance/tests/helpers.ts
- `shortfallEvents()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/phase1.test.ts → abig-finance/tests/helpers.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (66 total, 17 thin omitted)

### Community 0 - "form.tsx"
Cohesion: 0.24
Nodes (11): NewRequestForm(), newRow(), Step(), SearchableSelect(), SearchableSelectProps, accountPlace(), METHODS_FOR_KIND, FormAccount (+3 more)

### Community 1 - "phase1.test.ts"
Cohesion: 0.11
Nodes (21): nodemailer@^10.1.1, compose(), Mail, makeSender(), OutboxEvent, Sender, SUBJECTS, tick() (+13 more)

### Community 2 - "Auth and Admin Actions"
Cohesion: 0.07
Nodes (76): Password(), Security(), addGroupGrant(), admin(), audit(), createCompany(), createRole(), createUser() (+68 more)

### Community 3 - "Documentation and Workflows"
Cohesion: 0.05
Nodes (43): Encryption key (APP_ENCRYPTION_KEY), ops/backup.sh, Docker Compose deployment, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Migration runner (ops/migrate.mjs) (+35 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.10
Nodes (58): act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine(), addSupplier(), adjustRequest(), createAndSubmitRequest() (+50 more)

### Community 5 - "users"
Cohesion: 0.10
Nodes (35): app_member_companies(), company_memberships, users, company_role_users(), app_can_snapshot(), app_member_companies(), app_permitted_companies(), assert_role_company_limit() (+27 more)

### Community 6 - "Button"
Cohesion: 0.19
Nodes (24): DemoConfirm(), DemoControls(), OPTIONS, LIMITED, Reconciliation(), CorrectStatement(), ReviewDecision(), SendForReview() (+16 more)

### Community 7 - "Suppliers and Requests Schema"
Cohesion: 0.07
Nodes (43): app_can_edit_draft(), app_can_see_request(), app_supplier_active_for(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate (+35 more)

### Community 8 - "Workflow Schema and Adjustments"
Cohesion: 0.09
Nodes (27): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+19 more)

### Community 9 - "Dev Dependencies"
Cohesion: 0.09
Nodes (30): devDependencies, esbuild@^0.24.0, prisma@^6.0.0, @tailwindcss/postcss@4.2.4, tsx@^4.19.0, tw-animate-css@^1.4.0, @types/node@^22.0.0, @types/nodemailer@^8.0.2 (+22 more)

### Community 10 - "app/page.tsx"
Cohesion: 0.08
Nodes (48): setCompany(), accessLines(), dynamic, metadata, RootLayout(), Dashboard(), Panel(), QUEUE_COLUMNS (+40 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.08
Nodes (44): payment_installments, access_revoked_release(), account_access_release, account_use_approvals, account_use_one_active, app_can_see_funding(), approvals_no_delete, assert_account_use() (+36 more)

### Community 12 - "20261106000000_phase2_payees_accounts/migration.sql"
Cohesion: 0.11
Nodes (21): app_person_active_for(), assert_method_fits_account(), assert_submittable(), company_bank_accounts_wallet_phone, payment_request_cash_processed(), payment_requests_cash_processed, payment_requests_person_invoice_once, payment_requests_person_payee_idx (+13 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "helpers.ts"
Cohesion: 0.16
Nodes (27): Tx, compare(), sumRows(), TableQuery, tableView(), accountDetail(), accountList(), treasuryOverview() (+19 more)

### Community 15 - "NPM Scripts"
Cohesion: 0.14
Nodes (14): scripts, bootstrap:admin, build, build:worker, check:integrity, db:demo, db:seed, demo:passwords (+6 more)

### Community 16 - "Runtime Dependencies"
Cohesion: 0.09
Nodes (22): dependencies, class-variance-authority@^0.7.1, clsx@^2.1.1, lucide-react@^1.69.0, next@^15.2.0, pg@^8.13.0, qrcode@^1.5.4, @radix-ui/react-dialog@^1.3.1 (+14 more)

### Community 17 - "Compose Database Service"
Cohesion: 0.17
Nodes (12): environment, healthcheck, image, restart, volumes, POSTGRES_DB, POSTGRES_PASSWORD, interval (+4 more)

### Community 18 - "cn"
Cohesion: 0.07
Nodes (51): switchUser(), AppShell(), ShellProps, Brand(), CompanySwitcher(), DevBanner(), Header(), MobileNav() (+43 more)

### Community 19 - "Compose Migrate Service"
Cohesion: 0.18
Nodes (11): condition, db, APP_DB_PASSWORD, AUTH_DB_PASSWORD, MIGRATION_DATABASE_URL, WORKER_DB_PASSWORD, command, depends_on (+3 more)

### Community 20 - "account-panel.tsx"
Cohesion: 0.08
Nodes (34): AccountPanel(), canDo(), Line(), Section(), RegisterAccountForm(), AdjustForm(), AdjustFormProps, BalanceCheckForm() (+26 more)

### Community 21 - "pg"
Cohesion: 0.15
Nodes (13): b, c, [email, ...nameParts], name, temp, c, hashPassword(), BD_ADDIS (+5 more)

### Community 22 - "20261012000000_foundation/migration.sql"
Cohesion: 0.08
Nodes (35): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_manage_access(), app_can_see_account() (+27 more)

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 24 - "payees/page.tsx"
Cohesion: 0.18
Nodes (24): COLUMNS, Line(), PersonPanel(), versionLabel(), COLUMNS, Company, NameField(), SupplierPanel() (+16 more)

### Community 25 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 26 - "20261016000000_scheduler/migration.sql"
Cohesion: 0.24
Nodes (10): cash_forecast_account_idx, cash_forecast_guard, cash_forecast_items, cash_forecast_no_delete, _forecast(), forecast_add(), forecast_cancel(), forecast_guard() (+2 more)

### Community 27 - "session.ts"
Cohesion: 0.12
Nodes (50): Accounts(), COLUMNS, FILTERS, Admin(), GET(), Gallery(), Payees(), EditRequest() (+42 more)

### Community 28 - "companies"
Cohesion: 0.23
Nodes (11): companies, admin_create_company(), auth_events, auth_events_append_only, auth_events_no_truncate, auth_events_time_idx, company_directory(), report_outstanding() (+3 more)

### Community 29 - "20261105000100_phase1_money_logic/migration.sql"
Cohesion: 0.09
Nodes (16): wf_set_state(), banks, account_balance_history(), mark_authenticated_paid_at_go_live(), outbox_recipients(), payment_request_funds_guard(), payment_requests_invoice_once, record_execution() (+8 more)

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

### Community 35 - "Badge"
Cohesion: 0.14
Nodes (21): COLUMNS, PAYMENTS, ROWS, Section(), SWATCHES, cells(), COLUMNS, Partial() (+13 more)

### Community 42 - "wf_adjust"
Cohesion: 0.14
Nodes (7): wf_adjust(), account_balance_history(), app_actionable_requests(), payment_request_funds_guard(), public.wf_adjust(), request_payment_status(), wf_return()

### Community 43 - "weekly-treasury.test.ts"
Cohesion: 0.18
Nodes (16): actAs(), authorized(), fn(), key(), mk(), before, ids, snapshot() (+8 more)

### Community 48 - "reconciliation.ts"
Cohesion: 0.15
Nodes (23): PaymentColumnsProps, addDays(), byOwner(), carriedIn(), defaultStatementDate(), mondayOf(), overviewWeeks(), partialFigures() (+15 more)

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.05
Nodes (44): bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), account_balance_history(), account_week_status(), balance_check_items (+36 more)

### Community 51 - "format.ts"
Cohesion: 0.21
Nodes (18): GET(), money(), Reports(), g, addisDate(), amount2(), parts(), STATE_LABEL (+10 more)

### Community 52 - "weekly-treasury.test.ts"
Cohesion: 0.16
Nodes (15): at(), balance(), check(), clockSql(), day(), lock(), lockedWeek(), open() (+7 more)

### Community 55 - "approvals/page.tsx"
Cohesion: 0.09
Nodes (41): Approvals(), COLUMNS, Fact(), ReviewPanel(), Card(), Fact(), INSTALLMENTS, RequestDetail() (+33 more)

### Community 58 - "rows"
Cohesion: 0.13
Nodes (23): attempt(), connect(), draft(), granted(), held(), must(), noStranded(), raced() (+15 more)

### Community 59 - "shared-account-privacy.test.ts"
Cohesion: 0.09
Nodes (14): c, dir, files, files(), ADMIN_URL, root, run(), url() (+6 more)

### Community 60 - "payee-screens.ts"
Cohesion: 0.17
Nodes (14): history(), listFilters(), needsVerifying(), PaymentLine, personList(), PersonRow, PersonVersion, SupplierLink (+6 more)

### Community 62 - "weekly-concurrency.test.ts"
Cohesion: 0.26
Nodes (13): asPerson(), authenticated(), balance(), monday(), newAccount(), once(), person(), prepared() (+5 more)

### Community 63 - "treasury.ts"
Cohesion: 0.32
Nodes (11): addReconciliationLine(), lockWeek(), matchPayment(), recordExecution(), recordFigure(), removeReconciliationLine(), returnReconciliation(), run() (+3 more)

### Community 64 - "csv.ts"
Cohesion: 0.70
Nodes (3): cell(), toCsv(), addisIso()

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)`, `Migration runner (ops/migrate.mjs)`, `Local test copy setup` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 351 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `phase1.test.ts` to `Auth and Admin Actions`, `session.ts`, `Dev Dependencies`, `app/page.tsx`, `weekly-treasury.test.ts`, `helpers.ts`, `Runtime Dependencies`, `reconciliation.ts`, `format.ts`, `weekly-treasury.test.ts`, `pg`, `rows`, `shared-account-privacy.test.ts`, `weekly-concurrency.test.ts`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `phase1.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10582010582010581 - nodes in this community are weakly interconnected._
- **Why does `next` connect `session.ts` to `next.config.ts`, `Auth and Admin Actions`, `Payment Workflow Actions`, `Badge`, `Button`, `Dev Dependencies`, `app/page.tsx`, `Runtime Dependencies`, `cn`, `format.ts`, `account-panel.tsx`, `approvals/page.tsx`, `payees/page.tsx`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Should `Auth and Admin Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.07032967032967033 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `shared-account-privacy.test.ts` to `csv.ts`, `phase1.test.ts`, `Auth and Admin Actions`, `Dev Dependencies`, `app/page.tsx`, `weekly-treasury.test.ts`, `helpers.ts`, `reconciliation.ts`, `cn`, `format.ts`, `weekly-treasury.test.ts`, `pg`, `rows`, `weekly-concurrency.test.ts`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Should `Documentation and Workflows` be split into smaller, more focused modules?**
  _Cohesion score 0.054693877551020405 - nodes in this community are weakly interconnected._