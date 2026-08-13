import type { Metadata } from "next";
import { LeaderboardPage } from "@/components/social/LeaderboardPage";

export const metadata: Metadata = {
  title: "LIFEPATCH — Leaderboards",
  description: "Best run per player, ranked by net worth (Story / Infinite) and passive income (Rat Race).",
};

export default function Page() {
  return <LeaderboardPage />;
}
