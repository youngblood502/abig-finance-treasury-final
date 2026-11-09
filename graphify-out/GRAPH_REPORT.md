# Graph Report - abig-finance-treasury  (2026-11-09)

## Corpus Check
- 193 files · ~160,249 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 6, .css 3, .example 2)

## Summary
- 1643 nodes · 5589 edges · 68 communities (50 shown, 18 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 81 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `aaadb396`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- admin/page.tsx
- phase1.test.ts
- admin-actions.ts
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
- db.ts
- NPM Scripts
- Runtime Dependencies
- Compose Database Service
- account-numbers.test.ts
- Compose Migrate Service
- Button
- shared-account-privacy.test.ts
- 20261012000000_foundation/migration.sql
- Compose Service Topology
- Badge
- components.json
- wf_adjust
- requireMe
- companies
- 20261105000100_phase1_money_logic/migration.sql
- Compose Proxy Service
- App Environment Variables
- Compose Volumes
- Compose Build Targets
- Worker Environment Variables
- overview/page.tsx
- Restore Drill Script
- Graphify Skill References
- Notifications Worker Doc
- Backup Script
- reveal-number.tsx
- helpers.ts
- ABIG Brand Logo
- Supplier Bank Versioning
- 20261107000000_phase3_weekly_treasury/migration.sql
- etb
- weekly-treasury.test.ts
- auth.ts
- auth-actions.ts
- actAs
- postcss.config.mjs
- tailwind-merge
- prisma@^6.0.0
- weekly-concurrency.test.ts
- smtp-server
- typescript@^5.6.0
- ops.test.ts
- reports/page.tsx
- crypto.ts
- requests/[id]/page.tsx
- phase1.test.ts
- table.ts
- health/route.ts

## God Nodes (most connected - your core abstractions)
1. `payment_requests` - 95 edges
2. `Button()` - 77 edges
3. `rows()` - 77 edges
4. `withUser()` - 76 edges
5. `etb()` - 67 edges
6. `company_bank_accounts` - 60 edges
7. `Badge()` - 58 edges
8. `users` - 52 edges
9. `currentUserId()` - 51 edges
10. `requireMe()` - 45 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `public.submit_reconciliation()` --reads_from--> `reconciliation_lines`  [EXTRACTED]
  abig-finance/prisma/migrations/20261109000800_more_notifications/migration.sql → abig-finance/prisma/migrations/20261107000000_phase3_weekly_treasury/migration.sql
- `events()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/notification-events.test.ts → abig-finance/tests/helpers.ts
- `to()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/notification-events.test.ts → abig-finance/tests/helpers.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (68 total, 18 thin omitted)

### Community 0 - "admin/page.tsx"
Cohesion: 0.11
Nodes (41): Activity(), AddAction(), Admin(), Companies(), Field(), Panel(), People(), Roles() (+33 more)

### Community 1 - "phase1.test.ts"
Cohesion: 0.07
Nodes (26): compose(), deliver(), Mail, makeSender(), NOTES, OutboxEvent, Sender, SUBJECTS (+18 more)

### Community 2 - "admin-actions.ts"
Cohesion: 0.27
Nodes (22): addGroupGrant(), admin(), audit(), createCompany(), createRole(), createUser(), done(), resetMfa() (+14 more)

### Community 3 - "Operations guide"
Cohesion: 0.05
Nodes (43): Encryption key (APP_ENCRYPTION_KEY), ops/backup.sh, Docker Compose deployment, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Migration runner (ops/migrate.mjs) (+35 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.08
Nodes (70): act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine(), addSupplier(), adjustRequest(), createAndSubmitRequest() (+62 more)

### Community 5 - "users"
Cohesion: 0.10
Nodes (35): app_member_companies(), company_memberships, users, company_role_users(), app_can_snapshot(), app_member_companies(), app_permitted_companies(), assert_role_company_limit() (+27 more)

### Community 6 - "layout.tsx"
Cohesion: 0.07
Nodes (51): setCompany(), AppShell(), ShellProps, Brand(), CompanySwitcher(), DevBanner(), Header(), MobileNav() (+43 more)

### Community 7 - "Suppliers and Requests Schema"
Cohesion: 0.06
Nodes (42): app_can_edit_draft(), app_can_see_request(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx (+34 more)

### Community 8 - "Workflow Schema and Adjustments"
Cohesion: 0.08
Nodes (32): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+24 more)

### Community 9 - "package.json"
Cohesion: 0.09
Nodes (30): devDependencies, esbuild@^0.24.0, @fontsource-variable/figtree@^5.3.0, tailwindcss@4.2.4, @tailwindcss/postcss@4.2.4, tsx@^4.19.0, tw-animate-css@^1.4.0, @types/node@^22.0.0 (+22 more)

### Community 10 - "app/page.tsx"
Cohesion: 0.07
Nodes (60): GET(), accessLines(), dynamic, metadata, RootLayout(), Dashboard(), Panel(), QUEUE_COLUMNS (+52 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.06
Nodes (57): installments_guard, payment_installments, access_revoked_release(), account_access_release, account_use_approvals, account_use_one_active, app_can_see_funding(), approvals_no_delete (+49 more)

### Community 12 - "20261106000000_phase2_payees_accounts/migration.sql"
Cohesion: 0.07
Nodes (32): banks, register_bank_account(), app_person_active_for(), assert_method_fits_account(), assert_submittable(), company_bank_accounts_wallet_phone, payment_request_cash_processed(), payment_requests_cash_processed (+24 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "db.ts"
Cohesion: 0.17
Nodes (27): MY_COMPANIES_SQL, g, Tx, likePattern(), listRequests(), loadRequest(), maskRequest(), parseRequestFilters() (+19 more)

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
Cohesion: 0.28
Nodes (7): normalizeAccountNumber(), supplierList(), audits(), clean(), NUM, plain(), reveal()

### Community 19 - "Compose Migrate Service"
Cohesion: 0.18
Nodes (11): condition, db, APP_DB_PASSWORD, AUTH_DB_PASSWORD, MIGRATION_DATABASE_URL, WORKER_DB_PASSWORD, command, depends_on (+3 more)

### Community 20 - "Button"
Cohesion: 0.12
Nodes (30): COLUMNS, FILTERS, switchUser(), DemoControls(), OPTIONS, NewRequestForm(), newRow(), Step() (+22 more)

### Community 21 - "shared-account-privacy.test.ts"
Cohesion: 0.11
Nodes (11): c, dir, files, files(), askuNo(), berberoNo(), log(), numbers (+3 more)

### Community 22 - "20261012000000_foundation/migration.sql"
Cohesion: 0.06
Nodes (48): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_manage_access(), app_can_see_account() (+40 more)

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 24 - "Badge"
Cohesion: 0.13
Nodes (35): COLUMNS, Line(), Payees(), PersonPanel(), versionLabel(), COLUMNS, Company, NameField() (+27 more)

### Community 25 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 27 - "requireMe"
Cohesion: 0.19
Nodes (19): DemoConfirm(), COLUMNS, Gallery(), PAYMENTS, Section(), SWATCHES, EditRequest(), NewRequest() (+11 more)

### Community 28 - "companies"
Cohesion: 0.12
Nodes (20): companies, app_supplier_active_for(), company_suppliers, suppliers, admin_create_company(), auth_events, auth_events_append_only, auth_events_no_truncate (+12 more)

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

### Community 35 - "overview/page.tsx"
Cohesion: 0.06
Nodes (75): GET(), money(), shown(), cells(), COLUMNS, Partial(), WeekOverview(), LIMITED (+67 more)

### Community 42 - "reveal-number.tsx"
Cohesion: 0.19
Nodes (16): revealAccountNumber(), RevealResult, AccountNumber(), AccountPlaceNumber(), HIDE_AFTER_MS, maskNumber(), RevealNumber(), isNumberKind() (+8 more)

### Community 43 - "helpers.ts"
Cohesion: 0.33
Nodes (7): BD_ADDIS, S_ADDIS, addAtt(), draft(), inst(), key(), ready()

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.05
Nodes (44): account_balance_history(), bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), account_balance_history(), account_week_status() (+36 more)

### Community 50 - "etb"
Cohesion: 0.09
Nodes (46): ROWS, Card(), PaymentLine(), TreasuryAccount(), ACCOUNTS, SCHEDULE, Treasury(), PositionBar() (+38 more)

### Community 52 - "weekly-treasury.test.ts"
Cohesion: 0.09
Nodes (35): attempt(), connect(), draft(), granted(), held(), must(), noStranded(), raced() (+27 more)

### Community 53 - "auth.ts"
Cohesion: 0.24
Nodes (23): adminResetTotp(), adminSetPassword(), adminUnlock(), assertAdmin(), changePassword(), disableTotp(), enableTotp(), endSession() (+15 more)

### Community 54 - "auth-actions.ts"
Cohesion: 0.22
Nodes (13): Password(), Security(), back(), changePasswordAction(), disableMfaAction(), enableMfaAction(), loginAction(), logoutAction() (+5 more)

### Community 55 - "actAs"
Cohesion: 0.19
Nodes (18): refusedAfter(), actAs(), authorized(), fails(), fn(), key(), mk(), S_HAWASSA (+10 more)

### Community 62 - "weekly-concurrency.test.ts"
Cohesion: 0.15
Nodes (17): BD_HAWASSA, addDetail(), asPerson(), balance(), state(), authenticated(), balance(), monday() (+9 more)

### Community 65 - "ops.test.ts"
Cohesion: 0.15
Nodes (11): b, c, [email, ...nameParts], name, temp, c, hashPassword(), ADMIN_URL (+3 more)

### Community 66 - "reports/page.tsx"
Cohesion: 0.18
Nodes (27): config, csp, Accounts(), Audit(), Cash(), Download(), FilterBar(), Outstanding() (+19 more)

### Community 68 - "crypto.ts"
Cohesion: 0.22
Nodes (16): startTotp(), base32(), blindIndex(), COMMON, decryptSecret(), encryptSecret(), key(), newTotpSecret() (+8 more)

### Community 69 - "requests/[id]/page.tsx"
Cohesion: 0.09
Nodes (35): Approvals(), COLUMNS, Fact(), ReviewPanel(), Card(), Fact(), INSTALLMENTS, RequestDetail() (+27 more)

### Community 72 - "phase1.test.ts"
Cohesion: 0.17
Nodes (10): BD_ETHIO, BERBERO_ID, enterFigure(), MkOpts, root, S_ETHIO_ID, bal(), req() (+2 more)

### Community 73 - "table.ts"
Cohesion: 0.23
Nodes (11): DataFilter, DataRow, DataTableProps, SearchableSelectProps, compare(), filterOptions(), SelectOption, sumRows() (+3 more)

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)`, `Migration runner (ops/migrate.mjs)`, `Local test copy setup` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 372 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `db.ts` to `ops.test.ts`, `phase1.test.ts`, `overview/page.tsx`, `phase1.test.ts`, `package.json`, `app/page.tsx`, `helpers.ts`, `Runtime Dependencies`, `account-numbers.test.ts`, `weekly-treasury.test.ts`, `auth.ts`, `shared-account-privacy.test.ts`, `actAs`, `weekly-concurrency.test.ts`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `admin/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.10707070707070707 - nodes in this community are weakly interconnected._
- **Why does `payment_requests` connect `Suppliers and Requests Schema` to `users`, `Workflow Schema and Adjustments`, `20261015000000_treasury/migration.sql`, `20261106000000_phase2_payees_accounts/migration.sql`, `20261107000000_phase3_weekly_treasury/migration.sql`, `20261012000000_foundation/migration.sql`, `wf_adjust`, `companies`, `20261105000100_phase1_money_logic/migration.sql`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Should `phase1.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07152496626180836 - nodes in this community are weakly interconnected._
- **Why does `next` connect `reports/page.tsx` to `admin/page.tsx`, `admin-actions.ts`, `overview/page.tsx`, `Payment Workflow Actions`, `requests/[id]/page.tsx`, `layout.tsx`, `package.json`, `app/page.tsx`, `Runtime Dependencies`, `etb`, `Button`, `auth-actions.ts`, `Badge`, `requireMe`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Should `Operations guide` be split into smaller, more focused modules?**
  _Cohesion score 0.054693877551020405 - nodes in this community are weakly interconnected._