import Link from "next/link";
import { retryNotification } from "@/app/admin-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { SidePanel } from "@/components/ui/side-panel";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { NOTIFICATION_EVENTS, NOTIFICATION_STATUSES, notificationSubject, RETRYABLE, type NotificationFilters, type NotificationRow, type NotificationSummary } from "@/lib/admin";
import { ageSince, dtime } from "@/lib/format";

const STATUS_VARIANT: Record<string, "default" | "destructive" | "warning" | "outline" | "secondary"> = { DELIVERED: "default", DEAD: "destructive", NO_RECIPIENTS: "warning", RETRYING: "warning", WAITING: "outline" };
const DELIVERY_LABEL: Record<string, string> = { SENT: "Sent", FAILED: "Failed", SENDING: "Sending", PENDING: "Not tried" };
const COLUMNS: DataColumn[] = [
  { key: "when", header: "Created", primary: true, sortable: true }, { key: "event", header: "Notification" }, { key: "status", header: "Status" },
  { key: "attempts", header: "Attempts", align: "right", sortable: true }, { key: "recipients", header: "Recipients" }, { key: "open", header: "" },
];
const label = (type: string) => NOTIFICATION_EVENTS[type] ?? type.replace(/_/g, " ").toLowerCase();
const Line = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex justify-between gap-3 py-0.5 text-sm"><dt className="text-muted-foreground">{k}</dt><dd className="m-0 text-right">{v}</dd></div>;

function Detail({ n, back, now }: { n: NotificationRow; back: string; now: Date }) {
  return (
    <SidePanel title={label(n.event_type)} description={notificationSubject(n) || n.event_type} trigger={<Button variant="outline" size="sm">Details</Button>}>
      <dl className="m-0 mt-3">
        <Line k="Status" v={NOTIFICATION_STATUSES[n.status] ?? n.status} />
        <Line k="Created" v={`${dtime(n.created_at)} (${ageSince(n.created_at, now).toLowerCase()})`} />
        <Line k="Attempts" v={n.attempts} />
        {n.status === "RETRYING" && <Line k="Next try" v={dtime(n.available_at)} />}
        {n.delivered_at && <Line k="Delivered" v={dtime(n.delivered_at)} />}
        {n.dead_at && <Line k="Gave up" v={dtime(n.dead_at)} />}
        {n.request_id && <Line k="Request" v={<Link href={`/requests/${n.request_id}`}>{n.request_no ?? "Open"}</Link>} />}
      </dl>
      {n.last_error && <p className="m-0 mt-2 text-sm break-words"><span className="text-muted-foreground">Last error: </span>{n.last_error}</p>}
      <section className="mt-4"><h3 className="m-0 mb-2 text-base">Recipients</h3>
        {n.deliveries.length === 0 ? <p className="m-0 text-sm text-muted-foreground">Nobody has been tried yet.</p> : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">{n.deliveries.map((d) => (
            <li key={d.email} className="rounded-md border bg-background p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all">{d.email}</span><Badge variant={d.status === "SENT" ? "default" : d.status === "FAILED" ? "destructive" : "outline"}>{DELIVERY_LABEL[d.status] ?? d.status}</Badge></div>
              <div className="mt-1 text-xs text-muted-foreground">{d.attempts} {d.attempts === 1 ? "attempt" : "attempts"}{d.sent_at ? `, sent ${dtime(new Date(d.sent_at))}` : ""}</div>
              {d.last_error && d.status !== "SENT" && <div className="mt-1 text-xs break-words text-muted-foreground">{d.last_error}</div>}
            </li>))}
          </ul>)}
      </section>
      {RETRYABLE.has(n.status) && (
        <div className="mt-4">
          <ConfirmDialog title="Send this notification again?" confirmLabel="Send again" cancelLabel="Not now" action={retryNotification} fields={{ id: n.id, back }}
            description={`It gets the usual 8 attempts. Anyone already sent it is not emailed again. Recipients are worked out again now, so people given a role since then are included, and it goes to nobody if it no longer applies. It was created ${ageSince(n.created_at, now).toLowerCase()}${n.request_id ? ", and a request email describes the request as it was then" : ""}.`}
            trigger={<Button size="sm">Send again</Button>} />
        </div>
      )}
    </SidePanel>
  );
}

/** Notification monitoring on the System tab. Everything shown here came from admin-only database functions. */
export function NotificationMonitor({ summary, rows, filters, now = new Date() }: { summary: NotificationSummary; rows: NotificationRow[]; filters: NotificationFilters; now?: Date }) {
  const p = new URLSearchParams({ tab: "system" });
  for (const [k, v] of [["nstatus", filters.status], ["ntype", filters.type], ["nq", filters.q], ["nfrom", filters.from], ["nto", filters.to]] as const) if (v) p.set(k, v);
  const back = `/admin?${p.toString()}`;
  const tableRows: DataRow[] = rows.map((n) => ({
    id: n.id, sort: { when: new Date(n.created_at).getTime(), attempts: n.attempts },
    cells: {
      when: dtime(n.created_at), event: <><b>{label(n.event_type)}</b><span className="block text-xs text-muted-foreground">{notificationSubject(n)}</span></>,
      status: <Badge variant={STATUS_VARIANT[n.status] ?? "outline"}>{NOTIFICATION_STATUSES[n.status] ?? n.status}</Badge>, attempts: n.attempts,
      recipients: (() => { const c = (s: string) => n.deliveries.filter((d) => d.status === s).length; return n.deliveries.length === 0 ? "None tried" : `${c("SENT")} sent${c("FAILED") ? `, ${c("FAILED")} failed` : ""}${c("SENDING") + c("PENDING") ? `, ${c("SENDING") + c("PENDING")} in progress` : ""}`; })(),
      open: <Detail n={n} back={back} now={now} />,
    },
  }));
  return (
    <section className="mt-6">
      <h2>Notifications</h2>
      <StatGrid>
        <StatTile label="Waiting to send" value={summary.waiting} hint={summary.oldest_waiting ? `Oldest created ${ageSince(new Date(summary.oldest_waiting), now).toLowerCase()}` : undefined} />
        <StatTile label="Retrying" value={summary.retrying} tone={summary.retrying > 0 ? "warning" : "default"} />
        <StatTile label="Failed" value={summary.dead} tone={summary.dead > 0 ? "destructive" : "default"} hint="Gave up after 8 attempts" />
        <StatTile label="Nobody to send to" value={summary.no_recipients} tone={summary.no_recipients > 0 ? "warning" : "default"} />
        <StatTile label="Delivered in 24 hours" value={summary.delivered_24h} />
      </StatGrid>
      <form method="get" action="/admin" className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border bg-card p-4">
        <input type="hidden" name="tab" value="system" />
        <label className="f">Status<select name="nstatus" defaultValue={filters.status ?? ""}><option value="">Any</option>{Object.entries(NOTIFICATION_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="f">Notification<select name="ntype" defaultValue={filters.type ?? ""}><option value="">Any</option>{Object.entries(NOTIFICATION_EVENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="f">Search<input name="nq" defaultValue={filters.q ?? ""} placeholder="Request, name or email" /></label>
        <label className="f">From<input type="date" name="nfrom" defaultValue={filters.from ?? ""} /></label>
        <label className="f">To<input type="date" name="nto" defaultValue={filters.to ?? ""} /></label>
        <Button type="submit" variant="outline">Filter</Button>
        <Button asChild variant="ghost"><Link href="/admin?tab=system">Clear</Link></Button>
      </form>
      <div className="rounded-xl border bg-card p-4">
        <DataTable caption="Notifications" columns={COLUMNS} rows={tableRows} pageSize={25} emptyMessage="No notifications match." />
        {rows.length === 200 && <p className="m-0 mt-2 text-sm text-muted-foreground">Showing the newest 200. Narrow the filters to see older ones.</p>}
      </div>
    </section>
  );
}
