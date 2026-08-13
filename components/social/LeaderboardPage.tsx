"use client";

import { useRouter } from "next/navigation";
import { Leaderboard } from "@/components/social/Leaderboard";

/**
 * The boards as a real destination, not only an overlay inside AppShell — a shared
 * /r/{id} statement needs somewhere to send a reader that isn't "start a run".
 * Same component, permanently open; closing it hands them the title screen.
 * `useAudio` no-ops without a provider and MotionProvider lives in the root layout,
 * so this route carries none of AppShell's weight.
 */
export function LeaderboardPage() {
  const router = useRouter();
  return (
    <main id="main" className="min-h-[100svh] w-full bg-bg">
      <Leaderboard open onClose={() => router.push("/")} />
    </main>
  );
}
