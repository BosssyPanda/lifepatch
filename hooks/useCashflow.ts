"use client";

import { useCallback, useRef, useState } from "react";
import { initCashflow } from "@/lib/cashflow/engine";
import { clearCashflow, loadCashflow, saveCashflow } from "@/lib/cashflow/persist";
import type { CashflowState } from "@/lib/cashflow/types";

/**
 * QA/replay hook: `?seed=12345` pins the run's RNG so a bug can be reproduced
 * turn for turn. Dev only — a production build ignores the parameter, so nobody
 * can hand a friend a "lucky" link.
 */
function seedFromUrl(): number | undefined {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return undefined;
  const raw = new URLSearchParams(window.location.search).get("seed");
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.abs(n) : undefined;
}

/**
 * Owns the Cashflow game state.
 *
 * Every mutator here saves. There used to be a second, transient path — `apply`,
 * which wrote React state and nothing else — and its only caller was the dice roll,
 * which is precisely the state that most needed to survive a refresh. Rather than
 * leave a no-save door standing next to the fixed one, it is removed.
 */
export function useCashflow() {
  const [state, setState] = useState<CashflowState | null>(null);
  /**
   * The live state, written synchronously by every path that can change it.
   *
   * Same device as `hooks/useRun.ts`'s `liveRef`, and here for the same reason:
   * `commit` used to call `saveCashflow` from inside a `setState` updater, and React
   * is allowed to invoke an updater twice. Reading the previous state from a ref
   * lets the write happen exactly once per call, and two calls in one tick still
   * see each other because the ref is updated before the second one reads it.
   */
  const liveRef = useRef<CashflowState | null>(null);

  const begin = useCallback((professionId: string, dreamId: string, name: string) => {
    const s = initCashflow(professionId, dreamId, name, seedFromUrl());
    liveRef.current = s;
    setState(s);
    saveCashflow(s);
    return s;
  }, []);

  const commit = useCallback((fn: (s: CashflowState) => CashflowState) => {
    const prev = liveRef.current;
    if (!prev) return;
    const next = fn(prev);
    liveRef.current = next;
    setState(next);
    saveCashflow(next);
  }, []);

  const set = useCallback((next: CashflowState) => {
    liveRef.current = next;
    setState(next);
    saveCashflow(next);
  }, []);

  const resume = useCallback(() => {
    const s = loadCashflow();
    if (s) {
      liveRef.current = s;
      setState(s);
    }
    return s;
  }, []);

  const reset = useCallback(() => {
    liveRef.current = null;
    setState(null);
    clearCashflow();
  }, []);

  return { state, commit, set, begin, resume, reset };
}
