import { Badge } from "@/components/ui/badge";
import { STATE_LABEL, STATUS_SHORT, statusTone } from "@/lib/format";

/** One short label per status, in the same colour everywhere. The full wording is kept for assistive technology and on hover. */
export function StatusBadge({ state }: { state: string }) {
  return <Badge variant={statusTone(state)} title={STATE_LABEL[state] ?? state}>{STATUS_SHORT[state] ?? state}<span className="sr-only">: {STATE_LABEL[state] ?? state}</span></Badge>;
}
