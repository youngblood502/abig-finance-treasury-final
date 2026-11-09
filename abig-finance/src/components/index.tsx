import { etb } from "@/lib/format";

export function Flash({ sp }: { sp: { msg?: string; err?: string } }) {
  if (sp.err) return <div className="note bad" role="alert">{sp.err}</div>;
  if (sp.msg) return <div className="note ok" role="status">{sp.msg}</div>;
  return null;
}
/** Shown in red wherever an account appears while its balance is below the reserved funds. */
export function ShortfallChip({ amount }: { amount: unknown }) {
  return Number(amount) > 0 ? <span className="chip b">Shortfall {etb(amount)}: new submissions blocked</span> : null;
}
export function PositionBar({ p }: { p: { estimated_balance: string; active_reserved: string; min_buffer: string; available: string } }) {
  const total = Math.max(Number(p.estimated_balance), 1), pct = (v: string | number) => Math.min(100, Math.max(0, (Number(v) / total) * 100));
  return (
    <>
      <div className="bar" role="img" aria-label={`Reserved ${etb(p.active_reserved)}, buffer ${etb(p.min_buffer)}, available ${etb(p.available)}`}>
        <i className="k1" style={{ width: pct(p.active_reserved) + "%" }} /><i className="k2" style={{ width: pct(p.min_buffer) + "%" }} /><i className="k3" style={{ width: pct(p.available) + "%" }} />
      </div>
      <div className="legend"><span><u className="k1" />Reserved {etb(p.active_reserved)}</span><span><u className="k2" />Minimum buffer {etb(p.min_buffer)}</span><span><u className="k3" />Available {etb(p.available)}</span></div>
    </>
  );
}
