# Graph Report - abig-finance-treasury  (2026-11-09)

## Corpus Check
- 189 files · ~152,399 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 6, .css 3, .example 2)

## Summary
- 1599 nodes · 5469 edges · 69 communities (52 shown, 17 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 81 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `87621392`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Button
- phase1.test.ts
- people/[id]/page.tsx
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
- account-panel.tsx
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
- reports/page.tsx
- weekly-treasury.test.ts
- auth.ts
- auth-actions.ts
- actAs
- postcss.config.mjs
- access-withdrawal-race.test.ts
- treasury.ts
- tailwind-merge
- prisma@^6.0.0
- weekly-concurrency.test.ts
- smtp-server
- typescript@^5.6.0
- shared-account-privacy.test.ts
- wf_adjust
- etb
- session.ts

## God Nodes (most connected - your core abstractions)
1. `payment_requests` - 95 edges
2. `Button()` - 77 edges
3. `withUser()` - 76 edges
4. `rows()` - 71 edges
5. `etb()` - 67 edges
6. `Badge()` - 58 edges
7. `company_bank_accounts` - 55 edges
8. `currentUserId()` - 51 edges
9. `users` - 49 edges
10. `requireMe()` - 45 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `set_account_number()` --reads_from--> `company_bank_accounts`  [EXTRACTED]
  abig-finance/prisma/migrations/20261109000600_account_number_update/migration.sql → abig-finance/prisma/migrations/20261012000000_foundation/migration.sql
- `dbl()` --indirect_call--> `translate()`  [INFERRED]
  abig-finance/src/app/actions.ts → abig-finance/src/lib/errors.ts
- `seen()` --indirect_call--> `week()`  [INFERRED]
  abig-finance/tests/company-deactivation.test.ts → abig-finance/src/app/actions.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (69 total, 17 thin omitted)

### Community 0 - "Button"
Cohesion: 0.10
Nodes (36): Activity(), AddAction(), Admin(), Companies(), Field(), Panel(), People(), Roles() (+28 more)

### Community 1 - "phase1.test.ts"
Cohesion: 0.11
Nodes (17): compose(), Mail, makeSender(), OutboxEvent, Sender, SUBJECTS, tick(), every() (+9 more)

### Community 2 - "people/[id]/page.tsx"
Cohesion: 0.29
Nodes (22): addGroupGrant(), admin(), audit(), createCompany(), createRole(), createUser(), done(), resetMfa() (+14 more)

### Community 3 - "Operations guide"
Cohesion: 0.05
Nodes (41): Encryption key (APP_ENCRYPTION_KEY), ops/backup.sh, Docker Compose deployment, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Migration runner (ops/migrate.mjs) (+33 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.10
Nodes (62): act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine(), addSupplier(), adjustRequest(), createAndSubmitRequest() (+54 more)

### Community 5 - "users"
Cohesion: 0.09
Nodes (37): app_member_companies(), company_memberships, users, company_role_users(), account_owner_company(), app_can_snapshot(), app_member_companies(), app_permitted_companies() (+29 more)

### Community 6 - "layout.tsx"
Cohesion: 0.07
Nodes (52): switchUser(), DemoControls(), OPTIONS, AppShell(), ShellProps, Brand(), CompanySwitcher(), DevBanner() (+44 more)

### Community 7 - "Suppliers and Requests Schema"
Cohesion: 0.06
Nodes (42): app_can_edit_draft(), app_can_see_request(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx (+34 more)

### Community 8 - "Workflow Schema and Adjustments"
Cohesion: 0.09
Nodes (26): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+18 more)

### Community 9 - "package.json"
Cohesion: 0.09
Nodes (30): devDependencies, esbuild@^0.24.0, @fontsource-variable/figtree@^5.3.0, tailwindcss@4.2.4, @tailwindcss/postcss@4.2.4, tsx@^4.19.0, tw-animate-css@^1.4.0, @types/node@^22.0.0 (+22 more)

### Community 10 - "app/page.tsx"
Cohesion: 0.16
Nodes (29): Dashboard(), Panel(), QUEUE_COLUMNS, queueTable(), Section(), accountInCompany(), AccountRow, accountRows() (+21 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.08
Nodes (46): installments_guard, payment_installments, access_revoked_release(), account_access_release, account_use_approvals, account_use_one_active, app_can_see_funding(), approvals_no_delete (+38 more)

### Community 12 - "20261106000000_phase2_payees_accounts/migration.sql"
Cohesion: 0.07
Nodes (30): banks, register_bank_account(), app_person_active_for(), assert_method_fits_account(), company_bank_accounts_wallet_phone, payment_request_cash_processed(), payment_requests_cash_processed, payment_requests_person_invoice_once (+22 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "company-deactivation.test.ts"
Cohesion: 0.13
Nodes (30): MY_COMPANIES_SQL, likePattern(), listRequests(), loadRequest(), maskRequest(), parseRequestFilters(), ASKU_OFF, BEES_OFF (+22 more)

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
Cohesion: 0.32
Nodes (6): normalizeAccountNumber(), audits(), clean(), NUM, plain(), reveal()

### Community 19 - "Compose Migrate Service"
Cohesion: 0.18
Nodes (11): condition, db, APP_DB_PASSWORD, AUTH_DB_PASSWORD, MIGRATION_DATABASE_URL, WORKER_DB_PASSWORD, command, depends_on (+3 more)

### Community 20 - "form.tsx"
Cohesion: 0.16
Nodes (17): NewRequestForm(), newRow(), Step(), AdjustForm(), AdjustFormProps, BalanceCheckForm(), BalanceCheckFormProps, CheckPayment (+9 more)

### Community 21 - "account-panel.tsx"
Cohesion: 0.17
Nodes (18): EditRequest(), AccountPanel(), canDo(), Line(), Section(), BalanceLog(), AccountNumber(), AccountPlaceNumber() (+10 more)

### Community 22 - "20261012000000_foundation/migration.sql"
Cohesion: 0.08
Nodes (35): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_manage_access(), app_can_see_account() (+27 more)

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 24 - "Badge"
Cohesion: 0.12
Nodes (37): COLUMNS, Line(), Payees(), PersonPanel(), versionLabel(), COLUMNS, Company, NameField() (+29 more)

### Community 25 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 26 - "20261016000000_scheduler/migration.sql"
Cohesion: 0.27
Nodes (10): cash_forecast_account_idx, cash_forecast_guard, cash_forecast_items, cash_forecast_no_delete, _forecast(), forecast_add(), forecast_cancel(), forecast_guard() (+2 more)

### Community 27 - "currentUserId"
Cohesion: 0.16
Nodes (31): Accounts(), COLUMNS, FILTERS, setCompany(), NewRequest(), COLUMNS, Requests(), Card() (+23 more)

### Community 28 - "companies"
Cohesion: 0.10
Nodes (23): companies, app_supplier_active_for(), company_suppliers, suppliers, treasury_schedule_queue(), admin_create_company(), auth_events, auth_events_append_only (+15 more)

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
Cohesion: 0.10
Nodes (34): cells(), COLUMNS, Partial(), WeekOverview(), BalanceLogEntry, COLUMNS, DataColumn, DataFilter (+26 more)

### Community 42 - "crypto.ts"
Cohesion: 0.16
Nodes (21): revealAccountNumber(), RevealResult, isNumberKind(), NumberKind, REVEAL, revealNumber(), base32(), blindIndex() (+13 more)

### Community 43 - "helpers.ts"
Cohesion: 0.17
Nodes (14): supplierList(), ACCESS_LABEL, BD_ADDIS, BD_HAWASSA, BERBERO_ID, MkOpts, root, S_ADDIS (+6 more)

### Community 48 - "Button"
Cohesion: 0.16
Nodes (30): DemoConfirm(), LIMITED, Reconciliation(), CompanyPanel(), RolePanel(), CorrectStatement(), ReviewDecision(), SendForReview() (+22 more)

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.05
Nodes (42): account_balance_history(), bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), account_balance_history(), account_week_status() (+34 more)

### Community 50 - "treasury-screens.ts"
Cohesion: 0.14
Nodes (21): dynamic, g, pool, Tx, ACCESS_NOTE, accountDetail(), AccountFacts, accountList() (+13 more)

### Community 51 - "reports/page.tsx"
Cohesion: 0.07
Nodes (70): COLUMNS, Gallery(), PAYMENTS, Section(), SWATCHES, GET(), money(), shown() (+62 more)

### Community 52 - "weekly-treasury.test.ts"
Cohesion: 0.10
Nodes (26): rows(), addDetail(), addPerson(), balance(), state(), account(), before, ids (+18 more)

### Community 53 - "auth.ts"
Cohesion: 0.24
Nodes (23): adminResetTotp(), adminSetPassword(), adminUnlock(), assertAdmin(), changePassword(), disableTotp(), enableTotp(), endSession() (+15 more)

### Community 54 - "auth-actions.ts"
Cohesion: 0.18
Nodes (13): Password(), Security(), back(), changePasswordAction(), disableMfaAction(), enableMfaAction(), loginAction(), logoutAction() (+5 more)

### Community 55 - "actAs"
Cohesion: 0.20
Nodes (15): actAs(), fn(), key(), mk(), submitted(), before, ids, snapshot() (+7 more)

### Community 58 - "access-withdrawal-race.test.ts"
Cohesion: 0.23
Nodes (13): attempt(), connect(), draft(), granted(), held(), must(), noStranded(), raced() (+5 more)

### Community 59 - "treasury.ts"
Cohesion: 0.27
Nodes (12): translate(), addReconciliationLine(), lockWeek(), matchPayment(), recordExecution(), recordFigure(), removeReconciliationLine(), returnReconciliation() (+4 more)

### Community 62 - "weekly-concurrency.test.ts"
Cohesion: 0.26
Nodes (13): asPerson(), authenticated(), balance(), monday(), newAccount(), once(), person(), prepared() (+5 more)

### Community 65 - "shared-account-privacy.test.ts"
Cohesion: 0.08
Nodes (18): b, c, [email, ...nameParts], name, temp, c, hashPassword(), c (+10 more)

### Community 69 - "etb"
Cohesion: 0.10
Nodes (38): Approvals(), COLUMNS, Fact(), ReviewPanel(), ROWS, Card(), Fact(), INSTALLMENTS (+30 more)

### Community 71 - "session.ts"
Cohesion: 0.09
Nodes (33): Corporate treasury refactor, ABIG Corporate Treasury Requirement, config, csp, GET(), accessLines(), dynamic, metadata (+25 more)

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `Finance Manager role`, `Owner role`, `Stale version refusal`, `ABIG Corporate Treasury Requirement` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 363 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `company-deactivation.test.ts` to `shared-account-privacy.test.ts`, `phase1.test.ts`, `session.ts`, `package.json`, `app/page.tsx`, `helpers.ts`, `Runtime Dependencies`, `treasury-screens.ts`, `account-numbers.test.ts`, `reports/page.tsx`, `auth.ts`, `weekly-treasury.test.ts`, `actAs`, `access-withdrawal-race.test.ts`, `weekly-concurrency.test.ts`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `Finance Manager role`, `Owner role` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Button` be split into smaller, more focused modules?**
  _Cohesion score 0.09986504723346828 - nodes in this community are weakly interconnected._
- **Why does `next` connect `session.ts` to `Button`, `people/[id]/page.tsx`, `DataTable`, `Payment Workflow Actions`, `etb`, `layout.tsx`, `package.json`, `app/page.tsx`, `Runtime Dependencies`, `Button`, `reports/page.tsx`, `account-panel.tsx`, `auth-actions.ts`, `Badge`, `currentUserId`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Should `phase1.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11231884057971014 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `company-deactivation.test.ts` to `shared-account-privacy.test.ts`, `phase1.test.ts`, `layout.tsx`, `session.ts`, `package.json`, `crypto.ts`, `app/page.tsx`, `helpers.ts`, `account-numbers.test.ts`, `treasury-screens.ts`, `reports/page.tsx`, `weekly-treasury.test.ts`, `actAs`, `access-withdrawal-race.test.ts`, `weekly-concurrency.test.ts`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Should `Operations guide` be split into smaller, more focused modules?**
  _Cohesion score 0.05319148936170213 - nodes in this community are weakly interconnected._