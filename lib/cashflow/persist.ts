import { STATE_VERSION } from "./engine";
import type { CashflowState } from "./types";

// Solo game → local persistence only. Self-contained so it never touches the
// RunState-typed lib/saves.ts.
const KEY = "lifepatch.cashflow.v1";

export function saveCashflow(s: CashflowState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

export function loadCashflow(): CashflowState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as CashflowState;
    if (!s || s.version !== STATE_VERSION) return null;
    return s;
  } catch {
    return null;
  }
}

export function clearCashflow(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

export function hasCashflowSave(): boolean {
  return loadCashflow() !== null;
}
