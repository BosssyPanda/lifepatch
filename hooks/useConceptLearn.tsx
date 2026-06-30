"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Toast } from "@/components/cashflow/shared";
import { useAudio } from "@/hooks/useAudio";
import { useAuth } from "@/hooks/useAuth";
import { resolvePlayerId } from "@/lib/cloud/identity";
import { recordConcepts } from "@/lib/cloud/mastery";
import { markSeen } from "@/lib/cloud/seen";
import { getConcept } from "@/lib/concepts";

/**
 * The learning bus. Gameplay calls `learn(conceptIds, { applied })` whenever a
 * tagged teaching moment resolves:
 *  - newly-seen concepts fire a "You just learned: X" toast (local SEEN track),
 *  - applied (good outcome / correct quiz / bought asset) raises mastery level
 *    via recordConcepts (cloud MASTERED track, mastery-only).
 * `runGains` collects concepts leveled this run for the end-of-run summary.
 */

type LearnOpts = { applied?: boolean };

type ConceptCtx = {
  learn: (conceptIds: string[], opts?: LearnOpts) => void;
  runGains: string[];
  resetRun: () => void;
};

const Ctx = createContext<ConceptCtx | null>(null);

const TOAST_MS = 2600;

export function ConceptLearnProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { accent } = useAudio();
  const [queue, setQueue] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [runGains, setRunGains] = useState<string[]>([]);

  // Drain the toast queue one concept at a time.
  useEffect(() => {
    if (current || queue.length === 0) return;
    const [next, ...rest] = queue;
    setCurrent(next);
    setQueue(rest);
    const t = setTimeout(() => setCurrent(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [queue, current]);

  const learn = useCallback(
    (conceptIds: string[], opts?: LearnOpts) => {
      const ids = Array.from(new Set(conceptIds.filter(Boolean)));
      if (ids.length === 0) return;

      const newly = markSeen(ids);
      if (newly.length > 0) setQueue((q) => [...q, ...newly]);

      if (opts?.applied) {
        const id = resolvePlayerId(user?.id ?? null);
        if (id) {
          void recordConcepts(id, ids)
            .then((gains) => {
              // only concepts whose level actually rose (drop cap re-hits)
              const rose = gains.filter((g) => g.level > g.prevLevel);
              if (rose.length === 0) return;
              setRunGains((r) => Array.from(new Set([...r, ...rose.map((g) => g.conceptId)])));
              // newly mastered is the bigger moment; otherwise a level-up flourish
              accent(rose.some((g) => g.isFirst) ? "mastered" : "levelup");
            })
            .catch(() => {});
        } else {
          setRunGains((r) => Array.from(new Set([...r, ...ids])));
        }
      }
    },
    [user, accent],
  );

  const resetRun = useCallback(() => setRunGains([]), []);

  return (
    <Ctx.Provider value={{ learn, runGains, resetRun }}>
      {children}
      <ConceptToast conceptId={current} />
    </Ctx.Provider>
  );
}

function ConceptToast({ conceptId }: { conceptId: string | null }) {
  const concept = conceptId ? getConcept(conceptId) : undefined;
  return (
    <Toast show={!!conceptId}>
      <div className="flex items-center gap-3 rounded-full border border-accent/40 bg-bg2/95 px-5 py-2.5 shadow-xl">
        <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-base">
          🧠
        </span>
        <span className="leading-tight">
          <span className="eyebrow block text-[0.58rem] text-accent">You just learned</span>
          <span className="display-caps text-sm text-ink">{concept?.title ?? conceptId}</span>
        </span>
      </div>
    </Toast>
  );
}

/** Safe outside the provider too — returns a no-op so callers stay decoupled. */
export function useConceptLearn(): ConceptCtx {
  return useContext(Ctx) ?? { learn: () => {}, runGains: [], resetRun: () => {} };
}
