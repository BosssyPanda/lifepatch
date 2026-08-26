"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { CloseIcon, LockIcon } from "@/components/icons";
import { MoneyBrainMeter, moneyBrainPct } from "@/components/learn/MoneyBrainMeter";
import { LedgerButton } from "@/components/ui/LedgerButton";
import { LedgerDialog } from "@/components/ui/LedgerDialog";
import { TerminalOp } from "@/components/ui/TerminalOp";
import { useAudio } from "@/hooks/useAudio";
import { useProfile } from "@/hooks/useProfile";
import { MAX_MASTERY_LEVEL } from "@/lib/cloud/mastery";
import { getSeen } from "@/lib/cloud/seen";
import { CATEGORY_META, CONCEPTS, type Concept, type ConceptCategory } from "@/lib/concepts";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { DUR, EASE } from "@/src/motion/tokens";
const ORDER: ConceptCategory[] = ["earn", "grow", "protect", "borrow", "spend"];

type NodeState = "locked" | "introduced" | "mastering";

function nodeState(level: number, seen: boolean): NodeState {
  if (level >= 1) return "mastering";
  return seen ? "introduced" : "locked";
}

/**
 * The "Money Brain" — a constellation of every financial concept the game teaches,
 * grouped by category. Locked (never seen) → Introduced (met) → Mastering L1–5
 * (proven through correct application). Same overlay pattern as the Leaderboard.
 */
export function MasteryMap({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mastery, loading, failed } = useProfile();
  const { setBrainGlow } = useAudio();
  const { reduced } = useMotionCtx();
  const [selected, setSelected] = useState<string | null>(null);
  const [seen, setSeen] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setSeen(getSeen());
      setSelected(null);
    }
  }, [open, mastery]);

  const levelOf = useMemo(() => {
    const m = new Map(mastery.map((r) => [r.conceptId, r.level]));
    return (id: string) => m.get(id) ?? 0;
  }, [mastery]);

  const seenSet = useMemo(() => new Set(seen), [seen]);
  const masteredCount = CONCEPTS.filter((c) => levelOf(c.id) >= 1).length;
  const pct = moneyBrainPct(mastery);

  // a richer Money Brain warms the calm menu/recap bed while the map is open
  useEffect(() => {
    if (open) setBrainGlow(pct / 100);
  }, [open, pct, setBrainGlow]);

  return (
    <AnimatePresence>
      {open && (
        <LedgerDialog
          open={open}
          onClose={onClose}
          label="Money Brain"
          dismissOnScrimClick
          maxWidth="max-w-2xl"
          className="max-h-[90svh] overflow-hidden"
          card={{
            initial: { opacity: 0, y: 24, scale: 0.98 },
            animate: { opacity: 1, y: 0, scale: 1 },
            // exits run ~30% faster than the enter they reverse
            exit: { opacity: 0, y: 16, scale: 0.98, transition: { duration: DUR.exitFast, ease: EASE } },
            transition: { duration: DUR.base, ease: EASE },
          }}
        >
            <header className="border-b-2 border-hairline-strong px-5 py-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="eyebrow text-ink">Your progress</p>
                  <h2 className="display-caps text-3xl text-ink">Money Brain</h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close Money Brain"
                  data-radius=""
                  className="grid h-11 w-11 place-items-center border-2 border-hairline-strong text-ink-dim transition-colors hover:border-ink hover:text-ink"
                >
                  <CloseIcon size={16} />
                </button>
              </div>
              <div className="mt-3">
                <MoneyBrainMeter mastery={mastery} />
                <p className="voice mt-1.5 text-xs text-secondary">
                  {loading
                    ? "Reading your record…"
                    : failed
                      ? "Your record could not be read — this is not a score."
                      : `${masteredCount} of ${CONCEPTS.length} concepts mastered · master by applying them well, not just seeing them.`}
                </p>
              </div>
            </header>

            <div className="thin-scroll flex-1 overflow-y-auto px-5 py-4" data-lenis-prevent>
              {/* While the profile is in flight every concept resolves to "Locked", which is
                  indistinguishable from a genuine zero — say we're still reading instead.
                  A load that FAILED has the same problem and never resolves out of it, so it
                  gets its own sentence rather than silently printing a map of zeroes. */}
              {loading ? (
                <div className="grid place-items-center py-16">
                  <TerminalOp label="Reading your record" center />
                </div>
              ) : failed ? (
                <div className="grid place-items-center gap-2 px-6 py-16 text-center">
                  <p className="display-caps text-lg text-ink">RECORD UNAVAILABLE</p>
                  <p className="voice max-w-sm text-[0.95rem] text-ink-dim">
                    We couldn&apos;t read your concept record just now. Nothing has been lost —
                    close this and open it again once you&apos;re back online.
                  </p>
                </div>
              ) : (
              ORDER.map((cat) => {
                const concepts = CONCEPTS.filter((c) => c.category === cat);
                const meta = CATEGORY_META[cat];
                return (
                  <div key={cat} className="mb-5 last:mb-0">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="h-3 w-3" style={{ background: "var(--color-secondary)" }} />
                      <span className="eyebrow text-secondary">{meta.label}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {concepts.map((c) => (
                        <ConceptNode
                          key={c.id}
                          concept={c}
                          state={nodeState(levelOf(c.id), seenSet.has(c.id))}
                          level={levelOf(c.id)}
                          expanded={selected === c.id}
                          reduced={reduced}
                          onToggle={() => setSelected((s) => (s === c.id ? null : c.id))}
                        />
                      ))}
                    </div>
                  </div>
                );
              })
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

/**
 * Expanding a node used to widen it to `col-span-2 sm:col-span-3` with nothing but a
 * CSS `transition-all`, so the grid re-flowed instantly and shoved every later node
 * down with no motion at all. The span change is the same, but the node (and its
 * displaced neighbours) are `layout` components now, so framer animates the reflow
 * as transforms. Reduced motion opts out and keeps the instant re-flow.
 */
function ConceptNode({
  concept,
  state,
  level,
  expanded,
  reduced,
  onToggle,
}: {
  concept: Concept;
  state: NodeState;
  level: number;
  expanded: boolean;
  reduced: boolean;
  onToggle: () => void;
}) {
  const locked = state === "locked";
  return (
    <motion.button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      data-radius=""
      layout={reduced ? false : true}
      transition={{ duration: DUR.base, ease: EASE }}
      className={`border px-3 py-2 text-left transition-colors ${
        locked
          ? "border-hairline opacity-55"
          : "border-hairline-strong hover:border-ink hover:bg-ink/[0.03]"
      } ${expanded ? "col-span-2 bg-ink/[0.04] sm:col-span-3" : ""}`}
      style={state === "mastering" ? { borderColor: "var(--color-secondary)" } : undefined}
    >
      {/* `layout="position"` on the contents: the node's box is what resizes, so the
          children ride along on translate only and never get scale-distorted. */}
      <motion.span
        layout={reduced ? false : "position"}
        className="inline-flex items-center gap-1 font-mono text-[0.82rem] font-semibold leading-tight text-ink"
      >
        {locked && <LockIcon size={11} className="shrink-0 opacity-70" />}
        {concept.title}
      </motion.span>
      {state === "mastering" ? (
        <span className="mt-1.5 flex gap-0.5" aria-label={`Level ${level} of ${MAX_MASTERY_LEVEL}`}>
          {Array.from({ length: MAX_MASTERY_LEVEL }).map((_, i) => (
            <span
              key={i}
              className="h-1.5 flex-1"
              // Chartreuse, not gain-green: a mastery tick is EARNED, and green here would
              // read as money. Never accent either — these are not the primary path.
              style={{ background: i < level ? "var(--color-highlight)" : "var(--color-hairline)" }}
            />
          ))}
        </span>
      ) : (
        <span className="eyebrow mt-1.5 block text-[0.55rem] text-secondary">
          {state === "introduced" ? "Introduced" : "Locked"}
        </span>
      )}
      {/* span, not p: a <button> takes phrasing content only */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.span
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: DUR.exitFast } }}
            transition={{ duration: DUR.fast, ease: EASE }}
            className="voice mt-2 block text-[0.82rem] leading-snug text-ink/75"
          >
            {concept.def}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
