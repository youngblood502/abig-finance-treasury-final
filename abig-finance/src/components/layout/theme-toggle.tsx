"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export const THEME_KEY = "abig-theme";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.dataset.theme === "dark"); }, []);
  const flip = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try { localStorage.setItem(THEME_KEY, next ? "dark" : "light"); } catch { /* private mode: the choice lasts until the page closes */ }
  };
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return <Button type="button" variant="ghost" size="icon" onClick={flip} aria-label={label} title={label}>{dark ? <Sun /> : <Moon />}</Button>;
}
