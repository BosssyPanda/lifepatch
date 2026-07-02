"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { CloseIcon, LockIcon } from "@/components/icons";
import { MoneyBrainMeter, moneyBrainPct } from "@/components/learn/MoneyBrainMeter";
import { NeonButton } from "@/components/ui/NeonButton";
import { useAudio } from "@/hooks/useAudio";
import { useProfile } from "@/hooks/useProfile";
import { MAX_MASTERY_LEVEL } from "@/lib/cloud/mastery";
import { getSeen } from "@/lib/cloud/seen";
import { CATEGORY_META, CONCEPTS, type Concept, type ConceptCategory } from "@/lib/concepts";
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
  const { mastery } = useProfile();
  const { setBrainGlow } = useAudio();
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
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg/85 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.section
            className="paper relative flex max-h-[90svh] w-full max-w-2xl flex-col overflow-hidden rounded-[6px]"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: DUR.base, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="border-b-2 border-ink/15 px-5 py-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="eyebrow text-ink">Your progress</p>
                  <h2 className="display-caps text-3xl text-ink">Money Brain</h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close Money Brain"
                  className="grid h-9 w-9 place-items-center rounded-full border-2 border-ink/25 text-ink/70 transition-colors hover:bg-ink/10"
                >
                  <CloseIcon size={16} />
                </button>
              </div>
              <div className="mt-3">
                <MoneyBrainMeter mastery={mastery} />
                <p className="mt-1.5 font-body text-xs italic text-secondary">
                  {masteredCount} of {CONCEPTS.length} concepts mastered · master by applying them
                  well, not just seeing them.
                </p>
              </div>
            </header>

            <div className="thin-scroll flex-1 overflow-y-auto px-5 py-4">
              {ORDER.map((cat) => {
                const concepts = CONCEPTS.filter((c) => c.category === cat);
                const meta = CATEGORY_META[cat];
                return (
                  <div key={cat} className="mb-5 last:mb-0">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="h-3 w-3 rounded-[2px]" style={{ background: "var(--color-secondary)" }} />
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
                          onToggle={() => setSelected((s) => (s === c.id ? null : c.id))}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <footer className="border-t-2 border-ink/10 px-5 py-3">
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

function ConceptNode({
  concept,
  state,
  level,
  expanded,
  onToggle,
}: {
  concept: Concept;
  state: NodeState;
  level: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const locked = state === "locked";
  const meta = CATEGORY_META[concept.category];
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-[4px] border px-3 py-2 text-left transition-all ${
        locked
          ? "border-ink/10 opacity-55"
          : "border-ink/20 hover:border-ink/50 hover:bg-ink/[0.03]"
      } ${expanded ? "col-span-2 bg-ink/[0.04] sm:col-span-3" : ""}`}
      style={state === "mastering" ? { borderColor: "var(--color-secondary)" } : undefined}
    >
      <span className="inline-flex items-center gap-1 font-mono text-[0.82rem] font-semibold leading-tight text-ink">
        {locked && <LockIcon size={11} className="shrink-0 opacity-70" />}
        {concept.title}
      </span>
      {state === "mastering" ? (
        <span className="mt-1.5 flex gap-0.5" aria-label={`Level ${level} of ${MAX_MASTERY_LEVEL}`}>
          {Array.from({ length: MAX_MASTERY_LEVEL }).map((_, i) => (
            <span
              key={i}
              className="h-1.5 flex-1 rounded-full"
              style={{ background: "var(--color-gain)", opacity: i < level ? 1 : 0.14 }}
            />
          ))}
        </span>
      ) : (
        <span className="eyebrow mt-1.5 block text-[0.55rem] text-secondary">
          {state === "introduced" ? "Introduced" : "Locked"}
        </span>
      )}
      {expanded && (
        <p className="mt-2 font-body text-[0.82rem] italic leading-snug text-ink/75">
          {concept.def}
        </p>
      )}
    </button>
  );
}
