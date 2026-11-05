# ABIG Finance

Corporate treasury and payment approval for the ABIG group of companies: shared bank accounts with live balances, payment
requests that lock the money when they are submitted, and a strict three-step approval (Accountant, Finance Manager, Owner)
that pays by debiting the account. Next.js + TypeScript on PostgreSQL. The rules that protect money live in the database,
so the screens, the API and any future tool all obey them.

## Run it
See `docs/TEST-GUIDE.md` for a step-by-step local setup with demo data, and `docs/OPERATIONS.md` for deployment, backups and upgrades.
Short version: `npm install`, set `.env` (see `.env.example`), `npm run migrate`, `npm run db:seed`, `npm run db:demo`, `npm run demo:passwords`, `npm run dev`. `npm test` runs the database and unit tests (needs a superuser connection in TEST_ADMIN_URL).

## The screens
Dashboard (consolidated current, reserved and available balances), Payment requests (list, new, detail with history), Approvals, Accounts (bank, Telebirr wallet, cash), Suppliers, People, Reports, Administration. A person sees only what their roles allow (`src/lib/rbac.ts`); the database enforces the same rules even if a form is forged.

## The workflow
1. **Accountant** updates the overall balance of a bank account (one amount, no transaction entry; every update is logged with time, new amount, previous amount and who) and creates a payment request: company, supplier, **debit bank account**, up to four instalments.
2. **Submit** checks the total against the account's **available balance** and moves it into **reserved**, under a lock, so the same money can never be committed twice. The request is `RESERVED`.
3. **Finance Manager** sees requests waiting for verification and verifies them (`VERIFIED`). Finance Managers cannot authenticate.
4. **Owner** sees verified requests and authenticates. In that one step the account is debited (`currentBalance` down by the amount), the lock is released (`reservedBalance` down by the same amount) and the request is `AUTHENTICATED`, which means paid. The debit appears in the account's balance history with the payment number.
5. Cancel, return (back to a draft) and reject release the reserved funds at once.

`currentBalance` is what the Accountant typed in; `availableBalance` is always `currentBalance - reservedBalance - minBuffer` (a generated column), so the minimum buffer cannot be committed. A bank figure below the reserved amount is accepted and is a **shortfall**: the account shows it in red, the Finance Managers of every linked company are emailed, and the account takes no new or larger reservations until it is cleared. Requests already holding funds can still be verified, authenticated (if the balance covers them), returned, reduced or cancelled.

A request pays one supplier or one person. A person belongs to one company, with a unique phone and ID number there; the ID number is encrypted with `APP_ENCRYPTION_KEY`, masked in lists, and shown in full only on the request page to roles holding `payee:view_identity`, with each view logged. A second person must verify every change to a person's bank or Telebirr details. Cash is paid from cash accounts, Telebirr from wallets, and cheques and transfers from bank accounts. Invoice documents are optional; approvers see a "No document" badge.

Authenticated means debited, not paid: a payment becomes `PAID` only through reconciliation (Phase 3) and is then final. Cancelled requests are `CANCELLED`; only an Owner's refusal is `REJECTED`. Times are shown in Africa/Addis_Ababa and amounts as ETB 1,250.00.

## Roles
| Role | Companies | Can do |
|---|---|---|
| Accountant | exactly one | balances, requests, suppliers, recurring payments. Never verifies, authenticates or administers users |
| Finance Manager | one or several (set on the role) | verifies; sees accounts and reports. Never authenticates or manages users |
| Owner | several | all modules except user administration; authenticates (final approval); manages bank accounts |
| Administrator | all | everything, including user administration and approvals. Separation of duties still applies to administrators |

Roles, their permissions and each role's company limit are edited in Administration. Nobody can be given user or company administration through a role, an Accountant can never be given approval permissions, and the Accountant's one-company limit cannot be changed; the database refuses these. Group reporting is a separate read-only grant per company.

## Rules built in
**Separation of duties.** The creator, the verifier and the authenticator of a request must be three different people, even for someone holding several roles. Every action carries the version the person saw; stale versions are refused. Return, reject and cancel need reasons. History is append-only.
**Suppliers.** One group-wide list (unique TIN). Each company links a supplier with its own status and terms. Every change to bank details is a new version, verified by someone other than the person who entered it. The app never reads full account numbers.
**Requests.** Drafts are private to their creator. Submission needs instalments that add up, an invoice file, verified bank details, an active supplier and a debit account the company is linked to. The same supplier invoice cannot be in play twice. After submission nothing can be edited except through the workflow; an approver's change to the amount or payee restarts verification and resizes the reservation (refused if the account cannot cover it).
**Shared accounts.** A bank account can belong to many companies (a junction table; one row marks the owner). Companies linked with the "use" right can pay from it; companies linked with the "update balance" right can enter its balance.
**Companies.** Name, TIN and phone are mandatory; the TIN is unique.
**Notifications.** Written with each action in the same transaction; a worker resolves recipients at send time, retries with backoff and gives up after 8 attempts. It also sends a daily reminder for requests that are past their due date and still waiting for approval.

## Policy decisions that need sign-off before go-live
ETB only; the TIN format check (loose until Finance confirms); whether Owners should also be able to enter balances (today they cannot); that Administrators can approve (as requested, with separation of duties kept and their approvals logged as ADMIN); that cancelling is recorded as Rejected (there is no separate cancelled status); the `Scheduled` status exists but is not used yet; no automatic intercompany accounting entries.

## What was verified, and what was not
- **Run and passing:** 250 automated tests (last run on PostgreSQL 18, against a separate throw-away server): database rules (reservation, debit, available balance, shortfall, minimum buffer, status rules, separation of duties, role limits, shared accounts, administration), two people acting at the same moment, the money integrity checks including deliberate tampering, access rules per role, email delivery, the migration runner, password and one-time-code code. The app type-checks and builds.
- **Pages exercised over HTTP** (development mode, as each role: Accountant, Finance Manager, Owner, Administrator, group reporting, an unrelated company): every page and CSV download loaded, people without access were redirected with a reason, and the figures matched the database.
- **Not verified:** form submissions through a browser (the server actions behind the buttons compile and their database calls are tested, but were not clicked), how the screens look and feel in a real browser, production-mode sign-in with two-step verification after these changes (that code was not changed), the Docker files, behaviour under load, email against a real provider.
- **Not built:** bank connection and automatic reconciliation, account-number encryption (only the last four digits are kept), malware scanning of uploads, in-app notifications (email only), single sign-on, scheduled and recurring payments (the status and permissions exist), reversing an authenticated payment.
- **Left in the database, unused:** the previous treasury engine's tables and functions (per-instalment reservations, payment ledger, forecasts, snapshots, owner approvals). A later migration can remove them once you are sure no history is needed.

## Sign-in
Built in: email and password, optional-then-required two-step verification, sessions, lockout, administrator-managed accounts. In production the encryption key `APP_ENCRYPTION_KEY` is required. If you prefer single sign-on with Microsoft or Google later, replace `src/lib/session.ts` (the one place that decides who is signed in).
