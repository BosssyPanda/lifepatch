import { initialStockPrices } from "./decks";
import { STATE_VERSION } from "./engine";
import { getProfession } from "./professions";
import type { CashflowState } from "./types";

// Solo game → local persistence only. Self-contained so it never touches the
// RunState-typed lib/saves.ts.
const KEY = "lifepatch.cashflow.v1";

export function saveCashflow(s: CashflowState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

/**
 * v1 → v2: the balance sheet was restructured (net worth double-counted property
 * and business debt) and the Freedom meter gained a solvency drag, which needs a
 * baseline. A v1 save has no `startingNetWorth`, no `lostReason`, no quote board
 * and no interest ledger — all four are recoverable, so old runs migrate rather
 * than being thrown away mid-game.
 */
function migrateV1(raw: Partial<CashflowState> & { version: number }): CashflowState | null {
  const p = getProfession(String(raw.professionId ?? ""));
  const startingLiabilities =
    p.liab.homeMortgage + p.liab.schoolLoan + p.liab.carLoan + p.liab.creditCard + p.liab.retail;
  const s = raw as CashflowState;
  if (!s.liabilities || !s.expenses || !Array.isArray(s.stocks)) return null;
  return {
    ...s,
    version: 2,
    startingNetWorth:
      typeof s.startingNetWorth === "number" ? s.startingNetWorth : p.startingCash - startingLiabilities,
    lostReason: s.lostReason ?? null,
    interestPaid: typeof s.interestPaid === "number" ? s.interestPaid : 0,
    // Quotes open at deck prices; anything already held keeps its cost basis as
    // its fallback, so a migrated book is never revalued behind the player's back.
    stockPrices: s.stockPrices && typeof s.stockPrices === "object" ? s.stockPrices : initialStockPrices(),
  };
}

export function loadCashflow(): CashflowState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as CashflowState;
    if (!s || typeof s.version !== "number") return null;
    if (s.version === STATE_VERSION) return s;
    if (s.version === 1) return migrateV1(s);
    return null; // a save from the future — don't guess at it
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
