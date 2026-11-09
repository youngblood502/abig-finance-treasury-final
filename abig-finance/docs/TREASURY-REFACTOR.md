# Corporate treasury refactor: what changed and why

Source: the "ABIG Corporate Treasury Requirement" document and the instructions given step by step. Five migrations were added
after `20261020000000_production`; they are meant to be applied together (the first leaves the old workflow functions broken
until the following ones replace them).

| Migration | What it does |
|---|---|
| `20261027000000_treasury_refactor` | Companies get mandatory name, TIN (unique) and phone (existing companies receive random placeholders, to be replaced). New `banks` table; a bank account can belong to many companies (junction `company_bank_account_access`, owner = `is_owner` row). Bank accounts get `current_balance`, `reserved_balance` and a generated `available_balance`. Payment requests get a status enum (DRAFT, SCHEDULED, RESERVED, VERIFIED, AUTHENTICATED, REJECTED), `debit_account_id`, verifier and authenticator. RBAC tables: roles, permissions, role_permissions, membership_roles; the Accountant's one-company limit. Old data is mapped: SUBMITTED to RESERVED, AUTHORIZED to AUTHENTICATED, RETURNED to DRAFT, CANCELLED to REJECTED; INPUTTER/TREASURY to Accountant, VERIFIER/FINANCE_MANAGER to Finance Manager, AUTHENTICATOR/ACCOUNT_OWNER to Owner. |
| `20261028000000_bank_balance_updates` | `update_bank_balance()` (retired in treasury Phase 3 for `record_opening_balance()` and `record_balance_check()`) and the append-only `bank_balance_history`. |
| `20261029000000_request_reservation` | The funds guard: submitting checks the total against the available balance and reserves it under a lock; the lock follows the request and is released by cancel, return, reject or authenticate. New submit and cancel functions. |
| `20261030000000_approvals` | Verify (Finance Manager), authenticate (Owner), return and reject; authenticating debits the account, releases the lock and writes a history row. Permission-based checks, separation of duties, the approval queues, adjust during review. |
| `20261031000000_rbac_admin` | Administrators act in every company; permissions no role may hold; company edit; the Accountant limit cannot be configured away; supplier correction and the background reminders on the new flow. |

Application: `src/lib/rbac.ts` (access rules), `src/lib/session.ts` (roles and permissions per company), `src/lib/auth.ts` (credential
functions re-check the caller is an administrator), pages for Dashboard, Payment requests, Approvals, Bank accounts, Suppliers,
Reports and Administration, and `src/lib/reports.ts`. The old Treasury schedule screen was removed.

Replaced rather than migrated: the previous treasury engine (per-instalment reservations, payment ledger, forecasts, snapshots, owner approvals) is
no longer used by the application. Its tables and functions are still in the database; remove them in a later migration when ready.
