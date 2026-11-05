# Testing guide: functionality, workflow and UI/UX

## Set up a test copy (about 10 minutes)
1. Install Node.js 20+ and PostgreSQL 14+. Unzip the project and run `npm install`.
2. Create an empty database called `abig`, then copy `.env.example` to `.env` and fill in the postgres password.
3. `npm run migrate` (builds all tables and gives the app roles their passwords).
4. `npm run db:seed` then `npm run db:demo` (demo companies, people and requests).
5. `npm run demo:passwords` (gives every demo person the password **demo-password-2026**).
6. Remove the `DEV_USER_ID` line from `.env` so the real sign-in screen is used, then `npm run dev` and open http://localhost:3000.

Finance roles are asked to set up two-step verification only in production mode. To see that too, use `npm run build` then `npm start` (it also needs `APP_ENCRYPTION_KEY`; see docs/OPERATIONS.md).

## The demo people (password: demo-password-2026)
| Person | Email | Company and role |
|---|---|---|
| Meron | meron@abig.test | ASKU, accountant |
| Lidya | lidya@abig.test | ASKU, accountant |
| Dawit | dawit@abig.test | ASKU, finance manager |
| Kebede | kebede@abig.test | ASKU, owner |
| Yared | yared@abig.test | ASKU, accountant + finance manager + owner (to test separation of duties) |
| Nardos / Fikru / Hana / Tigist | nardos@ / fikru@ / hana@ / tigist@abig.test | Berbero: accountant / finance manager / owner / accountant |
| Samuel | samuel@abig.test | BEES, accountant |
| Abebe | abebe@abig.test | BEES, owner + finance manager |
| Bereket | bereket@abig.test | Daily Mart, accountant |
| Selam | selam@abig.test | Group reporting (read-only) for ASKU and BEES |
| System admin | admin@abig.test | Administration (users, companies, roles) and full access |

Use a private window per person, or sign out between people. The accounts: ASKU Awash (owned by ASKU) and BEES CBE (owned by BEES, shared with ASKU for payments and with Berbero for payments and balance updates).

## Workflow scenarios (what you should see)
1. **The balance.** Meron: Bank accounts. Enter a new total for ASKU Awash: Current changes, Available follows (current minus reserved minus the minimum buffer), and "Balance history" shows the time, new and previous amount and her name. Try an amount below the Reserved figure: it is refused with a message to resolve pending requests first.
2. **The normal path.** Meron: New request (Hawassa Packaging, pay from ASKU Awash, one instalment, attach a PDF, "Save and submit"). The bank account now shows the amount as Reserved and Available is lower. Dawit: Approvals shows it under "Waiting for verification"; Verify. Kebede: Approvals shows it under "Waiting for authentication"; Authenticate. The account is debited: Current and Reserved both drop by the amount, Available is unchanged, and the balance history has a line "Payment PR-...".
3. **Not enough money.** Create a request for more than the account's Available figure and submit: it is saved as a draft with the message that the amount is more than the available balance. Nothing is reserved.
4. **Nobody approves their own work.** Sign in as Yared, create a request, and confirm he cannot verify or authenticate it. Have Yared verify Meron's request and confirm he is not offered Authenticate for the same one.
5. **Each role sees only its part.** Meron has no Approvals menu. Dawit can Verify but never Authenticate. Kebede can Authenticate but is not offered requests that have not been verified. Bereket (Daily Mart) sees none of ASKU's data. Selam can read requests, accounts and reports but cannot act. Only the administrator sees Administration.
6. **Return, reject, cancel.** As Dawit, return a request with a reason: it becomes a draft again and its funds are released. As Kebede, reject a verified request with a reason (final, funds released). A creator can cancel a request that is waiting; the funds are released.
7. **Changes during review.** As Dawit on a waiting request: Adjust the amount. If the account can cover it the reservation is resized; if not the change is refused as a whole.
8. **Shared account.** Compare BEES CBE as Samuel (owner company), Tigist (Berbero: can also enter its balance) and Lidya (ASKU: can pay from it, cannot enter its balance). Berbero's requests can pay from it; ASKU's own account is not available to Berbero.
9. **Reports.** Waiting for payment (with age buckets), payments made (date range), cash and commitments, audit trail. Download the CSV files.
10. **Administration.** As the administrator: Companies (edit name, TIN, phone), People and access (give a role in a company; try giving an Accountant a second company and read the refusal; give a Finance Manager several), Roles and permissions (set a role's company limit; notice that Accountants cannot be given approval permissions and nobody can be given user administration), add a person (a temporary password is shown once), reset a password, deactivate someone. Try five wrong passwords and see the account lock for 15 minutes.

## The weekly cycle (Weekly treasury in the menu)

1. As an Accountant, record the opening balance of an account. The dashboard stops listing it.
2. Authenticate a transfer and a cheque on it, then enter a balance check: the transfer is ticked, the cheque is not, and the log shows the bank figure, what is not yet processed, the system balance and the implied deposit.
3. Start the reconciliation from the account's page. Match the transfer, add a bank charge, give a reason for carrying the cheque, and send it for review.
4. As a Finance Manager of the company that owns the account, lock it. The transfer is Paid, the cheque is still Authenticated, and nothing in the week can change.
5. Record next week's opening: the cheque is listed as carried over. Match it in that week's reconciliation.

## Things to try to break
Enter a bank reference twice; submit a request whose installments do not add up; upload a text file renamed to .pdf; open another company's request by pasting its address while signed in as someone from a different company (you should get "not found"); use the browser's Back button after approving.

## UI and UX checklist
- Can a new person tell what to do next on each screen without help? Note every place you hesitated.
- Are the messages after each action clear? Are the error messages understandable to a finance person?
- Is anything shown that should not be, or missing that you need? (Especially on the Approvals page and request detail.)
- Phone-sized screen: does every table and form work? (Tables scroll sideways.)
- Dark mode (the moon/sun button) and keyboard use (Tab through a form; focus should always be visible).
- Wording: are the names for statuses and roles the ones your team uses?

## Reporting what you find
For each problem write: who you were signed in as, the page, what you did, what you expected, what happened (a screenshot helps). Money-related surprises first.
