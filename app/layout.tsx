import type { Metadata, Viewport } from "next";
import { Oswald, Newsreader } from "next/font/google";
import "./globals.css";

const oswald = Oswald({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-oswald",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
});

export const metadata: Metadata = {
  title: "LifePatch — Survive the Internet Economy",
  description:
    "You're running out of money fast. Every choice costs something. Survive the internet economy without getting financially cooked.",
};

export const viewport: Viewport = {
  themeColor: "#14110e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${oswald.variable} ${newsreader.variable}`}>
      <body>
        {children}
        <div className="vignette" aria-hidden />
        <div className="grain-overlay" aria-hidden />
      </body>
    </html>
  );
}
