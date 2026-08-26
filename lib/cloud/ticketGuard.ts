import { BACKGROUNDS } from "../backgrounds";
import { dailyBackgroundId, dailyNumber, dailySeed, DAILY_MODE, isDailyDate, todayUTC } from "../daily";
import { ASSET_IDS, type AssetId } from "../markets";
import type { ReplayTicket } from "../replay";
import { MAX_ACTS_PER_YEAR, type JournalAct, type YearJournal } from "../runEngine";

/**
 * The gate on `app/api/submit-result` — everything that decides whether a request
 * is a ticket at all, and whether a daily claim is true.
 *
 * A module rather than part of the route, for two reasons. Next.js validates the
 * exports of a `route.ts` and refuses names outside its own contract, so nothing
 * in here could be reached by a test while it lived there. And the reasoning is
 * worth testing: `scripts/qa/verify-route.mjs` drives real runs through it and
 * proves an honest ticket survives, a tampered one does not, and a daily claim
 * only holds for the day that actually produced the seed.
 */

/**
 * A ceiling on the journal this route will replay.
 *
 * Not a game rule — the engine has no year limit, and Infinite is called that for
 * a reason. It is a bound on an UNTRUSTED request: replaying is real CPU, and a
 * body claiming a hundred thousand years would spend all of it before failing.
 * A life that outlives this was not lived; the death model ends a run long before
 * it, and the sweep in this branch never saw a run past 90.
 */
export const MAX_JOURNAL_YEARS = 250;

/** Bytes of JSON this route will read. A ticket for a 90-year run is a few KB. */
export const MAX_BODY_BYTES = 512 * 1024;

// Both derived from the engine's own lists rather than written out here. A
// hand-copied allowlist is a second source of truth that silently rejects real
// play the moment the first one gains an entry — and the failure mode is a run
// that will not post, with a 400 blaming the player's own trade.
const BACKGROUND_IDS = new Set(BACKGROUNDS.map((b) => b.id));
const ASSETS = new Set<string>(ASSET_IDS);

export type Fail = { status: number; error: string };

function bad(status: number, error: string): Fail {
  return { status, error };
}

function isFiniteInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v);
}

/**
 * Rebuild the ticket field by field, or say why it cannot be one.
 *
 * Deliberately a REBUILD and not a validation pass. `lib/mp/protocol.ts` already
 * draws this line for the wire, and the reasoning is the same here: a checked cast
 * lets every field nobody thought to check ride through untouched, and the object
 * that reaches the engine is the attacker's, not ours. What comes out of this
 * function contains only keys written by this function.
 */
export function parseTicket(raw: unknown): ReplayTicket | Fail {
  if (!raw || typeof raw !== "object") return bad(400, "ticket must be an object");
  const t = raw as Record<string, unknown>;

  const mode = t.mode;
  // Cashflow has no journal to replay — its state records dice rolls, not
  // decisions — so it is not verifiable here and does not pretend to be. It posts
  // from the client and never carries the flag.
  if (mode !== "story" && mode !== "infinite") return bad(400, "mode must be story or infinite");

  const backgroundId = t.backgroundId;
  if (typeof backgroundId !== "string" || !BACKGROUND_IDS.has(backgroundId)) {
    return bad(400, "unknown backgroundId");
  }

  const name = typeof t.name === "string" ? t.name.slice(0, 64) : "";

  const seed = t.seed;
  if (!isFiniteInt(seed) || seed < 0 || seed > Number.MAX_SAFE_INTEGER) return bad(400, "seed must be a non-negative integer");

  const journalRaw = t.journal;
  if (!Array.isArray(journalRaw)) return bad(400, "journal must be an array");
  if (journalRaw.length === 0) return bad(400, "journal is empty");
  if (journalRaw.length > MAX_JOURNAL_YEARS) return bad(413, "journal is too long to replay");

  const journal: YearJournal[] = [];
  for (const entryRaw of journalRaw) {
    if (!entryRaw || typeof entryRaw !== "object") return bad(400, "journal entry must be an object");
    const e = entryRaw as Record<string, unknown>;
    if (!isFiniteInt(e.y)) return bad(400, "journal entry year must be an integer");
    if (!Array.isArray(e.deal)) return bad(400, "journal entry deal must be an array");
    if (!e.deal.every((id) => typeof id === "string" && id.length <= 64)) return bad(400, "malformed deal");
    if (!Array.isArray(e.acts)) return bad(400, "journal entry acts must be an array");
    // The engine's own ceiling, applied to the request. `record` drops a journal
    // that exceeds it, so a ticket claiming more years-worth of actions than the
    // engine would ever have written is not a ticket the engine produced.
    if (e.acts.length > MAX_ACTS_PER_YEAR) return bad(400, "too many acts in one year");

    const acts: JournalAct[] = [];
    for (const actRaw of e.acts) {
      if (!Array.isArray(actRaw) || actRaw.length === 0) return bad(400, "malformed act");
      const kind = actRaw[0];
      if (kind === "c") {
        const [, eventId, choiceId, outcomeIdx] = actRaw;
        if (typeof eventId !== "string" || eventId.length > 64) return bad(400, "malformed choice act");
        if (typeof choiceId !== "string" || choiceId.length > 64) return bad(400, "malformed choice act");
        if (!isFiniteInt(outcomeIdx) || outcomeIdx < 0 || outcomeIdx > 64) return bad(400, "malformed choice act");
        acts.push(["c", eventId, choiceId, outcomeIdx] as const);
      } else if (kind === "t") {
        const [, asset, dollars] = actRaw;
        if (typeof asset !== "string" || !ASSETS.has(asset)) return bad(400, "unknown asset");
        if (typeof dollars !== "number" || !Number.isFinite(dollars)) return bad(400, "malformed trade act");
        acts.push(["t", asset as AssetId, Math.round(dollars)] as const);
      } else if (kind === "d") {
        const [, dollars] = actRaw;
        if (typeof dollars !== "number" || !Number.isFinite(dollars)) return bad(400, "malformed debt act");
        acts.push(["d", Math.round(dollars)] as const);
      } else if (kind === "h") {
        acts.push(["h"] as const);
      } else {
        return bad(400, "unknown act kind");
      }
    }

    const end = e.end === "retire" || e.end === "quit" ? e.end : undefined;
    journal.push({ y: e.y, deal: e.deal.map(String), acts, ...(end ? { end } : {}) });
  }

  const weakSpotsRaw = t.weakSpots;
  const weakSpots = Array.isArray(weakSpotsRaw)
    ? weakSpotsRaw.filter((w): w is string => typeof w === "string" && w.length <= 64).slice(0, 16)
    : undefined;

  return {
    mode,
    backgroundId,
    name,
    seed,
    sharedEvents: t.sharedEvents === true || undefined,
    weakSpots,
    // A ticket posted to this route describes a FINISHED run. `open` marks a year
    // still being played, and a replay that stopped early would derive a score
    // from a life that has not happened yet — so it is never honoured here, and
    // the `status === "ended"` check below is what enforces it.
    journal,
  };
}

/**
 * Is this run really an attempt at the day it says it is?
 *
 * `metrics.daily` is what the Daily Ledger board filters on, and until now it was
 * simply declared by the browser. `lib/daily.ts` is a pure function of a date, so
 * a player could compute any past day's seed, play it at leisure with as many
 * restarts as they liked, and file the best one under today. The day is derived
 * here from the same pure function, and the claim only survives if the seed AND
 * the background it fixes both match the ticket that was actually replayed.
 *
 * ── The background check has a cost, and it is worth naming ────────────────
 * `dailyBackgroundId` is `(dailyNumber - 1) % BACKGROUNDS.length`, so adding or
 * reordering a background changes which one every PAST day resolves to. A daily
 * run finished across such a deploy would stop matching its own day.
 *
 * That is a real coupling and it is kept anyway, because the check does something
 * the seed cannot: the day fixes the background precisely so the board is not a
 * comparison of openings, and a run on the day's seed from a CHOSEN background is
 * not an attempt at that puzzle. What makes the cost acceptable is that a
 * rejection here is SOFT — the route answers `reject: "daily"` and the client
 * posts the run as an ordinary Story row rather than losing it. The worst a
 * background change can do is quietly retire a day's board, never a player's run.
 */
export function checkDaily(claim: unknown, ticket: ReplayTicket): string | null | Fail {
  if (claim === undefined || claim === null) return null;
  if (typeof claim !== "string" || !isDailyDate(claim)) return bad(400, "daily must be a YYYY-MM-DD date");
  if (dailyNumber(claim) < 1) return bad(400, "that date is before the first puzzle");
  // A day that has not started yet cannot have been played.
  if (claim > todayUTC()) return bad(400, "that puzzle has not opened yet");
  if (ticket.mode !== DAILY_MODE) return bad(400, "the daily is a Story run");
  if (dailySeed(claim) !== ticket.seed) return bad(400, "this run was not played on that day's world");
  if (dailyBackgroundId(claim) !== ticket.backgroundId) return bad(400, "this run was not played from that day's background");
  return claim;
}

export function isFail(v: unknown): v is Fail {
  return !!v && typeof v === "object" && typeof (v as Fail).status === "number" && typeof (v as Fail).error === "string";
}
