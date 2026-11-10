# Graph Report - abig-finance-treasury  (2026-11-10)

## Corpus Check
- 201 files · ~169,146 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 6, .css 3, .example 2)

## Summary
- 1714 nodes · 5827 edges · 74 communities (51 shown, 23 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 85 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a06a8a10`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- admin.ts
- phase1.test.ts
- format.ts
- Corporate treasury refactor
- Payment Workflow Actions
- users
- side-panel.tsx
- Suppliers and Requests Schema
- Workflow Schema and Adjustments
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
- Button
- phase1.test.ts
- 20261012000000_foundation/migration.sql
- Compose Service Topology
- Badge
- components.json
- wf_adjust
- requests/[id]/page.tsx
- dependencies
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
- payee-screens.ts
- helpers.ts
- ABIG Brand Logo
- Supplier Bank Versioning
- companies
- 20261107000000_phase3_weekly_treasury/migration.sql
- session.ts
- treasury_weeks
- weekly-treasury.test.ts
- auth.ts
- company_bank_accounts
- bank_balance_history
- postcss.config.mjs
- 20261109000800_more_notifications/migration.sql
- reconciliation_lines
- update_bank_balance
- form.tsx
- weekly-concurrency.test.ts
- recon_figures
- submit_reconciliation
- ops.test.ts
- next.config.ts
- tailwind-merge
- requests.ts
- prisma@^6.0.0
- smtp-server
- typescript@^5.6.0
- health/route.ts

## God Nodes (most connected - your core abstractions)
1. `payment_requests` - 100 edges
2. `rows()` - 84 edges
3. `Button()` - 80 edges
4. `withUser()` - 79 edges
5. `etb()` - 67 edges
6. `Badge()` - 61 edges
7. `company_bank_accounts` - 60 edges
8. `users` - 53 edges
9. `currentUserId()` - 52 edges
10. `pg` - 48 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `dbl()` --indirect_call--> `translate()`  [INFERRED]
  abig-finance/src/app/actions.ts → abig-finance/src/lib/errors.ts
- `seen()` --indirect_call--> `week()`  [INFERRED]
  abig-finance/tests/company-deactivation.test.ts → abig-finance/src/app/actions.ts
- `setBalance()` --calls--> `enterFigure()`  [EXTRACTED]
  abig-finance/tests/phase1.test.ts → abig-finance/tests/helpers.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (74 total, 23 thin omitted)

### Community 0 - "admin.ts"
Cohesion: 0.09
Nodes (31): System(), COLUMNS, DELIVERY_LABEL, Detail(), label(), Line(), STATUS_VARIANT, AdminChange (+23 more)

### Community 1 - "phase1.test.ts"
Cohesion: 0.06
Nodes (27): compose(), deliver(), Mail, makeSender(), NOTES, OutboxEvent, Sender, SUBJECTS (+19 more)

### Community 2 - "format.ts"
Cohesion: 0.09
Nodes (49): Fact(), ReviewPanel(), Card(), PaymentLine(), TreasuryAccount(), cells(), Partial(), LIMITED (+41 more)

### Community 3 - "Corporate treasury refactor"
Cohesion: 0.05
Nodes (43): Encryption key (APP_ENCRYPTION_KEY), ops/backup.sh, Docker Compose deployment, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Migration runner (ops/migrate.mjs) (+35 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.08
Nodes (68): act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine(), addSupplier(), adjustRequest(), afterSave() (+60 more)

### Community 5 - "users"
Cohesion: 0.11
Nodes (31): app_member_companies(), company_memberships, users, company_role_users(), app_member_companies(), app_permitted_companies(), assert_role_company_limit(), company_role_users() (+23 more)

### Community 6 - "side-panel.tsx"
Cohesion: 0.08
Nodes (40): switchUser(), AppShell(), ShellProps, Brand(), CompanySwitcher(), DevBanner(), Header(), MobileNav() (+32 more)

### Community 7 - "Suppliers and Requests Schema"
Cohesion: 0.05
Nodes (52): app_can_edit_draft(), app_can_see_request(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx (+44 more)

### Community 8 - "Workflow Schema and Adjustments"
Cohesion: 0.06
Nodes (36): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+28 more)

### Community 9 - "package.json"
Cohesion: 0.09
Nodes (30): devDependencies, esbuild@^0.24.0, @fontsource-variable/figtree@^5.3.0, tailwindcss@4.2.4, @tailwindcss/postcss@4.2.4, tsx@^4.19.0, tw-animate-css@^1.4.0, @types/node@^22.0.0 (+22 more)

### Community 10 - "dashboard.ts"
Cohesion: 0.06
Nodes (49): PaymentColumnsProps, accountInCompany(), AccountRow, accountRows(), approvalQueue(), cashByCompany(), CompanyCash, OWNER_CASH_NOTE (+41 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.06
Nodes (57): payment_installments, access_revoked_release(), account_access_release, account_use_approvals, account_use_one_active, app_can_see_funding(), approvals_no_delete, assert_account_use() (+49 more)

### Community 12 - "20261106000000_phase2_payees_accounts/migration.sql"
Cohesion: 0.07
Nodes (31): banks, register_bank_account(), app_person_active_for(), assert_method_fits_account(), company_bank_accounts_wallet_phone, payment_request_cash_processed(), payment_requests_cash_processed, payment_requests_person_invoice_once (+23 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "account-numbers.test.ts"
Cohesion: 0.07
Nodes (47): normalizeAccountNumber(), MY_COMPANIES_SQL, Tx, likePattern(), listRequests(), loadRequest(), maskRequest(), parseRequestFilters() (+39 more)

### Community 15 - "NPM Scripts"
Cohesion: 0.14
Nodes (14): scripts, bootstrap:admin, build, build:worker, check:integrity, db:demo, db:seed, demo:passwords (+6 more)

### Community 16 - "reports.ts"
Cohesion: 0.12
Nodes (30): GET(), money(), shown(), cell(), toCsv(), addisIso(), amount2(), AGE_BUCKETS (+22 more)

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
Cohesion: 0.10
Nodes (51): Activity(), AddAction(), Admin(), Companies(), Field(), Panel(), People(), Roles() (+43 more)

### Community 21 - "phase1.test.ts"
Cohesion: 0.10
Nodes (13): c, dir, files, files(), AWASH, BD_ETHIO, bal(), req() (+5 more)

### Community 22 - "20261012000000_foundation/migration.sql"
Cohesion: 0.08
Nodes (31): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_manage_access(), app_can_see_account() (+23 more)

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 24 - "Badge"
Cohesion: 0.14
Nodes (29): COLUMNS, Line(), Payees(), PersonPanel(), versionLabel(), COLUMNS, Company, NameField() (+21 more)

### Community 25 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 27 - "requests/[id]/page.tsx"
Cohesion: 0.13
Nodes (26): Card(), Fact(), INSTALLMENTS, RequestDetail(), badgeVariants, AccountNumber(), AccountPlaceNumber(), HIDE_AFTER_MS (+18 more)

### Community 28 - "dependencies"
Cohesion: 0.10
Nodes (21): dependencies, class-variance-authority@^0.7.1, clsx@^2.1.1, lucide-react@^1.69.0, next@^15.2.0, nodemailer@^10.1.1, pg@^8.13.0, qrcode@^1.5.4 (+13 more)

### Community 29 - "20261105000100_phase1_money_logic/migration.sql"
Cohesion: 0.15
Nodes (10): wf_set_state(), mark_authenticated_paid_at_go_live(), outbox_recipients(), payment_request_funds_guard(), payment_requests_invoice_once, record_execution(), removed_owner_approval_settings, request_payment_status() (+2 more)

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
Cohesion: 0.15
Nodes (33): COLUMNS, Gallery(), PAYMENTS, ROWS, Section(), SWATCHES, Audit(), Cash() (+25 more)

### Community 42 - "payee-screens.ts"
Cohesion: 0.15
Nodes (17): NumberState, history(), LIST_FILTERS, listFilters(), needsVerifying(), PaymentLine, personList(), PersonRow (+9 more)

### Community 43 - "helpers.ts"
Cohesion: 0.13
Nodes (24): BD_ADDIS, BERBERO_ID, fails(), MkOpts, root, S_ADDIS, S_ETHIO, S_HAWASSA (+16 more)

### Community 48 - "companies"
Cohesion: 0.10
Nodes (21): companies, app_supplier_active_for(), company_suppliers, suppliers, admin_create_company(), auth_events, auth_events_append_only, auth_events_no_truncate (+13 more)

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.12
Nodes (5): balance_check_items, balance_check_items_no_change, balance_check_items_no_truncate, balance_check_items_request_idx, payment_requests_outstanding_idx

### Community 50 - "session.ts"
Cohesion: 0.11
Nodes (52): Accounts(), COLUMNS, FILTERS, setCompany(), Approvals(), COLUMNS, accessLines(), dynamic (+44 more)

### Community 51 - "treasury_weeks"
Cohesion: 0.14
Nodes (14): account_balance_history(), recon_candidates(), reconciliation_summary(), start_reconciliation(), treasury_week_for(), treasury_week_start(), treasury_weeks, treasury_weeks_guard() (+6 more)

### Community 52 - "weekly-treasury.test.ts"
Cohesion: 0.07
Nodes (50): actAs(), BD_HAWASSA, fn(), key(), mk(), rows(), addDetail(), addPerson() (+42 more)

### Community 53 - "auth.ts"
Cohesion: 0.06
Nodes (91): Password(), Security(), addGroupGrant(), admin(), audit(), createCompany(), createRole(), createUser() (+83 more)

### Community 54 - "company_bank_accounts"
Cohesion: 0.18
Nodes (10): company_bank_accounts, app_can_snapshot(), payment_request_account_guard(), set_account_policy(), account_week_status(), lock_week(), recon_lock(), record_figure() (+2 more)

### Community 55 - "bank_balance_history"
Cohesion: 0.27
Nodes (9): account_balance_history(), bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), bank_balance_history_one_debit, bank_balance_history_stamp() (+1 more)

### Community 58 - "20261109000800_more_notifications/migration.sql"
Cohesion: 0.19
Nodes (12): account_access_notify, enqueue_missing_openings(), notify_account_access(), notify_person_details_pending(), notify_supplier_details_pending(), notify_user_account(), person_payment_details_notify, public.outbox_recipients() (+4 more)

### Community 59 - "reconciliation_lines"
Cohesion: 0.22
Nodes (9): reconciliation_lines, reconciliation_lines_carry_once, reconciliation_lines_guard(), reconciliation_lines_match_once, reconciliation_lines_no_delete, reconciliation_lines_no_truncate, reconciliation_lines_week_idx, remove_reconciliation_line() (+1 more)

### Community 61 - "form.tsx"
Cohesion: 0.32
Nodes (9): EditRequest(), NewRequestForm(), newRow(), Step(), ScheduleField(), accountPlace(), METHODS_FOR_KIND, FormPayee (+1 more)

### Community 62 - "weekly-concurrency.test.ts"
Cohesion: 0.26
Nodes (13): asPerson(), authenticated(), balance(), monday(), newAccount(), once(), person(), prepared() (+5 more)

### Community 65 - "ops.test.ts"
Cohesion: 0.15
Nodes (11): b, c, [email, ...nameParts], name, temp, c, hashPassword(), ADMIN_URL (+3 more)

### Community 69 - "requests.ts"
Cohesion: 0.10
Nodes (25): GET(), Reason(), ReviewActions(), ReviewTarget, denyApi(), ACTION_LABEL, AdjustmentRow, AGE_OPTIONS (+17 more)

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `Finance Manager role`, `Owner role`, `Stale version refusal`, `ABIG Corporate Treasury Requirement` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 392 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `phase1.test.ts` to `ops.test.ts`, `format.ts`, `package.json`, `dashboard.ts`, `helpers.ts`, `account-numbers.test.ts`, `session.ts`, `access-withdrawal-race.test.ts`, `weekly-treasury.test.ts`, `auth.ts`, `phase1.test.ts`, `dependencies`, `weekly-concurrency.test.ts`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `Finance Manager role`, `Owner role` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `admin.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08712121212121213 - nodes in this community are weakly interconnected._
- **Why does `rows()` connect `weekly-treasury.test.ts` to `phase1.test.ts`, `ops.test.ts`, `dashboard.ts`, `helpers.ts`, `account-numbers.test.ts`, `access-withdrawal-race.test.ts`, `phase1.test.ts`, `weekly-concurrency.test.ts`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Should `phase1.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.061170212765957445 - nodes in this community are weakly interconnected._
- **Why does `payment_requests` connect `Suppliers and Requests Schema` to `users`, `Workflow Schema and Adjustments`, `20261015000000_treasury/migration.sql`, `20261106000000_phase2_payees_accounts/migration.sql`, `companies`, `20261107000000_phase3_weekly_treasury/migration.sql`, `treasury_weeks`, `20261012000000_foundation/migration.sql`, `bank_balance_history`, `company_bank_accounts`, `wf_adjust`, `reconciliation_lines`, `20261105000100_phase1_money_logic/migration.sql`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Should `format.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09022556390977443 - nodes in this community are weakly interconnected._