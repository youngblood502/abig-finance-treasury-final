# Graph Report - abig-finance-treasury  (2026-11-22)

## Corpus Check
- 275 files · ~312,000 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 13 file(s) not represented in the graph (top: (none) 6, .example 3, .css 3)

## Summary
- 2500 nodes · 8201 edges · 106 communities (86 shown, 20 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 142 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0fd5f7d5`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- account-numbers.ts
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
- notifications.tsx
- Compose Database Service
- access-withdrawal-race.test.ts
- Compose Migrate Service
- users
- legacy-removal.test.ts
- company_bank_accounts
- Compose Service Topology
- DataTable
- components.json
- Deliverable 1: Final business requirements
- test-db.mjs
- dependencies
- email-settings.test.ts
- Compose Proxy Service
- App Environment Variables
- Compose Volumes
- Compose Build Targets
- admin-actions.ts
- format.ts
- Restore Drill Script
- Graphify Skill References
- Notifications Worker Doc
- Backup Script
- recurring-payments.test.ts
- helpers.ts
- ABIG Brand Logo
- Supplier Bank Versioning
- Deliverable 5: Test plan
- 20261107000000_phase3_weekly_treasury/migration.sql
- account-activation.test.ts
- Operations guide
- voucher.ts
- auth.ts
- Testing guide
- crypto.ts
- postcss.config.mjs
- Docker Compose deployment
- phase2.test.ts
- reports/page.tsx
- 20261116000100_one_time_payees_optional_phones/migration.sql
- Money rules live in the database
- cn
- bootstrap-admin.mjs
- page-loading.test.ts
- mail-settings.ts
- etb
- app-shell.tsx
- admin_update_user_identity
- requests/[id]/page.tsx
- Removing the old treasury engine
- tax.ts
- Button
- overview/page.tsx
- rows
- admin/page.tsx
- wf_adjust
- company-logo.ts
- scripts
- 20261118000000_payment_request_tax/migration.sql
- voucher-export.test.ts
- signed-in-frame.tsx
- company-logos.test.ts
- preview-dev.mjs
- notification-bell.tsx
- loading-states.test.ts
- test-db-safety.mjs
- next.config.ts
- session.ts
- admin.ts
- Deliverable 2: Technical implementation plan
- health/route.ts
- nav-progress.ts
- page-loading.tsx
- Deliverable 3: Data migration and compatibility plan
- admin-notifications.test.ts
- notifications.ts
- notification-events.test.ts
- theme.test.ts
- rbac.test.ts
- in-app-notifications.test.ts
- storage.ts

## God Nodes (most connected - your core abstractions)
1. `rows()` - 140 edges
2. `payment_requests` - 128 edges
3. `withUser()` - 101 edges
4. `Button()` - 91 edges
5. `company_bank_accounts` - 79 edges
6. `etb()` - 74 edges
7. `actAs()` - 74 edges
8. `users` - 70 edges
9. `Badge()` - 69 edges
10. `pg` - 68 edges

## Surprising Connections (you probably didn't know these)
- `Phase 1 — Company onboarding and activation` --references--> `createCompany()`  [INFERRED]
  abig-finance/docs/payments-letters/02-implementation-plan.md → abig-finance/src/app/admin-actions.ts
- `Phase 5 — Amharic toolkit` --references--> `parseCents()`  [INFERRED]
  abig-finance/docs/payments-letters/02-implementation-plan.md → abig-finance/src/lib/tax.ts
- `Phase 6a — Emergency payments (O9, U1, U5, IC2–IC6, IC11)` --references--> `status()`  [INFERRED]
  abig-finance/docs/payments-letters/02-implementation-plan.md → abig-finance/ops/test-db.mjs
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (106 total, 20 thin omitted)

### Community 0 - "account-numbers.ts"
Cohesion: 0.43
Nodes (6): revealAccountNumber(), RevealResult, isNumberKind(), NumberKind, REVEAL, revealNumber()

### Community 1 - "20261012000000_foundation/migration.sql"
Cohesion: 0.06
Nodes (50): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_manage_access(), app_can_see_account() (+42 more)

### Community 2 - "payees/page.tsx"
Cohesion: 0.10
Nodes (39): COLUMNS, Line(), Payees(), PersonPanel(), versionLabel(), COLUMNS, Company, NameField() (+31 more)

### Community 3 - "Corporate treasury refactor"
Cohesion: 0.14
Nodes (16): Corporate treasury refactor, 20261030000000_approvals, 20261031000000_rbac_admin, 20261029000000_request_reservation, Previous treasury engine (replaced), ABIG Corporate Treasury Requirement, update_bank_balance(), Authenticate debits the account (+8 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.07
Nodes (94): act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine(), addSupplier(), adjustRequest(), afterSave() (+86 more)

### Community 5 - "users"
Cohesion: 0.10
Nodes (30): company_memberships, app_can_snapshot(), app_member_companies(), app_permitted_companies(), assert_role_company_limit(), company_role_users(), membership_roles, membership_roles_limit (+22 more)

### Community 6 - "fn"
Cohesion: 0.10
Nodes (38): protectAccountNumber(), reservedOn(), verifiedOn(), actAs(), BD_HAWASSA, fn(), mk(), urlFor() (+30 more)

### Community 7 - "payment_requests"
Cohesion: 0.05
Nodes (48): app_can_edit_draft(), app_can_see_request(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx (+40 more)

### Community 8 - "20261014000000_workflow/migration.sql"
Cohesion: 0.05
Nodes (39): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+31 more)

### Community 9 - "devDependencies"
Cohesion: 0.07
Nodes (38): devDependencies, esbuild@^0.24.0, @fontsource-variable/figtree@^5.3.0, prisma@^6.0.0, smtp-server@^3.19.22, tailwindcss@4.2.4, @tailwindcss/postcss@4.2.4, tsx@^4.19.0 (+30 more)

### Community 10 - "app/page.tsx"
Cohesion: 0.06
Nodes (58): 10. Emergency payments (O9, U1, U5, IC2–IC6, IC11), 1. Debit timing (installment level, every payment method), 2. Internal transfer: atomic debit and credit, 3. Incoming in transit (destination side), 4. Idempotency and duplicates, 5. Concurrent executions, 6. Partial execution and remaining balances, 7. Shared accounts and reports (+50 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.06
Nodes (61): installments_guard, payment_installments, access_revoked_release(), account_access_release, account_use_approvals, account_use_one_active, app_can_see_funding(), approvals_no_delete (+53 more)

### Community 12 - "20261106000000_phase2_payees_accounts/migration.sql"
Cohesion: 0.06
Nodes (34): banks, register_bank_account(), app_person_active_for(), assert_method_fits_account(), assert_submittable(), company_bank_accounts_wallet_phone, payment_request_cash_processed(), payment_requests_cash_processed (+26 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "payees.test.ts"
Cohesion: 0.15
Nodes (17): addDetail(), addPerson(), asPerson(), balance(), state(), authenticated(), balance(), monday() (+9 more)

### Community 15 - "NPM Scripts"
Cohesion: 0.10
Nodes (21): scripts, bootstrap:admin, build, build:worker, check:integrity, db:demo, db:seed, demo:passwords (+13 more)

### Community 16 - "notifications.tsx"
Cohesion: 0.21
Nodes (13): COLUMNS, DELIVERY_LABEL, Detail(), label(), Line(), NotificationMonitor(), STATUS_VARIANT, NOTIFICATION_EVENTS (+5 more)

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
Cohesion: 0.07
Nodes (39): app_supplier_active_for(), bank_detail_guard(), company_suppliers, supplier_bank_details, supplier_bank_details_guard, supplier_bank_details_no_delete, supplier_bank_one_verified, suppliers (+31 more)

### Community 21 - "legacy-removal.test.ts"
Cohesion: 0.06
Nodes (25): c, dir, files, files(), ADMIN_URL, FUNCTIONS, LEGACY, tableCount() (+17 more)

### Community 22 - "company_bank_accounts"
Cohesion: 0.07
Nodes (29): company_bank_accounts, wf_set_state(), mark_authenticated_paid_at_go_live(), outbox_recipients(), payment_request_funds_guard(), payment_requests_invoice_once, record_execution(), removed_owner_approval_settings (+21 more)

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 24 - "DataTable"
Cohesion: 0.11
Nodes (26): DemoControls(), OPTIONS, COLUMNS, PAYMENTS, Section(), SWATCHES, RegisterAccountForm(), AmountInput() (+18 more)

### Community 25 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 26 - "Deliverable 1: Final business requirements"
Cohesion: 0.08
Nodes (23): 10. Letter wording and templates (Approved), 11. Letter date and numbering (Approved), 12. Company onboarding and activation (Approved), 12a. System Administrator authority (SA, Approved), 13. Existing Telebirr references (Approved), 14. Decision register, 15. Implementation gate and remaining items before production, 1. Principles (+15 more)

### Community 27 - "test-db.mjs"
Cohesion: 0.21
Nodes (24): APP_DIR, checkBinaries(), checkDataDir(), commands, DATA_DIR, dataDirEmpty(), ENV_FILE, exe() (+16 more)

### Community 28 - "dependencies"
Cohesion: 0.08
Nodes (26): dependencies, class-variance-authority@^0.7.1, clsx@^2.1.1, lucide-react@^1.69.0, next@^15.2.0, nodemailer@^10.1.1, pdfkit@^0.15.2, pg@^8.13.0 (+18 more)

### Community 29 - "email-settings.test.ts"
Cohesion: 0.06
Nodes (21): Phase 4 — Installment-level execution (ledger), compose(), deliver(), tick(), args(), commit(), emailAudit(), event() (+13 more)

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
Cohesion: 0.17
Nodes (40): addGroupGrant(), addVatRate(), admin(), audit(), clearEmailSettings(), createCompany(), createRole(), createUser() (+32 more)

### Community 35 - "format.ts"
Cohesion: 0.06
Nodes (66): ROWS, COLUMNS, Card(), PaymentLine(), TreasuryAccount(), ACCOUNTS, SCHEDULE, AccountPanel() (+58 more)

### Community 42 - "recurring-payments.test.ts"
Cohesion: 0.15
Nodes (9): FREQUENCIES, GeneratedRequest, RecurringTemplate, templateList(), drafts(), generate(), Opts, reserved() (+1 more)

### Community 43 - "helpers.ts"
Cohesion: 0.09
Nodes (57): normalizeAccountNumber(), MY_COMPANIES_SQL, Tx, history(), personList(), supplierList(), likePattern(), listRequests() (+49 more)

### Community 48 - "Deliverable 5: Test plan"
Cohesion: 0.10
Nodes (19): 10. Telebirr execution and voucher, 11. Company activation, 12. Destination changes during in-progress requests, 13. Migration and backfill safety, 13a. Clean-start baseline (T5), 14. Documents and layout (D1, D2, D4, D5), 1. Payment routes (every layer), 2. Roles and permissions (+11 more)

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.04
Nodes (57): account_balance_history(), bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), account_balance_history(), account_week_status() (+49 more)

### Community 50 - "account-activation.test.ts"
Cohesion: 0.17
Nodes (12): account(), clock(), commitments(), connect(), day(), deactivate(), draftOn(), freshAccount() (+4 more)

### Community 51 - "Operations guide"
Cohesion: 0.27
Nodes (10): ops/backup.sh, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Operations guide, Restore drill (ops/restore-drill.sh), ABIG Finance (+2 more)

### Community 52 - "voucher.ts"
Cohesion: 0.16
Nodes (14): exceljs@^4.4.0, cellAmount(), moneyText, drawCode(), drawLogo(), PdfOptions, pdfText(), voucherPdf() (+6 more)

### Community 53 - "auth.ts"
Cohesion: 0.15
Nodes (33): back(), changePasswordAction(), disableMfaAction(), enableMfaAction(), loginAction(), logoutAction(), startMfaAction(), adminResetTotp() (+25 more)

### Community 54 - "Testing guide"
Cohesion: 0.22
Nodes (10): Demo people, Local test copy setup, Testing guide, Things to try to break, UI and UX checklist, Workflow scenarios, company_bank_account_access, Legacy status and role mapping (+2 more)

### Community 55 - "crypto.ts"
Cohesion: 0.20
Nodes (19): base32(), blindIndex(), COMMON, decryptMailSecret(), decryptSecret(), decryptWith(), encryptMailSecret(), encryptSecret() (+11 more)

### Community 58 - "Docker Compose deployment"
Cohesion: 0.40
Nodes (5): Encryption key (APP_ENCRYPTION_KEY), Docker Compose deployment, Migration runner (ops/migrate.mjs), Sign-in security policy, Built-in sign-in

### Community 59 - "phase2.test.ts"
Cohesion: 0.33
Nodes (7): BD_ADDIS, S_ADDIS, addAtt(), draft(), inst(), key(), ready()

### Community 61 - "reports/page.tsx"
Cohesion: 0.10
Nodes (54): Phase 7 — Internal transfers and reporting separation, exact(), GET(), money(), shown(), Audit(), Cash(), Download() (+46 more)

### Community 62 - "20261116000100_one_time_payees_optional_phones/migration.sql"
Cohesion: 0.12
Nodes (19): app_one_time_reveal_company(), one_time_account_state(), one_time_payee_revise(), one_time_payees, one_time_payees_company_idx, one_time_payees_no_delete, one_time_payees_no_truncate, one_time_payees_no_update (+11 more)

### Community 64 - "cn"
Cohesion: 0.25
Nodes (12): Brand(), MobileNav(), ICONS, SidebarNav(), Sidebar(), Sheet(), SheetContent(), SheetDescription() (+4 more)

### Community 65 - "bootstrap-admin.mjs"
Cohesion: 0.24
Nodes (7): b, c, [email, ...nameParts], name, temp, c, hashPassword()

### Community 66 - "page-loading.test.ts"
Cohesion: 0.18
Nodes (11): dynamic, metadata, RootLayout(), NavigationProgress(), Progress(), ProgressBar(), BrandSplash(), createProgress() (+3 more)

### Community 68 - "mail-settings.ts"
Cohesion: 0.11
Nodes (20): EMAIL_SECURITY, EmailSecurity, EmailSettingsInput, EmailSettingsRow, Mail, mailError(), MailSource, Options (+12 more)

### Community 69 - "etb"
Cohesion: 0.09
Nodes (32): Approvals(), COLUMNS, Fact(), ReviewPanel(), Reason(), ReviewActions(), ReviewTarget, ACTION_LABEL (+24 more)

### Community 70 - "app-shell.tsx"
Cohesion: 0.19
Nodes (14): setCompany(), switchUser(), ShellProps, CompanySwitcher(), SwitcherSelect(), DevBanner(), Header(), label() (+6 more)

### Community 71 - "admin_update_user_identity"
Cohesion: 0.29
Nodes (5): admin_clear_email_settings(), admin_email_transport(), admin_record_email_test(), email_settings, worker_email_settings()

### Community 72 - "requests/[id]/page.tsx"
Cohesion: 0.14
Nodes (24): Card(), DEACTIVATED_DETAILS_NOTE, Fact(), INSTALLMENTS, RequestDetail(), AccountNumber(), AccountPlaceNumber(), HIDE_AFTER_MS (+16 more)

### Community 73 - "Removing the old treasury engine"
Cohesion: 0.33
Nodes (5): Deployment approach: a fresh installation, Installing on the new server, Removing the old treasury engine, Safety checks in the migration, What the migration removes

### Community 74 - "tax.ts"
Cohesion: 0.12
Nodes (39): EditRequest(), NewRequestForm(), Step(), AdjustForm(), AdjustFormProps, AdjustTax, AmountEntry(), AmountEntryInitial (+31 more)

### Community 75 - "Button"
Cohesion: 0.12
Nodes (49): Password(), Security(), Accounts(), COLUMNS, FILTERS, Card(), Person(), RoleChoices() (+41 more)

### Community 76 - "overview/page.tsx"
Cohesion: 0.11
Nodes (43): cells(), COLUMNS, Partial(), WeekOverview(), LIMITED, Reconciliation(), CorrectStatement(), ReviewDecision() (+35 more)

### Community 77 - "rows"
Cohesion: 0.06
Nodes (38): account(), attempt(), history(), outbox(), state(), twice(), rows(), clock() (+30 more)

### Community 78 - "admin/page.tsx"
Cohesion: 0.16
Nodes (26): Activity(), AddAction(), Admin(), Companies(), Email(), Field(), Panel(), People() (+18 more)

### Community 80 - "company-logo.ts"
Cohesion: 0.15
Nodes (21): CompanyMark(), ADAM7, assertPdfkitCanDraw(), bad(), crc32(), CRC_TABLE, inspectImage(), isJpeg() (+13 more)

### Community 81 - "scripts"
Cohesion: 0.15
Nodes (12): description, name, private, scripts, build, dev, install:app, migrate (+4 more)

### Community 82 - "20261118000000_payment_request_tax/migration.sql"
Cohesion: 0.08
Nodes (20): assert_submittable(), admin_update_company(), assert_submittable(), admin_vat_rate_add(), admin_vat_rate_set_active(), admin_vat_rate_set_default(), admin_vat_rate_update(), admin_withholding_update() (+12 more)

### Community 83 - "voucher-export.test.ts"
Cohesion: 0.08
Nodes (15): env, PDF, Redirected, stored(), key(), account(), draft(), setThreshold() (+7 more)

### Community 84 - "signed-in-frame.tsx"
Cohesion: 0.23
Nodes (11): AppShell(), accessLines(), SignedInFrame(), myCompanies, ROLE_LABEL(), devUsers(), getMe(), load() (+3 more)

### Community 85 - "company-logos.test.ts"
Cohesion: 0.15
Nodes (13): ABIG, call(), current(), env, LOGO, Redirected, upload(), chunk() (+5 more)

### Community 86 - "preview-dev.mjs"
Cohesion: 0.17
Nodes (15): fail(), onDb(), PREVIEW_DB, PREVIEW_FILE, provenAdminUrl(), readEnvFile(), ROLE_LOGINS, root (+7 more)

### Community 87 - "notification-bell.tsx"
Cohesion: 0.36
Nodes (13): NotificationBell(), OpenButton, THEME_KEY, ThemeMenuItem(), initials(), UserMenu(), DropdownMenu(), DropdownMenuContent() (+5 more)

### Community 88 - "loading-states.test.ts"
Cohesion: 0.13
Nodes (15): ExportButton(), useSubmitGuard(), DownloadResult, fetchCsv(), MESSAGES, browserTimers, claimSubmission(), createSubmitLock() (+7 more)

### Community 89 - "test-db-safety.mjs"
Cohesion: 0.19
Nodes (15): assertTestServer(), assertTestServerUrl(), fail(), FORBIDDEN_TEST_ENV, PREVIEW_NOWHERE, scrubDatabaseEnv(), SYSTEM_DBS, TEST_DB_NAME (+7 more)

### Community 92 - "session.ts"
Cohesion: 0.13
Nodes (22): Phase 3 — Telebirr reference and voucher, GET(), GET(), notFound(), GET(), TYPES, CurrentLogo, currentLogo() (+14 more)

### Community 93 - "admin.ts"
Cohesion: 0.12
Nodes (17): AdminChange, AdminCompany, AdminEmailSettings, AdminGrant, AdminMembership, AdminPermission, AdminTaxRow, AdminUser (+9 more)

### Community 94 - "Deliverable 2: Technical implementation plan"
Cohesion: 0.12
Nodes (15): 0. Decisions and remaining dependencies, 0a. Implementation gate: GO/NO-GO (T5), 10. Implementation readiness assessment, 1. Phase order, 1a. System Administrator authority (SA), applies to every phase, 9. Risks and open design questions, Deliverable 2: Technical implementation plan, Phase 1 — Company onboarding and activation (+7 more)

### Community 96 - "nav-progress.ts"
Cohesion: 0.15
Nodes (10): AnchorLike, ClickLike, FormLike, LocationLike, navigationTarget(), ProgressOptions, ProgressState, SubmitterLike (+2 more)

### Community 97 - "page-loading.tsx"
Cohesion: 0.28
Nodes (9): Loading(), Loading(), Loading(), Loading(), Loading(), Bone(), HeaderBones(), PageSkeleton() (+1 more)

### Community 98 - "Deliverable 3: Data migration and compatibility plan"
Cohesion: 0.14
Nodes (13): 10. Template approval state, 11. Internal transfers, ledger and reconciliation, 12. Review list produced by the rehearsal, 1. `destination_type` on payment requests, 2. Recurring payment templates, 3. Destination rows, 5. One-time payee classification, 6. Telebirr references (+5 more)

### Community 100 - "notifications.ts"
Cohesion: 0.31
Nodes (8): NOTES, notificationLink(), notificationTitle(), OutboxEvent, SUBJECTS, BELL_LIMIT, BellItem, loadBell()

### Community 101 - "notification-events.test.ts"
Cohesion: 0.29
Nodes (5): at(), day(), events(), revision(), to()

### Community 102 - "theme.test.ts"
Cohesion: 0.28
Nodes (7): channel(), contrast(), css, luminance(), SHAPES, TEXT, themes

### Community 103 - "rbac.test.ts"
Cohesion: 0.33
Nodes (5): navFor(), ACCOUNTANT, FINANCE_MANAGER, OWNER, paths()

### Community 104 - "in-app-notifications.test.ts"
Cohesion: 0.33
Nodes (4): bell(), forRequest(), mine(), tx()

### Community 105 - "storage.ts"
Cohesion: 0.47
Nodes (4): MAGIC, saveAttachment(), putObject(), removeObject()

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `Finance Manager role`, `Owner role`, `Stale version refusal`, `ABIG Corporate Treasury Requirement` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 669 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `helpers.ts` to `fn`, `devDependencies`, `app/page.tsx`, `payees.test.ts`, `access-withdrawal-race.test.ts`, `legacy-removal.test.ts`, `email-settings.test.ts`, `format.ts`, `recurring-payments.test.ts`, `account-activation.test.ts`, `voucher.ts`, `crypto.ts`, `phase2.test.ts`, `reports/page.tsx`, `page-loading.test.ts`, `tax.ts`, `rows`, `voucher-export.test.ts`, `signed-in-frame.tsx`, `company-logos.test.ts`, `preview-dev.mjs`, `loading-states.test.ts`, `test-db-safety.mjs`, `admin-notifications.test.ts`, `notification-events.test.ts`, `theme.test.ts`, `rbac.test.ts`, `in-app-notifications.test.ts`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `Finance Manager role`, `Owner role` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `20261012000000_foundation/migration.sql` be split into smaller, more focused modules?**
  _Cohesion score 0.05792349726775956 - nodes in this community are weakly interconnected._
- **Why does `pg` connect `helpers.ts` to `fn`, `devDependencies`, `app/page.tsx`, `payees.test.ts`, `access-withdrawal-race.test.ts`, `legacy-removal.test.ts`, `test-db.mjs`, `dependencies`, `email-settings.test.ts`, `format.ts`, `recurring-payments.test.ts`, `account-activation.test.ts`, `auth.ts`, `phase2.test.ts`, `bootstrap-admin.mjs`, `mail-settings.ts`, `tax.ts`, `rows`, `voucher-export.test.ts`, `company-logos.test.ts`, `preview-dev.mjs`, `test-db-safety.mjs`, `session.ts`, `admin-notifications.test.ts`, `notification-events.test.ts`, `in-app-notifications.test.ts`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Should `payees/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.10042283298097252 - nodes in this community are weakly interconnected._
- **Why does `rows()` connect `rows` to `admin-notifications.test.ts`, `notification-events.test.ts`, `fn`, `in-app-notifications.test.ts`, `app/page.tsx`, `helpers.ts`, `recurring-payments.test.ts`, `payees.test.ts`, `access-withdrawal-race.test.ts`, `account-activation.test.ts`, `voucher-export.test.ts`, `company-logos.test.ts`, `legacy-removal.test.ts`, `phase2.test.ts`, `email-settings.test.ts`, `Deliverable 2: Technical implementation plan`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Should `Corporate treasury refactor` be split into smaller, more focused modules?**
  _Cohesion score 0.13725490196078433 - nodes in this community are weakly interconnected._