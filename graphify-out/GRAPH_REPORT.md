# Graph Report - abig-finance-treasury  (2026-11-12)

## Corpus Check
- 238 files · ~202,267 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 13 file(s) not represented in the graph (top: (none) 6, .example 3, .css 3)

## Summary
- 2000 nodes · 6732 edges · 87 communities (64 shown, 23 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 107 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `cfe46d5d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- account-numbers.test.ts
- phase1.test.ts
- recurring/page.tsx
- Corporate treasury refactor
- Payment Workflow Actions
- users
- fn
- Suppliers and Requests Schema
- 20261014000000_workflow/migration.sql
- package.json
- app/page.tsx
- 20261015000000_treasury/migration.sql
- 20261106000000_phase2_payees_accounts/migration.sql
- TypeScript Compiler Config
- rows
- NPM Scripts
- reports.ts
- Compose Database Service
- access-withdrawal-race.test.ts
- Compose Migrate Service
- notifications.tsx
- actAs
- 20261012000000_foundation/migration.sql
- Compose Service Topology
- Badge
- components.json
- 20261109000800_more_notifications/migration.sql
- test-db.mjs
- dependencies
- company_bank_accounts
- Compose Proxy Service
- App Environment Variables
- Compose Volumes
- Compose Build Targets
- Worker Environment Variables
- admin-actions.ts
- Restore Drill Script
- Graphify Skill References
- Notifications Worker Doc
- Backup Script
- weekly-concurrency.test.ts
- helpers.ts
- ABIG Brand Logo
- Supplier Bank Versioning
- companies
- 20261107000000_phase3_weekly_treasury/migration.sql
- treasury-screens.ts
- accounts/page.tsx
- admin.ts
- admin-actions.ts
- 20261110000200_in_app_notifications/migration.sql
- format.ts
- postcss.config.mjs
- cn
- phase2.test.ts
- loading-states.test.ts
- admin/page.tsx
- Operations guide
- Testing guide
- ops.test.ts
- page-loading.test.ts
- notification_outbox
- format.ts
- treasury.ts
- admin_update_company
- notification-events.test.ts
- Removing the old treasury engine
- Docker Compose deployment
- Money rules live in the database
- next.config.ts
- ops.test.ts
- 20261110000300_outbox_retention/migration.sql
- wf_adjust
- health/route.ts
- SubmitLock
- @types/pg@^8.11.0
- nav-progress.ts
- page-loading.tsx
- @tailwindcss/postcss@4.2.4
- @types/smtp-server@^3.5.13

## God Nodes (most connected - your core abstractions)
1. `payment_requests` - 107 edges
2. `rows()` - 106 edges
3. `withUser()` - 88 edges
4. `Button()` - 85 edges
5. `etb()` - 73 edges
6. `company_bank_accounts` - 72 edges
7. `Badge()` - 67 edges
8. `users` - 60 edges
9. `pg` - 56 edges
10. `currentUserId()` - 56 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `granted()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/access-withdrawal-race.test.ts → abig-finance/tests/helpers.ts
- `state()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/access-withdrawal-race.test.ts → abig-finance/tests/helpers.ts
- `account()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/account-activation.test.ts → abig-finance/tests/helpers.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (87 total, 23 thin omitted)

### Community 0 - "account-numbers.test.ts"
Cohesion: 0.11
Nodes (21): normalizeAccountNumber(), MY_COMPANIES_SQL, reconciliationWeek(), likePattern(), listRequests(), loadRequest(), maskRequest(), parseRequestFilters() (+13 more)

### Community 1 - "phase1.test.ts"
Cohesion: 0.07
Nodes (24): compose(), deliver(), Mail, makeSender(), Sender, tick(), every(), log() (+16 more)

### Community 2 - "recurring/page.tsx"
Cohesion: 0.09
Nodes (56): Accounts(), COLUMNS, FILTERS, GET(), Approvals(), Payees(), Amount(), COLUMNS (+48 more)

### Community 3 - "Corporate treasury refactor"
Cohesion: 0.14
Nodes (16): Corporate treasury refactor, 20261030000000_approvals, 20261031000000_rbac_admin, 20261029000000_request_reservation, Previous treasury engine (replaced), ABIG Corporate Treasury Requirement, update_bank_balance(), Authenticate debits the account (+8 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.08
Nodes (77): act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine(), addSupplier(), adjustRequest(), afterSave() (+69 more)

### Community 5 - "users"
Cohesion: 0.11
Nodes (31): app_member_companies(), company_memberships, users, company_role_users(), app_member_companies(), app_permitted_companies(), assert_role_company_limit(), company_role_users() (+23 more)

### Community 6 - "fn"
Cohesion: 0.08
Nodes (30): account(), clock(), commitments(), connect(), day(), deactivate(), draftOn(), freshAccount() (+22 more)

### Community 7 - "Suppliers and Requests Schema"
Cohesion: 0.05
Nodes (50): app_can_edit_draft(), app_can_see_request(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx (+42 more)

### Community 8 - "20261014000000_workflow/migration.sql"
Cohesion: 0.13
Nodes (14): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+6 more)

### Community 9 - "package.json"
Cohesion: 0.09
Nodes (32): clsx@^2.1.1, devDependencies, esbuild@^0.24.0, @fontsource-variable/figtree@^5.3.0, prisma@^6.0.0, smtp-server@^3.19.22, tailwindcss@4.2.4, tsx@^4.19.0 (+24 more)

### Community 10 - "app/page.tsx"
Cohesion: 0.08
Nodes (46): Dashboard(), Panel(), QUEUE_COLUMNS, queueTable(), Section(), AppShell(), accessLines(), SignedInFrame() (+38 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.06
Nodes (60): installments_guard, payment_installments, access_revoked_release(), account_access_release, account_use_approvals, account_use_one_active, app_can_see_funding(), approvals_no_delete (+52 more)

### Community 12 - "20261106000000_phase2_payees_accounts/migration.sql"
Cohesion: 0.06
Nodes (39): bank_detail_guard(), supplier_bank_details, supplier_bank_details_guard, supplier_bank_details_no_delete, supplier_bank_one_verified, banks, register_bank_account(), app_person_active_for() (+31 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "rows"
Cohesion: 0.07
Nodes (38): account(), attempt(), history(), outbox(), state(), twice(), actAs(), rows() (+30 more)

### Community 15 - "NPM Scripts"
Cohesion: 0.11
Nodes (19): scripts, bootstrap:admin, build, build:worker, check:integrity, db:demo, db:seed, demo:passwords (+11 more)

### Community 16 - "reports.ts"
Cohesion: 0.12
Nodes (46): GET(), money(), shown(), Audit(), Cash(), Download(), FilterBar(), Outstanding() (+38 more)

### Community 17 - "Compose Database Service"
Cohesion: 0.17
Nodes (12): environment, healthcheck, image, restart, volumes, POSTGRES_DB, POSTGRES_PASSWORD, interval (+4 more)

### Community 18 - "access-withdrawal-race.test.ts"
Cohesion: 0.25
Nodes (12): attempt(), connect(), draft(), granted(), held(), must(), noStranded(), raced() (+4 more)

### Community 19 - "Compose Migrate Service"
Cohesion: 0.18
Nodes (11): condition, db, APP_DB_PASSWORD, AUTH_DB_PASSWORD, MIGRATION_DATABASE_URL, WORKER_DB_PASSWORD, command, depends_on (+3 more)

### Community 20 - "notifications.tsx"
Cohesion: 0.11
Nodes (15): COLUMNS, DELIVERY_LABEL, Detail(), label(), Line(), NotificationMonitor(), STATUS_VARIANT, NOTIFICATION_EVENTS (+7 more)

### Community 21 - "actAs"
Cohesion: 0.07
Nodes (15): c, dir, files, files(), FUNCTIONS, LEGACY, tableCount(), event() (+7 more)

### Community 22 - "20261012000000_foundation/migration.sql"
Cohesion: 0.08
Nodes (31): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_manage_access(), app_can_see_account() (+23 more)

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 24 - "Badge"
Cohesion: 0.10
Nodes (42): COLUMNS, Line(), PersonPanel(), versionLabel(), COLUMNS, Company, NameField(), SupplierPanel() (+34 more)

### Community 25 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 26 - "20261109000800_more_notifications/migration.sql"
Cohesion: 0.19
Nodes (12): account_access_notify, enqueue_missing_openings(), notify_account_access(), notify_person_details_pending(), notify_supplier_details_pending(), notify_user_account(), person_payment_details_notify, public.lock_week() (+4 more)

### Community 27 - "test-db.mjs"
Cohesion: 0.11
Nodes (40): APP_DIR, checkBinaries(), checkDataDir(), commands, DATA_DIR, dataDirEmpty(), ENV_FILE, exe() (+32 more)

### Community 28 - "dependencies"
Cohesion: 0.09
Nodes (22): dependencies, class-variance-authority@^0.7.1, lucide-react@^1.69.0, next@^15.2.0, nodemailer@^10.1.1, pg@^8.13.0, qrcode@^1.5.4, @radix-ui/react-dialog@^1.3.1 (+14 more)

### Community 29 - "company_bank_accounts"
Cohesion: 0.07
Nodes (30): company_bank_accounts, wf_set_state(), app_can_snapshot(), payment_request_account_guard(), set_account_policy(), mark_authenticated_paid_at_go_live(), outbox_recipients(), payment_request_funds_guard() (+22 more)

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

### Community 35 - "admin-actions.ts"
Cohesion: 0.29
Nodes (22): addGroupGrant(), admin(), audit(), createCompany(), createRole(), createUser(), done(), resetMfa() (+14 more)

### Community 42 - "weekly-concurrency.test.ts"
Cohesion: 0.14
Nodes (18): BD_HAWASSA, addDetail(), addPerson(), asPerson(), balance(), state(), authenticated(), balance() (+10 more)

### Community 43 - "helpers.ts"
Cohesion: 0.13
Nodes (37): Tx, stopReason(), accountDetail(), accountList(), paymentSchedule(), treasuryOverview(), ASKU, authorized() (+29 more)

### Community 48 - "companies"
Cohesion: 0.09
Nodes (27): companies, app_supplier_active_for(), company_suppliers, suppliers, admin_create_company(), auth_events, auth_events_append_only, auth_events_no_truncate (+19 more)

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.05
Nodes (45): account_balance_history(), bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), account_balance_history(), account_week_status() (+37 more)

### Community 50 - "treasury-screens.ts"
Cohesion: 0.09
Nodes (42): Card(), PaymentLine(), TreasuryAccount(), AccountPanel(), canDo(), Line(), Section(), AccountStatus() (+34 more)

### Community 51 - "accounts/page.tsx"
Cohesion: 0.09
Nodes (51): DemoConfirm(), DemoControls(), OPTIONS, TemplateForm(), TemplatePanel(), NewRequestForm(), newRow(), Step() (+43 more)

### Community 52 - "admin.ts"
Cohesion: 0.13
Nodes (23): Card(), Person(), RoleChoices(), SecretNotice(), AdminChange, AdminCompany, AdminGrant, AdminMembership (+15 more)

### Community 53 - "admin-actions.ts"
Cohesion: 0.08
Nodes (58): Password(), Security(), back(), changePasswordAction(), disableMfaAction(), enableMfaAction(), loginAction(), logoutAction() (+50 more)

### Community 54 - "20261110000200_in_app_notifications/migration.sql"
Cohesion: 0.28
Nodes (4): notification_outbox_in_app_idx, user_notifications, user_notifications_unread_idx, user_notifications_user_idx

### Community 55 - "format.ts"
Cohesion: 0.07
Nodes (43): cells(), COLUMNS, Partial(), WeekOverview(), BalanceLogEntry, COLUMNS, DataColumn, DataFilter (+35 more)

### Community 58 - "cn"
Cohesion: 0.06
Nodes (60): setCompany(), switchUser(), ShellProps, Brand(), CompanySwitcher(), SwitcherSelect(), DevBanner(), Header() (+52 more)

### Community 59 - "phase2.test.ts"
Cohesion: 0.39
Nodes (6): BD_ADDIS, addAtt(), draft(), inst(), key(), ready()

### Community 61 - "loading-states.test.ts"
Cohesion: 0.18
Nodes (13): ExportButton(), useSubmitGuard(), DownloadResult, fetchCsv(), MESSAGES, browserTimers, claimSubmission(), createSubmitLock() (+5 more)

### Community 62 - "admin/page.tsx"
Cohesion: 0.20
Nodes (19): Activity(), AddAction(), Admin(), Companies(), Field(), Panel(), People(), Roles() (+11 more)

### Community 63 - "Operations guide"
Cohesion: 0.27
Nodes (10): ops/backup.sh, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Operations guide, Restore drill (ops/restore-drill.sh), ABIG Finance (+2 more)

### Community 64 - "Testing guide"
Cohesion: 0.22
Nodes (10): Demo people, Local test copy setup, Testing guide, Things to try to break, UI and UX checklist, Workflow scenarios, company_bank_account_access, Legacy status and role mapping (+2 more)

### Community 65 - "ops.test.ts"
Cohesion: 0.24
Nodes (7): b, c, [email, ...nameParts], name, temp, c, hashPassword()

### Community 66 - "page-loading.test.ts"
Cohesion: 0.18
Nodes (11): dynamic, metadata, RootLayout(), NavigationProgress(), Progress(), ProgressBar(), BrandSplash(), createProgress() (+3 more)

### Community 68 - "notification_outbox"
Cohesion: 0.21
Nodes (12): notification_outbox, notification_outbox_pending_idx, outbox_claim(), outbox_complete(), outbox_fail(), wf_notify(), notification_deliveries, notification_outbox_pending_idx (+4 more)

### Community 69 - "format.ts"
Cohesion: 0.08
Nodes (46): COLUMNS, Fact(), ReviewPanel(), COLUMNS, Gallery(), PAYMENTS, ROWS, Section() (+38 more)

### Community 70 - "treasury.ts"
Cohesion: 0.27
Nodes (12): translate(), addReconciliationLine(), lockWeek(), matchPayment(), recordExecution(), recordFigure(), removeReconciliationLine(), returnReconciliation() (+4 more)

### Community 71 - "admin_update_company"
Cohesion: 0.20
Nodes (4): admin_update_company(), admin_notification_list(), admin_notification_retry(), notification_outbox_outcome_created_idx

### Community 72 - "notification-events.test.ts"
Cohesion: 0.29
Nodes (5): at(), day(), events(), revision(), to()

### Community 73 - "Removing the old treasury engine"
Cohesion: 0.33
Nodes (5): Deployment approach: a fresh installation, Installing on the new server, Removing the old treasury engine, Safety checks in the migration, What the migration removes

### Community 74 - "Docker Compose deployment"
Cohesion: 0.40
Nodes (5): Encryption key (APP_ENCRYPTION_KEY), Docker Compose deployment, Migration runner (ops/migrate.mjs), Sign-in security policy, Built-in sign-in

### Community 77 - "ops.test.ts"
Cohesion: 0.38
Nodes (6): ADMIN_URL, childEnv(), DB, root, run(), url()

### Community 83 - "nav-progress.ts"
Cohesion: 0.15
Nodes (10): AnchorLike, ClickLike, FormLike, LocationLike, navigationTarget(), ProgressOptions, ProgressState, SubmitterLike (+2 more)

### Community 84 - "page-loading.tsx"
Cohesion: 0.28
Nodes (9): Loading(), Loading(), Loading(), Loading(), Loading(), Bone(), HeaderBones(), PageSkeleton() (+1 more)

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `Finance Manager role`, `Owner role`, `Stale version refusal`, `ABIG Corporate Treasury Requirement` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 478 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `phase1.test.ts` to `account-numbers.test.ts`, `recurring/page.tsx`, `fn`, `package.json`, `app/page.tsx`, `rows`, `access-withdrawal-race.test.ts`, `notifications.tsx`, `actAs`, `test-db.mjs`, `dependencies`, `weekly-concurrency.test.ts`, `helpers.ts`, `admin-actions.ts`, `format.ts`, `phase2.test.ts`, `ops.test.ts`, `notification-events.test.ts`, `ops.test.ts`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `Finance Manager role`, `Owner role` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `account-numbers.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `helpers.ts` to `account-numbers.test.ts`, `phase1.test.ts`, `fn`, `package.json`, `app/page.tsx`, `rows`, `access-withdrawal-race.test.ts`, `notifications.tsx`, `actAs`, `test-db.mjs`, `weekly-concurrency.test.ts`, `admin-actions.ts`, `format.ts`, `cn`, `phase2.test.ts`, `loading-states.test.ts`, `page-loading.test.ts`, `notification-events.test.ts`, `ops.test.ts`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Should `phase1.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07179487179487179 - nodes in this community are weakly interconnected._
- **Why does `rows()` connect `rows` to `account-numbers.test.ts`, `phase1.test.ts`, `fn`, `notification-events.test.ts`, `app/page.tsx`, `helpers.ts`, `weekly-concurrency.test.ts`, `ops.test.ts`, `access-withdrawal-race.test.ts`, `notifications.tsx`, `actAs`, `phase2.test.ts`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Should `recurring/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.0898021308980213 - nodes in this community are weakly interconnected._