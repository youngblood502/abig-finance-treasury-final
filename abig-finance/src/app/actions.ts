"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withUser } from "@/lib/db";
import { saveAttachment } from "@/lib/attachments";
import { message, translate, WorkflowError } from "@/lib/errors";
import { currentUserId, requireMe } from "@/lib/session";
import { assertCan } from "@/lib/rbac";
import * as t from "@/lib/treasury";
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

// ---------- Payment requests ----------
/** Submits a saved draft. If the submission is refused (not enough available balance, for example) the draft is kept. */
async function submitSaved(uid: string, id: string): Promise<string | null> {
  try { await dbl(withUser(uid, (tx) => tx.q("SELECT wf_submit($1)", [id]))); return null; } catch (e) { return message(e); }
}
const SUBMITTED_MSG = "Request submitted. The amount is now reserved on the debit account.";
const notSubmittedMsg = (why: string) => `Saved as a draft, but not submitted. ${why}`;

export async function createRequest(f: FormData) {
  const uid = await currentUserId();
  const submit = Boolean(f.get("submit_now"));
  let id: string | null = null; let err: string | null = null; let notSubmitted: string | null = null;
  try {
    assertCan(await requireMe(), "payment_request:create");
    const [companyId, supplierId] = str(f, "target").split("|");
    const dues = f.getAll("due").map(String), amts = f.getAll("amt").map(String);
    const inst = dues.map((d, i) => ({ d, a: Number(amts[i]) })).filter((x) => x.d && x.a > 0);
    const total = inst.reduce((s, x) => s + x.a, 0);
    const file = f.get("invoice");
    id = await dbl(withUser(uid, async (tx) => {
      const bank = (await tx.q<{ id: string }>("SELECT id FROM supplier_bank_details WHERE supplier_id = $1 AND status = 'VERIFIED'", [supplierId]))[0];
      const rid = (await tx.q<{ id: string }>(
        `INSERT INTO payment_requests (debtor_company_id, supplier_id, supplier_bank_detail_id, debit_account_id, created_by, invoice_ref, invoice_date, description, priority, total_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10) RETURNING id`,
        [companyId, supplierId, bank?.id ?? null, str(f, "account") || null, uid, str(f, "invoice_ref") || null, str(f, "invoice_date") || null, str(f, "description") || null, str(f, "priority") || "NORMAL", total || 0]))[0].id;
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
export async function updateBalance(f: FormData) {
  return act("/accounts", "Balance updated.", guard(["bank_balance:update"], (uid) => t.updateBankBalance(uid, { accountId: str(f, "account"), balance: num(f, "balance") })));
}

// ---------- Suppliers ----------
export async function addSupplier(f: FormData) {
  return act("/suppliers", "Supplier added. Add bank details next; a Verifier must verify them before any payment request.", guard(["supplier:manage"], (uid) => dbl(withUser(uid, async (tx) => {
    const sid = (await tx.q<{ id: string }>("INSERT INTO suppliers (legal_name, tin, created_by) VALUES ($1,$2,$3) RETURNING id", [str(f, "name"), str(f, "tin"), uid]))[0].id;
    if (str(f, "company")) await tx.q("INSERT INTO company_suppliers (company_id, supplier_id, created_by) VALUES ($1,$2,$3)", [str(f, "company"), sid, uid]);
  }))));
}
export async function linkSupplier(f: FormData) {
  return act("/suppliers", "Supplier linked to the company.", guard(["supplier:manage"], (uid) => dbl(withUser(uid, (tx) => tx.q("INSERT INTO company_suppliers (company_id, supplier_id, created_by) VALUES ($1,$2,$3)", [str(f, "company"), str(f, "supplier"), uid])))));
}
export async function addBankDetail(f: FormData) {
  return act("/suppliers", "New bank details entered. They must be verified by someone else before use.", guard(["supplier:manage"], (uid) => dbl(withUser(uid, (tx) =>
    tx.q("INSERT INTO supplier_bank_details (supplier_id, bank_name, account_last4, created_by) VALUES ($1,$2,$3,$4)", [str(f, "supplier"), str(f, "bank"), str(f, "last4"), uid])))));
}
export async function decideBankDetail(f: FormData) {
  const ok = str(f, "decision") === "verify";
  return act("/suppliers", ok ? "Bank details verified." : "Bank details rejected.", guard(["payment_request:verify"], (uid) => dbl(withUser(uid, async (tx) => {
    const n = await tx.q("UPDATE supplier_bank_details SET status = $2, rejection_reason = $3 WHERE id = $1 RETURNING id", [str(f, "id"), ok ? "VERIFIED" : "REJECTED", ok ? null : str(f, "reason")]);
    if (n.length === 0) throw new WorkflowError(403, "You are not allowed to do that.");
  }))));
}

// ---------- Editing a draft ----------
export async function saveDraft(f: FormData) {
  const id = str(f, "id"); const uid = await currentUserId(); let err: string | null = null; let notSubmitted: string | null = null;
  const submit = Boolean(f.get("submit_now"));
  try {
    assertCan(await requireMe(), "payment_request:create");
    const dues = f.getAll("due").map(String), amts = f.getAll("amt").map(String);
    const inst = dues.map((d, i) => ({ d, a: Number(amts[i]) })).filter((x) => x.d && x.a > 0);
    const file = f.get("invoice");
    await dbl(withUser(uid, async (tx) => {
      const cur = (await tx.q<{ debtor_company_id: string }>("SELECT debtor_company_id FROM payment_requests WHERE id = $1", [id]))[0];
      if (!cur) throw new WorkflowError(404, "Request not found.");
      const supplierId = str(f, "supplier");
      const bank = (await tx.q<{ id: string }>("SELECT id FROM supplier_bank_details WHERE supplier_id = $1 AND status = 'VERIFIED'", [supplierId]))[0];
      const n = await tx.q("UPDATE payment_requests SET supplier_id = $2, supplier_bank_detail_id = $3, invoice_ref = $4, invoice_date = $5::date, description = $6, priority = $7, total_amount = $8, debit_account_id = $9 WHERE id = $1 RETURNING id",
        [id, supplierId, bank?.id ?? null, str(f, "invoice_ref") || null, str(f, "invoice_date") || null, str(f, "description") || null, str(f, "priority") || "NORMAL", inst.reduce((s, x) => s + x.a, 0) || 1, str(f, "account") || null]);
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

// ---------- Supplier corrections ----------
export async function updateSupplier(f: FormData) {
  return act("/suppliers", "Supplier updated.", guard(["supplier:manage"], (uid) => dbl(withUser(uid, (tx) => tx.q("SELECT supplier_update($1,$2,$3,$4)", [str(f, "id"), str(f, "name"), str(f, "tin"), str(f, "active") === "on"])))));
}

// ---------- Account administration (account owner) ----------
export async function registerAccount(f: FormData) {
  return act("/accounts", "Account registered. Enter its current balance before it is used.", guard(["bank_account:manage"], (uid) => dbl(withUser(uid, (tx) =>
    tx.q("SELECT register_bank_account($1,$2,$3,$4,NULL,$5,$6)", [str(f, "owner"), str(f, "bank"), str(f, "label"), str(f, "last4"), Number(str(f, "buffer") || 0), str(f, "approval") === "on"])))));
}
export async function setAccountPolicy(f: FormData) {
  return act("/accounts", "Account policy saved.", guard(["bank_account:manage"], (uid) => dbl(withUser(uid, (tx) => tx.q("SELECT set_account_policy($1,$2,$3)", [str(f, "account"), Number(str(f, "buffer") || 0), str(f, "approval") === "on"])))));
}
export async function grantAccess(f: FormData) {
  const perms = ["USE", ...(str(f, "snapshot") === "on" ? ["RECORD_SNAPSHOT"] : [])];
  return act("/accounts", "Access granted.", guard(["bank_account:manage"], (uid) => dbl(withUser(uid, (tx) => tx.q("INSERT INTO company_bank_account_access (account_id, company_id, permissions, granted_by) VALUES ($1,$2,$3,$4)", [str(f, "account"), str(f, "company"), perms, uid])))));
}
export async function revokeAccess(f: FormData) {
  return act("/accounts", "Access withdrawn.", guard(["bank_account:manage"], (uid) => dbl(withUser(uid, (tx) => tx.q("UPDATE company_bank_account_access SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [str(f, "id")])))));
}
