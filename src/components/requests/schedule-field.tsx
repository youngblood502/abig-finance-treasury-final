/** The scheduled date, with the rules the database checks again: after today, and on or before the first installment's due date. */
export function ScheduleField({ firstDue, defaultValue }: { firstDue?: string; defaultValue?: string | null }) {
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  return (
    <div className="flex flex-col gap-2">
      <label className="f">Scheduled date<input name="scheduled_for" type="date" min={tomorrow} max={firstDue || undefined} defaultValue={defaultValue ?? undefined} /></label>
      <p className="m-0 text-sm text-muted-foreground">
        On this date it is submitted for verification automatically, and the amount is reserved then, not now. It must be after today and on or before the
        first installment&apos;s due date{firstDue ? ` (${firstDue})` : ""}. If the account cannot cover it on the day, or anything else stops it, it stays
        Scheduled and you are told once.
      </p>
    </div>
  );
}
