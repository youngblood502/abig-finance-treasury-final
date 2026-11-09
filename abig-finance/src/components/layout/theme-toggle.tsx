"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

export const THEME_KEY = "abig-theme";

/** The theme control inside the account menu. The menu stays open, so the change can be seen and undone. */
export function ThemeMenuItem() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.dataset.theme === "dark"); }, []);
  const flip = (e: Event) => {
    e.preventDefault();
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try { localStorage.setItem(THEME_KEY, next ? "dark" : "light"); } catch { /* private mode: the choice lasts until the page closes */ }
  };
  return <DropdownMenuItem onSelect={flip}>{dark ? <Sun /> : <Moon />}{dark ? "Light mode" : "Dark mode"}</DropdownMenuItem>;
}
