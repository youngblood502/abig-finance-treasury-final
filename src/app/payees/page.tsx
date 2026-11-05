import { Flash } from "@/components";
import { addPerson, addPersonDetail, rejectPersonDetail, updatePerson, verifyPersonDetail } from "../actions";
import { PAYMENT_METHODS } from "@/lib/format";
import { maskId } from "@/lib/payees";
import { withUser } from "@/lib/db";
import { can, requireAccess } from "@/lib/rbac";
import { currentUserId, hasPermission, requireMe } from "@/lib/session";

const methodOptions = Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>);

export default async function Payees({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const uid = await currentUserId(); const me = await requireMe();
  requireAccess(me, "/payees");
  const d = await withUser(uid, async (tx) => ({
    // Row-level security limits these to the person's own companies. The encrypted ID number cannot be read here at all.
    people: await tx.q<any>(`SELECT p.id, p.company_id, c.legal_name AS company, p.full_name, p.phone, p.id_last4, p.preferred_method::text AS preferred_method, p.is_active
      FROM person_payees p JOIN companies c ON c.id = p.company_id ORDER BY p.full_name`),
    details: await tx.q<any>("SELECT id, person_id, version, kind, bank_name, account_last4, telebirr_phone, status, created_by, rejection_reason FROM person_payment_details ORDER BY person_id, version DESC"),
  }));
  const entering = me.memberships.filter((m) => m.permissions.includes("payee:manage"));
  const canEnter = can(me, "payee:manage");
  const chip = (s: string) => <span className={`chip ${s === "VERIFIED" ? "" : s === "PENDING" ? "w" : "o"}`}>{s === "VERIFIED" ? "Verified" : s === "PENDING" ? "Waiting for verification" : s === "REJECTED" ? "Rejected" : "Replaced"}</span>;
  return (
    <>
      <h1>People</h1><p className="sub">People this company pays. ID numbers are encrypted and masked here, and every change to how someone is paid must be verified by a second person.</p><Flash sp={sp} />
      {d.people.length === 0 && <div className="card">No people yet.</div>}
      {d.people.map((p: any) => {
        const canManage = hasPermission(me, "payee:manage", p.company_id), canVerify = hasPermission(me, "payment_request:verify", p.company_id);
        return (
          <div className="card" key={p.id}>
            <div className="row"><div><b>{p.full_name}</b> <span className="mute">{p.phone} · ID {maskId(p.id_last4)} · usually {PAYMENT_METHODS[p.preferred_method]}</span>{!p.is_active && <span className="chip b">Inactive</span>}</div><div><span className="chip o">{p.company}</span></div></div>
            {canManage && <details style={{ margin: "6px 0" }}><summary className="mute">Correct name, phone, ID number or status</summary>
              <form action={updatePerson} className="form" style={{ marginTop: 8 }}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="company" value={p.company_id} />
                <label className="f">Full name<input name="name" defaultValue={p.full_name} required /></label><label className="f">Phone<input name="phone" type="tel" defaultValue={p.phone} required /></label>
                <label className="f">New ID number (leave empty to keep it)<input name="id_number" autoComplete="off" /></label>
                <label className="f">Usually paid by<select name="preferred" defaultValue={p.preferred_method}>{methodOptions}</select></label>
                <label className="f">Status<span className="inline"><input type="checkbox" name="active" defaultChecked={p.is_active} />Active</span></label><button>Save</button></form>
              <p className="mute">Name, phone, ID and status cannot change while this person has requests in progress.</p></details>}
            <table><tbody>{d.details.filter((x: any) => x.person_id === p.id).map((x: any) => (
              <tr key={x.id}><td>Version {x.version}</td><td>{x.kind === "TELEBIRR" ? `Telebirr ${x.telebirr_phone}` : `${x.bank_name} ••••${x.account_last4}`}</td><td>{chip(x.status)}{x.rejection_reason && <span className="mute"> {x.rejection_reason}</span>}</td>
                <td>{x.status === "PENDING" && canVerify && x.created_by !== me.id && (
                  <form action={verifyPersonDetail} className="inline"><input type="hidden" name="id" value={x.id} /><input name="reason" placeholder="Reason (to reject)" aria-label="Reason to reject" />
                    <button>Verify</button><button formAction={rejectPersonDetail} className="sec">Reject</button></form>)}
                  {x.status === "PENDING" && x.created_by === me.id && <span className="mute">Someone else must verify this</span>}</td></tr>))}</tbody></table>
          </div>);
      })}
      {canEnter && entering.length > 0 && (<>
        <h2>Add a person</h2>
        <form action={addPerson} className="card form"><label className="f">Company<select name="company">{entering.map((m) => <option key={m.company_id} value={m.company_id}>{m.company}</option>)}</select></label>
          <label className="f">Full name<input name="name" required /></label><label className="f">Phone<input name="phone" type="tel" required placeholder="0911 234 567" /></label>
          <label className="f">ID number<input name="id_number" required autoComplete="off" /></label><label className="f">Usually paid by<select name="preferred" defaultValue="TRANSFER">{methodOptions}</select></label><button>Add person</button></form>
      </>)}
      {canEnter && d.people.length > 0 && (<>
        <h2>Enter bank or Telebirr details</h2>
        <form action={addPersonDetail} className="card form"><label className="f">Person<select name="person">{d.people.filter((p: any) => hasPermission(me, "payee:manage", p.company_id)).map((p: any) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
          <label className="f">Type<select name="kind"><option value="BANK">Bank</option><option value="TELEBIRR">Telebirr</option></select></label>
          <label className="f">Bank<input name="bank" /></label><label className="f">Last 4 digits of the account<input name="last4" pattern="[0-9]{4}" maxLength={4} /></label>
          <label className="f">Telebirr phone<input name="phone" type="tel" placeholder="0911 234 567" /></label><button>Enter for verification</button></form></>)}
    </>
  );
}
