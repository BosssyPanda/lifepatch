import type { Metadata } from "next";
import { IntroDigital } from "@/components/intro/digital/IntroDigital";

// Preview of the intro's scene 07 on its own, before the scenes are stitched into one scroll. Not
// linked from the game and not indexed.
export const metadata: Metadata = {
  title: "LifePatch — Intro preview: money becomes a number",
  robots: { index: false, follow: false },
};

export default function IntroDigitalPage() {
  return <IntroDigital />;
}
