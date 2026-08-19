"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ConceptToast } from "@/components/learn/ConceptToast";
import { useAudio } from "@/hooks/useAudio";
import { useAuth } from "@/hooks/useAuth";
import { resolvePlayerId, resolveProgressId } from "@/lib/cloud/identity";
import { recordConcepts } from "@/lib/cloud/mastery";
import { markSeen } from "@/lib/cloud/seen";

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
        const id = resolveProgressId(user?.id ?? null);
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

/** Safe outside the provider too — returns a no-op so callers stay decoupled. */
export function useConceptLearn(): ConceptCtx {
  return useContext(Ctx) ?? { learn: () => {}, runGains: [], resetRun: () => {} };
}
