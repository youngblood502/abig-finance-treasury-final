import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { ANOMALIES, dtime, ENTRY_KINDS, etb, etbOrBlank, PRIVATE_LOG_NOTE } from "@/lib/format";
import { logColumnKeys, type AccessLevel } from "@/lib/treasury-screens";

const COLUMNS: Record<string, DataColumn> = {
  when: { key: "when", header: "When", primary: true, sortable: true }, entry: { key: "entry", header: "Entry" }, bank: { key: "bank", header: "Bank figure", align: "right" }, outstanding: { key: "outstanding", header: "Not yet processed", align: "right" },
  previous: { key: "previous", header: "Previous", align: "right" }, balance: { key: "balance", header: "System balance", align: "right", sortable: true }, implied: { key: "implied", header: "Implied deposit", align: "right" }, by: { key: "by", header: "By" },
};

export interface BalanceLogEntry { id: string; updated_at: Date; previous_balance: string | null; new_balance: string; updated_by_name: string | null; request_no: string | null; entry_kind: string; bank_figure: string | null; outstanding_total: string | null; implied_deposit: string | null; anomalies: string[] }

/** One account's balance log. account_balance_history() decides what each person gets; this draws it, and a value held back stays blank. */
export function BalanceLog({ entries, access, pageSize = 20, limit }: { entries: BalanceLogEntry[]; access: AccessLevel; pageSize?: number; /** How many entries were asked for. Reaching it means there may be older ones. */ limit?: number }) {
  const rows: DataRow[] = entries.map((h) => ({
    id: h.id, sort: { when: h.updated_at.getTime(), balance: Number(h.new_balance) },
    cells: {
      when: dtime(h.updated_at),
      entry: <>{h.request_no ? `Payment ${h.request_no}` : ENTRY_KINDS[h.entry_kind]}{h.anomalies.map((a) => <Badge variant="warning" className="ml-2" key={a}>{ANOMALIES[a]}</Badge>)}</>,
      bank: etbOrBlank(h.bank_figure), outstanding: etbOrBlank(h.outstanding_total), previous: etbOrBlank(h.previous_balance), balance: etb(h.new_balance), implied: etbOrBlank(h.implied_deposit), by: h.updated_by_name ?? "",
    },
  }));
  return (
    <>
      <DataTable caption="Balance log" columns={logColumnKeys(access, entries).map((k) => COLUMNS[k])} rows={rows} pageSize={pageSize} emptyMessage="No balance entries yet." />
      {limit !== undefined && entries.length >= limit && <p className="mute mt-2 mb-0">Showing the latest {limit} entries. Older entries are not shown.</p>}
      {access === "NONE" && <p className="mute mt-2 mb-0">{PRIVATE_LOG_NOTE}</p>}
    </>
  );
}
