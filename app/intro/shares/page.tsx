import type { Metadata } from "next";
import { IntroShares } from "@/components/intro/shares/IntroShares";

// Preview of the intro's era five on its own, before the scenes are stitched into one scroll. Not
// linked from the game and not indexed.
export const metadata: Metadata = {
  title: "LifePatch — Intro preview: the first company shares",
  robots: { index: false, follow: false },
};

export default function IntroSharesPage() {
  return <IntroShares />;
}
