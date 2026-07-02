import type { Metadata, Viewport } from "next";
import { Anton, IBM_Plex_Mono, Instrument_Serif, Archivo } from "next/font/google";
import "./globals.css";

// LEDGER type system — each font has exactly one job (see globals.css).
const anton = Anton({ subsets: ["latin"], weight: "400", variable: "--font-anton-src" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });
const instrument = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument" });
const archivo = Archivo({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-archivo" });

export const metadata: Metadata = {
  title: "LifePatch — Survive the Internet Economy",
  description:
    "You're running out of money fast. Every choice costs something. Survive the internet economy without getting financially cooked.",
};

export const viewport: Viewport = {
  themeColor: "#0e0e0c",
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
      <body>{children}</body>
    </html>
  );
}
