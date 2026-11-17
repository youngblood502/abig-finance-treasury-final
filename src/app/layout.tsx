import type { Metadata } from "next";
import { Suspense } from "react";
import "@fontsource-variable/figtree";
import "./globals.css";
import { NavigationProgress } from "@/components/layout/navigation-progress";
import { BrandSplash } from "@/components/layout/page-loading";
import { SignedInFrame } from "@/components/layout/signed-in-frame";

export const metadata: Metadata = { title: "ABIG Finance" };
export const dynamic = "force-dynamic";

// Runs before the first paint, so a saved dark theme does not flash white.
const THEME_SCRIPT = `try{if(localStorage.getItem("abig-theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

/**
 * The document is sent at once with the branded loading screen; the frame (who is signed in, their menu, companies and notifications) and
 * then the page stream in as they become ready, so the screen is never blank. While a page's own data loads, app/loading.tsx outlines it
 * inside the frame, and the bar at the top shows that the next page is on its way.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <NavigationProgress />
        <Suspense fallback={<BrandSplash />}>
          <SignedInFrame>{children}</SignedInFrame>
        </Suspense>
      </body>
    </html>
  );
}
