"use client";
import * as React from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/** Detail beside a list, without leaving it. Its content is rendered on the server and handed in, so permissions are decided there. */
export function SidePanel({ trigger, title, description, children }: { trigger: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="right" className="w-full max-w-lg overflow-y-auto p-5">
        <div>
          <SheetTitle className="m-0 pr-8 text-lg">{title}</SheetTitle>
          <SheetDescription className="m-0 mt-1">{description}</SheetDescription>
        </div>
        {children}
      </SheetContent>
    </Sheet>
  );
}
