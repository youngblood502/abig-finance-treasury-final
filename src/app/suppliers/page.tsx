import { Flash } from "@/components";
import { addBankDetail, addSupplier, linkSupplier, rejectBankDetail, updateSupplier, verifyBankDetail } from "../actions";
import { withUser } from "@/lib/db";
import { companyScope } from "@/lib/company-scope";
import { can, requireAccess } from "@/lib/rbac";
import { currentUserId, requireMe } from "@/lib/session";

export default async function Suppliers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/suppliers");
  const company = await companyScope(uid);
  const d = await withUser(uid, async (tx) => {
    const suppliers = await tx.q<any>("SELECT id, legal_name, tin, is_active FROM suppliers WHERE $1::uuid IS NULL OR id IN (SELECT supplier_id FROM company_suppliers WHERE company_id = $1) ORDER BY legal_name", [company]);
    const banks = await tx.q<any>("SELECT id, supplier_id, version, bank_name, account_last4, status, created_by, rejection_reason FROM supplier_bank_details ORDER BY supplier_id, version DESC");
    const links = await tx.q<any>("SELECT cs.supplier_id, c.legal_name AS company, cs.status FROM company_suppliers cs JOIN companies c ON c.id = cs.company_id ORDER BY c.legal_name");
    const companies = (await tx.q<any>("SELECT id, legal_name AS name FROM company_directory() WHERE is_active"));
    return { suppliers, banks, links, companies };
  });
  // Entering suppliers needs supplier:manage; verifying a supplier's bank details needs payment_request:verify (Finance Managers).
  const entering = me.isAdmin ? d.companies : me.memberships.filter((m) => m.permissions.includes("supplier:manage")).map((m) => ({ id: m.company_id, name: m.company }));
  const canVerify = can(me, "payment_request:verify"), canEnter = can(me, "supplier:manage"), canEdit = canEnter;
  const chip = (s: string) => <span className={`chip ${s === "VERIFIED" ? "" : s === "PENDING" ? "w" : "o"}`}>{s === "VERIFIED" ? "Verified" : s === "PENDING" ? "Waiting for verification" : s === "REJECTED" ? "Rejected" : "Replaced"}</span>;
  return (
    <>
      <h1>Suppliers</h1><p className="sub">One list for the whole group. Bank details are masked, and every change must be verified by someone other than the person who entered it.</p><Flash sp={sp} />
      {d.suppliers.map((s: any) => (
        <div className="card" key={s.id}>
          <div className="row"><div><b>{s.legal_name}</b> <span className="mute">TIN {s.tin}</span>{!s.is_active && <span className="chip b">Inactive</span>}</div><div>{d.links.filter((l: any) => l.supplier_id === s.id).map((l: any) => <span className="chip o" key={l.company}>{l.company}{l.status === "ACTIVE" ? "" : ` (${l.status.toLowerCase()})`}</span>)}</div></div>
          {canEdit && <details style={{ margin: "6px 0" }}><summary className="mute">Correct name, TIN or status</summary>
            <form action={updateSupplier} className="form" style={{ marginTop: 8 }}><input type="hidden" name="id" value={s.id} /><label className="f">Legal name<input name="name" defaultValue={s.legal_name} required /></label><label className="f">TIN<input name="tin" defaultValue={s.tin} required pattern="[0-9A-Za-z\-]{6,20}" /></label>
              <label className="f">Status<span className="inline"><input type="checkbox" name="active" defaultChecked={s.is_active} />Active</span></label><button>Save</button></form>
            <p className="mute">Not allowed while this supplier has requests in progress.</p></details>}
          <table><tbody>{d.banks.filter((b: any) => b.supplier_id === s.id).map((b: any) => (
            <tr key={b.id}><td>Version {b.version}</td><td>{b.bank_name} ••••{b.account_last4}</td><td>{chip(b.status)}{b.rejection_reason && <span className="mute"> {b.rejection_reason}</span>}</td>
              <td>{b.status === "PENDING" && canVerify && b.created_by !== me.id && (
                <form action={verifyBankDetail} className="inline"><input type="hidden" name="id" value={b.id} /><input name="reason" placeholder="Reason (to reject)" aria-label="Reason to reject" />
                  <button>Verify</button><button formAction={rejectBankDetail} className="sec">Reject</button></form>)}
                {b.status === "PENDING" && b.created_by === me.id && <span className="mute">Someone else must verify this</span>}</td></tr>))}</tbody></table>
        </div>))}
      {canEnter && (<>
        <h2>Add a supplier</h2>
        <form action={addSupplier} className="card form"><label className="f">Legal name<input name="name" required /></label><label className="f">TIN<input name="tin" required pattern="[0-9A-Za-z\-]{6,20}" /></label>
          <label className="f">Use for company<select name="company">{entering.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><button>Add supplier</button></form>
        <h2>Enter bank details</h2>
        <form action={addBankDetail} className="card form"><label className="f">Supplier<select name="supplier">{d.suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.legal_name}</option>)}</select></label>
          <label className="f">Bank<input name="bank" required /></label><label className="f">Last 4 digits of the account<input name="last4" required pattern="[0-9]{4}" maxLength={4} /></label><button>Enter for verification</button></form>
        <h2>Use an existing supplier for a company</h2>
        <form action={linkSupplier} className="card form"><label className="f">Supplier<select name="supplier">{d.suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.legal_name}</option>)}</select></label>
          <label className="f">Company<select name="company">{entering.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><button>Link</button></form></>)}
    </>
  );
}
