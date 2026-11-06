import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { StatusTracker } from "@/components/ui/status-tracker";
import { etb, PAYMENT_METHODS } from "@/lib/format";
import { requireAccess } from "@/lib/rbac";
import { requireMe } from "@/lib/session";
import { DemoConfirm } from "./demo-confirm";

// Made-up examples: this page reads nothing from the database.
const PAYMENTS = [
  { no: "EX-0001", company: "Example Trading PLC", payee: "Sample Packaging", method: "TRANSFER", amount: 400000, state: "Paid" },
  { no: "EX-0002", company: "Example Trading PLC", payee: "Sample Chemicals", method: "CHEQUE", amount: 200000, state: "Authenticated" },
  { no: "EX-0003", company: "Demo Foods SC", payee: "Abebech Example", method: "TELEBIRR", amount: 12500.5, state: "Verified" },
  { no: "EX-0004", company: "Demo Foods SC", payee: "Sample Hardware", method: "CASH", amount: 8200, state: "Reserved" },
  { no: "EX-0005", company: "Example Trading PLC", payee: "Sample Logistics", method: "TRANSFER", amount: 96000, state: "Draft" },
  { no: "EX-0006", company: "Demo Foods SC", payee: "Sample Packaging", method: "TRANSFER", amount: 54000, state: "Reserved" },
];
const COLUMNS: DataColumn[] = [
  { key: "no", header: "Payment", sortable: true, primary: true }, { key: "company", header: "Company", sortable: true }, { key: "payee", header: "Payee", sortable: true },
  { key: "method", header: "Method" }, { key: "amount", header: "Amount", align: "right", sortable: true }, { key: "state", header: "Status", sortable: true },
];
const ROWS: DataRow[] = PAYMENTS.map((p) => ({
  id: p.no, search: `${p.no} ${p.company} ${p.payee}`, filters: { method: p.method, company: p.company }, sort: { no: p.no, company: p.company, payee: p.payee, amount: p.amount, state: p.state },
  cells: { no: p.no, company: p.company, payee: p.payee, method: PAYMENT_METHODS[p.method], amount: etb(p.amount), state: <Badge variant={p.state === "Paid" ? "secondary" : "outline"}>{p.state}</Badge> },
}));
const SWATCHES = ["background", "card", "primary", "accent", "muted", "destructive", "warning", "brand"];

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="mb-6"><h2>{title}</h2><div className="card">{children}</div></section>;

export default async function Gallery() {
  requireAccess(await requireMe(), "/gallery");
  return (
    <>
      <h1>Component gallery</h1>
      <p className="sub">The shared components, with made-up data. Use the theme button in the header for dark mode, and a narrow window for the phone layout.</p>

      <Section title="Colours">
        <div className="flex flex-wrap gap-3">{SWATCHES.map((s) => <div key={s} className="text-xs text-muted-foreground"><div className="mb-1 h-10 w-20 rounded-md border" style={{ background: `var(--${s})` }} />{s}</div>)}</div>
      </Section>

      <Section title="Buttons">
        <div className="mb-3 flex flex-wrap gap-2"><Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button><Button variant="link">Link</Button><Button variant="destructive">Destructive</Button><Button disabled>Disabled</Button></div>
        <div className="flex flex-wrap items-center gap-2"><Button size="sm">Small</Button><Button>Default</Button><Button size="lg">Large</Button></div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-2"><Badge>Default</Badge><Badge variant="secondary">Secondary</Badge><Badge variant="warning">Warning</Badge><Badge variant="destructive">Destructive</Badge><Badge variant="outline">Outline</Badge></div>
      </Section>

      <Section title="Data table">
        <DataTable caption="Example payments" columns={COLUMNS} rows={ROWS} searchable pageSize={4}
          filters={[{ key: "method", label: "Method", options: Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label })) }]}
          totals={{ no: "Total", amount: etb(PAYMENTS.reduce((s, p) => s + p.amount, 0)) }} />
      </Section>

      <Section title="Data table with nothing to show">
        <DataTable caption="No payments" columns={COLUMNS} rows={[]} emptyMessage="No payments yet." />
      </Section>

      <Section title="Status tracker">
        <div className="flex flex-col gap-5">
          {["DRAFT", "SCHEDULED", "RESERVED", "VERIFIED", "AUTHENTICATED", "PAID", "REJECTED", "CANCELLED"].map((s) => <div key={s}><div className="mb-1 text-xs font-semibold text-muted-foreground">{s}</div><StatusTracker state={s} /></div>)}
        </div>
      </Section>

      <Section title="Confirmation dialog"><DemoConfirm /></Section>

      <Section title="Tables on the screens not yet rebuilt">
        <p className="mt-0 text-sm text-muted-foreground">Existing tables stack by themselves on a phone.</p>
        <table><thead><tr><th>Account</th><th className="n">Balance</th><th>Updated</th></tr></thead>
          <tbody><tr><td>Example current</td><td className="n">{etb(1500000)}</td><td>Monday 08:30</td></tr><tr><td>Example wallet</td><td className="n">{etb(45000)}</td><td>Monday 08:45</td></tr></tbody></table>
      </Section>
    </>
  );
}
