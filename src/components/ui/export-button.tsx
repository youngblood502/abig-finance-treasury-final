"use client";
import * as React from "react";
import { Download, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchCsv } from "@/lib/download";

/** Downloads a CSV export with a visible "Preparing…" state, ignores further clicks while it runs, and shows the reason if it fails. */
export function ExportButton({ href, children = "Download CSV" }: { href: string; children?: React.ReactNode }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const running = React.useRef(false);

  const download = async () => {
    if (running.current) return;   // a second click while the first is still running does nothing
    running.current = true; setBusy(true); setError(null);
    try {
      const r = await fetchCsv(href);
      if (!r.ok) { setError(r.error); return; }
      const url = URL.createObjectURL(r.blob);
      const a = document.createElement("a"); a.href = url; a.download = r.filename; document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError("The report could not be downloaded. Please try again.");
    } finally {
      running.current = false; setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <Button type="button" variant="outline" size="sm" onClick={download} disabled={busy} aria-busy={busy || undefined}>
        {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}{busy ? "Preparing…" : children}
      </Button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
