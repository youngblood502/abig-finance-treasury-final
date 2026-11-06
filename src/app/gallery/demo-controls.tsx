"use client";
import { useState } from "react";
import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SidePanel } from "@/components/ui/side-panel";

const OPTIONS = [{ value: "1", label: "Sample Packaging", hint: "Supplier" }, { value: "2", label: "Abebech Example", hint: "Person" }, { value: "3", label: "Sample Hardware", hint: "Bank details not verified", disabled: true }];

/** The gallery's examples. Nothing here is sent anywhere. */
export function DemoControls() {
  const [payee, setPayee] = useState("");
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <SearchableSelect label="Searchable select" name="demo-payee" options={OPTIONS} value={payee} onChange={setPayee} />
      <AmountInput name="demo-amount" label="Amount input" defaultValue="1250000.5" />
      <div><SidePanel title="Side panel" description="Detail beside a list." trigger={<Button variant="outline">Open side panel</Button>}><p className="m-0 text-sm">Example content.</p></SidePanel></div>
    </div>
  );
}
