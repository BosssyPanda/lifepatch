"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/social/Avatar";
import { NeonButton } from "@/components/ui/NeonButton";
import { useProfile } from "@/hooks/useProfile";
import { listFriendIds } from "@/lib/cloud/friends";
import { getProfiles } from "@/lib/cloud/profiles";
import { topResults, type LeaderboardScope } from "@/lib/cloud/results";
import type { GameMode, Profile, ResultRow } from "@/lib/cloud/types";
import { currency } from "@/lib/format";

const EASE = [0.2, 0.65, 0.3, 0.9] as const;

const MODE_TABS: { id: GameMode; label: string; metric: string }[] = [
  { id: "story", label: "Story", metric: "net worth" },
  { id: "infinite", label: "Infinite", metric: "net worth" },
  { id: "cashflow", label: "Rat Race", metric: "passive income" },
];

const SCOPE_TABS: { id: LeaderboardScope; label: string }[] = [
  { id: "all", label: "All-time" },
  { id: "week", label: "This week" },
  { id: "friends", label: "Friends" },
];

function formatScore(mode: GameMode, score: number): string {
  return mode === "cashflow" ? `${currency(score)}/mo` : currency(score);
}

export function Leaderboard({
  open,
  onClose,
  initialMode = "story",
}: {
  open: boolean;
  onClose: () => void;
  initialMode?: GameMode;
}) {
  const { profile } = useProfile();
  const [mode, setMode] = useState<GameMode>(initialMode);
  const [scope, setScope] = useState<LeaderboardScope>("all");
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open) setMode(initialMode);
  }, [open, initialMode]);

  const profileId = profile?.id ?? null;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const friendIds =
          scope === "friends" && profileId ? await listFriendIds(profileId) : [];
        const top = await topResults(mode, { scope, friendIds });
        const profs = await getProfiles(top.map((r) => r.userId));
        if (!active) return;
        setRows(top);
        setProfiles(profs);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, mode, scope, profileId]);

  const metric = MODE_TABS.find((t) => t.id === mode)?.metric ?? "score";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.section
            className="paper relative flex max-h-[88svh] w-full max-w-lg flex-col overflow-hidden rounded-[6px]"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.4, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b-2 border-paper-ink/15 px-5 py-4">
              <div>
                <p className="eyebrow text-accent">Compete</p>
                <h2 className="display-caps text-3xl text-paper-ink">Leaderboards</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close leaderboards"
                className="grid h-9 w-9 place-items-center rounded-full border-2 border-paper-ink/25 text-paper-ink/70 transition-colors hover:bg-paper-ink/10"
              >
                ✕
              </button>
            </header>

            <div className="flex gap-1 px-5 pt-4">
              {MODE_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setMode(t.id)}
                  className={`display-caps flex-1 rounded-[4px] px-2 py-2 text-sm tracking-[0.08em] transition-colors ${
                    mode === t.id
                      ? "bg-paper-ink text-paper"
                      : "text-paper-ink/60 hover:bg-paper-ink/10"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex gap-4 px-5 pt-3 text-xs">
              {SCOPE_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setScope(t.id)}
                  className={`border-b-2 pb-1 font-serif transition-colors ${
                    scope === t.id
                      ? "border-accent text-paper-ink"
                      : "border-transparent text-paper-ink/50 hover:text-paper-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <p className="px-5 pt-3 font-serif text-xs italic text-paper-dim">
              Best run per player, ranked by {metric}.
            </p>

            <div className="thin-scroll mt-2 flex-1 overflow-y-auto px-3 pb-3">
              {loading ? (
                <p className="py-10 text-center font-serif text-paper-dim">Loading…</p>
              ) : rows.length === 0 ? (
                <EmptyState scope={scope} />
              ) : (
                <ol className="flex flex-col gap-1.5">
                  {rows.map((r, i) => {
                    const p = profiles[r.userId];
                    const isMe = profile?.id === r.userId;
                    const name = p?.username ?? "anonymous";
                    return (
                      <li
                        key={r.id}
                        className={`flex items-center gap-3 rounded-[4px] px-3 py-2 ${
                          isMe
                            ? "bg-accent/15 ring-1 ring-accent/40"
                            : i % 2
                              ? "bg-paper-ink/[0.03]"
                              : ""
                        }`}
                      >
                        <span className="w-6 text-right font-serif text-sm tabular-nums text-paper-dim">
                          {i + 1}
                        </span>
                        <Avatar seed={p?.avatarSeed ?? r.userId} username={name} size={34} />
                        <span className="min-w-0 flex-1 truncate font-serif text-paper-ink">
                          {name}
                          {isMe && <span className="ml-1.5 text-xs text-accent">you</span>}
                        </span>
                        <span className="text-right">
                          <span className="display-caps block text-sm text-paper-ink">
                            {formatScore(mode, r.score)}
                          </span>
                          <span className="block text-[0.65rem] uppercase tracking-wide text-paper-dim">
                            {r.verdict}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>

            <footer className="border-t-2 border-paper-ink/10 px-5 py-3">
              <NeonButton variant="ghost" size="sm" onClick={onClose}>
                Close
              </NeonButton>
            </footer>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function EmptyState({ scope }: { scope: LeaderboardScope }) {
  const msg =
    scope === "friends"
      ? "No friends added yet. Share your friend code to race together."
      : scope === "week"
        ? "No runs this week. Finish a run to claim the top spot."
        : "No runs yet. Finish a run to be the first on the board.";
  return <p className="py-10 text-center font-serif text-sm text-paper-dim">{msg}</p>;
}
