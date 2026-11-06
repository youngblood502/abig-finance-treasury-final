# Graph Report - abig-finance-treasury  (2026-11-06)

## Corpus Check
- 151 files · ~115,635 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 6, .css 3, .example 2)

## Summary
- 1313 nodes · 3881 edges · 70 communities (52 shown, 18 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 62 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `dba6a5d5`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- format.ts
- phase1.test.ts
- Auth and Admin Actions
- Documentation and Workflows
- Payment Workflow Actions
- Foundation Schema and Guards
- users
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
- company.ts
- Compose Migrate Service
- rows
- pg
- 20261027000000_treasury_refactor/migration.sql
- Compose Service Topology
- gallery/page.tsx
- components.json
- 20261016000000_scheduler/migration.sql
- treasury.ts
- companies
- 20261105000100_phase1_money_logic/migration.sql
- Compose Proxy Service
- App Environment Variables
- Compose Volumes
- Compose Build Targets
- Worker Environment Variables
- session.ts
- Restore Drill Script
- Graphify Skill References
- Notifications Worker Doc
- Backup Script
- wf_adjust
- phase2-migration.test.ts
- ABIG Brand Logo
- Supplier Bank Versioning
- vitest
- 20261107000000_phase3_weekly_treasury/migration.sql
- 20261029000000_request_reservation/migration.sql
- weekly-concurrency.test.ts
- helpers.ts
- Button
- user-menu.tsx
- requests/[id]/page.tsx
- withUser
- postcss.config.mjs
- rows
- @types/smtp-server@^3.5.13
- form.tsx
- mobile-nav.tsx
- lucide-react
- theme.test.ts
- 20261108000000_shared_account_privacy/migration.sql
- recon_figures
- next.config.ts
- prisma@^6.0.0
- tailwindcss@4.2.4
- @types/node@^22.0.0

## God Nodes (most connected - your core abstractions)
1. `payment_requests` - 92 edges
2. `withUser()` - 66 edges
3. `company_bank_accounts` - 52 edges
4. `rows()` - 50 edges
5. `users` - 49 edges
6. `currentUserId()` - 47 edges
7. `etb()` - 42 edges
8. `requireMe()` - 41 edges
9. `Button()` - 34 edges
10. `payment_installments` - 34 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `dbl()` --indirect_call--> `translate()`  [INFERRED]
  abig-finance/src/app/actions.ts → abig-finance/src/lib/errors.ts
- `snapshot()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/weekly-migration.test.ts → abig-finance/tests/helpers.ts
- `snapshot()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/phase2-migration.test.ts → abig-finance/tests/helpers.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (70 total, 18 thin omitted)

### Community 0 - "format.ts"
Cohesion: 0.14
Nodes (27): dynamic, GET(), money(), Reports(), EditRequest(), cell(), toCsv(), g (+19 more)

### Community 1 - "phase1.test.ts"
Cohesion: 0.11
Nodes (21): compose(), Mail, makeSender(), OutboxEvent, Sender, SUBJECTS, tick(), every() (+13 more)

### Community 2 - "Auth and Admin Actions"
Cohesion: 0.07
Nodes (78): Password(), Security(), addGroupGrant(), admin(), audit(), createCompany(), createRole(), createUser() (+70 more)

### Community 3 - "Documentation and Workflows"
Cohesion: 0.05
Nodes (43): Encryption key (APP_ENCRYPTION_KEY), ops/backup.sh, Docker Compose deployment, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Migration runner (ops/migrate.mjs) (+35 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.11
Nodes (55): act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine(), addSupplier(), adjustRequest(), createAndSubmitRequest() (+47 more)

### Community 5 - "Foundation Schema and Guards"
Cohesion: 0.08
Nodes (35): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_manage_access(), app_can_see_account() (+27 more)

### Community 6 - "users"
Cohesion: 0.17
Nodes (26): app_member_companies(), company_memberships, users, company_role_users(), app_member_companies(), app_permitted_companies(), assert_role_company_limit(), company_role_users() (+18 more)

### Community 7 - "Suppliers and Requests Schema"
Cohesion: 0.10
Nodes (29): app_can_edit_draft(), app_can_see_request(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx (+21 more)

### Community 8 - "Workflow Schema and Adjustments"
Cohesion: 0.07
Nodes (37): payment_requests, adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events (+29 more)

### Community 9 - "Dev Dependencies"
Cohesion: 0.10
Nodes (28): devDependencies, esbuild@^0.24.0, @fontsource-variable/figtree@^5.3.0, smtp-server@^3.19.22, @tailwindcss/postcss@4.2.4, tsx@^4.19.0, tw-animate-css@^1.4.0, @types/nodemailer@^8.0.2 (+20 more)

### Community 10 - "app/page.tsx"
Cohesion: 0.16
Nodes (29): Dashboard(), Panel(), QUEUE_COLUMNS, queueTable(), Section(), accountInCompany(), AccountRow, accountRows() (+21 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.08
Nodes (46): payment_installments, access_revoked_release(), account_use_approvals, account_use_one_active, app_can_see_funding(), approvals_no_delete, assert_account_use(), cash_ledger_account_time_idx (+38 more)

### Community 12 - "20261106000000_phase2_payees_accounts/migration.sql"
Cohesion: 0.12
Nodes (20): app_person_active_for(), assert_method_fits_account(), assert_submittable(), company_bank_accounts_wallet_phone, payment_request_cash_processed(), payment_requests_cash_processed, payment_requests_person_invoice_once, payment_requests_person_payee_idx (+12 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "helpers.ts"
Cohesion: 0.25
Nodes (9): BD_ADDIS, BD_HAWASSA, S_ADDIS, S_ETHIO, addAtt(), draft(), inst(), key() (+1 more)

### Community 15 - "NPM Scripts"
Cohesion: 0.14
Nodes (14): scripts, bootstrap:admin, build, build:worker, check:integrity, db:demo, db:seed, demo:passwords (+6 more)

### Community 16 - "Runtime Dependencies"
Cohesion: 0.10
Nodes (20): dependencies, class-variance-authority@^0.7.1, clsx@^2.1.1, lucide-react@^1.69.0, next@^15.2.0, nodemailer@^10.1.1, pg@^8.13.0, qrcode@^1.5.4 (+12 more)

### Community 17 - "Compose Database Service"
Cohesion: 0.17
Nodes (12): environment, healthcheck, image, restart, volumes, POSTGRES_DB, POSTGRES_PASSWORD, interval (+4 more)

### Community 18 - "company.ts"
Cohesion: 0.19
Nodes (14): ShellProps, Brand(), CompanySwitcher(), Header(), ICONS, SidebarNav(), Sidebar(), label() (+6 more)

### Community 19 - "Compose Migrate Service"
Cohesion: 0.18
Nodes (11): condition, db, APP_DB_PASSWORD, AUTH_DB_PASSWORD, MIGRATION_DATABASE_URL, WORKER_DB_PASSWORD, command, depends_on (+3 more)

### Community 20 - "rows"
Cohesion: 0.27
Nodes (10): actAs(), at(), clockSql(), day(), lock(), lockedWeek(), opened(), revision() (+2 more)

### Community 21 - "pg"
Cohesion: 0.15
Nodes (11): b, c, [email, ...nameParts], name, temp, c, hashPassword(), ADMIN_URL (+3 more)

### Community 22 - "20261027000000_treasury_refactor/migration.sql"
Cohesion: 0.11
Nodes (11): account_owner_company(), app_related_companies(), banks, membership_roles_limit, membership_roles_limit_guard(), memberships_reactivate, payment_requests_debit_account_guard, register_bank_account() (+3 more)

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 24 - "gallery/page.tsx"
Cohesion: 0.18
Nodes (12): badgeVariants, StatTile(), StatTileProps, tile, StatusTracker(), ENDED_STATES, STEPS, StepStatus (+4 more)

### Community 25 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 26 - "20261016000000_scheduler/migration.sql"
Cohesion: 0.31
Nodes (9): cash_forecast_account_idx, cash_forecast_guard, cash_forecast_items, cash_forecast_no_delete, _forecast(), forecast_add(), forecast_cancel(), forecast_guard() (+1 more)

### Community 27 - "treasury.ts"
Cohesion: 0.32
Nodes (11): addReconciliationLine(), lockWeek(), matchPayment(), recordExecution(), recordFigure(), removeReconciliationLine(), returnReconciliation(), run() (+3 more)

### Community 28 - "companies"
Cohesion: 0.16
Nodes (18): companies, app_supplier_active_for(), company_suppliers, suppliers, treasury_schedule_queue(), admin_create_company(), auth_events, auth_events_append_only (+10 more)

### Community 29 - "20261105000100_phase1_money_logic/migration.sql"
Cohesion: 0.09
Nodes (14): account_balance_history(), bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), mark_authenticated_paid_at_go_live(), outbox_recipients(), payment_request_funds_guard() (+6 more)

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

### Community 35 - "session.ts"
Cohesion: 0.10
Nodes (29): setCompany(), GET(), accessLines(), dynamic, metadata, RootLayout(), AppShell(), myCompanies (+21 more)

### Community 43 - "phase2-migration.test.ts"
Cohesion: 0.16
Nodes (7): c, dir, files, files(), before, ids, snapshot()

### Community 48 - "vitest"
Cohesion: 0.19
Nodes (13): authorized(), fn(), key(), mk(), S_HAWASSA, actions(), state(), sub() (+5 more)

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.07
Nodes (33): bank_balance_history, account_balance_history(), account_week_status(), balance_check_items, balance_check_items_no_change, balance_check_items_no_truncate, balance_check_items_request_idx, bank_balance_history_one_debit (+25 more)

### Community 50 - "20261029000000_request_reservation/migration.sql"
Cohesion: 0.20
Nodes (6): app_can_edit_draft(), attachment_guard(), installment_guard(), payment_request_funds_guard(), payment_requests_funds_guard, wf_submit()

### Community 51 - "weekly-concurrency.test.ts"
Cohesion: 0.26
Nodes (13): asPerson(), authenticated(), balance(), monday(), newAccount(), once(), person(), prepared() (+5 more)

### Community 52 - "helpers.ts"
Cohesion: 0.13
Nodes (20): AWASH, BERBERO, BERBERO_ID, CBE, fails(), MkOpts, root, S_ETHIO_ID (+12 more)

### Community 53 - "Button"
Cohesion: 0.22
Nodes (13): @radix-ui/react-dialog@^1.3.1, react-dom@^19.0.0, switchUser(), DemoConfirm(), DevBanner(), Button(), buttonVariants, ConfirmButton() (+5 more)

### Community 54 - "user-menu.tsx"
Cohesion: 0.38
Nodes (11): THEME_KEY, ThemeMenuItem(), initials(), UserMenu(), DropdownMenu(), DropdownMenuContent(), DropdownMenuItem(), DropdownMenuLabel() (+3 more)

### Community 55 - "requests/[id]/page.tsx"
Cohesion: 0.07
Nodes (62): Approvals(), COLUMNS, Fact(), ReviewPanel(), COLUMNS, Gallery(), PAYMENTS, ROWS (+54 more)

### Community 56 - "withUser"
Cohesion: 0.24
Nodes (27): Accounts(), Admin(), methodOptions, Payees(), NewRequest(), Suppliers(), TreasuryAccount(), Treasury() (+19 more)

### Community 58 - "rows"
Cohesion: 0.14
Nodes (15): rows(), addDetail(), balance(), state(), account(), before, ids, state() (+7 more)

### Community 60 - "form.tsx"
Cohesion: 0.21
Nodes (13): NewRequestForm(), newRow(), Step(), AdjustForm(), AdjustFormProps, AmountInput(), AmountInputProps, SubmitButton() (+5 more)

### Community 61 - "mobile-nav.tsx"
Cohesion: 0.35
Nodes (10): DemoControls(), OPTIONS, MobileNav(), Sheet(), SheetContent(), SheetDescription(), SheetOverlay(), SheetTitle() (+2 more)

### Community 62 - "lucide-react"
Cohesion: 0.31
Nodes (8): SearchableSelect(), SearchableSelectProps, compare(), filterOptions(), SelectOption, TableQuery, tableView(), lucide-react

### Community 63 - "theme.test.ts"
Cohesion: 0.28
Nodes (7): channel(), contrast(), css, luminance(), SHAPES, TEXT, themes

### Community 64 - "20261108000000_shared_account_privacy/migration.sql"
Cohesion: 0.33
Nodes (3): account_balance_history(), reconciliation_payments(), reconciliation_summary()

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)`, `Migration runner (ops/migrate.mjs)`, `Local test copy setup` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 320 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `phase1.test.ts` to `format.ts`, `Auth and Admin Actions`, `session.ts`, `Dev Dependencies`, `app/page.tsx`, `phase2-migration.test.ts`, `helpers.ts`, `Runtime Dependencies`, `vitest`, `weekly-concurrency.test.ts`, `helpers.ts`, `pg`, `rows`, `rows`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `format.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13630229419703105 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `helpers.ts` to `format.ts`, `phase1.test.ts`, `Auth and Admin Actions`, `session.ts`, `Dev Dependencies`, `app/page.tsx`, `phase2-migration.test.ts`, `helpers.ts`, `vitest`, `weekly-concurrency.test.ts`, `rows`, `pg`, `rows`, `theme.test.ts`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Should `phase1.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10582010582010581 - nodes in this community are weakly interconnected._
- **Why does `rows()` connect `rows` to `phase1.test.ts`, `Auth and Admin Actions`, `app/page.tsx`, `phase2-migration.test.ts`, `helpers.ts`, `vitest`, `weekly-concurrency.test.ts`, `helpers.ts`, `pg`, `rows`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Should `Auth and Admin Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.06778868630201028 - nodes in this community are weakly interconnected._