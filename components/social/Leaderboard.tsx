"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";
import { NumberTicker } from "@/components/cinematic/landing/NumberTicker";
import { CloseIcon } from "@/components/icons";
import { Avatar } from "@/components/social/Avatar";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import { LedgerButton } from "@/components/ui/LedgerButton";
import { LedgerDialog } from "@/components/ui/LedgerDialog";
import { LedgerTabs, tabId } from "@/components/ui/LedgerTabs";
import { TerminalOp } from "@/components/ui/TerminalOp";
import { useAudio } from "@/hooks/useAudio";
import { useProfile } from "@/hooks/useProfile";
import { listFriendIds } from "@/lib/cloud/friends";
import { getProfiles } from "@/lib/cloud/profiles";
import { topResults, type LeaderboardScope } from "@/lib/cloud/results";
import type { GameMode, Profile, ResultRow } from "@/lib/cloud/types";
import { currency } from "@/lib/format";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { DUR, EASE } from "@/src/motion/tokens";

// staggered split-flap row landing (re-runs per tab via a keyed list);
// compositor-only: the whole row flips in like a Solari board line
const listContainer = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const listItem = {
  hidden: { opacity: 0, rotateX: -72, y: 8 },
  show: { opacity: 1, rotateX: 0, y: 0, transition: { duration: 0.32, ease: EASE } },
};
const listItemReduced = { hidden: { opacity: 0 }, show: { opacity: 1 } };

// gold / silver / bronze discs for the top three (from the warm token palette)
const MEDALS = ["var(--color-ink)", "var(--color-secondary)", "var(--color-tertiary)"];

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
  const { sfx } = useAudio();
  const { reduced } = useMotionCtx();
  const [mode, setMode] = useState<GameMode>(initialMode);
  const [scope, setScope] = useState<LeaderboardScope>("all");
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  /** The fetch failed. Distinct from "no rows" — telling a player the board is empty
   *  when the network dropped is a lie the old try/finally told every time. */
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const rankCelebrated = useRef(false);
  const panelId = useId();

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      rankCelebrated.current = false; // re-arm the "you placed" cue per open
    }
  }, [open, initialMode]);

  const profileId = profile?.id ?? null;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const friendIds =
          scope === "friends" && profileId ? await listFriendIds(profileId) : [];
        const top = await topResults(mode, { scope, friendIds });
        const profs = await getProfiles(top.map((r) => r.userId));
        if (!active) return;
        setRows(top);
        setProfiles(profs);
        // confident flourish the first time you see your own row on a board
        if (!rankCelebrated.current && profileId && top.some((r) => r.userId === profileId)) {
          rankCelebrated.current = true;
          sfx("rankUp");
        }
      } catch {
        if (!active) return;
        setRows([]);
        setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, mode, scope, profileId, sfx, retry]);

  const metric = MODE_TABS.find((t) => t.id === mode)?.metric ?? "score";

  return (
    <AnimatePresence>
      {open && (
        <LedgerDialog
          open={open}
          onClose={onClose}
          label="Leaderboards"
          dismissOnScrimClick
          className="max-h-[88svh] overflow-hidden"
          card={{
            initial: { opacity: 0, y: 24, scale: 0.98 },
            animate: { opacity: 1, y: 0, scale: 1 },
            exit: { opacity: 0, y: 16, scale: 0.98 },
            transition: { duration: DUR.base, ease: EASE },
          }}
        >
            <header className="flex items-center justify-between border-b-2 border-hairline-strong px-5 py-4">
              <div>
                <p className="eyebrow text-ink">Compete</p>
                <h2 className="display-caps text-3xl text-ink">Leaderboards</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close leaderboards"
                data-radius="round"
                className="grid h-11 w-11 place-items-center border-2 border-hairline-strong text-ink-dim transition-colors hover:border-ink hover:text-ink"
              >
                <CloseIcon size={16} />
              </button>
            </header>

            {/* one tab treatment for both axes — they used to be filled pills over
                underlined text, two visual languages inside one overlay */}
            <LedgerTabs
              items={MODE_TABS}
              value={mode}
              onChange={setMode}
              label="Leaderboard mode"
              panelId={panelId}
              className="px-5 pt-4"
            />
            <LedgerTabs
              items={SCOPE_TABS}
              value={scope}
              onChange={setScope}
              label="Leaderboard range"
              panelId={panelId}
              size="sm"
              className="px-5 pt-2"
            />

            <p className="px-5 pt-3 font-body text-xs italic text-secondary">
              Best run per player, ranked by {metric}.
            </p>

            <div
              className="thin-scroll mt-2 flex-1 overflow-y-auto px-3 pb-3"
              id={panelId}
              role="tabpanel"
              aria-labelledby={tabId(panelId, mode)}
              data-lenis-prevent
            >
              {loading ? (
                <p className="py-10 text-center"><TerminalOp label="Fetching ledger" center /></p>
              ) : failed ? (
                <FailedState reduced={reduced} onRetry={() => setRetry((n) => n + 1)} />
              ) : rows.length === 0 ? (
                <EmptyState scope={scope} reduced={reduced} />
              ) : (
                <motion.ol
                  key={`${mode}-${scope}`}
                  className="flex flex-col gap-1.5"
                  variants={listContainer}
                  initial="hidden"
                  animate="show"
                >
                  {rows.map((r, i) => {
                    const p = profiles[r.userId];
                    const isMe = profile?.id === r.userId;
                    const name = p?.username ?? "anonymous";
                    return (
                      <motion.li
                        key={r.id}
                        variants={reduced ? listItemReduced : listItem}
                        style={{ transformPerspective: 640, transformOrigin: "center top" }}
                        className={`flex items-center gap-3 border px-3 py-2 transition-colors ${
                          isMe
                            ? "border-ink bg-ink/10"
                            : i % 2
                              ? "border-transparent bg-ink/[0.03] hover:bg-ink/[0.06]"
                              : "border-transparent hover:bg-ink/[0.04]"
                        }`}
                      >
                        <RankBadge rank={i + 1} />
                        <Avatar seed={p?.avatarSeed ?? r.userId} username={name} size={34} />
                        <span className="min-w-0 flex-1 truncate font-body text-ink">
                          {name}
                          {isMe && <span className="ml-1.5 text-xs text-ink">you</span>}
                        </span>
                        <span className="text-right">
                          <span className="display-caps block text-sm text-ink">
                            <AnimatedNumber value={r.score} format={(n) => formatScore(mode, n)} />
                          </span>
                          <span className="block text-[0.65rem] uppercase tracking-wide text-secondary">
                            {r.verdict}
                          </span>
                        </span>
                      </motion.li>
                    );
                  })}
                </motion.ol>
              )}
            </div>

            <footer className="border-t-2 border-hairline px-5 py-3">
              <LedgerButton variant="ghost" size="sm" onClick={onClose}>
                Close
              </LedgerButton>
            </footer>
        </LedgerDialog>
      )}
    </AnimatePresence>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank <= 3) {
    return (
      <span
        className="grid h-6 w-6 shrink-0 place-items-center text-[0.72rem] font-bold text-bg"
        style={{ background: MEDALS[rank - 1] }}
      >
        <NumberTicker value={rank} durationMs={450} />
      </span>
    );
  }
  return (
    <span className="w-6 shrink-0 text-right font-body text-sm text-secondary">
      <NumberTicker value={rank} durationMs={450} />
    </span>
  );
}

function EmptyState({ scope, reduced }: { scope: LeaderboardScope; reduced: boolean }) {
  const msg =
    scope === "friends"
      ? "No friends added yet. Share your friend code to race together."
      : scope === "week"
        ? "No runs this week. Finish a run to claim the top spot."
        : "No runs yet. Finish a run to be the first on the board.";
  return (
    <motion.div
      key={scope}
      initial={reduced ? false : { scale: 1.28, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.26, ease: EASE }}
      className="mx-auto my-10 max-w-xs border-2 border-ink/30 p-1.5 text-center"
    >
      <div className="border border-ink/25 px-4 py-6">
        <p className="font-anton text-xl leading-tight tracking-[0.06em] text-ink">NO ENTRIES — BE THE FIRST</p>
        <p className="mt-2 font-body text-xs text-secondary">{msg}</p>
      </div>
    </motion.div>
  );
}

/** The board could not be read — same stamped plate, loss-red, and a way back. */
function FailedState({ reduced, onRetry }: { reduced: boolean; onRetry: () => void }) {
  return (
    <motion.div
      role="alert"
      initial={reduced ? false : { scale: 1.28, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.26, ease: EASE }}
      className="mx-auto my-10 max-w-xs border-2 border-loss/50 p-1.5 text-center"
    >
      <div className="border border-loss/40 px-4 py-6">
        <p className="font-anton text-xl leading-tight tracking-[0.06em] text-loss">COULD NOT REACH THE BOARD</p>
        <p className="mt-2 font-body text-xs text-secondary">
          The standings did not come back. This is a connection problem, not an empty board.
        </p>
        <div className="mt-4 flex justify-center">
          <LedgerButton variant="secondary" size="sm" onClick={onRetry}>Retry</LedgerButton>
        </div>
      </div>
    </motion.div>
  );
}
