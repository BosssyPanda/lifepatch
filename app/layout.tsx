import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { PALETTE } from "@/lib/palette";
import type { Metadata, Viewport } from "next";
import { Anton, IBM_Plex_Mono, Instrument_Serif, Archivo } from "next/font/google";
import { MotionProvider } from "@/src/motion/MotionProvider";
import "./globals.css";

// LEDGER type system — each font has exactly one job (see globals.css).
const anton = Anton({ subsets: ["latin"], weight: "400", variable: "--font-anton-src" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });
const instrument = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument" });
const archivo = Archivo({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-archivo" });

// Absolute base for og/twitter image URLs (crawlers require absolute).
// Explicit env first; otherwise production builds use the canonical prod
// domain (the `/` route is statically prerendered, so this is baked at build
// time — a localhost fallback would ship broken unfurls), then the per-deploy
// URL, then localhost in dev.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NODE_ENV === "production"
    ? "https://lifepatch-nine.vercel.app"
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "LifePatch — Survive the Internet Economy",
  description:
    "You're running out of money fast. Every choice costs something. Survive the internet economy without getting financially cooked.",
  openGraph: {
    title: "LifePatch — Survive the Internet Economy",
    description:
      "You're running out of money fast. Every choice costs something. Survive the internet economy without getting financially cooked.",
    url: "/",
    siteName: "LifePatch",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "LifePatch — Survive the Internet Economy",
    description:
      "Every choice costs something. Survive the internet economy without getting financially cooked.",
  },
};

/**
 * No `viewportFit: "cover"`, deliberately.
 *
 * Without it iOS insets the viewport for you and paints the safe areas in the page's own
 * background — which is `themeColor` / `--color-bg` — so a notched phone already reads
 * edge-to-edge paper. Adopting `cover` would move the gain from ~nothing to nothing while
 * putting `AdvanceBar`'s sticky primary CTA and `HudRail`'s sticky top row under the
 * hardware, unless every bottom- and top-anchored surface grows an `env(safe-area-inset-*)`
 * term. That is the trade: the one safe-area term in the codebase
 * (`components/cashflow/shared.tsx`, the toast) evaluates to 0 today and is defensive, not
 * dead — it becomes live the moment this line changes, and it is the shape the rest would
 * have to take.
 */
export const viewport: Viewport = {
  themeColor: PALETTE.bg,
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${anton.variable} ${plexMono.variable} ${instrument.variable} ${archivo.variable}`}
    >
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {/* Mounted at the root, not in AppShell: shared UI (AnnotatedLifeChart, LedgerButton,
            Reveal) also renders on the standalone routes — /r/[id] and the error/not-found
            pages — which never mount AppShell. useMotionCtx throws without a provider, so a
            shared statement link carrying chart history rendered a crash instead of a page.
            Passing `children` through keeps every route's server components server-rendered. */}
        <MotionProvider>{children}</MotionProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
