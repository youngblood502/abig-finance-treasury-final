# Graph Report - abig-finance-treasury  (2026-11-19)

## Corpus Check
- 261 files · ~254,943 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 13 file(s) not represented in the graph (top: (none) 6, .example 3, .css 3)

## Summary
- 2317 nodes · 7832 edges · 97 communities (76 shown, 21 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 120 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `03a697bf`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- etb
- account-numbers.test.ts
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
- overview/page.tsx
- Compose Database Service
- access-withdrawal-race.test.ts
- Compose Migrate Service
- users
- legacy-removal.test.ts
- company_bank_accounts
- Compose Service Topology
- 20261013000000_suppliers_requests/migration.sql
- components.json
- mk
- test-db.mjs
- dependencies
- phase1.test.ts
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
- 20261029000000_request_reservation/migration.sql
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
- nav-progress.ts
- mail-settings.ts
- etb
- app-shell.tsx
- admin_update_user_identity
- notification-events.test.ts
- Removing the old treasury engine
- tax.ts
- Button
- format.ts
- rows
- admin/page.tsx
- wf_adjust
- 20261110000000_scheduled_payments/migration.sql
- scripts
- 20261118000000_payment_request_tax/migration.sql
- voucher-export.test.ts
- signed-in-frame.tsx
- sidebar-nav.tsx
- loading-states.test.ts
- notification-bell.tsx
- loading-states.test.ts
- @types/node@^22.0.0
- next.config.ts
- pdfkit
- page-loading.tsx
- tailwindcss@4.2.4
- layout.tsx
- theme.test.ts

## God Nodes (most connected - your core abstractions)
1. `rows()` - 138 edges
2. `payment_requests` - 128 edges
3. `withUser()` - 99 edges
4. `Button()` - 91 edges
5. `company_bank_accounts` - 79 edges
6. `etb()` - 74 edges
7. `actAs()` - 72 edges
8. `Badge()` - 69 edges
9. `users` - 69 edges
10. `pg` - 65 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `ZERO()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/request-tax.test.ts → abig-finance/tests/helpers.ts
- `setThreshold()` --calls--> `actAs()`  [EXTRACTED]
  abig-finance/tests/request-tax.test.ts → abig-finance/tests/helpers.ts
- `tax()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/request-tax.test.ts → abig-finance/tests/helpers.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (97 total, 21 thin omitted)

### Community 0 - "etb"
Cohesion: 0.08
Nodes (43): ROWS, Card(), PaymentLine(), TreasuryAccount(), PositionBar(), ShortfallChip(), BalanceCheckForm(), BalanceCheckFormProps (+35 more)

### Community 1 - "account-numbers.test.ts"
Cohesion: 0.19
Nodes (12): revealAccountNumber(), RevealResult, isNumberKind(), normalizeAccountNumber(), NumberKind, REVEAL, revealNumber(), audits() (+4 more)

### Community 2 - "payees/page.tsx"
Cohesion: 0.11
Nodes (37): COLUMNS, Line(), PersonPanel(), versionLabel(), COLUMNS, Company, NameField(), PhoneField() (+29 more)

### Community 3 - "Corporate treasury refactor"
Cohesion: 0.14
Nodes (16): Corporate treasury refactor, 20261030000000_approvals, 20261031000000_rbac_admin, 20261029000000_request_reservation, Previous treasury engine (replaced), ABIG Corporate Treasury Requirement, update_bank_balance(), Authenticate debits the account (+8 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.06
Nodes (102): act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine(), addSupplier(), adjustRequest(), afterSave() (+94 more)

### Community 5 - "users"
Cohesion: 0.05
Nodes (64): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_manage_access(), app_can_see_account() (+56 more)

### Community 6 - "fn"
Cohesion: 0.09
Nodes (34): protectAccountNumber(), actAs(), BD_HAWASSA, fn(), approve(), balance(), bareSupplier(), count() (+26 more)

### Community 7 - "payment_requests"
Cohesion: 0.13
Nodes (16): app_can_see_request(), payment_requests, payment_requests_company_state_idx, payment_requests_invoice_once, outbox_recipients(), wf_assert_actor(), wf_lock(), wf_submit() (+8 more)

### Community 8 - "20261014000000_workflow/migration.sql"
Cohesion: 0.05
Nodes (38): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+30 more)

### Community 9 - "devDependencies"
Cohesion: 0.08
Nodes (34): react-dom@^19.0.0, devDependencies, esbuild@^0.24.0, prisma@^6.0.0, smtp-server@^3.19.22, @tailwindcss/postcss@4.2.4, tsx@^4.19.0, tw-animate-css@^1.4.0 (+26 more)

### Community 10 - "app/page.tsx"
Cohesion: 0.16
Nodes (29): Dashboard(), Panel(), QUEUE_COLUMNS, queueTable(), Section(), accountInCompany(), AccountRow, accountRows() (+21 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.06
Nodes (61): payment_installments, access_revoked_release(), account_access_release, account_use_approvals, account_use_one_active, app_can_see_funding(), approvals_no_delete, assert_account_use() (+53 more)

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

### Community 16 - "overview/page.tsx"
Cohesion: 0.12
Nodes (42): cells(), COLUMNS, Partial(), WeekOverview(), LIMITED, Reconciliation(), ReviewDecision(), Column() (+34 more)

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
Nodes (35): app_supplier_active_for(), company_suppliers, supplier_bank_details, supplier_bank_details_no_delete, supplier_bank_one_verified, wf_set_state(), mark_authenticated_paid_at_go_live(), outbox_recipients() (+27 more)

### Community 21 - "legacy-removal.test.ts"
Cohesion: 0.09
Nodes (15): c, dir, files, files(), ADMIN_URL, childEnv(), DB, root (+7 more)

### Community 22 - "company_bank_accounts"
Cohesion: 0.06
Nodes (38): company_bank_accounts, update_bank_balance(), set_large_deposit_threshold(), payment_request_funds_guard(), account_access_notify, enqueue_missing_openings(), notify_account_access(), notify_person_details_pending() (+30 more)

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 24 - "20261013000000_suppliers_requests/migration.sql"
Cohesion: 0.13
Nodes (21): app_can_edit_draft(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx, bank_detail_guard() (+13 more)

### Community 25 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 26 - "mk"
Cohesion: 0.13
Nodes (14): AWASH, mk(), bal(), req(), setBalance(), shortfallEvents(), submitted(), submittedReq() (+6 more)

### Community 27 - "test-db.mjs"
Cohesion: 0.08
Nodes (54): fail(), onDb(), PREVIEW_DB, PREVIEW_FILE, provenAdminUrl(), readEnvFile(), ROLE_LOGINS, root (+46 more)

### Community 28 - "dependencies"
Cohesion: 0.09
Nodes (23): dependencies, class-variance-authority@^0.7.1, clsx@^2.1.1, exceljs@^4.4.0, lucide-react@^1.69.0, next@^15.2.0, nodemailer@^10.1.1, pg@^8.13.0 (+15 more)

### Community 29 - "phase1.test.ts"
Cohesion: 0.05
Nodes (27): compose(), NOTES, notificationTitle(), OutboxEvent, SUBJECTS, deliver(), tick(), every() (+19 more)

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
Cohesion: 0.19
Nodes (35): addGroupGrant(), addVatRate(), admin(), audit(), clearEmailSettings(), createCompany(), createRole(), createUser() (+27 more)

### Community 35 - "currentUserId"
Cohesion: 0.15
Nodes (39): Password(), Accounts(), COLUMNS, FILTERS, Approvals(), Payees(), Recurring(), EditRequest() (+31 more)

### Community 42 - "recurring/page.tsx"
Cohesion: 0.15
Nodes (17): Amount(), COLUMNS, Line(), STATUS_VARIANT, Template, TemplateForm(), TemplatePanel(), DataFilter (+9 more)

### Community 43 - "helpers.ts"
Cohesion: 0.07
Nodes (61): dynamic, MY_COMPANIES_SQL, g, pool, Tx, likePattern(), listRequests(), loadRequest() (+53 more)

### Community 48 - "companies"
Cohesion: 0.20
Nodes (10): auth_events, auth_events_append_only, auth_events_no_truncate, auth_events_time_idx, company_directory(), report_outstanding(), sessions, sessions_user_idx (+2 more)

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.05
Nodes (45): account_balance_history(), bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), account_balance_history(), account_week_status() (+37 more)

### Community 50 - "account-activation.test.ts"
Cohesion: 0.17
Nodes (14): account(), clock(), commitments(), connect(), day(), deactivate(), draftOn(), freshAccount() (+6 more)

### Community 51 - "Operations guide"
Cohesion: 0.27
Nodes (10): ops/backup.sh, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Operations guide, Restore drill (ops/restore-drill.sh), ABIG Finance (+2 more)

### Community 52 - "20261029000000_request_reservation/migration.sql"
Cohesion: 0.18
Nodes (7): app_can_edit_draft(), assert_submittable(), attachment_guard(), installment_guard(), payment_request_funds_guard(), payment_requests_funds_guard, wf_submit()

### Community 53 - "auth.ts"
Cohesion: 0.15
Nodes (34): Security(), back(), changePasswordAction(), disableMfaAction(), enableMfaAction(), loginAction(), logoutAction(), startMfaAction() (+26 more)

### Community 54 - "Testing guide"
Cohesion: 0.22
Nodes (10): Demo people, Local test copy setup, Testing guide, Things to try to break, UI and UX checklist, Workflow scenarios, company_bank_account_access, Legacy status and role mapping (+2 more)

### Community 55 - "crypto.ts"
Cohesion: 0.17
Nodes (22): base32(), blindIndex(), COMMON, decryptMailSecret(), decryptSecret(), decryptWith(), encryptMailSecret(), encryptSecret() (+14 more)

### Community 58 - "Docker Compose deployment"
Cohesion: 0.40
Nodes (5): Encryption key (APP_ENCRYPTION_KEY), Docker Compose deployment, Migration runner (ops/migrate.mjs), Sign-in security policy, Built-in sign-in

### Community 59 - "phase2.test.ts"
Cohesion: 0.18
Nodes (10): BD_ADDIS, addAtt(), draft(), inst(), key(), ready(), actions(), state() (+2 more)

### Community 61 - "reports/page.tsx"
Cohesion: 0.10
Nodes (53): exact(), GET(), money(), shown(), Audit(), Cash(), Download(), FilterBar() (+45 more)

### Community 62 - "20261116000100_one_time_payees_optional_phones/migration.sql"
Cohesion: 0.09
Nodes (23): suppliers, supplier_update(), supplier_update(), supplier_update(), app_one_time_reveal_company(), one_time_account_state(), one_time_payee_revise(), one_time_payees (+15 more)

### Community 64 - "cn"
Cohesion: 0.29
Nodes (12): MobileNav(), Sheet(), SheetContent(), SheetDescription(), SheetOverlay(), SheetTitle(), SheetTrigger(), SidePanel() (+4 more)

### Community 65 - "bootstrap-admin.mjs"
Cohesion: 0.24
Nodes (7): b, c, [email, ...nameParts], name, temp, c, hashPassword()

### Community 66 - "nav-progress.ts"
Cohesion: 0.12
Nodes (16): Progress(), ProgressBar(), AnchorLike, ClickLike, createProgress(), FormLike, isNavigatingSubmit(), LocationLike (+8 more)

### Community 68 - "mail-settings.ts"
Cohesion: 0.15
Nodes (16): EMAIL_SECURITY, EmailSecurity, EmailSettingsInput, EmailSettingsRow, Mail, mailError(), MailSource, Options (+8 more)

### Community 69 - "etb"
Cohesion: 0.09
Nodes (25): COLUMNS, Fact(), ReviewPanel(), ACTION_LABEL, AdjustmentRow, AGE_OPTIONS, ageBucket(), ApprovalRow (+17 more)

### Community 70 - "app-shell.tsx"
Cohesion: 0.17
Nodes (15): setCompany(), switchUser(), ShellProps, CompanySwitcher(), SwitcherSelect(), DevBanner(), Header(), label() (+7 more)

### Community 71 - "admin_update_user_identity"
Cohesion: 0.29
Nodes (5): admin_clear_email_settings(), admin_email_transport(), admin_record_email_test(), email_settings, worker_email_settings()

### Community 72 - "notification-events.test.ts"
Cohesion: 0.29
Nodes (5): at(), day(), events(), revision(), to()

### Community 73 - "Removing the old treasury engine"
Cohesion: 0.33
Nodes (5): Deployment approach: a fresh installation, Installing on the new server, Removing the old treasury engine, Safety checks in the migration, What the migration removes

### Community 74 - "tax.ts"
Cohesion: 0.08
Nodes (56): Fact(), PrintVoucher(), GET(), TYPES, NewRequestForm(), Step(), AdjustForm(), AdjustFormProps (+48 more)

### Community 75 - "Button"
Cohesion: 0.11
Nodes (41): DemoConfirm(), DemoControls(), OPTIONS, Login(), Card(), DEACTIVATED_DETAILS_NOTE, Fact(), INSTALLMENTS (+33 more)

### Community 76 - "format.ts"
Cohesion: 0.10
Nodes (31): COLUMNS, Gallery(), PAYMENTS, Section(), SWATCHES, CommitmentList(), commitmentSummary(), dateText() (+23 more)

### Community 77 - "rows"
Cohesion: 0.07
Nodes (35): account(), attempt(), history(), outbox(), state(), twice(), rows(), account() (+27 more)

### Community 78 - "admin/page.tsx"
Cohesion: 0.06
Nodes (64): Activity(), AddAction(), Admin(), Companies(), Email(), Field(), Panel(), People() (+56 more)

### Community 80 - "20261110000000_scheduled_payments/migration.sql"
Cohesion: 0.22
Nodes (8): memberships_system_guard, payment_requests_scheduled_due_idx, release_scheduled_requests(), request_snapshot(), schedule_log(), system_user_guard(), users_system_guard, wf_schedule()

### Community 81 - "scripts"
Cohesion: 0.15
Nodes (12): description, name, private, scripts, build, dev, install:app, migrate (+4 more)

### Community 82 - "20261118000000_payment_request_tax/migration.sql"
Cohesion: 0.09
Nodes (20): assert_submittable(), admin_update_company(), assert_submittable(), admin_vat_rate_add(), admin_vat_rate_set_active(), admin_vat_rate_set_default(), admin_vat_rate_update(), admin_withholding_update() (+12 more)

### Community 83 - "voucher-export.test.ts"
Cohesion: 0.10
Nodes (12): key(), account(), draft(), setThreshold(), STD(), submit(), tax(), TaxOpts (+4 more)

### Community 84 - "signed-in-frame.tsx"
Cohesion: 0.14
Nodes (18): AppShell(), accessLines(), SignedInFrame(), myCompanies, loadBell(), Module, navFor(), ROLE_LABEL() (+10 more)

### Community 85 - "sidebar-nav.tsx"
Cohesion: 0.43
Nodes (5): Brand(), ICONS, SidebarNav(), Sidebar(), isCurrentPath()

### Community 86 - "loading-states.test.ts"
Cohesion: 0.43
Nodes (4): ExportButton(), DownloadResult, fetchCsv(), MESSAGES

### Community 87 - "notification-bell.tsx"
Cohesion: 0.36
Nodes (13): NotificationBell(), OpenButton, THEME_KEY, ThemeMenuItem(), initials(), UserMenu(), DropdownMenu(), DropdownMenuContent() (+5 more)

### Community 88 - "loading-states.test.ts"
Cohesion: 0.18
Nodes (10): useSubmitGuard(), browserTimers, claimSubmission(), createSubmitLock(), lockFor(), locks, SubmitLock, Timers (+2 more)

### Community 93 - "page-loading.tsx"
Cohesion: 0.28
Nodes (9): Loading(), Loading(), Loading(), Loading(), Loading(), Bone(), HeaderBones(), PageSkeleton() (+1 more)

### Community 99 - "layout.tsx"
Cohesion: 0.28
Nodes (7): @fontsource-variable/figtree@^5.3.0, dynamic, metadata, RootLayout(), NavigationProgress(), BrandSplash(), @fontsource-variable/figtree

### Community 102 - "theme.test.ts"
Cohesion: 0.28
Nodes (7): channel(), contrast(), css, luminance(), SHAPES, TEXT, themes

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `Legacy status and role mapping`, `Finance Manager role`, `Owner role`, `Stale version refusal` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 561 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `helpers.ts` to `account-numbers.test.ts`, `fn`, `devDependencies`, `app/page.tsx`, `payees.test.ts`, `overview/page.tsx`, `access-withdrawal-race.test.ts`, `legacy-removal.test.ts`, `mk`, `test-db.mjs`, `dependencies`, `phase1.test.ts`, `currentUserId`, `account-activation.test.ts`, `auth.ts`, `phase2.test.ts`, `bootstrap-admin.mjs`, `notification-events.test.ts`, `tax.ts`, `format.ts`, `rows`, `voucher-export.test.ts`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `Legacy status and role mapping`, `Finance Manager role` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `etb` be split into smaller, more focused modules?**
  _Cohesion score 0.0782312925170068 - nodes in this community are weakly interconnected._
- **Why does `rows()` connect `rows` to `account-numbers.test.ts`, `fn`, `notification-events.test.ts`, `app/page.tsx`, `helpers.ts`, `payees.test.ts`, `overview/page.tsx`, `access-withdrawal-race.test.ts`, `account-activation.test.ts`, `voucher-export.test.ts`, `legacy-removal.test.ts`, `crypto.ts`, `mk`, `phase2.test.ts`, `phase1.test.ts`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Should `payees/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.11033681765389082 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `helpers.ts` to `account-numbers.test.ts`, `fn`, `devDependencies`, `app/page.tsx`, `payees.test.ts`, `overview/page.tsx`, `access-withdrawal-race.test.ts`, `legacy-removal.test.ts`, `mk`, `test-db.mjs`, `phase1.test.ts`, `account-activation.test.ts`, `crypto.ts`, `phase2.test.ts`, `reports/page.tsx`, `nav-progress.ts`, `notification-events.test.ts`, `tax.ts`, `format.ts`, `rows`, `voucher-export.test.ts`, `signed-in-frame.tsx`, `loading-states.test.ts`, `theme.test.ts`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Should `Corporate treasury refactor` be split into smaller, more focused modules?**
  _Cohesion score 0.13725490196078433 - nodes in this community are weakly interconnected._