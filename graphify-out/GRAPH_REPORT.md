# Graph Report - abig-finance-treasury  (2026-11-06)

## Corpus Check
- 161 files · ~126,057 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 6, .css 3, .example 2)

## Summary
- 1398 nodes · 4364 edges · 64 communities (46 shown, 18 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 66 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0230d3bf`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- format.ts
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
- health/route.ts
- pg
- 20261012000000_foundation/migration.sql
- Compose Service Topology
- [account]/page.tsx
- components.json
- 20261016000000_scheduler/migration.sql
- reconciliation.ts
- companies
- 20261105000100_phase1_money_logic/migration.sql
- Compose Proxy Service
- App Environment Variables
- Compose Volumes
- Compose Build Targets
- Worker Environment Variables
- withUser
- Restore Drill Script
- Graphify Skill References
- Notifications Worker Doc
- Backup Script
- wf_adjust
- phase2-migration.test.ts
- ABIG Brand Logo
- Supplier Bank Versioning
- actAs
- 20261107000000_phase3_weekly_treasury/migration.sql
- overview/page.tsx
- weekly-concurrency.test.ts
- helpers.ts
- requests/[id]/page.tsx
- treasury.ts
- approvals/page.tsx
- @types/qrcode@^1.5.6
- postcss.config.mjs
- rows
- payees.test.ts
- tailwind-merge
- esbuild@^0.24.0
- prisma@^6.0.0
- next.config.ts

## God Nodes (most connected - your core abstractions)
1. `payment_requests` - 92 edges
2. `withUser()` - 68 edges
3. `etb()` - 59 edges
4. `rows()` - 53 edges
5. `company_bank_accounts` - 52 edges
6. `Button()` - 49 edges
7. `currentUserId()` - 49 edges
8. `users` - 49 edges
9. `requireMe()` - 43 edges
10. `Badge()` - 36 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `dbl()` --indirect_call--> `translate()`  [INFERRED]
  abig-finance/src/app/actions.ts → abig-finance/src/lib/errors.ts
- `Password()` --calls--> `getSession()`  [EXTRACTED]
  abig-finance/src/app/account/password/page.tsx → abig-finance/src/lib/session.ts
- `log()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/shared-account-privacy.test.ts → abig-finance/tests/helpers.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (64 total, 18 thin omitted)

### Community 0 - "format.ts"
Cohesion: 0.20
Nodes (19): GET(), money(), Reports(), cell(), toCsv(), ACCOUNT_KINDS, addisDate(), addisIso() (+11 more)

### Community 1 - "phase1.test.ts"
Cohesion: 0.10
Nodes (22): nodemailer@^10.1.1, compose(), Mail, makeSender(), OutboxEvent, Sender, SUBJECTS, tick() (+14 more)

### Community 2 - "Auth and Admin Actions"
Cohesion: 0.07
Nodes (74): Password(), addGroupGrant(), admin(), audit(), createCompany(), createRole(), createUser(), done() (+66 more)

### Community 3 - "Documentation and Workflows"
Cohesion: 0.05
Nodes (43): Encryption key (APP_ENCRYPTION_KEY), ops/backup.sh, Docker Compose deployment, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Migration runner (ops/migrate.mjs) (+35 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.10
Nodes (57): act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine(), addSupplier(), adjustRequest(), createAndSubmitRequest() (+49 more)

### Community 5 - "users"
Cohesion: 0.10
Nodes (35): app_member_companies(), company_memberships, users, company_role_users(), app_can_snapshot(), app_member_companies(), app_permitted_companies(), assert_role_company_limit() (+27 more)

### Community 6 - "Button"
Cohesion: 0.12
Nodes (39): DemoConfirm(), NewRequestForm(), newRow(), Step(), LIMITED, Reconciliation(), AdjustForm(), AdjustFormProps (+31 more)

### Community 7 - "Suppliers and Requests Schema"
Cohesion: 0.07
Nodes (40): app_can_edit_draft(), app_can_see_request(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx (+32 more)

### Community 8 - "Workflow Schema and Adjustments"
Cohesion: 0.09
Nodes (28): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+20 more)

### Community 9 - "Dev Dependencies"
Cohesion: 0.09
Nodes (30): devDependencies, @fontsource-variable/figtree@^5.3.0, smtp-server@^3.19.22, tailwindcss@4.2.4, @tailwindcss/postcss@4.2.4, tsx@^4.19.0, tw-animate-css@^1.4.0, @types/node@^22.0.0 (+22 more)

### Community 10 - "app/page.tsx"
Cohesion: 0.09
Nodes (45): setCompany(), accessLines(), dynamic, metadata, RootLayout(), Dashboard(), Panel(), QUEUE_COLUMNS (+37 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.07
Nodes (52): app_can_manage_access(), app_can_see_account(), app_can_snapshot(), company_bank_accounts, installments_guard, payment_installments, access_revoked_release(), account_access_release (+44 more)

### Community 12 - "20261106000000_phase2_payees_accounts/migration.sql"
Cohesion: 0.13
Nodes (18): app_person_active_for(), assert_submittable(), payment_request_cash_processed(), payment_requests_cash_processed, payment_requests_person_invoice_once, payment_requests_person_payee_idx, person_detail_add(), person_detail_decide() (+10 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "helpers.ts"
Cohesion: 0.13
Nodes (17): BD_ADDIS, BD_HAWASSA, BERBERO_ID, fails(), key(), MkOpts, root, S_ADDIS (+9 more)

### Community 15 - "NPM Scripts"
Cohesion: 0.14
Nodes (14): scripts, bootstrap:admin, build, build:worker, check:integrity, db:demo, db:seed, demo:passwords (+6 more)

### Community 16 - "Runtime Dependencies"
Cohesion: 0.10
Nodes (21): dependencies, class-variance-authority@^0.7.1, clsx@^2.1.1, lucide-react@^1.69.0, next@^15.2.0, pg@^8.13.0, qrcode@^1.5.4, @radix-ui/react-dialog@^1.3.1 (+13 more)

### Community 17 - "Compose Database Service"
Cohesion: 0.17
Nodes (12): environment, healthcheck, image, restart, volumes, POSTGRES_DB, POSTGRES_PASSWORD, interval (+4 more)

### Community 18 - "cn"
Cohesion: 0.06
Nodes (57): switchUser(), logoutAction(), DemoControls(), OPTIONS, AppShell(), ShellProps, Brand(), CompanySwitcher() (+49 more)

### Community 19 - "Compose Migrate Service"
Cohesion: 0.18
Nodes (11): condition, db, APP_DB_PASSWORD, AUTH_DB_PASSWORD, MIGRATION_DATABASE_URL, WORKER_DB_PASSWORD, command, depends_on (+3 more)

### Community 21 - "pg"
Cohesion: 0.15
Nodes (11): b, c, [email, ...nameParts], name, temp, c, hashPassword(), ADMIN_URL (+3 more)

### Community 22 - "20261012000000_foundation/migration.sql"
Cohesion: 0.10
Nodes (26): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_granted_companies(), app_group_companies() (+18 more)

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 24 - "[account]/page.tsx"
Cohesion: 0.13
Nodes (33): COLUMNS, Gallery(), PAYMENTS, Section(), SWATCHES, Card(), PaymentLine(), TreasuryAccount() (+25 more)

### Community 25 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 26 - "20261016000000_scheduler/migration.sql"
Cohesion: 0.24
Nodes (10): cash_forecast_account_idx, cash_forecast_guard, cash_forecast_items, cash_forecast_no_delete, _forecast(), forecast_add(), forecast_cancel(), forecast_guard() (+2 more)

### Community 27 - "reconciliation.ts"
Cohesion: 0.08
Nodes (37): Tx, addDays(), byOwner(), defaultStatementDate(), mondayOf(), overviewWeeks(), partialFigures(), paymentColumns() (+29 more)

### Community 28 - "companies"
Cohesion: 0.15
Nodes (20): companies, app_supplier_active_for(), company_suppliers, suppliers, treasury_schedule_queue(), admin_create_company(), auth_events, auth_events_append_only (+12 more)

### Community 29 - "20261105000100_phase1_money_logic/migration.sql"
Cohesion: 0.08
Nodes (16): wf_set_state(), banks, register_bank_account(), account_balance_history(), mark_authenticated_paid_at_go_live(), outbox_recipients(), payment_request_funds_guard(), payment_requests_invoice_once (+8 more)

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

### Community 35 - "withUser"
Cohesion: 0.15
Nodes (39): Security(), Accounts(), Admin(), GET(), methodOptions, Payees(), EditRequest(), NewRequest() (+31 more)

### Community 43 - "phase2-migration.test.ts"
Cohesion: 0.13
Nodes (6): c, dir, files, files(), log(), numbers

### Community 48 - "actAs"
Cohesion: 0.28
Nodes (13): actAs(), authorized(), fn(), mk(), submitted(), before, ids, snapshot() (+5 more)

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.05
Nodes (43): bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), account_balance_history(), account_week_status(), balance_check_items (+35 more)

### Community 50 - "overview/page.tsx"
Cohesion: 0.16
Nodes (17): cells(), COLUMNS, Partial(), BalanceLogEntry, COLUMNS, DataColumn, DataFilter, DataRow (+9 more)

### Community 51 - "weekly-concurrency.test.ts"
Cohesion: 0.26
Nodes (13): asPerson(), authenticated(), balance(), monday(), newAccount(), once(), person(), prepared() (+5 more)

### Community 52 - "helpers.ts"
Cohesion: 0.16
Nodes (18): compare(), TableQuery, tableView(), accountDetail(), AWASH, BERBERO, CBE, S_ETHIO_ID (+10 more)

### Community 53 - "requests/[id]/page.tsx"
Cohesion: 0.26
Nodes (13): Card(), Fact(), INSTALLMENTS, RequestDetail(), Timeline(), accountPlace(), dtime(), maskId() (+5 more)

### Community 54 - "treasury.ts"
Cohesion: 0.32
Nodes (11): addReconciliationLine(), lockWeek(), matchPayment(), recordExecution(), recordFigure(), removeReconciliationLine(), returnReconciliation(), run() (+3 more)

### Community 55 - "approvals/page.tsx"
Cohesion: 0.11
Nodes (29): Approvals(), COLUMNS, Fact(), ReviewPanel(), ROWS, PositionBar(), Reason(), ReviewActions() (+21 more)

### Community 58 - "rows"
Cohesion: 0.13
Nodes (22): rows(), account(), before, ids, state(), version(), bal(), state() (+14 more)

### Community 59 - "payees.test.ts"
Cohesion: 0.33
Nodes (3): addDetail(), balance(), state()

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)`, `Migration runner (ops/migrate.mjs)`, `Local test copy setup` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 340 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `phase1.test.ts` to `format.ts`, `Auth and Admin Actions`, `withUser`, `reconciliation.ts`, `Dev Dependencies`, `app/page.tsx`, `phase2-migration.test.ts`, `helpers.ts`, `Runtime Dependencies`, `actAs`, `weekly-concurrency.test.ts`, `helpers.ts`, `pg`, `rows`, `payees.test.ts`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `phase1.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10344827586206896 - nodes in this community are weakly interconnected._
- **Why does `next` connect `withUser` to `format.ts`, `next.config.ts`, `Auth and Admin Actions`, `Payment Workflow Actions`, `Button`, `Dev Dependencies`, `app/page.tsx`, `Runtime Dependencies`, `overview/page.tsx`, `cn`, `requests/[id]/page.tsx`, `approvals/page.tsx`, `[account]/page.tsx`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Should `Auth and Admin Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.07150153217568948 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `helpers.ts` to `format.ts`, `phase1.test.ts`, `Auth and Admin Actions`, `reconciliation.ts`, `Dev Dependencies`, `app/page.tsx`, `phase2-migration.test.ts`, `helpers.ts`, `actAs`, `cn`, `weekly-concurrency.test.ts`, `pg`, `rows`, `payees.test.ts`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Should `Documentation and Workflows` be split into smaller, more focused modules?**
  _Cohesion score 0.054693877551020405 - nodes in this community are weakly interconnected._