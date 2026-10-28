import type { Metadata } from "next";
import { IntroCave } from "@/components/intro/IntroCave";

// Scene two of the rebuilt intro on its own, for review. Not linked from the game or from /intro.
export const metadata: Metadata = {
  title: "LifePatch — Intro preview: the cave",
  robots: { index: false, follow: false },
};

export default function IntroCavePage() {
  return <IntroCave />;
}
