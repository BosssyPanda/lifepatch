"use client";

import { useCallback, useState } from "react";
import { initCashflow } from "@/lib/cashflow/engine";
import { clearCashflow, loadCashflow, saveCashflow } from "@/lib/cashflow/persist";
import type { CashflowState } from "@/lib/cashflow/types";

/** Owns the Cashflow game state. `apply` = transient (no save), `commit` = save. */
export function useCashflow() {
  const [state, setState] = useState<CashflowState | null>(null);

  const begin = useCallback((professionId: string, dreamId: string, name: string) => {
    const s = initCashflow(professionId, dreamId, name);
    setState(s);
    saveCashflow(s);
    return s;
  }, []);

  const apply = useCallback((fn: (s: CashflowState) => CashflowState) => {
    setState((prev) => (prev ? fn(prev) : prev));
  }, []);

  const commit = useCallback((fn: (s: CashflowState) => CashflowState) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      saveCashflow(next);
      return next;
    });
  }, []);

  const set = useCallback((next: CashflowState) => {
    setState(next);
    saveCashflow(next);
  }, []);

  const resume = useCallback(() => {
    const s = loadCashflow();
    if (s) setState(s);
    return s;
  }, []);

  const reset = useCallback(() => {
    setState(null);
    clearCashflow();
  }, []);

  return { state, apply, commit, set, begin, resume, reset };
}
