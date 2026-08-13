"use client";

import Link from "next/link";
import { Leaderboard } from "@/components/social/Leaderboard";

/**
 * The boards as a real destination, not an overlay — a shared /r/{id} statement needs
 * somewhere to send a reader that isn't "start a run". It wears the page chrome (masthead,
 * folio rail) rather than the dialog's card-on-a-scrim, which read as a modal that had lost
 * its page. `useAudio` no-ops without a provider and MotionProvider lives in the root layout,
 * so this route carries none of AppShell's weight.
 */
export function LeaderboardPage() {
  return (
    <Leaderboard
      open
      chrome="page"
      // Never called in page chrome — the masthead link is the way out.
      onClose={() => {}}
      pageAction={
        <Link
          href="/"
          className="eyebrow text-ink-dim transition-colors hover:text-ink"
          style={{ fontSize: "0.62rem" }}
        >
          ← The ledger
        </Link>
      }
    />
  );
}
