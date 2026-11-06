# Graph Report - abig-finance-treasury  (2026-11-06)

## Corpus Check
- 156 files · ~120,606 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 6, .css 3, .example 2)

## Summary
- 1353 nodes · 4099 edges · 65 communities (47 shown, 18 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 64 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `49fbeb27`
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
- treasury/page.tsx
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
- actAs
- 20261107000000_phase3_weekly_treasury/migration.sql
- format.ts
- weekly-concurrency.test.ts
- helpers.ts
- requests/[id]/page.tsx
- requests/page.tsx
- approvals/page.tsx
- phase1.test.ts
- postcss.config.mjs
- rows
- payees.test.ts
- smtp-server
- tsx@^4.19.0
- @types/node@^22.0.0
- @types/react-dom@^19.0.0
- next.config.ts

## God Nodes (most connected - your core abstractions)
1. `payment_requests` - 92 edges
2. `withUser()` - 66 edges
3. `rows()` - 52 edges
4. `company_bank_accounts` - 52 edges
5. `etb()` - 51 edges
6. `users` - 49 edges
7. `currentUserId()` - 47 edges
8. `requireMe()` - 41 edges
9. `Button()` - 38 edges
10. `payment_installments` - 34 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `bal()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/phase1.test.ts → abig-finance/tests/helpers.ts
- `req()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/phase1.test.ts → abig-finance/tests/helpers.ts
- `shortfallEvents()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/phase1.test.ts → abig-finance/tests/helpers.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (65 total, 18 thin omitted)

### Community 0 - "format.ts"
Cohesion: 0.23
Nodes (17): GET(), money(), Reports(), cell(), toCsv(), addisDate(), addisIso(), amount2() (+9 more)

### Community 1 - "phase1.test.ts"
Cohesion: 0.16
Nodes (14): nodemailer@^10.1.1, compose(), Mail, makeSender(), OutboxEvent, Sender, SUBJECTS, tick() (+6 more)

### Community 2 - "Auth and Admin Actions"
Cohesion: 0.07
Nodes (78): Password(), Security(), addGroupGrant(), admin(), audit(), createCompany(), createRole(), createUser() (+70 more)

### Community 3 - "Documentation and Workflows"
Cohesion: 0.05
Nodes (43): Encryption key (APP_ENCRYPTION_KEY), ops/backup.sh, Docker Compose deployment, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Migration runner (ops/migrate.mjs) (+35 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.11
Nodes (54): act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine(), addSupplier(), adjustRequest(), createAndSubmitRequest() (+46 more)

### Community 5 - "users"
Cohesion: 0.10
Nodes (35): app_member_companies(), company_memberships, users, company_role_users(), app_can_snapshot(), app_member_companies(), app_permitted_companies(), assert_role_company_limit() (+27 more)

### Community 6 - "Button"
Cohesion: 0.14
Nodes (25): DemoConfirm(), COLUMNS, Gallery(), PAYMENTS, Section(), SWATCHES, Button(), buttonVariants (+17 more)

### Community 7 - "Suppliers and Requests Schema"
Cohesion: 0.07
Nodes (40): app_can_edit_draft(), app_can_see_request(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx (+32 more)

### Community 8 - "Workflow Schema and Adjustments"
Cohesion: 0.09
Nodes (28): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+20 more)

### Community 9 - "Dev Dependencies"
Cohesion: 0.10
Nodes (28): devDependencies, esbuild@^0.24.0, @fontsource-variable/figtree@^5.3.0, prisma@^6.0.0, tailwindcss@4.2.4, @tailwindcss/postcss@4.2.4, tw-animate-css@^1.4.0, @types/nodemailer@^8.0.2 (+20 more)

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
Cohesion: 0.18
Nodes (12): BD_ADDIS, BERBERO_ID, MkOpts, root, S_ADDIS, S_ETHIO, S_HAWASSA, addAtt() (+4 more)

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
Cohesion: 0.05
Nodes (64): switchUser(), DemoControls(), OPTIONS, AppShell(), ShellProps, Brand(), CompanySwitcher(), DevBanner() (+56 more)

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

### Community 24 - "treasury/page.tsx"
Cohesion: 0.11
Nodes (24): ACCOUNTS, SCHEDULE, Treasury(), PageHeader(), ACCESS_NOTE, AccessLevel, AccountFacts, AccountRow (+16 more)

### Community 25 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 26 - "20261016000000_scheduler/migration.sql"
Cohesion: 0.24
Nodes (10): cash_forecast_account_idx, cash_forecast_guard, cash_forecast_items, cash_forecast_no_delete, _forecast(), forecast_add(), forecast_cancel(), forecast_guard() (+2 more)

### Community 27 - "treasury.ts"
Cohesion: 0.32
Nodes (11): addReconciliationLine(), lockWeek(), matchPayment(), recordExecution(), recordFigure(), removeReconciliationLine(), returnReconciliation(), run() (+3 more)

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

### Community 35 - "session.ts"
Cohesion: 0.16
Nodes (34): Accounts(), Admin(), GET(), methodOptions, Payees(), EditRequest(), NewRequest(), Suppliers() (+26 more)

### Community 43 - "phase2-migration.test.ts"
Cohesion: 0.16
Nodes (7): c, dir, files, files(), before, ids, snapshot()

### Community 48 - "actAs"
Cohesion: 0.16
Nodes (20): actAs(), authorized(), fn(), key(), mk(), submitted(), before, ids (+12 more)

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.05
Nodes (43): bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), account_balance_history(), account_week_status(), balance_check_items (+35 more)

### Community 50 - "format.ts"
Cohesion: 0.16
Nodes (25): ROWS, Card(), PaymentLine(), TreasuryAccount(), PositionBar(), ShortfallChip(), BalanceCheckForm(), BalanceCheckFormProps (+17 more)

### Community 51 - "weekly-concurrency.test.ts"
Cohesion: 0.26
Nodes (13): asPerson(), authenticated(), balance(), monday(), newAccount(), once(), person(), prepared() (+5 more)

### Community 52 - "helpers.ts"
Cohesion: 0.16
Nodes (20): Tx, accountDetail(), ASKU, AWASH, BERBERO, CBE, fails(), setupDb() (+12 more)

### Community 53 - "requests/[id]/page.tsx"
Cohesion: 0.16
Nodes (20): Card(), Fact(), INSTALLMENTS, RequestDetail(), NewRequestForm(), newRow(), Step(), AdjustForm() (+12 more)

### Community 54 - "requests/page.tsx"
Cohesion: 0.36
Nodes (8): COLUMNS, Requests(), StatusBadge(), STATUS_SHORT, statusTone(), filterAccounts(), listRequests(), parseRequestFilters()

### Community 55 - "approvals/page.tsx"
Cohesion: 0.10
Nodes (29): Approvals(), COLUMNS, Fact(), ReviewPanel(), Reason(), ReviewActions(), ReviewTarget, ACTION_LABEL (+21 more)

### Community 56 - "phase1.test.ts"
Cohesion: 0.22
Nodes (7): BD_ETHIO, enterFigure(), S_ETHIO_ID, bal(), req(), setBalance(), shortfallEvents()

### Community 58 - "rows"
Cohesion: 0.16
Nodes (15): rows(), account(), before, ids, state(), version(), at(), balance() (+7 more)

### Community 59 - "payees.test.ts"
Cohesion: 0.29
Nodes (4): BD_HAWASSA, addDetail(), balance(), state()

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)`, `Migration runner (ops/migrate.mjs)`, `Local test copy setup` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 335 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `helpers.ts` to `format.ts`, `phase1.test.ts`, `Auth and Admin Actions`, `session.ts`, `Dev Dependencies`, `app/page.tsx`, `phase2-migration.test.ts`, `helpers.ts`, `Runtime Dependencies`, `actAs`, `weekly-concurrency.test.ts`, `pg`, `phase1.test.ts`, `rows`, `payees.test.ts`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Auth and Admin Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.06778868630201028 - nodes in this community are weakly interconnected._
- **Why does `rows()` connect `rows` to `phase1.test.ts`, `Auth and Admin Actions`, `app/page.tsx`, `phase2-migration.test.ts`, `helpers.ts`, `actAs`, `weekly-concurrency.test.ts`, `helpers.ts`, `pg`, `phase1.test.ts`, `payees.test.ts`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Should `Documentation and Workflows` be split into smaller, more focused modules?**
  _Cohesion score 0.054693877551020405 - nodes in this community are weakly interconnected._
- **Why does `next` connect `session.ts` to `format.ts`, `next.config.ts`, `Auth and Admin Actions`, `Payment Workflow Actions`, `Button`, `Dev Dependencies`, `app/page.tsx`, `Runtime Dependencies`, `format.ts`, `cn`, `requests/[id]/page.tsx`, `requests/page.tsx`, `approvals/page.tsx`, `treasury/page.tsx`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Should `Payment Workflow Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.10987726475745178 - nodes in this community are weakly interconnected._