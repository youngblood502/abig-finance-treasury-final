// Fetching a CSV export so the button can show progress and a useful error instead of the browser's own download page.
// The export route checks the person's access as before; this only changes how the browser asks for the file.

export type DownloadResult = { ok: true; blob: Blob; filename: string } | { ok: false; error: string };

const MESSAGES: Record<number, string> = {
  401: "Your session has ended. Sign in again, then download the report.",
  403: "You do not have access to this report.",
  404: "This report was not found.",
};

/** Fetches a CSV. Anything but a CSV response (an error, or the sign-in page after a session ended) comes back as an error to show. */
export async function fetchCsv(url: string, fetchImpl: typeof fetch = fetch): Promise<DownloadResult> {
  let res: Response;
  try { res = await fetchImpl(url, { credentials: "same-origin", headers: { Accept: "text/csv" } }); }
  catch { return { ok: false, error: "The report could not be downloaded. Check your connection and try again." }; }
  if (!res.ok) return { ok: false, error: MESSAGES[res.status] ?? `The report could not be prepared (error ${res.status}). Please try again.` };
  if (!(res.headers.get("Content-Type") ?? "").includes("text/csv")) return { ok: false, error: MESSAGES[401] };
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? "report.csv";
  return { ok: true, blob: await res.blob(), filename };
}
