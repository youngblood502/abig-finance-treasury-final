# Graph Report - abig-finance-treasury  (2026-11-17)

## Corpus Check
- 251 files · ~235,659 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 13 file(s) not represented in the graph (top: (none) 6, .example 3, .css 3)

## Summary
- 2192 nodes · 7351 edges · 81 communities (62 shown, 19 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 116 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `24fce509`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- treasury-screens.ts
- email-settings.test.ts
- payees/page.tsx
- Corporate treasury refactor
- Payment Workflow Actions
- users
- fn
- payment_requests
- 20261014000000_workflow/migration.sql
- package.json
- app/page.tsx
- 20261015000000_treasury/migration.sql
- 20261106000000_phase2_payees_accounts/migration.sql
- TypeScript Compiler Config
- payees.test.ts
- NPM Scripts
- Button
- Compose Database Service
- access-withdrawal-race.test.ts
- Compose Migrate Service
- users
- legacy-removal.test.ts
- company_bank_accounts
- Compose Service Topology
- DataTable
- components.json
- company_bank_accounts
- test-db.mjs
- dependencies
- phase1.test.ts
- Compose Proxy Service
- App Environment Variables
- Compose Volumes
- Compose Build Targets
- admin-actions.ts
- etb
- Restore Drill Script
- Graphify Skill References
- Notifications Worker Doc
- Backup Script
- recurring/page.tsx
- helpers.ts
- ABIG Brand Logo
- Supplier Bank Versioning
- companies
- 20261107000000_phase3_weekly_treasury/migration.sql
- account-activation.test.ts
- Operations guide
- admin/page.tsx
- auth.ts
- Testing guide
- crypto.ts
- postcss.config.mjs
- Docker Compose deployment
- phase2.test.ts
- reports/page.tsx
- 20261116000100_one_time_payees_optional_phones/migration.sql
- Money rules live in the database
- Badge
- bootstrap-admin.mjs
- page-loading.test.ts
- mail-settings.ts
- format.ts
- notification-bell.tsx
- admin_update_user_identity
- notification-events.test.ts
- Removing the old treasury engine
- next.config.ts
- rows
- 20261016000000_scheduler/migration.sql
- health/route.ts
- scripts
- tsx@^4.19.0

## God Nodes (most connected - your core abstractions)
1. `rows()` - 130 edges
2. `payment_requests` - 124 edges
3. `withUser()` - 94 edges
4. `Button()` - 86 edges
5. `company_bank_accounts` - 77 edges
6. `etb()` - 73 edges
7. `Badge()` - 68 edges
8. `actAs()` - 67 edges
9. `users` - 67 edges
10. `pg` - 62 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `supplier_bank_detail_open_requests()` --reads_from--> `payment_requests`  [EXTRACTED]
  abig-finance/prisma/migrations/20261116000400_supplier_bank_detail_activation/migration.sql → abig-finance/prisma/migrations/20261013000000_suppliers_requests/migration.sql
- `seen()` --indirect_call--> `week()`  [INFERRED]
  abig-finance/tests/company-deactivation.test.ts → abig-finance/src/app/actions.ts
- `SupplierPanel()` --indirect_call--> `deactivateBankDetail()`  [INFERRED]
  abig-finance/src/app/suppliers/page.tsx → abig-finance/src/app/actions.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (81 total, 19 thin omitted)

### Community 0 - "treasury-screens.ts"
Cohesion: 0.08
Nodes (37): COLUMNS, FILTERS, AccountPanel(), canDo(), Line(), Section(), RegisterAccountForm(), AmountInput() (+29 more)

### Community 1 - "email-settings.test.ts"
Cohesion: 0.11
Nodes (12): normalizeAccountNumber(), clean(), plain(), args(), commit(), emailAudit(), event(), Got (+4 more)

### Community 2 - "payees/page.tsx"
Cohesion: 0.09
Nodes (48): COLUMNS, Line(), Payees(), PersonPanel(), versionLabel(), NewRequest(), COLUMNS, Company (+40 more)

### Community 3 - "Corporate treasury refactor"
Cohesion: 0.14
Nodes (16): Corporate treasury refactor, 20261030000000_approvals, 20261031000000_rbac_admin, 20261029000000_request_reservation, Previous treasury engine (replaced), ABIG Corporate Treasury Requirement, update_bank_balance(), Authenticate debits the account (+8 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.06
Nodes (99): act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine(), addSupplier(), adjustRequest(), afterSave() (+91 more)

### Community 5 - "users"
Cohesion: 0.10
Nodes (30): company_memberships, app_can_snapshot(), app_member_companies(), app_permitted_companies(), assert_role_company_limit(), company_role_users(), membership_roles, membership_roles_limit (+22 more)

### Community 6 - "fn"
Cohesion: 0.09
Nodes (39): protectAccountNumber(), reservedOn(), verifiedOn(), actAs(), BD_HAWASSA, fn(), key(), mk() (+31 more)

### Community 7 - "payment_requests"
Cohesion: 0.04
Nodes (61): app_can_edit_draft(), app_can_see_request(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx (+53 more)

### Community 8 - "20261014000000_workflow/migration.sql"
Cohesion: 0.05
Nodes (40): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+32 more)

### Community 9 - "package.json"
Cohesion: 0.08
Nodes (34): devDependencies, esbuild@^0.24.0, @fontsource-variable/figtree@^5.3.0, prisma@^6.0.0, smtp-server@^3.19.22, tailwindcss@4.2.4, @tailwindcss/postcss@4.2.4, tw-animate-css@^1.4.0 (+26 more)

### Community 10 - "app/page.tsx"
Cohesion: 0.09
Nodes (45): Dashboard(), Panel(), QUEUE_COLUMNS, queueTable(), Section(), accountInCompany(), AccountRow, accountRows() (+37 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.07
Nodes (47): payment_installments, access_revoked_release(), account_access_release, account_use_approvals, account_use_one_active, app_can_see_funding(), approvals_no_delete, assert_account_use() (+39 more)

### Community 12 - "20261106000000_phase2_payees_accounts/migration.sql"
Cohesion: 0.07
Nodes (32): banks, register_bank_account(), app_person_active_for(), assert_method_fits_account(), assert_submittable(), company_bank_accounts_wallet_phone, payment_request_cash_processed(), payment_requests_cash_processed (+24 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "payees.test.ts"
Cohesion: 0.16
Nodes (16): addDetail(), asPerson(), balance(), state(), authenticated(), balance(), monday(), newAccount() (+8 more)

### Community 15 - "NPM Scripts"
Cohesion: 0.10
Nodes (21): scripts, bootstrap:admin, build, build:worker, check:integrity, db:demo, db:seed, demo:passwords (+13 more)

### Community 16 - "Button"
Cohesion: 0.11
Nodes (41): DemoConfirm(), LIMITED, Reconciliation(), AccountStatus(), CommitmentList(), commitmentSummary(), dateText(), itemLink() (+33 more)

### Community 17 - "Compose Database Service"
Cohesion: 0.17
Nodes (12): environment, healthcheck, image, restart, volumes, POSTGRES_DB, POSTGRES_PASSWORD, interval (+4 more)

### Community 18 - "access-withdrawal-race.test.ts"
Cohesion: 0.25
Nodes (12): attempt(), connect(), draft(), granted(), held(), must(), noStranded(), raced() (+4 more)

### Community 19 - "Compose Migrate Service"
Cohesion: 0.18
Nodes (11): condition, db, APP_DB_PASSWORD, AUTH_DB_PASSWORD, MIGRATION_DATABASE_URL, WORKER_DB_PASSWORD, command, depends_on (+3 more)

### Community 20 - "users"
Cohesion: 0.10
Nodes (36): app_is_admin(), app_member_companies(), users, app_supplier_active_for(), company_suppliers, supplier_bank_details, suppliers, app_supplier_reveal_company() (+28 more)

### Community 21 - "legacy-removal.test.ts"
Cohesion: 0.05
Nodes (26): c, dir, files, files(), ADMIN_URL, FUNCTIONS, LEGACY, tableCount() (+18 more)

### Community 22 - "company_bank_accounts"
Cohesion: 0.07
Nodes (21): mark_authenticated_paid_at_go_live(), outbox_recipients(), payment_request_funds_guard(), payment_requests_invoice_once, record_execution(), removed_owner_approval_settings, request_payment_status(), set_account_policy() (+13 more)

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 24 - "DataTable"
Cohesion: 0.10
Nodes (30): COLUMNS, PAYMENTS, ROWS, Section(), SWATCHES, cells(), COLUMNS, Partial() (+22 more)

### Community 25 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 26 - "company_bank_accounts"
Cohesion: 0.05
Nodes (50): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_manage_access(), app_can_see_account() (+42 more)

### Community 27 - "test-db.mjs"
Cohesion: 0.08
Nodes (54): fail(), onDb(), PREVIEW_DB, PREVIEW_FILE, provenAdminUrl(), readEnvFile(), ROLE_LOGINS, root (+46 more)

### Community 28 - "dependencies"
Cohesion: 0.08
Nodes (24): dependencies, class-variance-authority@^0.7.1, clsx@^2.1.1, lucide-react@^1.69.0, next@^15.2.0, nodemailer@^10.1.1, pg@^8.13.0, qrcode@^1.5.4 (+16 more)

### Community 29 - "phase1.test.ts"
Cohesion: 0.07
Nodes (24): compose(), NOTES, notificationTitle(), OutboxEvent, SUBJECTS, deliver(), tick(), every() (+16 more)

### Community 30 - "Compose Proxy Service"
Cohesion: 0.25
Nodes (8): APP_DOMAIN, depends_on, environment, image, ports, restart, volumes, proxy

### Community 31 - "App Environment Variables"
Cohesion: 0.20
Nodes (12): environment, APP_ENCRYPTION_KEY, APP_URL, AUTH_DATABASE_URL, DATABASE_URL, MAIL_ENCRYPTION_KEY, MAIL_FROM, REQUIRE_MFA (+4 more)

### Community 32 - "Compose Volumes"
Cohesion: 0.40
Nodes (4): volumes, caddydata, dbdata, storage

### Community 33 - "Compose Build Targets"
Cohesion: 0.60
Nodes (5): build, context, target, build, build

### Community 34 - "admin-actions.ts"
Cohesion: 0.20
Nodes (31): addGroupGrant(), admin(), audit(), clearEmailSettings(), createCompany(), createRole(), createUser(), done() (+23 more)

### Community 35 - "etb"
Cohesion: 0.12
Nodes (44): Password(), Accounts(), Gallery(), Login(), Cash(), EditRequest(), Card(), DEACTIVATED_DETAILS_NOTE (+36 more)

### Community 42 - "recurring/page.tsx"
Cohesion: 0.25
Nodes (13): Amount(), COLUMNS, Line(), Recurring(), STATUS_VARIANT, Template, TemplateForm(), TemplatePanel() (+5 more)

### Community 43 - "helpers.ts"
Cohesion: 0.09
Nodes (55): MY_COMPANIES_SQL, g, Tx, reconciliationWeek(), likePattern(), listRequests(), loadRequest(), maskRequest() (+47 more)

### Community 48 - "companies"
Cohesion: 0.13
Nodes (13): admin_create_company(), auth_events, auth_events_append_only, auth_events_no_truncate, auth_events_time_idx, company_directory(), report_outstanding(), sessions (+5 more)

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.05
Nodes (44): account_balance_history(), bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), account_balance_history(), account_week_status() (+36 more)

### Community 50 - "account-activation.test.ts"
Cohesion: 0.17
Nodes (12): account(), clock(), commitments(), connect(), day(), deactivate(), draftOn(), freshAccount() (+4 more)

### Community 51 - "Operations guide"
Cohesion: 0.27
Nodes (10): ops/backup.sh, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Operations guide, Restore drill (ops/restore-drill.sh), ABIG Finance (+2 more)

### Community 52 - "admin/page.tsx"
Cohesion: 0.07
Nodes (51): Activity(), AddAction(), Admin(), Companies(), Email(), Field(), Panel(), People() (+43 more)

### Community 53 - "auth.ts"
Cohesion: 0.12
Nodes (40): Security(), back(), changePasswordAction(), disableMfaAction(), enableMfaAction(), loginAction(), logoutAction(), startMfaAction() (+32 more)

### Community 54 - "Testing guide"
Cohesion: 0.22
Nodes (10): Demo people, Local test copy setup, Testing guide, Things to try to break, UI and UX checklist, Workflow scenarios, company_bank_account_access, Legacy status and role mapping (+2 more)

### Community 55 - "crypto.ts"
Cohesion: 0.13
Nodes (28): revealAccountNumber(), RevealResult, isNumberKind(), NumberKind, REVEAL, revealNumber(), base32(), blindIndex() (+20 more)

### Community 58 - "Docker Compose deployment"
Cohesion: 0.40
Nodes (5): Encryption key (APP_ENCRYPTION_KEY), Docker Compose deployment, Migration runner (ops/migrate.mjs), Sign-in security policy, Built-in sign-in

### Community 59 - "phase2.test.ts"
Cohesion: 0.40
Nodes (5): addAtt(), draft(), inst(), key(), ready()

### Community 61 - "reports/page.tsx"
Cohesion: 0.07
Nodes (58): GET(), money(), shown(), Audit(), Download(), FilterBar(), Outstanding(), Panel() (+50 more)

### Community 62 - "20261116000100_one_time_payees_optional_phones/migration.sql"
Cohesion: 0.12
Nodes (20): app_one_time_reveal_company(), assert_submittable(), one_time_account_state(), one_time_payee_revise(), one_time_payees, one_time_payees_company_idx, one_time_payees_no_delete, one_time_payees_no_truncate (+12 more)

### Community 64 - "Badge"
Cohesion: 0.08
Nodes (48): Approvals(), COLUMNS, Fact(), ReviewPanel(), DemoControls(), OPTIONS, COLUMNS, DELIVERY_LABEL (+40 more)

### Community 65 - "bootstrap-admin.mjs"
Cohesion: 0.24
Nodes (7): b, c, [email, ...nameParts], name, temp, c, hashPassword()

### Community 66 - "page-loading.test.ts"
Cohesion: 0.07
Nodes (30): Loading(), dynamic, metadata, RootLayout(), Loading(), Loading(), Loading(), Loading() (+22 more)

### Community 68 - "mail-settings.ts"
Cohesion: 0.15
Nodes (16): EMAIL_SECURITY, EmailSecurity, EmailSettingsInput, EmailSettingsRow, Mail, mailError(), MailSource, Options (+8 more)

### Community 69 - "format.ts"
Cohesion: 0.08
Nodes (35): NewRequestForm(), newRow(), Step(), COLUMNS, BalanceCheckFormProps, CheckPayment, Line(), ANOMALIES (+27 more)

### Community 70 - "notification-bell.tsx"
Cohesion: 0.06
Nodes (51): setCompany(), switchUser(), AppShell(), ShellProps, Brand(), CompanySwitcher(), SwitcherSelect(), DevBanner() (+43 more)

### Community 71 - "admin_update_user_identity"
Cohesion: 0.29
Nodes (5): admin_clear_email_settings(), admin_email_transport(), admin_record_email_test(), email_settings, worker_email_settings()

### Community 72 - "notification-events.test.ts"
Cohesion: 0.29
Nodes (5): at(), day(), events(), revision(), to()

### Community 73 - "Removing the old treasury engine"
Cohesion: 0.33
Nodes (5): Deployment approach: a fresh installation, Installing on the new server, Removing the old treasury engine, Safety checks in the migration, What the migration removes

### Community 77 - "rows"
Cohesion: 0.06
Nodes (42): account(), attempt(), history(), outbox(), state(), twice(), rows(), account() (+34 more)

### Community 79 - "20261016000000_scheduler/migration.sql"
Cohesion: 0.16
Nodes (11): cash_forecast_account_idx, cash_forecast_guard, cash_forecast_items, cash_forecast_no_delete, _forecast(), forecast_add(), forecast_cancel(), forecast_guard() (+3 more)

### Community 81 - "scripts"
Cohesion: 0.15
Nodes (12): description, name, private, scripts, build, dev, install:app, migrate (+4 more)

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)`, `Migration runner (ops/migrate.mjs)`, `Local test copy setup` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 533 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `helpers.ts` to `bootstrap-admin.mjs`, `email-settings.test.ts`, `format.ts`, `fn`, `notification-events.test.ts`, `package.json`, `app/page.tsx`, `rows`, `payees.test.ts`, `access-withdrawal-race.test.ts`, `account-activation.test.ts`, `admin/page.tsx`, `legacy-removal.test.ts`, `auth.ts`, `test-db.mjs`, `dependencies`, `phase1.test.ts`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `treasury-screens.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07716701902748414 - nodes in this community are weakly interconnected._
- **Why does `rows()` connect `rows` to `email-settings.test.ts`, `fn`, `notification-events.test.ts`, `app/page.tsx`, `helpers.ts`, `payees.test.ts`, `access-withdrawal-race.test.ts`, `account-activation.test.ts`, `admin/page.tsx`, `legacy-removal.test.ts`, `crypto.ts`, `phase2.test.ts`, `phase1.test.ts`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Should `email-settings.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `helpers.ts` to `email-settings.test.ts`, `page-loading.test.ts`, `format.ts`, `fn`, `notification-bell.tsx`, `notification-events.test.ts`, `package.json`, `app/page.tsx`, `rows`, `payees.test.ts`, `access-withdrawal-race.test.ts`, `account-activation.test.ts`, `admin/page.tsx`, `legacy-removal.test.ts`, `phase1.test.ts`, `crypto.ts`, `test-db.mjs`, `reports/page.tsx`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Should `payees/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.09415584415584416 - nodes in this community are weakly interconnected._