"use client";
import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog for the voucher on this page. */
export function PrintButton() {
  return <Button type="button" onClick={() => window.print()}>Print</Button>;
}
