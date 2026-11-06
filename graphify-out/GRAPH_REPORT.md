# Graph Report - abig-finance-treasury  (2026-11-06)

## Corpus Check
- 133 files · ~103,953 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 6, .css 3, .example 2)

## Summary
- 1194 nodes · 3317 edges · 58 communities (40 shown, 18 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 50 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f841e884`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Session and RBAC Pages
- phase1.test.ts
- Auth and Admin Actions
- Documentation and Workflows
- Payment Workflow Actions
- Foundation Schema and Guards
- Roles and Memberships
- Suppliers and Requests Schema
- Workflow Schema and Adjustments
- Dev Dependencies
- Payment Request Approvals
- 20261015000000_treasury/migration.sql
- 20261106000000_phase2_payees_accounts/migration.sql
- TypeScript Compiler Config
- helpers.ts
- NPM Scripts
- Runtime Dependencies
- Compose Database Service
- gallery/page.tsx
- Compose Migrate Service
- rows
- pg
- Request Reservation Guards
- Compose Service Topology
- @types/nodemailer@^8.0.2
- components.json
- 20261016000000_scheduler/migration.sql
- treasury.ts
- 20261020000000_production/migration.sql
- 20261105000100_phase1_money_logic/migration.sql
- Compose Proxy Service
- App Environment Variables
- Compose Volumes
- Compose Build Targets
- Worker Environment Variables
- Next.js Config and CSP
- Restore Drill Script
- Graphify Skill References
- Notifications Worker Doc
- Backup Script
- wf_adjust
- vitest
- ABIG Brand Logo
- Supplier Bank Versioning
- vitest
- 20261107000000_phase3_weekly_treasury/migration.sql
- theme.test.ts
- weekly-concurrency.test.ts
- companies
- esbuild@^0.24.0
- @fontsource-variable/figtree
- tsx@^4.19.0
- @types/smtp-server@^3.5.13
- postcss.config.mjs

## God Nodes (most connected - your core abstractions)
1. `payment_requests` - 90 edges
2. `withUser()` - 66 edges
3. `company_bank_accounts` - 52 edges
4. `currentUserId()` - 47 edges
5. `users` - 47 edges
6. `rows()` - 46 edges
7. `requireMe()` - 41 edges
8. `payment_installments` - 34 edges
9. `requireAccess()` - 30 edges
10. `etb()` - 30 edges

## Surprising Connections (you probably didn't know these)
- `graphify skill (root .claude)` --semantically_similar_to--> `graphify skill (abig-finance .claude)`  [INFERRED] [semantically similar]
  .claude/CLAUDE.md → abig-finance/.claude/CLAUDE.md
- `graphify knowledge graph rules (root)` --semantically_similar_to--> `graphify knowledge graph rules (abig-finance)`  [INFERRED] [semantically similar]
  CLAUDE.md → abig-finance/CLAUDE.md
- `asPerson()` --indirect_call--> `person()`  [INFERRED]
  abig-finance/tests/payees.test.ts → abig-finance/tests/weekly-concurrency.test.ts
- `dbl()` --indirect_call--> `translate()`  [INFERRED]
  abig-finance/src/app/actions.ts → abig-finance/src/lib/errors.ts
- `actions()` --calls--> `rows()`  [EXTRACTED]
  abig-finance/tests/phase3.test.ts → abig-finance/tests/helpers.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-step approval flow** — abig_finance_readme_role_accountant, abig_finance_readme_role_finance_manager, abig_finance_readme_role_owner, abig_finance_readme_funds_reservation, abig_finance_readme_authenticate_debit [EXTRACTED 1.00]
- **Treasury refactor migrations applied together** — abig_finance_docs_treasury_refactor_migration_treasury_refactor, abig_finance_docs_treasury_refactor_migration_bank_balance_updates, abig_finance_docs_treasury_refactor_migration_request_reservation, abig_finance_docs_treasury_refactor_migration_approvals, abig_finance_docs_treasury_refactor_migration_rbac_admin [EXTRACTED 1.00]
- **Database-level safeguards** — abig_finance_readme_database_enforced_rules, abig_finance_docs_operations_row_level_security, abig_finance_docs_operations_credentials_database_role, abig_finance_docs_operations_immutable_history_tables [INFERRED 0.85]

## Communities (58 total, 18 thin omitted)

### Community 0 - "Session and RBAC Pages"
Cohesion: 0.08
Nodes (90): Accounts(), Admin(), GET(), dynamic, Approvals(), accessLines(), dynamic, metadata (+82 more)

### Community 1 - "phase1.test.ts"
Cohesion: 0.09
Nodes (24): nodemailer@^10.1.1, compose(), Mail, makeSender(), OutboxEvent, Sender, SUBJECTS, tick() (+16 more)

### Community 2 - "Auth and Admin Actions"
Cohesion: 0.07
Nodes (78): Password(), Security(), addGroupGrant(), admin(), audit(), createCompany(), createRole(), createUser() (+70 more)

### Community 3 - "Documentation and Workflows"
Cohesion: 0.05
Nodes (43): Encryption key (APP_ENCRYPTION_KEY), ops/backup.sh, Docker Compose deployment, Go-live checklist, /api/health, Money integrity check (ops/verify-integrity.sql), Known limits, Migration runner (ops/migrate.mjs) (+35 more)

### Community 4 - "Payment Workflow Actions"
Cohesion: 0.09
Nodes (61): act(), addBankDetail(), addPerson(), addPersonDetail(), addReconciliationLine(), addSupplier(), adjustRequest(), createAndSubmitRequest() (+53 more)

### Community 5 - "Foundation Schema and Guards"
Cohesion: 0.07
Nodes (37): account_access_account_idx, account_access_guard(), account_access_guard_trg, account_access_no_delete, account_access_no_truncate, account_access_one_active, app_can_manage_access(), app_can_see_account() (+29 more)

### Community 6 - "Roles and Memberships"
Cohesion: 0.11
Nodes (32): app_member_companies(), company_memberships, users, company_role_users(), app_member_companies(), app_permitted_companies(), assert_role_company_limit(), company_role_users() (+24 more)

### Community 7 - "Suppliers and Requests Schema"
Cohesion: 0.10
Nodes (29): app_can_edit_draft(), app_can_see_request(), attachment_guard(), attachments, attachments_append_only, attachments_guard, attachments_no_truncate, attachments_request_idx (+21 more)

### Community 8 - "Workflow Schema and Adjustments"
Cohesion: 0.10
Nodes (22): adjustment_history, adjustment_history_append_only, adjustment_history_no_truncate, adjustment_history_request_idx, app_actionable_requests(), app_can_edit_draft(), approval_events, approval_events_append_only (+14 more)

### Community 9 - "Dev Dependencies"
Cohesion: 0.11
Nodes (26): devDependencies, prisma@^6.0.0, smtp-server@^3.19.22, tailwindcss@4.2.4, @tailwindcss/postcss@4.2.4, tw-animate-css@^1.4.0, @types/node@^22.0.0, @types/pg@^8.11.0 (+18 more)

### Community 10 - "Payment Request Approvals"
Cohesion: 0.17
Nodes (12): payment_requests, outbox_recipients(), wf_assert_actor(), wf_lock(), wf_submit(), outbox_recipients(), account_balance_history(), app_actionable_requests() (+4 more)

### Community 11 - "20261015000000_treasury/migration.sql"
Cohesion: 0.08
Nodes (43): installments_guard, payment_installments, suppliers, access_revoked_release(), account_access_release, app_can_see_funding(), cash_ledger_account_time_idx, cash_ledger_entries (+35 more)

### Community 12 - "20261106000000_phase2_payees_accounts/migration.sql"
Cohesion: 0.12
Nodes (20): app_person_active_for(), assert_method_fits_account(), company_bank_accounts_wallet_phone, payment_request_cash_processed(), payment_requests_cash_processed, payment_requests_person_invoice_once, payment_requests_person_payee_idx, person_detail_add() (+12 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "helpers.ts"
Cohesion: 0.15
Nodes (16): ASKU, BD_ADDIS, BERBERO, BERBERO_ID, fails(), MkOpts, root, S_ADDIS (+8 more)

### Community 15 - "NPM Scripts"
Cohesion: 0.14
Nodes (14): scripts, bootstrap:admin, build, build:worker, check:integrity, db:demo, db:seed, demo:passwords (+6 more)

### Community 16 - "Runtime Dependencies"
Cohesion: 0.11
Nodes (19): dependencies, clsx@^2.1.1, lucide-react@^1.69.0, next@^15.2.0, pg@^8.13.0, qrcode@^1.5.4, @radix-ui/react-dropdown-menu@^2.2.1, @radix-ui/react-slot@^1.5.0 (+11 more)

### Community 17 - "Compose Database Service"
Cohesion: 0.17
Nodes (12): environment, healthcheck, image, restart, volumes, POSTGRES_DB, POSTGRES_PASSWORD, interval (+4 more)

### Community 18 - "gallery/page.tsx"
Cohesion: 0.06
Nodes (70): class-variance-authority@^0.7.1, @radix-ui/react-dialog@^1.3.1, setCompany(), switchUser(), DemoConfirm(), COLUMNS, Gallery(), PAYMENTS (+62 more)

### Community 19 - "Compose Migrate Service"
Cohesion: 0.18
Nodes (11): condition, db, APP_DB_PASSWORD, AUTH_DB_PASSWORD, MIGRATION_DATABASE_URL, WORKER_DB_PASSWORD, command, depends_on (+3 more)

### Community 20 - "rows"
Cohesion: 0.13
Nodes (22): CBE, rows(), account(), before, ids, state(), version(), at() (+14 more)

### Community 21 - "pg"
Cohesion: 0.15
Nodes (11): b, c, [email, ...nameParts], name, temp, c, hashPassword(), ADMIN_URL (+3 more)

### Community 22 - "Request Reservation Guards"
Cohesion: 0.20
Nodes (6): app_can_edit_draft(), attachment_guard(), installment_guard(), payment_request_funds_guard(), payment_requests_funds_guard, wf_submit()

### Community 23 - "Compose Service Topology"
Cohesion: 0.22
Nodes (10): depends_on, restart, volumes, migrate, condition, services, app, worker (+2 more)

### Community 25 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 26 - "20261016000000_scheduler/migration.sql"
Cohesion: 0.18
Nodes (15): account_use_approvals, account_use_one_active, approvals_no_delete, assert_account_use(), owner_revoke_account_use(), cash_forecast_account_idx, cash_forecast_guard, cash_forecast_items (+7 more)

### Community 27 - "treasury.ts"
Cohesion: 0.32
Nodes (11): addReconciliationLine(), lockWeek(), matchPayment(), recordExecution(), recordFigure(), removeReconciliationLine(), returnReconciliation(), run() (+3 more)

### Community 28 - "20261020000000_production/migration.sql"
Cohesion: 0.25
Nodes (8): auth_events, auth_events_append_only, auth_events_no_truncate, auth_events_time_idx, sessions, sessions_user_idx, set_treasury_settings(), supplier_update()

### Community 29 - "20261105000100_phase1_money_logic/migration.sql"
Cohesion: 0.10
Nodes (14): wf_set_state(), banks, account_balance_history(), mark_authenticated_paid_at_go_live(), payment_request_funds_guard(), payment_requests_invoice_once, record_execution(), register_bank_account() (+6 more)

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

### Community 43 - "vitest"
Cohesion: 0.12
Nodes (10): c, dir, files, files(), BD_HAWASSA, addDetail(), addPerson(), asPerson() (+2 more)

### Community 48 - "vitest"
Cohesion: 0.14
Nodes (25): actAs(), authorized(), AWASH, fn(), key(), mk(), setupDb(), as() (+17 more)

### Community 49 - "20261107000000_phase3_weekly_treasury/migration.sql"
Cohesion: 0.06
Nodes (40): bank_balance_history, bank_balance_history_account_id_updated_at_idx, bank_balance_history_no_change, bank_balance_history_no_truncate, update_bank_balance(), account_balance_history(), account_week_status(), balance_check_items (+32 more)

### Community 50 - "theme.test.ts"
Cohesion: 0.28
Nodes (7): channel(), contrast(), css, luminance(), SHAPES, TEXT, themes

### Community 51 - "weekly-concurrency.test.ts"
Cohesion: 0.29
Nodes (12): authenticated(), balance(), monday(), newAccount(), once(), person(), prepared(), raced() (+4 more)

### Community 52 - "companies"
Cohesion: 0.33
Nodes (6): companies, app_supplier_active_for(), company_suppliers, company_directory(), app_permitted_companies(), company_directory()

## Knowledge Gaps
- **19 isolated node(s):** `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)`, `Migration runner (ops/migrate.mjs)`, `Local test copy setup` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 291 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pg` connect `phase1.test.ts` to `Session and RBAC Pages`, `Auth and Admin Actions`, `Dev Dependencies`, `vitest`, `helpers.ts`, `Runtime Dependencies`, `vitest`, `weekly-concurrency.test.ts`, `rows`, `pg`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **What connects `RFC-6238`, `/api/health`, `Money integrity check (ops/verify-integrity.sql)` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Session and RBAC Pages` be split into smaller, more focused modules?**
  _Cohesion score 0.07623617219778756 - nodes in this community are weakly interconnected._
- **Why does `next` connect `Session and RBAC Pages` to `Auth and Admin Actions`, `Next.js Config and CSP`, `Payment Workflow Actions`, `Dev Dependencies`, `Runtime Dependencies`, `gallery/page.tsx`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Should `phase1.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09247311827956989 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `vitest` to `Session and RBAC Pages`, `phase1.test.ts`, `Auth and Admin Actions`, `Dev Dependencies`, `vitest`, `helpers.ts`, `theme.test.ts`, `weekly-concurrency.test.ts`, `rows`, `pg`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Should `Auth and Admin Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.06825619448340346 - nodes in this community are weakly interconnected._