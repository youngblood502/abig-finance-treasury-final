# Graph Report - abig-finance-treasury  (2026-11-19)

## Corpus Check
- 269 files · ~264,354 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 13 file(s) not represented in the graph (top: (none) 6, .example 3, .css 3)

## Summary
- 2389 nodes · 8056 edges · 99 communities (78 shown, 21 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 119 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d1a504e8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- treasury-screens.ts
- 20261012000000_foundation/migration.sql
- payees/page.tsx
- Corporate treasury refactor
- Payment Workflow Actions
- users
- fn
- payment_requests
- 20261014000000_workflow/migration.sql
- devDependencies
- app/page.tsx
- 20261015000000_treasury/migration.sql
- 20261106000000_phase2_payees_accounts/migration.sql
- TypeScript Compiler Config
- payees.test.ts
- NPM Scripts
- Badge
- Compose Database Service
- access-withdrawal-race.test.ts
- Compose Migrate Service
- users
- legacy-removal.test.ts
- company_bank_accounts
- Compose Service Topology
- reports/page.tsx
- components.json
- phase1.test.ts
- test-db.mjs
- dependencies
- notification-events.test.ts
- Compose Proxy Service
- App Environment Variables
- Compose Volumes
- Compose Build Targets
- admin-actions.ts
- currentUserId
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
- voucher.ts
- auth.ts
- Testing guide
- crypto.ts
- postcss.config.mjs
- Docker Compose deployment
- helpers.ts
- reports/page.tsx
- 20261116000100_one_time_payees_optional_phones/migration.sql
- Money rules live in the database
- cn
- bootstrap-admin.mjs
- nav-progress.ts
- email-settings.test.ts
- etb
- app-shell.tsx
- admin_update_user_identity
- requests/[id]/page.tsx
- Removing the old treasury engine
- tax.ts
- Button
- format.ts
- rows
- admin/page.tsx
- wf_adjust
- company-logo.ts
- scripts
- 20261118000000_payment_request_tax/migration.sql
- voucher-export.test.ts
- signed-in-frame.tsx
- company-logos.test.ts
- form.tsx
- notification-bell.tsx
- loading-states.test.ts
- 20261109000800_more_notifications/migration.sql
- next.config.ts
- logo/route.ts
- 20261110000200_in_app_notifications/migration.sql
- print/page.tsx
- health/route.ts
- @types/pdfkit@^0.13.9
- @types/qrcode@^1.5.6
- theme.test.ts

## God Nodes (most connected - your core abstractions)
1. `rows()` - 140 edges
2. `payment_requests` - 128 edges
3. `withUser()` - 101 edges
4. `Button()` - 91 edges
5. `company_bank_accounts` - 79 edges
6. `etb()` - 74 edges
7. `actAs()` - 73 edges
8. `users` - 70 edges
9. `Badge()` - 69 edges
10. `pg` - 66 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `current()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/company-logos.test.ts → abig-finance/tests/helpers.ts
- `addDetail()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/payees.test.ts → abig-finance/tests/helpers.ts
- `asPerson()` --indirect_call--> `person()`  [INFERRED]
  abig-finance/tests/payees.test.ts → abig-finance/tests/weekly-concurrency.test.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (99 total, 21 thin omitted)

### Community 0 - "treasury-screens.ts"
Cohesion: 0.09
Nodes (24): revealAccountNumber(), RevealResult, isNumberKind(), normalizeAccountNumber(), NumberKind, REVEAL, revealNumber(), ACCESS_NOTE (+16 more)

### Community 1 - "20261012000000_foundation/migration.sql"
Cohesion: 0.08
Nodes (37): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_manage_access(), app_can_see_account() (+29 more)

### Community 2 - "payees/page.tsx"
Cohesion: 0.10
Nodes (43): COLUMNS, Line(), Payees(), PersonPanel(), versionLabel(), COLUMNS, Company, NameField() (+35 more)

### Community 3 - "Corporate treasury refactor"
Cohesion: 0.14
Nodes (16): Corporate treasury refactor, 20261030000000_approvals, 20261031000000_rbac_admin, 20261029000000_request_reservation, Previous treasury engine (replaced), ABIG Corporate Treasury Requirement, update_bank_balance(), Authenticate debits the account (+8 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.07
Nodes (91): act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine(), addSupplier(), adjustRequest(), afterSave() (+83 more)

### Community 5 - "users"
Cohesion: 0.10
Nodes (36): app_member_companies(), company_memberships, users, company_role_users(), app_can_snapshot(), app_member_companies(), app_permitted_companies(), app_related_companies() (+28 more)

### Community 6 - "fn"
Cohesion: 0.07
Nodes (47): protectAccountNumber(), reservedOn(), verifiedOn(), actAs(), BD_HAWASSA, fn(), key(), mk() (+39 more)

### Community 7 - "payment_requests"
Cohesion: 0.05
Nodes (49): app_can_edit_draft(), app_can_see_request(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx (+41 more)

### Community 8 - "20261014000000_workflow/migration.sql"
Cohesion: 0.06
Nodes (33): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+25 more)

### Community 9 - "devDependencies"
Cohesion: 0.08
Nodes (34): qrcode@^1.5.4, devDependencies, esbuild@^0.24.0, prisma@^6.0.0, smtp-server@^3.19.22, tailwindcss@4.2.4, @tailwindcss/postcss@4.2.4, tsx@^4.19.0 (+26 more)

### Community 10 - "app/page.tsx"
Cohesion: 0.16
Nodes (29): Dashboard(), Panel(), QUEUE_COLUMNS, queueTable(), Section(), accountInCompany(), AccountRow, accountRows() (+21 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.06
Nodes (59): installments_guard, payment_installments, access_revoked_release(), account_access_release, account_use_approvals, account_use_one_active, app_can_see_funding(), approvals_no_delete (+51 more)

### Community 12 - "20261106000000_phase2_payees_accounts/migration.sql"
Cohesion: 0.06
Nodes (34): banks, register_bank_account(), app_person_active_for(), assert_method_fits_account(), assert_submittable(), company_bank_accounts_wallet_phone, payment_request_cash_processed(), payment_requests_cash_processed (+26 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "payees.test.ts"
Cohesion: 0.16
Nodes (16): addDetail(), asPerson(), balance(), state(), authenticated(), balance(), monday(), newAccount() (+8 more)

### Community 15 - "NPM Scripts"
Cohesion: 0.10
Nodes (21): scripts, bootstrap:admin, build, build:worker, check:integrity, db:demo, db:seed, demo:passwords (+13 more)

### Community 16 - "Badge"
Cohesion: 0.17
Nodes (17): cells(), Partial(), COLUMNS, DELIVERY_LABEL, Detail(), label(), Line(), NotificationMonitor() (+9 more)

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
Cohesion: 0.09
Nodes (33): app_supplier_active_for(), bank_detail_guard(), company_suppliers, supplier_bank_details, supplier_bank_details_guard, supplier_bank_details_no_delete, supplier_bank_one_verified, suppliers (+25 more)

### Community 21 - "legacy-removal.test.ts"
Cohesion: 0.08
Nodes (15): c, dir, files, files(), FUNCTIONS, LEGACY, tableCount(), event() (+7 more)

### Community 22 - "company_bank_accounts"
Cohesion: 0.06
Nodes (36): company_bank_accounts, wf_set_state(), mark_authenticated_paid_at_go_live(), outbox_recipients(), payment_request_funds_guard(), payment_requests_invoice_once, record_execution(), removed_owner_approval_settings (+28 more)

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 24 - "reports/page.tsx"
Cohesion: 0.14
Nodes (37): COLUMNS, Gallery(), PAYMENTS, ROWS, Section(), SWATCHES, Audit(), Cash() (+29 more)

### Community 25 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 26 - "phase1.test.ts"
Cohesion: 0.22
Nodes (7): BD_ETHIO, enterFigure(), S_ETHIO_ID, bal(), req(), setBalance(), shortfallEvents()

### Community 27 - "test-db.mjs"
Cohesion: 0.08
Nodes (53): fail(), onDb(), PREVIEW_DB, PREVIEW_FILE, provenAdminUrl(), readEnvFile(), ROLE_LOGINS, root (+45 more)

### Community 28 - "dependencies"
Cohesion: 0.09
Nodes (23): dependencies, class-variance-authority@^0.7.1, clsx@^2.1.1, lucide-react@^1.69.0, next@^15.2.0, nodemailer@^10.1.1, pdfkit@^0.15.2, pg@^8.13.0 (+15 more)

### Community 29 - "notification-events.test.ts"
Cohesion: 0.07
Nodes (23): compose(), OutboxEvent, deliver(), tick(), every(), log(), pool, send (+15 more)

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
Cohesion: 0.15
Nodes (42): addGroupGrant(), addVatRate(), admin(), audit(), clearEmailSettings(), createCompany(), createRole(), createUser() (+34 more)

### Community 35 - "currentUserId"
Cohesion: 0.12
Nodes (47): Password(), Accounts(), COLUMNS, FILTERS, Approvals(), EditRequest(), NewRequest(), COLUMNS (+39 more)

### Community 42 - "recurring/page.tsx"
Cohesion: 0.23
Nodes (14): Amount(), COLUMNS, Line(), Recurring(), STATUS_VARIANT, Template, TemplateForm(), TemplatePanel() (+6 more)

### Community 43 - "helpers.ts"
Cohesion: 0.11
Nodes (42): MY_COMPANIES_SQL, g, Tx, ReportFilters, likePattern(), listRequests(), loadRequest(), maskRequest() (+34 more)

### Community 48 - "companies"
Cohesion: 0.18
Nodes (11): admin_create_company(), auth_events, auth_events_append_only, auth_events_no_truncate, auth_events_time_idx, company_directory(), report_outstanding(), sessions (+3 more)

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.05
Nodes (44): account_balance_history(), bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), account_balance_history(), account_week_status() (+36 more)

### Community 50 - "account-activation.test.ts"
Cohesion: 0.17
Nodes (12): account(), clock(), commitments(), connect(), day(), deactivate(), draftOn(), freshAccount() (+4 more)

### Community 51 - "Operations guide"
Cohesion: 0.27
Nodes (10): ops/backup.sh, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Operations guide, Restore drill (ops/restore-drill.sh), ABIG Finance (+2 more)

### Community 52 - "voucher.ts"
Cohesion: 0.12
Nodes (25): exceljs@^4.4.0, GET(), TYPES, logoBytes(), cellAmount(), cents(), destination(), loadVoucher() (+17 more)

### Community 53 - "auth.ts"
Cohesion: 0.15
Nodes (33): Security(), back(), changePasswordAction(), disableMfaAction(), enableMfaAction(), loginAction(), logoutAction(), startMfaAction() (+25 more)

### Community 54 - "Testing guide"
Cohesion: 0.22
Nodes (10): Demo people, Local test copy setup, Testing guide, Things to try to break, UI and UX checklist, Workflow scenarios, company_bank_account_access, Legacy status and role mapping (+2 more)

### Community 55 - "crypto.ts"
Cohesion: 0.16
Nodes (24): startTotp(), base32(), blindIndex(), COMMON, decryptMailSecret(), decryptSecret(), decryptWith(), encryptMailSecret() (+16 more)

### Community 58 - "Docker Compose deployment"
Cohesion: 0.40
Nodes (5): Encryption key (APP_ENCRYPTION_KEY), Docker Compose deployment, Migration runner (ops/migrate.mjs), Sign-in security policy, Built-in sign-in

### Community 59 - "helpers.ts"
Cohesion: 0.10
Nodes (23): assertTestDbName(), ADMIN_URL, BD_ADDIS, BERBERO_ID, MkOpts, root, S_ADDIS, urlFor() (+15 more)

### Community 61 - "reports/page.tsx"
Cohesion: 0.07
Nodes (57): exact(), GET(), money(), shown(), Reports(), PaymentColumnsProps, cell(), toCsv() (+49 more)

### Community 62 - "20261116000100_one_time_payees_optional_phones/migration.sql"
Cohesion: 0.12
Nodes (19): app_one_time_reveal_company(), one_time_account_state(), one_time_payee_revise(), one_time_payees, one_time_payees_company_idx, one_time_payees_no_delete, one_time_payees_no_truncate, one_time_payees_no_update (+11 more)

### Community 64 - "cn"
Cohesion: 0.25
Nodes (12): Brand(), MobileNav(), ICONS, SidebarNav(), Sidebar(), Sheet(), SheetContent(), SheetDescription() (+4 more)

### Community 65 - "bootstrap-admin.mjs"
Cohesion: 0.24
Nodes (7): b, c, [email, ...nameParts], name, temp, c, hashPassword()

### Community 66 - "nav-progress.ts"
Cohesion: 0.07
Nodes (32): @fontsource-variable/figtree@^5.3.0, Loading(), dynamic, metadata, RootLayout(), Loading(), Loading(), Loading() (+24 more)

### Community 68 - "email-settings.test.ts"
Cohesion: 0.07
Nodes (26): mailKeyProblem(), EMAIL_SECURITY, EmailSecurity, EmailSettingsInput, EmailSettingsRow, Mail, mailError(), MailSource (+18 more)

### Community 69 - "etb"
Cohesion: 0.09
Nodes (29): COLUMNS, Fact(), ReviewPanel(), Reason(), ReviewActions(), ReviewTarget, ACTION_LABEL, AdjustmentRow (+21 more)

### Community 70 - "app-shell.tsx"
Cohesion: 0.21
Nodes (13): switchUser(), ShellProps, CompanySwitcher(), SwitcherSelect(), DevBanner(), Header(), label(), TableLabels() (+5 more)

### Community 71 - "admin_update_user_identity"
Cohesion: 0.29
Nodes (5): admin_clear_email_settings(), admin_email_transport(), admin_record_email_test(), email_settings, worker_email_settings()

### Community 72 - "requests/[id]/page.tsx"
Cohesion: 0.16
Nodes (22): Card(), DEACTIVATED_DETAILS_NOTE, Fact(), INSTALLMENTS, RequestDetail(), AccountNumber(), AccountPlaceNumber(), HIDE_AFTER_MS (+14 more)

### Community 73 - "Removing the old treasury engine"
Cohesion: 0.33
Nodes (5): Deployment approach: a fresh installation, Installing on the new server, Removing the old treasury engine, Safety checks in the migration, What the migration removes

### Community 74 - "tax.ts"
Cohesion: 0.18
Nodes (28): amountFields(), AdjustForm(), AdjustFormProps, AdjustTax, AmountEntry(), AmountEntryInitial, InstallmentInitial, row() (+20 more)

### Community 75 - "Button"
Cohesion: 0.11
Nodes (38): Card(), Person(), RoleChoices(), DemoConfirm(), DemoControls(), OPTIONS, Login(), AccountPanel() (+30 more)

### Community 76 - "format.ts"
Cohesion: 0.12
Nodes (31): LIMITED, Reconciliation(), AccountStatus(), CommitmentList(), commitmentSummary(), dateText(), itemLink(), itemState() (+23 more)

### Community 77 - "rows"
Cohesion: 0.05
Nodes (45): audits(), reveal(), account(), attempt(), history(), outbox(), state(), twice() (+37 more)

### Community 78 - "admin/page.tsx"
Cohesion: 0.07
Nodes (49): Activity(), AddAction(), Admin(), Companies(), Email(), Field(), Panel(), People() (+41 more)

### Community 80 - "company-logo.ts"
Cohesion: 0.17
Nodes (19): ADAM7, assertPdfkitCanDraw(), bad(), crc32(), CRC_TABLE, inspectImage(), isJpeg(), isPng() (+11 more)

### Community 81 - "scripts"
Cohesion: 0.15
Nodes (12): description, name, private, scripts, build, dev, install:app, migrate (+4 more)

### Community 82 - "20261118000000_payment_request_tax/migration.sql"
Cohesion: 0.09
Nodes (19): admin_update_company(), assert_submittable(), admin_vat_rate_add(), admin_vat_rate_set_active(), admin_vat_rate_set_default(), admin_vat_rate_update(), admin_withholding_update(), assert_submittable() (+11 more)

### Community 83 - "voucher-export.test.ts"
Cohesion: 0.20
Nodes (3): env, Redirected, std()

### Community 84 - "signed-in-frame.tsx"
Cohesion: 0.10
Nodes (25): setCompany(), AppShell(), accessLines(), SignedInFrame(), myCompanies, NOTES, notificationLink(), notificationTitle() (+17 more)

### Community 85 - "company-logos.test.ts"
Cohesion: 0.14
Nodes (13): ABIG, call(), current(), env, LOGO, Redirected, upload(), chunk() (+5 more)

### Community 86 - "form.tsx"
Cohesion: 0.23
Nodes (11): NewRequestForm(), Step(), ScheduleField(), SearchableSelect(), SearchableSelectProps, METHODS_FOR_KIND, compare(), filterOptions() (+3 more)

### Community 87 - "notification-bell.tsx"
Cohesion: 0.36
Nodes (13): NotificationBell(), OpenButton, THEME_KEY, ThemeMenuItem(), initials(), UserMenu(), DropdownMenu(), DropdownMenuContent() (+5 more)

### Community 88 - "loading-states.test.ts"
Cohesion: 0.18
Nodes (10): useSubmitGuard(), browserTimers, claimSubmission(), createSubmitLock(), lockFor(), locks, SubmitLock, Timers (+2 more)

### Community 89 - "20261109000800_more_notifications/migration.sql"
Cohesion: 0.19
Nodes (12): account_access_notify, enqueue_missing_openings(), notify_account_access(), notify_person_details_pending(), notify_supplier_details_pending(), notify_user_account(), person_payment_details_notify, public.lock_week() (+4 more)

### Community 92 - "logo/route.ts"
Cohesion: 0.33
Nodes (8): GET(), GET(), notFound(), CurrentLogo, currentLogo(), denyApi(), requestDocument(), getObject()

### Community 93 - "20261110000200_in_app_notifications/migration.sql"
Cohesion: 0.28
Nodes (4): notification_outbox_in_app_idx, user_notifications, user_notifications_unread_idx, user_notifications_user_idx

### Community 94 - "print/page.tsx"
Cohesion: 0.46
Nodes (5): Fact(), PrintVoucher(), CompanyMark(), PrintButton(), logoUrl()

### Community 102 - "theme.test.ts"
Cohesion: 0.28
Nodes (7): channel(), contrast(), css, luminance(), SHAPES, TEXT, themes

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `Finance Manager role`, `Owner role`, `Stale version refusal`, `ABIG Corporate Treasury Requirement` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 582 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `helpers.ts` to `fn`, `devDependencies`, `app/page.tsx`, `payees.test.ts`, `access-withdrawal-race.test.ts`, `legacy-removal.test.ts`, `phase1.test.ts`, `test-db.mjs`, `notification-events.test.ts`, `account-activation.test.ts`, `voucher.ts`, `crypto.ts`, `helpers.ts`, `reports/page.tsx`, `nav-progress.ts`, `email-settings.test.ts`, `tax.ts`, `Button`, `format.ts`, `rows`, `admin/page.tsx`, `voucher-export.test.ts`, `signed-in-frame.tsx`, `company-logos.test.ts`, `theme.test.ts`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `Finance Manager role`, `Owner role` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `treasury-screens.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09116809116809117 - nodes in this community are weakly interconnected._
- **Why does `pg` connect `helpers.ts` to `fn`, `devDependencies`, `app/page.tsx`, `payees.test.ts`, `access-withdrawal-race.test.ts`, `legacy-removal.test.ts`, `phase1.test.ts`, `test-db.mjs`, `dependencies`, `notification-events.test.ts`, `currentUserId`, `account-activation.test.ts`, `auth.ts`, `helpers.ts`, `reports/page.tsx`, `bootstrap-admin.mjs`, `email-settings.test.ts`, `tax.ts`, `format.ts`, `rows`, `admin/page.tsx`, `voucher-export.test.ts`, `company-logos.test.ts`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Should `20261012000000_foundation/migration.sql` be split into smaller, more focused modules?**
  _Cohesion score 0.07505285412262157 - nodes in this community are weakly interconnected._
- **Why does `rows()` connect `rows` to `email-settings.test.ts`, `fn`, `app/page.tsx`, `helpers.ts`, `admin/page.tsx`, `payees.test.ts`, `access-withdrawal-race.test.ts`, `account-activation.test.ts`, `reports/page.tsx`, `company-logos.test.ts`, `legacy-removal.test.ts`, `crypto.ts`, `voucher-export.test.ts`, `phase1.test.ts`, `helpers.ts`, `notification-events.test.ts`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Should `payees/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.09929078014184398 - nodes in this community are weakly interconnected._