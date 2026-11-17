"use client";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { NavItem } from "@/lib/nav";
import { Brand } from "./brand";
import { SidebarNav } from "./sidebar-nav";

export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild><Button variant="ghost" size="icon" className="md:hidden" aria-label="Open the menu"><Menu /></Button></SheetTrigger>
      <SheetContent side="left" className="overflow-y-auto p-4">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <SheetDescription className="sr-only">The parts of ABIG Finance you can use.</SheetDescription>
        <Brand onNavigate={close} />
        <SidebarNav items={items} onNavigate={close} />
      </SheetContent>
    </Sheet>
  );
}
