"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withUser, type Tx } from "@/lib/db";
import { saveAttachment } from "@/lib/attachments";
import { message, translate, WorkflowError } from "@/lib/errors";
import { currentUserId, requireMe } from "@/lib/session";
import { assertCan } from "@/lib/rbac";
import * as t from "@/lib/treasury";
import { ALL_COMPANIES } from "@/lib/company";
import { COMPANY_COOKIE, myCompanies } from "@/lib/company-scope";
import { statementReturnPath } from "@/lib/reconciliation";
import { canChangeSupplierStatus } from "@/lib/payee-screens";
import { PERSON_DETAIL_FOR_METHOD, protectIdNumber } from "@/lib/payees";
import { protectAccountNumber } from "@/lib/account-numbers";
import { runWorkflow, type WorkflowAction } from "@/lib/workflow";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => { const v = Number(str(f, k)); if (!Number.isFinite(v)) throw new WorkflowError(400, "Please check the numbers you entered."); return v; };
const dbl = async <T,>(p: Promise<T>) => p.catch(translate);

/** Runs the action, then returns to `back` with a success or error message. */
async function act(back: string, ok: string, fn: (uid: string) => Promise<unknown>): Promise<never> {
  let err: string | null = null;
  try { await fn(await currentUserId()); } catch (e) { err = message(e); }
  revalidatePath("/", "layout");
  redirect(`${back}${back.includes("?") ? "&" : "?"}${err ? "err=" + encodeURIComponent(err) : "msg=" + encodeURIComponent(ok)}`);
}

/** Wraps an action so the person's role is checked first (the database checks again; this gives a clear message and stops early). */
const guard = (perms: string[], fn: (uid: string) => Promise<unknown>) => async (uid: string) => { assertCan(await requireMe(), ...perms); return fn(uid); };
/** What each workflow step needs. Verify and authenticate are different permissions held by different roles. */
const WORKFLOW_PERMS: Record<WorkflowAction, string[]> = {
  submit: ["payment_request:create"], cancel: ["payment_request:create"],
  verify: ["payment_request:verify"], authorize: ["payment_request:authenticate"],
  return: ["payment_request:verify", "payment_request:authenticate"], reject: ["payment_request:authenticate"],
  adjust: ["payment_request:verify", "payment_request:authenticate"],
};

export async function switchUser(f: FormData) {
  if (process.env.NODE_ENV === "production") return;
  (await cookies()).set("abig_dev_user", str(f, "user"), { httpOnly: true, sameSite: "lax", path: "/" });
  (await cookies()).delete("abig_session");
  redirect("/");
}

/** Chooses the company the lists follow. Only the person's own companies are accepted; everything else leaves the choice as it was. */
export async function setCompany(f: FormData) {
  const uid = await currentUserId(), value = str(f, "company"), jar = await cookies();
  if (value === ALL_COMPANIES) jar.delete(COMPANY_COOKIE);
  else if ((await myCompanies(uid)).some((c) => c.id === value)) jar.set(COMPANY_COOKIE, value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  else redirect(`/?err=${encodeURIComponent("You do not have access to that company.")}`);
  revalidatePath("/", "layout");
}

// ---------- Payment requests ----------
/** Submits a saved draft. If the submission is refused (not enough available balance, for example) the draft is kept. */
async function submitSaved(uid: string, id: string): Promise<string | null> {
  try { await dbl(withUser(uid, (tx) => tx.q("SELECT wf_submit($1)", [id]))); return null; } catch (e) { return message(e); }
}
const SUBMITTED_MSG = "Request submitted. The amount is now reserved on the debit account.";
const notSubmittedMsg = (why: string) => `Saved as a draft, but not submitted. ${why}`;

/** The verified details a request will pay to. Empty until they exist; submitting then explains what is missing. */
const supplierDetail = async (tx: Tx, supplierId: string) => (await tx.q<{ id: string }>("SELECT id FROM supplier_bank_details WHERE supplier_id = $1 AND status = 'VERIFIED'", [supplierId]))[0]?.id ?? null;
const personDetail = async (tx: Tx, personId: string, method: string) => {
  const kind = PERSON_DETAIL_FOR_METHOD[method];
  return kind ? (await tx.q<{ id: string }>("SELECT id FROM person_payment_details WHERE person_id = $1 AND kind = $2 AND status = 'VERIFIED'", [personId, kind]))[0]?.id ?? null : null;
};

// Saving and submitting are separate actions, one per button: once React has loaded, a form post does not say which button was pressed.
export async function createRequest(f: FormData) { return saveNewRequest(f, false); }
export async function createAndSubmitRequest(f: FormData) { return saveNewRequest(f, true); }
async function saveNewRequest(f: FormData, submit: boolean) {
  const uid = await currentUserId();
  let id: string | null = null; let err: string | null = null; let notSubmitted: string | null = null;
  try {
    assertCan(await requireMe(), "payment_request:create");
    const [companyId, payeeType, payeeId] = str(f, "target").split("|");
    const person = payeeType === "PERSON", method = str(f, "payment_method") || "TRANSFER";
    const dues = f.getAll("due").map(String), amts = f.getAll("amt").map(String);
    const inst = dues.map((d, i) => ({ d, a: Number(amts[i]) })).filter((x) => x.d && x.a > 0);
    const total = inst.reduce((s, x) => s + x.a, 0);
    const file = f.get("invoice");
    id = await dbl(withUser(uid, async (tx) => {
      const details = person ? await personDetail(tx, payeeId, method) : await supplierDetail(tx, payeeId);
      const rid = (await tx.q<{ id: string }>(
        `INSERT INTO payment_requests (debtor_company_id, payee_type, supplier_id, person_payee_id, supplier_bank_detail_id, person_payment_detail_id, debit_account_id, created_by, invoice_ref, invoice_date, description, priority, total_amount, payment_method)
         VALUES ($1,$2::payee_type,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12,$13,$14::payment_method) RETURNING id`,
        [companyId, person ? "PERSON" : "SUPPLIER", person ? null : payeeId, person ? payeeId : null, person ? null : details, person ? details : null, str(f, "account") || null, uid, str(f, "invoice_ref") || null, str(f, "invoice_date") || null, str(f, "description") || null, str(f, "priority") || "NORMAL", total || 0, method]))[0].id;
      for (const [i, x] of inst.entries()) await tx.q("INSERT INTO payment_installments (request_id, seq, due_date, amount) VALUES ($1,$2,$3::date,$4)", [rid, i + 1, x.d, x.a]);
      if (file instanceof File && file.size > 0) await saveAttachment(tx, uid, rid, file, "INVOICE");
      return rid;
    }));
    // Saved first, submitted second: a refusal (for example, not enough available balance) must not throw the draft away.
    if (submit && id) notSubmitted = await submitSaved(uid, id);
  } catch (e) { err = message(e); }
  revalidatePath("/", "layout");
  if (err || !id) redirect(`/requests/new?err=${encodeURIComponent(err ?? "Something went wrong.")}`);
  if (notSubmitted) redirect(`/requests/${id}?err=${encodeURIComponent(notSubmittedMsg(notSubmitted))}`);
  redirect(`/requests/${id}?msg=${encodeURIComponent(submit ? SUBMITTED_MSG : "Draft saved.")}`);
}

export async function workflowAction(f: FormData) {
  const id = str(f, "id"), action = str(f, "action") as WorkflowAction;
  const labels: Record<string, string> = { submit: "Submitted. The amount is now reserved on the debit account.", verify: "Verified. It now waits for an Owner to authenticate it.", authorize: "Authenticated. The amount was debited from the bank account and the reserved funds were released.", return: "Returned to its creator. The reserved funds were released.", reject: "Rejected. The reserved funds were released.", cancel: "Cancelled. The reserved funds were released." };
  // Actions taken from the Approvals queue go back to the queue; from a request page they stay on the request.
  return act(f.get("back") === "approvals" ? "/approvals" : `/requests/${id}`, labels[action] ?? "Done.", guard(WORKFLOW_PERMS[action] ?? ["payment_request:view"], (uid) => runWorkflow(uid, id, action, { version: Number(str(f, "version")), reason: str(f, "reason") })));
}

export async function adjustRequest(f: FormData) {
  const id = str(f, "id");
  return act(`/requests/${id}`, "Adjustment saved. Anything that needs a new review has been sent back.", guard(["payment_request:verify", "payment_request:authenticate"], (uid) => {
    const changes: Record<string, unknown> = {};
    for (const k of ["priority", "invoice_ref", "description"]) if (str(f, k) !== str(f, "orig_" + k)) changes[k] = str(f, k);
    if (num(f, "total_amount") !== num(f, "orig_total_amount")) changes.total_amount = num(f, "total_amount");
    const seqs = f.getAll("seq").map(String), amts = f.getAll("i_amount").map(String), dues = f.getAll("i_due").map(String), oa = f.getAll("o_amount").map(String), od = f.getAll("o_due").map(String);
    const insts = seqs.flatMap((s, i) => { const c: Record<string, unknown> = { seq: Number(s) }; if (Number(amts[i]) !== Number(oa[i])) c.amount = Number(amts[i]); if (dues[i] !== od[i]) c.due_date = dues[i]; return Object.keys(c).length > 1 ? [c] : []; });
    if (insts.length) changes.installments = insts;
    return runWorkflow(uid, id, "adjust", { version: Number(str(f, "version")), reason: str(f, "reason"), changes });
  }));
}

// ---------- Treasury ----------
// ---------- Accounts ----------
export async function setDepositAlert(f: FormData) {
  return act("/accounts", "Account policy saved.", guard(["bank_account:manage"], (uid) => dbl(withUser(uid, (tx) => tx.q("SELECT set_large_deposit_threshold($1,$2)", [str(f, "account"), num(f, "threshold")])))));
}

// ---------- Weekly treasury ----------
const ids = (f: FormData, k: string) => f.getAll(k).map(String);
export async function recordFigure(f: FormData) {
  const accountId = str(f, "account"), opening = str(f, "opening") === "1";
  return act(`/treasury/${accountId}`, opening ? "Opening balance recorded." : "Balance check recorded.", guard(["bank_balance:update"], (uid) =>
    t.recordFigure(uid, { accountId, figure: num(f, "figure"), processed: ids(f, "processed"), shown: ids(f, "shown"), opening })));
}
export async function undoTick(f: FormData) {
  return act(`/treasury/${str(f, "account")}`, "Tick undone. The next balance check will ask about this payment again.", guard(["bank_balance:update"], (uid) => t.undoProcessedTick(uid, { requestId: str(f, "id"), reason: str(f, "reason") })));
}
export async function startReconciliation(f: FormData) {
  const accountId = str(f, "account");
  return act(statementReturnPath(accountId, str(f, "return_week")), "Statement figures saved.", guard(["reconciliation:prepare"], (uid) => t.startReconciliation(uid, { accountId, week: str(f, "week"), closing: num(f, "closing"), deposits: num(f, "deposits") })));
}
const week = (f: FormData) => `/treasury/week/${str(f, "week")}`;
export async function matchPayment(f: FormData) {
  return act(week(f), "Payment matched. It becomes Paid when the week is locked.", guard(["reconciliation:prepare"], (uid) => t.matchPayment(uid, { week: str(f, "week"), requestId: str(f, "id"), date: str(f, "date"), reference: str(f, "reference") })));
}
export async function addReconciliationLine(f: FormData) {
  return act(week(f), "Line added.", guard(["reconciliation:prepare"], (uid) => t.addReconciliationLine(uid, { week: str(f, "week"), kind: str(f, "kind"), amount: num(f, "amount"), reason: str(f, "reason"), date: str(f, "date") || null, reference: str(f, "reference"), known: str(f, "known") === "on" })));
}
export async function removeReconciliationLine(f: FormData) {
  return act(week(f), "Removed.", guard(["reconciliation:prepare"], (uid) => t.removeReconciliationLine(uid, { line: str(f, "line"), reason: str(f, "reason") })));
}
export async function submitReconciliation(f: FormData) {
  const reasons = Object.fromEntries(ids(f, "carry").map((id) => [id, str(f, `reason_${id}`)]));
  return act(week(f), "Sent to the Finance Manager for review.", guard(["reconciliation:prepare"], (uid) => t.submitReconciliation(uid, { week: str(f, "week"), revision: num(f, "revision"), reasons, explanation: str(f, "explanation") })));
}
export async function returnReconciliation(f: FormData) {
  return act(week(f), "Returned to the Accountant.", guard(["reconciliation:lock"], (uid) => t.returnReconciliation(uid, { week: str(f, "week"), reason: str(f, "reason") })));
}
export async function lockWeek(f: FormData) {
  return act(week(f), "Week locked. Matched payments are now Paid.", guard(["reconciliation:lock"], (uid) => t.lockWeek(uid, { week: str(f, "week"), revision: num(f, "revision") })));
}

export async function recordExecution(f: FormData) {
  const id = str(f, "id");
  return act(`/requests/${id}`, "Payment details saved.", guard(["payment_request:create"], (uid) => t.recordExecution(uid, { requestId: id, chequeNo: str(f, "cheque_no"), bankReference: str(f, "bank_reference") })));
}

// ---------- Suppliers ----------
export async function addSupplier(f: FormData) {
  return act("/suppliers", "Supplier added. Add bank details next; a Verifier must verify them before any payment request.", guard(["supplier:manage"], (uid) => dbl(withUser(uid, async (tx) => {
    const sid = (await tx.q<{ id: string }>("INSERT INTO suppliers (legal_name, tin, created_by) VALUES ($1,$2,$3) RETURNING id", [str(f, "name"), str(f, "tin").trim() || null, uid]))[0].id;
    if (str(f, "company")) await tx.q("INSERT INTO company_suppliers (company_id, supplier_id, created_by) VALUES ($1,$2,$3)", [str(f, "company"), sid, uid]);
  }))));
}
export async function linkSupplier(f: FormData) {
  return act("/suppliers", "Supplier linked to the company.", guard(["supplier:manage"], (uid) => dbl(withUser(uid, (tx) => tx.q("INSERT INTO company_suppliers (company_id, supplier_id, created_by) VALUES ($1,$2,$3)", [str(f, "company"), str(f, "supplier"), uid])))));
}
export async function addBankDetail(f: FormData) {
  return act("/suppliers", "New bank details entered. They must be verified by someone else before use.", guard(["supplier:manage"], (uid) => dbl(withUser(uid, (tx) => {
    // A new version, PENDING until someone else verifies it. The full number is encrypted here; the database derives nothing from it.
    const n = protectAccountNumber(str(f, "account_number"));
    return tx.q("SELECT supplier_bank_detail_add($1,$2,$3,$4)", [str(f, "supplier"), str(f, "bank"), n.last4, n.enc]);
  }))));
}
export async function verifyBankDetail(f: FormData) { return decideBankDetail(f, true); }
export async function rejectBankDetail(f: FormData) { return decideBankDetail(f, false); }
async function decideBankDetail(f: FormData, ok: boolean) {
  return act("/suppliers", ok ? "Bank details verified." : "Bank details rejected.", guard(["payment_request:verify"], (uid) => dbl(withUser(uid, async (tx) => {
    const n = await tx.q("UPDATE supplier_bank_details SET status = $2, rejection_reason = $3 WHERE id = $1 RETURNING id", [str(f, "id"), ok ? "VERIFIED" : "REJECTED", ok ? null : str(f, "reason")]);
    if (n.length === 0) throw new WorkflowError(403, "You are not allowed to do that.");
  }))));
}

// ---------- Editing a draft ----------
export async function saveDraft(f: FormData) { return saveExistingDraft(f, false); }
export async function saveAndSubmitDraft(f: FormData) { return saveExistingDraft(f, true); }
async function saveExistingDraft(f: FormData, submit: boolean) {
  const id = str(f, "id"); const uid = await currentUserId(); let err: string | null = null; let notSubmitted: string | null = null;
  try {
    assertCan(await requireMe(), "payment_request:create");
    const dues = f.getAll("due").map(String), amts = f.getAll("amt").map(String);
    const inst = dues.map((d, i) => ({ d, a: Number(amts[i]) })).filter((x) => x.d && x.a > 0);
    const file = f.get("invoice");
    await dbl(withUser(uid, async (tx) => {
      const cur = (await tx.q<{ debtor_company_id: string; payee_type: string; person_payee_id: string | null }>("SELECT debtor_company_id, payee_type::text AS payee_type, person_payee_id FROM payment_requests WHERE id = $1", [id]))[0];
      if (!cur) throw new WorkflowError(404, "Request not found.");
      const person = cur.payee_type === "PERSON", method = str(f, "payment_method") || "TRANSFER", supplierId = person ? null : str(f, "supplier");
      const details = person ? await personDetail(tx, cur.person_payee_id!, method) : await supplierDetail(tx, supplierId!);
      const n = await tx.q("UPDATE payment_requests SET supplier_id = $2, supplier_bank_detail_id = $3, person_payment_detail_id = $11, invoice_ref = $4, invoice_date = $5::date, description = $6, priority = $7, total_amount = $8, debit_account_id = $9, payment_method = $10::payment_method WHERE id = $1 RETURNING id",
        [id, supplierId, person ? null : details, str(f, "invoice_ref") || null, str(f, "invoice_date") || null, str(f, "description") || null, str(f, "priority") || "NORMAL", inst.reduce((s, x) => s + x.a, 0) || 1, str(f, "account") || null, method, person ? details : null]);
      if (!n.length) throw new WorkflowError(403, "This request can no longer be edited by you.");
      await tx.q("DELETE FROM payment_installments WHERE request_id = $1", [id]);
      for (const [i, x] of inst.entries()) await tx.q("INSERT INTO payment_installments (request_id, seq, due_date, amount) VALUES ($1,$2,$3::date,$4)", [id, i + 1, x.d, x.a]);
      if (file instanceof File && file.size > 0) {
        const old = (await tx.q<{ id: string }>("SELECT a.id FROM attachments a WHERE a.request_id = $1 AND a.kind = 'INVOICE' AND NOT EXISTS (SELECT 1 FROM attachments b WHERE b.supersedes_id = a.id) ORDER BY a.uploaded_at DESC LIMIT 1", [id]))[0];
        await saveAttachment(tx, uid, id, file, "INVOICE", old?.id);
      }
    }));
    if (submit) notSubmitted = await submitSaved(uid, id);
  } catch (e) { err = message(e); }
  revalidatePath("/", "layout");
  if (err) redirect(`/requests/${id}/edit?err=${encodeURIComponent(err)}`);
  if (notSubmitted) redirect(`/requests/${id}?err=${encodeURIComponent(notSubmittedMsg(notSubmitted))}`);
  redirect(`/requests/${id}?msg=${encodeURIComponent(submit ? SUBMITTED_MSG : "Changes saved.")}`);
}

// ---------- People who are paid ----------
const PERSON_MSG = "Person added. Cash and cheque can be used now. Transfer and Telebirr need details that someone else has verified.";
export async function addPerson(f: FormData) {
  const company = str(f, "company");
  return act(str(f, "back") === "request" ? "/requests/new" : "/payees", PERSON_MSG, guard(["payee:manage"], (uid) => dbl(withUser(uid, (tx) => {
    const id = protectIdNumber(str(f, "id_number"), company);
    return tx.q("SELECT person_payee_create($1,$2,$3,$4,$5,$6,$7::payment_method)", [company, str(f, "name"), str(f, "phone"), id.enc, id.last4, id.hash, str(f, "preferred") || "TRANSFER"]);
  }))));
}
export async function updatePerson(f: FormData) {
  const company = str(f, "company");
  return act("/payees", "Person updated.", guard(["payee:manage"], (uid) => dbl(withUser(uid, (tx) => {
    const id = str(f, "id_number") ? protectIdNumber(str(f, "id_number"), company) : null;
    return tx.q("SELECT person_payee_update($1,$2,$3,$4::payment_method,$5,$6,$7,$8)", [str(f, "id"), str(f, "name"), str(f, "phone"), str(f, "preferred"), str(f, "active") === "on", id?.enc ?? null, id?.last4 ?? null, id?.hash ?? null]);
  }))));
}
export async function addPersonDetail(f: FormData) {
  return act("/payees", "New payment details entered. They must be verified by someone else before use.", guard(["payee:manage"], (uid) => dbl(withUser(uid, (tx) => {
    const n = str(f, "kind") === "BANK" ? protectAccountNumber(str(f, "account_number")) : null;
    return tx.q("SELECT person_detail_add($1,$2,$3,$4,$5,$6)", [str(f, "person"), str(f, "kind"), str(f, "bank") || null, n?.last4 ?? null, str(f, "phone") || null, n?.enc ?? null]);
  }))));
}
export async function verifyPersonDetail(f: FormData) { return decidePersonDetail(f, true); }
export async function rejectPersonDetail(f: FormData) { return decidePersonDetail(f, false); }
async function decidePersonDetail(f: FormData, ok: boolean) {
  return act("/payees", ok ? "Payment details verified." : "Payment details rejected.", guard(["payment_request:verify"], (uid) => dbl(withUser(uid, (tx) =>
    tx.q("SELECT person_detail_decide($1,$2,$3)", [str(f, "id"), ok, ok ? null : str(f, "reason")])))));
}

// ---------- Supplier corrections ----------
export async function updateSupplier(f: FormData) {
  // Only those who decide the status are sent the field. Without it the status stays as it is.
  const active = str(f, "status_shown") === "1" ? str(f, "active") === "on" : null;
  return act("/suppliers", "Supplier updated.", guard(["supplier:manage"], (uid) => dbl(withUser(uid, async (tx) => {
    if (active !== null && !(await canChangeSupplierStatus(tx))) throw new WorkflowError(403, "Only a Verifier or Finance Manager can change a supplier's status.");
    return tx.q("SELECT supplier_update($1,$2,$3,$4)", [str(f, "id"), str(f, "name"), str(f, "tin"), active]);
  }))));
}

// ---------- Account administration (account owner) ----------
export async function registerAccount(f: FormData) {
  const kind = str(f, "kind"), buffer = Number(str(f, "buffer") || 0);
  return act("/accounts", "Account registered. Enter its current balance before it is used.", guard(["bank_account:manage"], (uid) => dbl(withUser(uid, (tx) => {
    const n = kind === "CASH" || kind === "WALLET" ? null : protectAccountNumber(str(f, "account_number"));
    return kind === "CASH" ? tx.q("SELECT register_cash_account($1,$2,$3)", [str(f, "owner"), str(f, "label"), buffer])
      : kind === "WALLET" ? tx.q("SELECT register_wallet_account($1,$2,$3,$4)", [str(f, "owner"), str(f, "label"), str(f, "phone"), buffer])
      : tx.q("SELECT register_bank_account($1,$2,$3,$4,$5,$6)", [str(f, "owner"), str(f, "bank"), str(f, "label"), n!.last4, n!.enc, buffer]);
  }))));
}
/** The full number of an existing bank account, entered or corrected by the owner's managers. Encrypted here; only it and its last four digits change. */
export async function setAccountNumber(f: FormData) {
  return act("/accounts", "Account number saved.", guard(["bank_account:manage"], (uid) => dbl(withUser(uid, (tx) => {
    const n = protectAccountNumber(str(f, "account_number"));
    return tx.q("SELECT set_account_number($1,$2,$3,$4)", [str(f, "account"), n.last4, n.enc, str(f, "replace_last4") === "on"]);
  }))));
}
export async function setAccountPolicy(f: FormData) {
  return act("/accounts", "Account policy saved.", guard(["bank_account:manage"], (uid) => dbl(withUser(uid, (tx) => tx.q("SELECT set_account_policy($1,$2)", [str(f, "account"), Number(str(f, "buffer") || 0)])))));
}
export async function grantAccess(f: FormData) {
  const perms = ["USE", ...(str(f, "snapshot") === "on" ? ["RECORD_SNAPSHOT"] : [])];
  return act("/accounts", "Access granted.", guard(["bank_account:manage"], (uid) => dbl(withUser(uid, (tx) => tx.q("INSERT INTO company_bank_account_access (account_id, company_id, permissions, granted_by) VALUES ($1,$2,$3,$4)", [str(f, "account"), str(f, "company"), perms, uid])))));
}
export async function revokeAccess(f: FormData) {
  return act("/accounts", "Access withdrawn.", guard(["bank_account:manage"], (uid) => dbl(withUser(uid, (tx) => tx.q("UPDATE company_bank_account_access SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [str(f, "id")])))));
}
