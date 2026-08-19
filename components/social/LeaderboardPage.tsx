"use client";

import Link from "next/link";
import { Leaderboard } from "@/components/social/Leaderboard";
import { AuthProvider } from "@/hooks/useAuth";

/**
 * The boards as a real destination, not an overlay — a shared /r/{id} statement needs
 * somewhere to send a reader that isn't "start a run". It wears the page chrome (masthead,
 * folio rail) rather than the dialog's card-on-a-scrim, which read as a modal that had lost
 * its page. `useAudio` no-ops without a provider and MotionProvider lives in the root layout,
 * so this route carries none of AppShell's weight.
 *
 * It DOES need `AuthProvider`, though: `Leaderboard` reads `useProfile`, which reads
 * `useAuth`, and `useAuth` throws outside a provider by design (a second, parallel copy
 * of the auth state was the bug that contract replaced). Without this the route rendered
 * fine in dev — dev does not prerender — and `next build` failed on it every time:
 *   Error occurred prerendering page "/leaderboard" … useAuth must be used inside
 *   <AuthProvider>.
 * One provider per tree is the contract, and this is this tree's one.
 */
export function LeaderboardPage() {
  return (
    <AuthProvider>
    <Leaderboard
      open
      chrome="page"
      // Never called in page chrome — the masthead link is the way out.
      onClose={() => {}}
      pageAction={
        <Link
          href="/"
          // 0.62rem keeps it level with the wordmark it sits beside; the ::before expander
          // buys the 44px hit box out of the masthead cell's own padding, so the only exit
          // from this route is tappable without growing the rail.
          className="eyebrow relative text-ink-dim transition-colors before:absolute before:-inset-x-4 before:-inset-y-[15px] before:content-[''] hover:text-ink sm:before:-inset-x-6"
          style={{ fontSize: "0.62rem" }}
        >
          ← The ledger
        </Link>
      }
    />
    </AuthProvider>
  );
}
