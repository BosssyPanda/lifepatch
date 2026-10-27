import type { Metadata } from "next";
import { IntroOre } from "@/components/intro/IntroOre";

// A preview of the rebuilt intro, scene by scene. Not linked from the game and not indexed until
// the intro replaces the cold open.
export const metadata: Metadata = {
  title: "LifePatch — Intro preview",
  robots: { index: false, follow: false },
};

export default function IntroPage() {
  return <IntroOre />;
}
