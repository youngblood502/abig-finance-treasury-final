import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyMark } from "@/components/company-mark";
import { PrintButton } from "@/components/requests/print-button";
import { Button } from "@/components/ui/button";
import { withUser } from "@/lib/db";
import { requireAccess } from "@/lib/rbac";
import { currentUserId, requireMe } from "@/lib/session";
import { percentLabel } from "@/lib/tax";
import { loadVoucher, moneyText } from "@/lib/voucher";

const Fact = ({ label, value }: { label: string; value: string }) => <div><dt className="text-xs font-semibold uppercase text-muted-foreground">{label}</dt><dd className="m-0 text-sm break-words">{value}</dd></div>;

/** The payment voucher to print: the same values and the same access as the PDF and the request's detail page. Opening it changes nothing. */
export default async function PrintVoucher({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await requireMe(); requireAccess(me, "/requests");
  const v = await withUser(await currentUserId(), (tx) => loadVoucher(tx, id));
  if (!v) notFound();
  const hidden = (x: string | null, none: string) => x ?? (v.restricted ? "Not shown" : none);
  const lines: [string, string, boolean][] = v.tax ? [
    ["Amount before VAT", moneyText(v.tax.amountBeforeVat), false],
    [`VAT: ${v.tax.vatName} (${percentLabel(v.tax.vatPercent)})`, moneyText(v.tax.vatAmount), false],
    ["Total amount (including VAT)", moneyText(v.tax.gross), true],
    [v.tax.withholdingApplied ? `Withholding tax (${percentLabel(v.tax.withholdingPercent)})` : "Withholding tax", v.tax.withholdingApplied ? `− ${moneyText(v.tax.withholdingAmount)}` : "Not applied", false],
    ["Net payment", moneyText(v.net), true],
  ] : [["Net payment (no tax breakdown recorded)", moneyText(v.net), true]];
  return (
    <>
      <div className="no-print mb-3 flex flex-wrap gap-2"><PrintButton /><Button asChild variant="outline"><Link href={`/requests/${id}`}>Back to the request</Link></Button></div>
      <article className="voucher-print mx-auto max-w-3xl rounded-xl border bg-card p-6 text-foreground">
        <div className="voucher-head flex items-start justify-between gap-4 border-b-2 border-primary pb-3">
          {/* The paying company's own logo, or its code: never another company's logo or the group's. */}
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <CompanyMark companyId={v.companyId} code={v.companyCode} logo={v.logo} />
            <div className="min-w-0"><div className="break-words text-lg font-bold">{v.company}</div><div className="text-xs text-muted-foreground">TIN: {v.companyTin ?? "Not recorded"}</div></div>
          </div>
          <div className="shrink-0 text-right"><div className="text-xl font-bold text-primary">PAYMENT VOUCHER</div><div className="text-sm">No. {v.requestNo}</div><div className="text-sm">Date: {v.createdOn}</div><div className="text-sm">Status: {v.status}</div></div>
        </div>
        <dl className="my-4 grid gap-3 sm:grid-cols-2">
          <Fact label="Pay to" value={v.payee ?? "Not shown"} /><Fact label="Payee TIN" value={hidden(v.payeeTin, "Not recorded")} />
          <Fact label="Payment method" value={v.method} /><Fact label="Destination" value={hidden(v.destination, "Not needed for this method")} />
          <Fact label="Invoice" value={hidden(v.invoice, "None")} /><Fact label="Reason" value={hidden(v.description, "None")} />
        </dl>
        <h2 className="mb-1 text-base text-primary">Amount</h2>
        <table className="voucher-amounts no-stack w-full border-collapse text-sm"><tbody>
          {lines.map(([k, val, strong]) => <tr key={k} className={`border-b ${strong ? "bg-muted font-semibold" : ""}`}><td className="px-2 py-1.5">{k}</td><td className="px-2 py-1.5 text-right tabular-nums">{val}</td></tr>)}
        </tbody></table>
        {v.tax && <p className="mt-1 text-xs text-muted-foreground">{v.tax.mode}. The net payment is the amount paid from the bank.</p>}
        {v.installments.length > 1 && <><h2 className="mb-1 mt-4 text-base text-primary">Installments</h2>
          <table className="voucher-installments no-stack w-full border-collapse text-sm"><tbody>{v.installments.map((i) => <tr key={i.seq} className="border-b"><td className="px-2 py-1">{i.seq}. Due {i.due}</td><td className="px-2 py-1 text-right tabular-nums">{moneyText(i.amount)}</td></tr>)}</tbody></table></>}
        <div className="voucher-signatures mt-10 grid grid-cols-3 gap-4">
          {v.signatories.map((s) => <div key={s.role} className="text-sm"><div className="font-semibold">{s.role}</div><div>{s.name ?? (v.restricted ? "Not shown" : "")}</div><div className="text-xs text-muted-foreground">{s.when ?? ""}</div><div className="mt-12 border-t border-foreground pt-1 text-xs text-muted-foreground">Signature</div></div>)}
        </div>
      </article>
    </>
  );
}
