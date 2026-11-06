"use client";
import Link from "next/link";
import { ChevronDown, KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { logoutAction } from "@/app/auth-actions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const initials = (name: string) => (name.match(/\p{L}+/gu) ?? []).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

export function UserMenu({ name, details }: { name: string; details: string[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="max-w-56 gap-2 px-2" aria-label={`Account menu for ${name}`}>
          <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{initials(name)}</span>
          <span className="hidden truncate sm:inline">{name}</span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel>
          <div className="font-semibold">{name}</div>
          {details.map((d) => <div key={d} className="text-xs font-normal text-muted-foreground">{d}</div>)}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/account/password"><KeyRound />Password</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/account/security"><ShieldCheck />Two-step sign-in</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* The menu stays open here, so the form is still on the page when the sign-out request goes out. */}
        <form action={logoutAction}>
          <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}><button type="submit"><LogOut />Sign out</button></DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
