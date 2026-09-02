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
  if (!isCashflowShaped(s)) return null;
  return {
    ...s,
    version: 2,
    startingNetWorth:
      typeof s.startingNetWorth === "number" ? s.startingNetWorth : p.startingCash - startingLiabilities,
    lostReason: s.lostReason ?? null,
    interestPaid: typeof s.interestPaid === "number" ? s.interestPaid : 0,
    // Quotes open at deck prices. That happens to match every v1 holding's cost
    // basis today, because v1 always bought at the deck price and no price on this
    // branch moved — so a migrated book is not revalued. Edit a deck price and that
    // stops being true: this backfill would mark an old position to the new price.
    stockPrices: s.stockPrices && typeof s.stockPrices === "object" ? s.stockPrices : initialStockPrices(),
  };
}

/**
 * The fields every reader dereferences without checking first.
 *
 * `localStorage` is player-writable and the rest of this codebase says so out loud:
 * `lib/challenge.ts`'s `readChallenge` shape-guards every field because "a
 * half-written record must not reach the report as a row of undefineds", and
 * `lib/dailySave.ts`'s `readDaily` gates on `isCompatibleSave`. This was the one
 * persisted store that trusted its own bytes — a record of `{"version":2}` was
 * handed back as a `CashflowState`, and the first selector to touch it threw:
 * `passiveIncome` does `s.stocks.reduce(...)` on `undefined`. That is a
 * `TypeError` mid-render, caught only by `app/error.tsx` — and because
 * `hasCashflowSave()` runs the same loader, it landed on the MODE SELECT, before
 * the player had chosen anything, with no in-app way back short of clearing site
 * data.
 *
 * Deliberately the common floor of v1 and v2, so the migration can share it: the
 * four fields v1 lacks (`startingNetWorth`, `lostReason`, `interestPaid`,
 * `stockPrices`) are all backfilled below, and `quote` already answers a missing
 * quote board with the holding's cost basis. Cheap, and the only thing between a
 * hand-edited record and a dead screen.
 */
function isCashflowShaped(s: unknown): s is CashflowState {
  if (!s || typeof s !== "object") return false;
  const c = s as Partial<CashflowState>;
  return (
    typeof c.cash === "number" &&
    Number.isFinite(c.cash) &&
    !!c.liabilities &&
    !!c.expenses &&
    Array.isArray(c.stocks) &&
    Array.isArray(c.realEstate) &&
    Array.isArray(c.businesses)
  );
}

export function loadCashflow(): CashflowState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as CashflowState;
    if (!s || typeof s.version !== "number") return null;
    // The version stamp is not the validation. A record carrying the CURRENT
    // version used to be returned unread, which is the one path a hand-edited
    // save could walk straight through.
    if (s.version === STATE_VERSION) return isCashflowShaped(s) ? s : null;
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
