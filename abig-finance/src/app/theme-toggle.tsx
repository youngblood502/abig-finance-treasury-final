"use client";
import { useEffect, useState } from "react";

const svg = (d: React.ReactNode) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { let d = false; try { d = localStorage.getItem("abig-theme") === "dark"; } catch {} setDark(d); document.documentElement.dataset.theme = d ? "dark" : "light"; }, []);
  const flip = () => { const d = !dark; setDark(d); document.documentElement.dataset.theme = d ? "dark" : "light"; try { localStorage.setItem("abig-theme", d ? "dark" : "light"); } catch {} };
  return (
    <button type="button" className="tg" onClick={flip} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Switch to light mode" : "Switch to dark mode"}>
      {dark ? svg(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>) : svg(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />)}
    </button>
  );
}
