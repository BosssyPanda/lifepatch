"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";
import { CloseIcon } from "@/components/icons";
import { Avatar } from "@/components/social/Avatar";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import { LedgerButton } from "@/components/ui/LedgerButton";
import { LedgerDialog } from "@/components/ui/LedgerDialog";
import { LedgerTabs, tabId } from "@/components/ui/LedgerTabs";
import { TerminalOp } from "@/components/ui/TerminalOp";
import { useAudio } from "@/hooks/useAudio";
import { useProfile } from "@/hooks/useProfile";
import { BACKGROUNDS } from "@/lib/backgrounds";
import { todaysDaily } from "@/lib/daily";
import { listFriendIds } from "@/lib/cloud/friends";
import { getProfiles } from "@/lib/cloud/profiles";
import { topResults, type LeaderboardScope } from "@/lib/cloud/results";
import type { GameMode, PublicProfile, ResultRow } from "@/lib/cloud/types";
import { currency } from "@/lib/format";
import { scoreMetric } from "@/lib/scoreLabel";
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

const MODE_TABS: { id: GameMode; label: string }[] = [
  { id: "story", label: "Story" },
  { id: "infinite", label: "Infinite" },
  { id: "cashflow", label: "Rat Race" },
];

/**
 * The friends tab, restored.
 *
 * It was removed under a comment reading "NO FRIENDS TAB UNTIL THERE IS A WAY TO
 * ADD ONE", and that was the correct call at the time: the scope worked, the
 * query worked and the RLS worked, but `addByCode`, `accept` and `listIncoming`
 * had no callers and no screen rendered the player's own code — so the tab could
 * only ever be empty, under a message pointing at a code nothing showed them.
 *
 * `components/social/FriendsSheet.tsx` is the way to add one. The condition the
 * old comment set has been met, so the line it asked for goes back, and the
 * scope, the query and the empty-state copy are untouched — they were always the
 * half that worked.
 */
const SCOPE_TABS: { id: LeaderboardScope; label: string }[] = [
  { id: "all", label: "All-time" },
  { id: "week", label: "This week" },
  { id: "friends", label: "Friends" },
];

/**
 * Today's puzzle, offered on the Story board only.
 *
 * This is the board the whole verification effort was aiming at: one seed, one
 * background, one length, for everybody who played today. Nothing has to be
 * normalised because nothing differs — which is why the daily board needs no
 * computed baseline and the general board is only ever segmented, never scored
 * against an invented par.
 */
const DAILY_TAB: { id: LeaderboardScope; label: string } = { id: "daily", label: "Today" };

/**
 * The normalising axis. A life that opens with $6,000 and no debt and one that
 * opens with $1,500 and a $24,000 loan are not the same contest, and a single
 * ranked column silently treats them as one. Narrowing to a background is the
 * honest comparison — no computed baseline, no invented "par" figure, which
 * `DESIGN.md` § Data honesty would not allow anyway.
 *
 * The Rat Race has professions rather than backgrounds, so the strip is not shown
 * on that board.
 */
const ALL_BACKGROUNDS = "all";
const BACKGROUND_TABS = [
  { id: ALL_BACKGROUNDS, label: "Any start" },
  ...BACKGROUNDS.map((b) => ({ id: b.id, label: b.name.replace(/^The /, "") })),
];

/**
 * The replayed mark. A glyph, not a colour — `DESIGN.md`: colour is never the only
 * channel — and it is deliberately not a badge, a pill or a shield. It says one
 * narrow, true thing, and the legend under the tabs says exactly that thing.
 */
const VERIFIED_MARK = "\u2713";

// Every board's score is a dollar amount. The Rat Race column used to print its
// figure as `$…/mo`, but that score is net worth plus a year of cash flow — a
// balance sheet, not a wage. No suffix: see lib/scoreLabel.ts.
function formatScore(score: number): string {
  return currency(score);
}

export function Leaderboard({
  open,
  onClose,
  initialMode = "story",
  chrome = "dialog",
  /** Rendered in the page masthead's right cell — e.g. a link back to the ledger. */
  pageAction,
  onOpenFriends,
  refreshSignal = 0,
}: {
  open: boolean;
  onClose: () => void;
  initialMode?: GameMode;
  /**
   * `dialog` — the in-game overlay. `page` — the standalone /leaderboard route, which is a
   * destination rather than something opened over the game, and so gets a masthead and a
   * folio rail instead of a card floating on a scrim. Same board, same data, same tabs.
   */
  chrome?: "dialog" | "page";
  pageAction?: React.ReactNode;
  /**
   * Open the friends sheet. Optional: the board is also rendered by hosts that
   * have nowhere to put a second overlay, and a visible control that does nothing
   * is worse than no control. Where it IS passed, the host is expected to close
   * this board first — two open `LedgerDialog`s trap Tab against each other (see
   * `components/ui/LedgerDialog.tsx`).
   */
  onOpenFriends?: () => void;
  /**
   * Bump to re-read the board.
   *
   * The fetch effect keys on `open` among other things, so the dialog host gets
   * invalidation for free: it closes the board to open the sheet and reopening
   * toggles `open`. The `/leaderboard` route has no such toggle — `open` is a
   * hardcoded `true` there — so accepting a request in the sheet left the Friends
   * tab still showing "No friends added yet" over a friendship that now existed,
   * until a full page reload.
   */
  refreshSignal?: number;
}) {
  const { profile } = useProfile();
  const { sfx } = useAudio();
  const { reduced } = useMotionCtx();
  const [mode, setMode] = useState<GameMode>(initialMode);
  const [scopePick, setScope] = useState<LeaderboardScope>("all");
  const [backgroundPick, setBackground] = useState<string>(ALL_BACKGROUNDS);
  const [rows, setRows] = useState<ResultRow[]>([]);
  // PublicProfile, not Profile: a board needs a name and an avatar. It never needed
  // a friend code, and `getProfiles` no longer has one to give — it reads the
  // `profiles_public` view, which does not carry the column.
  const [profiles, setProfiles] = useState<Record<string, PublicProfile>>({});
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

  // Today's date after mount, never during render. `/leaderboard` is server
  // rendered, and a clock read on both sides disagrees across midnight UTC — a
  // hydration mismatch that would make a tab appear and vanish. Same discipline the
  // Opening screen uses for `sessionStorage`.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todaysDaily()?.date ?? null), []);

  // Two filters that do not exist on every board. Both are neutralised by
  // DERIVATION rather than by resetting state in an effect: an effect would let one
  // fetch go out with the stale filter still armed, and the player would watch the
  // board come back empty before it corrected itself.
  //
  // The daily is a Story run, so its board only exists behind the Story tab; and it
  // fixes the background for everyone, so there is nothing left to segment on it.
  const showDaily = mode === "story" && today !== null;
  const scope: LeaderboardScope = showDaily || scopePick !== "daily" ? scopePick : "all";
  const scopeTabs = showDaily ? [...SCOPE_TABS, DAILY_TAB] : SCOPE_TABS;
  const showBackgrounds = mode !== "cashflow" && scope !== "daily";
  const background = showBackgrounds ? backgroundPick : ALL_BACKGROUNDS;

  const profileId = profile?.id ?? null;
  /**
   * The day, but only where the query actually uses it.
   *
   * `today` resolves after mount (see above), and it sat in the fetch effect's
   * dependency list — so on `/leaderboard`, where the board is open at mount, the
   * first fetch ran with `today === null` and an identical second fetch ran the
   * instant the date landed. Two full pagination walks per page view, for a value
   * every scope but "daily" ignores. Narrowed to the usage: non-daily scopes never
   * see it change, and the daily tab does not exist until `today` does (`showDaily`).
   */
  const dailyKey = scope === "daily" ? today : null;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const friendIds =
          scope === "friends" && profileId ? await listFriendIds(profileId) : [];
        const top = await topResults(mode, {
          scope,
          friendIds,
          backgroundId: background === ALL_BACKGROUNDS ? undefined : background,
          daily: dailyKey ?? undefined,
        });
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
  }, [open, mode, scope, background, dailyKey, profileId, sfx, retry, refreshSignal]);

  const metric = scoreMetric(mode);
  // Each tab strip namespaces its own tab ids (see LedgerTabs' `idPrefix`). The MODE
  // strip's prefix is named here because the panel below points `aria-labelledby` at
  // one of its tabs, and the two must not drift apart.
  const modeTabs = `${panelId}-mode`;
  const isPage = chrome === "page";
  // The page breathes at the section rhythm the rest of the site uses; the dialog stays tight
  // because it is a card, not a document.
  const gutter = isPage ? "px-5 sm:px-8" : "px-5";

  const board = (
    <>
      <LedgerTabs
        items={MODE_TABS}
        value={mode}
        onChange={setMode}
        label="Leaderboard mode"
        panelId={panelId}
        idPrefix={modeTabs}
        className={`${gutter} pt-4`}
      />
      <LedgerTabs
        items={scopeTabs}
        value={scope}
        onChange={setScope}
        label="Leaderboard range"
        panelId={panelId}
        // Namespaced because "all" is an id in BOTH this strip and the background
        // strip below, and they share one panel.
        idPrefix={`${panelId}-scope`}
        size="sm"
        className={`${gutter} pt-2`}
      />
      {showBackgrounds && (
        <LedgerTabs
          items={BACKGROUND_TABS}
          value={background}
          onChange={setBackground}
          label="Leaderboard starting background"
          panelId={panelId}
          idPrefix={`${panelId}-bg`}
          size="sm"
          className={`${gutter} pt-2`}
        />
      )}

      <p className={`voice ${gutter} pt-3 text-xs text-secondary`}>
        {scope === "daily"
          ? `Today's puzzle — the same seed, the same opening and the same twenty-one years for everyone on this board. Ranked by ${metric}.`
          : `Best run per player, ranked by ${metric}.`}
        {background !== ALL_BACKGROUNDS && " Only runs that recorded which background they started from appear here."}
      </p>
      {/* Only explain a mark that is actually on screen — a legend over an empty
          board, or over rows that all predate the check, is chrome for nothing. */}
      {rows.some((r) => r.metrics.verified === 1) && (
        <p className={`voice ${gutter} pt-1 text-xs text-tertiary`}>
          <span aria-hidden>{VERIFIED_MARK}</span> replayed — the run re-simulated to the
          score it claims, on the device that played it. It is a self-check, not a proof.
        </p>
      )}

      {/* The way in, on the one tab that needs it. Deliberately here rather than in
          the empty state: a player who already has friends still needs to reach
          their code, and they never see an empty board again. */}
      {scope === "friends" && onOpenFriends && (
        <div className={`${gutter} pt-3`}>
          <LedgerButton variant="secondary" size="sm" onClick={onOpenFriends}>
            Your code · add a friend
          </LedgerButton>
        </div>
      )}
    </>
  );

  const body = loading ? (
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
                {r.metrics.verified === 1 && (
                  <>
                    <span aria-hidden className="mr-1 align-middle text-[0.72em] text-secondary">
                      {VERIFIED_MARK}
                    </span>
                    <span className="sr-only">Replayed. </span>
                  </>
                )}
                <AnimatedNumber value={r.score} format={formatScore} />
              </span>
              <span className="block text-[0.65rem] uppercase tracking-wide text-secondary">
                {r.verdict}
              </span>
            </span>
          </motion.li>
        );
      })}
    </motion.ol>
  );

  if (isPage) {
    return (
      <main id="main" className="mx-auto flex min-h-[100svh] w-full max-w-3xl flex-col">
        {/* the house masthead rail, same grammar as the hero and the /r/[id] statement */}
        <div className="flex items-stretch border-b border-hairline">
          <div className="flex items-center gap-2 border-r border-hairline px-4 py-3 sm:px-6">
            <span className="eyebrow text-ink" style={{ fontSize: "0.62rem", letterSpacing: "0.2em" }}>
              LIFEPATCH
            </span>
            <span className="eyebrow text-tertiary" style={{ fontSize: "0.62rem" }}>
              / Compete
            </span>
          </div>
          <div className="ml-auto flex items-center px-4 py-3 sm:px-6">{pageAction}</div>
        </div>

        <header className={`${gutter} border-b-2 border-hairline-strong pb-6 pt-10`}>
          <p className="eyebrow text-ink">Form 02 — Standing</p>
          <h1 className="display-caps mt-3 text-4xl text-ink sm:text-6xl">Leaderboards</h1>
          <div className="mt-5 h-px w-24 bg-ink" />
        </header>

        {board}

        <div className={`${gutter} flex-1 pb-10 pt-2`} id={panelId} role="tabpanel" aria-labelledby={tabId(modeTabs, mode)}>
          {body}
        </div>

        <footer className={`${gutter} mt-auto flex items-center justify-between border-t border-hairline py-4`}>
          <span className="eyebrow text-tertiary" style={{ fontSize: "0.55rem" }}>
            Lifepatch · Form 02
          </span>
          <span className="eyebrow text-tertiary" style={{ fontSize: "0.55rem" }}>
            Best run per player
          </span>
        </footer>
      </main>
    );
  }

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
                data-radius=""
                className="grid h-11 w-11 place-items-center border-2 border-hairline-strong text-ink-dim transition-colors hover:border-ink hover:text-ink"
              >
                <CloseIcon size={16} />
              </button>
            </header>

            {/* one tab treatment for both axes — they used to be filled pills over
                underlined text, two visual languages inside one overlay */}
            {board}

            {/* keyboard-reachable because the rows hold no focusable children; the ring is
                pulled inward since the card clips at its own edge and a 2px outward offset
                would render as two floating bars */}
            <div
              className="thin-scroll mt-2 flex-1 overflow-y-auto px-3 pb-3 [&:focus-visible]:[outline-offset:-2px]"
              id={panelId}
              role="tabpanel"
              aria-labelledby={tabId(modeTabs, mode)}
              tabIndex={0}
              data-lenis-prevent
            >
              {body}
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
  // A rank is a static ordinal — there is nothing for a count-up to reveal, and a
  // scroll-gated ticker would paint "0" for every row below the fold of a 25-row
  // board. The row's split-flap landing (listItem) is the ceremony.
  if (rank <= 3) {
    return (
      <span
        className="grid h-6 w-6 shrink-0 place-items-center text-[0.72rem] font-bold text-bg"
        style={{ background: MEDALS[rank - 1] }}
      >
        <span className="num">{rank}</span>
      </span>
    );
  }
  return (
    <span className="w-6 shrink-0 text-right text-sm text-secondary">
      <span className="num">{rank}</span>
    </span>
  );
}

function EmptyState({ scope, reduced }: { scope: LeaderboardScope; reduced: boolean }) {
  const msg =
    scope === "friends"
      ? "No friends added yet. Share your friend code to race together."
      : scope === "week"
        ? "No runs this week. Finish a run to claim the top spot."
        : scope === "daily"
          ? "Nobody has filed today's ledger yet. Play it and the board starts with you."
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
