import type { ReplayTicket } from "../replay";
import { isCloud, supabase } from "../supabase";
import { comparabilityMarker } from "./comparability";
import type { GameMode, NewResult, ResultRow } from "./types";

/**
 * Finished-run results → leaderboards + shareable cards. Cloud → `results` table
 * (indexed on mode, score desc); dev → a single localStorage list. Leaderboards
 * dedupe to each player's best run.
 */

const LIST_KEY = "lifepatch.results";
const DEFAULT_LIMIT = 25;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `daily` is not a mode — the Daily Ledger is a Story run — so it is a RANGE, the
 * same axis "this week" lives on: it narrows the story board to the rows that were
 * played on one specific day's puzzle.
 */
export type LeaderboardScope = "all" | "week" | "friends" | "daily";

export type TopOptions = {
  scope?: LeaderboardScope;
  friendIds?: string[];
  limit?: number;
  /**
   * Narrow the board to one starting background, so a run that began with a
   * student loan is not ranked against one that began with cash.
   *
   * Rows written before the background was recorded carry no `backgroundId` and
   * are therefore excluded by any value here — correctly: their starting position
   * is unknown, and guessing one would invent game data. The board says so rather
   * than quietly dropping them.
   */
  backgroundId?: string;
  /**
   * `YYYY-MM-DD` (UTC). Required when `scope` is `daily` — the scope alone cannot
   * pick a day, and defaulting to "today" inside a data module would put a clock
   * in the middle of a pure query.
   */
  daily?: string;
};

/**
 * `metrics` is `jsonb not null default '{}'` in the schema, but a column default
 * only covers rows that omit it — an explicit `null`, a legacy row, or anything
 * inserted outside this module can still arrive null, which is why `/r/[id]`
 * defensively writes `row.metrics ?? {}` at every single read. One consumer that
 * forgets (and `Leaderboard` did, twice) throws mid-render and takes the whole
 * board down for every player, not just that row.
 *
 * So it is normalized ONCE, here, at the boundary. Past this function the
 * non-optional type on `ResultRow` is true rather than hopeful. `?? {}` alone was
 * not enough: a JSON scalar or array is not null and would still not be an object.
 */
function toMetrics(raw: unknown): ResultRow["metrics"] {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as ResultRow["metrics"])
    : {};
}

function fromRow(row: Record<string, unknown>): ResultRow {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    mode: row.mode as GameMode,
    score: Number(row.score),
    verdict: String(row.verdict),
    metrics: toMetrics(row.metrics),
    createdAt: String(row.created_at),
  };
}

function readLocal(): ResultRow[] {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Same normalization the cloud rows get, for the same reason: this key is
    // hand-editable, and a row whose `metrics` is null renders identically to a
    // legacy cloud row right up until something dereferences it.
    return parsed.map((r) => ({ ...(r as ResultRow), metrics: toMetrics((r as ResultRow)?.metrics) }));
  } catch {
    return [];
  }
}

function writeLocal(rows: ResultRow[]): void {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(rows));
  } catch {}
}

function weekAgoIso(): string {
  return new Date(Date.now() - WEEK_MS).toISOString();
}

/** Keep only each player's single best run (highest score), sorted desc. */
function bestPerUser(rows: ResultRow[]): ResultRow[] {
  const best = new Map<string, ResultRow>();
  for (const r of rows) {
    const prev = best.get(r.userId);
    if (!prev || r.score > prev.score) best.set(r.userId, r);
  }
  return Array.from(best.values()).sort((a, b) => b.score - a.score);
}

/**
 * What the server did with a ticket.
 *
 * `null` is not an error and is the common case in a deployment that has not
 * finished the cutover: the route is not there, or it is there and could not
 * re-derive this particular run. Either way the run is real and still belongs on
 * the board — it simply posts without the flag, which is what an absent flag has
 * always meant.
 */
type ServerSubmit =
  | { kind: "posted"; row: ResultRow }
  /** Post it yourself. `dropDaily` when the server rejected the DAY it claimed —
   *  the run happened, it is just not provably that day's puzzle, so the tag has
   *  to come off rather than ride onto a board it cannot defend. */
  | { kind: "fallback"; dropDaily: boolean };

/**
 * Post the run through the server, which replays it and derives the score itself.
 *
 * Every refusal that is ABOUT THIS RUN falls back rather than throwing, and that
 * distinction is the one this function exists to draw. A 422 means "I could not
 * reproduce this run on this build" — which is exactly what a save carried across
 * an engine bump looks like (`migrateSave` documents it), and what any run
 * finished across a content deploy looks like. Treating that as fatal would
 * DELETE the run: it is not a claim the player made, it is a claim the server
 * could not check. It posts unverified, as it did before this route existed.
 *
 * Only "I could not reach you" and "your session is stale" throw, because those
 * are the two a retry can genuinely fix.
 */
async function submitViaServer(
  ticket: ReplayTicket,
  claimedScore: number,
  daily?: string,
): Promise<ServerSubmit> {
  const { data: session } = await supabase!.auth.getSession();
  const token = session.session?.access_token;
  // No session means no `auth.uid()`, so the direct insert is about to be refused
  // by RLS too. Let it be refused there, where the error already says so.
  if (!token) return { kind: "fallback", dropDaily: false };

  let res: Response;
  try {
    res = await fetch("/api/submit-result", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ ticket, claimedScore, ...(daily ? { daily } : {}) }),
    });
  } catch (err) {
    // The network, not a verdict. Retryable.
    throw new Error(`submit-result: could not reach the server: ${String(err)}`);
  }

  if (res.ok) {
    const json = (await res.json()) as { row?: Record<string, unknown> };
    if (!json.row) throw new Error("submit-result: the server returned no row");
    return { kind: "posted", row: fromRow(json.row) };
  }

  // 401 is a token that can be refreshed; 5xx is the server having a bad minute.
  // Both are worth another go, and neither is a statement about the run.
  if (res.status === 401 || res.status >= 500) {
    throw new Error(`submit-result failed: HTTP ${res.status}`);
  }

  let reason = `HTTP ${res.status}`;
  try {
    const json = (await res.json()) as { error?: string; reject?: string };
    if (json.error) reason = json.error;
    if (json.reject === "daily") {
      console.warn(`submit-result: this run is not provably that day's puzzle — posting it as an ordinary run (${reason})`);
      return { kind: "fallback", dropDaily: true };
    }
  } catch {}
  // 503 (no service key) and 404 (a build without the route) are silent by
  // design — that is a deployment state, not an event. Everything else is worth
  // one line, because it means a real run went onto the board unverified.
  if (res.status !== 503 && res.status !== 404) {
    console.warn(`submit-result: could not verify this run, posting it unverified — ${reason}`);
  }
  return { kind: "fallback", dropDaily: false };
}

/**
 * Write a finished run to the board.
 *
 * With a `ticket` — which every journaled life-sim run has — this goes through
 * `/api/submit-result`, and the score that lands is the one the SERVER derived by
 * replaying the run. The direct insert below is the fallback for the Rat Race
 * (nothing to replay), for a run with no journal, and for a deployment where the
 * route is not configured yet.
 */
export async function submitResult(
  userId: string,
  result: NewResult,
  ticket?: ReplayTicket | null,
): Promise<ResultRow> {
  let metrics = result.metrics ?? {};
  if (isCloud && supabase) {
    if (ticket && result.mode !== "cashflow") {
      const daily = typeof metrics.daily === "string" ? metrics.daily : undefined;
      const outcome = await submitViaServer(ticket, result.score, daily);
      if (outcome.kind === "posted") return outcome.row;
      // The server could not defend the day this run claims, so the claim comes
      // off before the row is written. Posting it with the tag intact would put
      // the run on a daily board on nothing but the browser's say-so, which is
      // the filing the binding exists to prevent.
      if (outcome.dropDaily && "daily" in metrics) {
        const { daily: _dropped, ...rest } = metrics;
        metrics = rest;
      }
    }
    const { data, error } = await supabase
      .from("results")
      .insert({
        user_id: userId,
        mode: result.mode,
        score: result.score,
        verdict: result.verdict,
        metrics,
      })
      .select("*")
      .single();
    // The raw Postgres message names tables, columns and constraints. This one is
    // only ever logged today, but the queue re-throws it and it is one render away
    // from a player's screen at any time — so it is logged where an operator can
    // read it and summarised where a caller can.
    if (error || !data) {
      console.error("submitResult: insert failed", error);
      throw new Error("Result submit failed");
    }
    return fromRow(data);
  }
  const row: ResultRow = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    mode: result.mode,
    score: result.score,
    verdict: result.verdict,
    metrics,
    createdAt: new Date().toISOString(),
  };
  writeLocal([row, ...readLocal()]);
  return row;
}

export async function topResults(mode: GameMode, opts: TopOptions = {}): Promise<ResultRow[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const scope = opts.scope ?? "all";
  const friendIds = opts.friendIds ?? [];
  const background = opts.backgroundId;
  const daily = opts.daily;

  if (scope === "friends" && friendIds.length === 0) return [];
  // A daily board with no day is not an empty board, it is a broken query.
  if (scope === "daily" && !daily) return [];

  if (isCloud && supabase) {
    let query = supabase
      .from("results")
      .select("*")
      .eq("mode", mode)
      .order("score", { ascending: false });
    if (scope === "week") query = query.gte("created_at", weekAgoIso());
    if (scope === "friends") query = query.in("user_id", friendIds);
    // `metrics->>backgroundId` is Postgres' text arrow, which PostgREST exposes as
    // a filterable column — the filter runs in the database, not over a page of
    // rows this client happened to fetch. Unindexed by design (no new SQL is
    // required to run this build); README carries the optional expression index.
    if (background) query = query.eq("metrics->>backgroundId", background);
    if (scope === "daily" && daily) query = query.eq("metrics->>daily", daily);
    // Only rows produced under the CURRENT rules are ranked. Same text-arrow
    // mechanism as the two filters above; see `comparabilityMarker` for why the key
    // differs by mode. Rows from an older economy are not deleted and their share
    // pages still work — they simply stop being ranked against scores that were
    // never playing the same game. A row written before the marker existed carries
    // no such key and is excluded by any value here, which is the correct reading:
    // an unmarked row makes no claim about which rules produced it.
    const marker = comparabilityMarker(mode);
    query = query.eq(`metrics->>${marker.key}`, marker.value);
    // Over-fetch so best-per-user dedupe still fills the board.
    const { data } = await query.limit(limit * 5);
    return bestPerUser((data ?? []).map(fromRow)).slice(0, limit);
  }

  let rows = readLocal().filter((r) => r.mode === mode);
  // The same rule as the cloud branch — a dev board that mixed economies would hide
  // exactly the bug the filter exists to prevent.
  const marker = comparabilityMarker(mode);
  rows = rows.filter((r) => String(r.metrics[marker.key]) === marker.value);
  if (background) rows = rows.filter((r) => r.metrics.backgroundId === background);
  if (scope === "daily") rows = rows.filter((r) => r.metrics.daily === daily);
  if (scope === "week") {
    const cutoff = weekAgoIso();
    rows = rows.filter((r) => r.createdAt >= cutoff);
  }
  if (scope === "friends") {
    const set = new Set(friendIds);
    rows = rows.filter((r) => set.has(r.userId));
  }
  return bestPerUser(rows).slice(0, limit);
}

/**
 * Has this exact run already been posted?
 *
 * Only asked on the RETRY path, and only because the failure it guards against is
 * invisible from here: a response lost after the server committed looks identical
 * to a request that never landed. Retrying the second is correct; retrying the
 * first duplicates the row — and `useShareUrl` resolves a run's `/r/{id}` link with
 * `order(created_at desc).limit(1)`, so the duplicate would also steal the link.
 *
 * Keyed on the run seed, which is unique to a run, exactly as `useShareUrl` keys
 * its own lookup. A row written before seeds were recorded cannot be matched, and
 * says so by returning false rather than guessing.
 */
export async function resultAlreadyPosted(userId: string, result: NewResult): Promise<boolean> {
  const seed = result.metrics?.seed;
  if (seed === undefined) return false;
  if (isCloud && supabase) {
    const { data, error } = await supabase
      .from("results")
      .select("id")
      .eq("user_id", userId)
      .eq("mode", result.mode)
      .eq("metrics->>seed", String(seed))
      .limit(1);
    // Unknown is not "no". Claiming the row is absent when the check itself failed
    // would re-insert it, which is the duplicate this exists to avoid.
    if (error) {
      console.error("resultAlreadyPosted: lookup failed", error);
      throw new Error("resultAlreadyPosted: lookup failed");
    }
    return (data?.length ?? 0) > 0;
  }
  return readLocal().some(
    (r) => r.userId === userId && r.mode === result.mode && String(r.metrics.seed) === String(seed),
  );
}

export async function myBest(userId: string, mode: GameMode): Promise<ResultRow | null> {
  if (isCloud && supabase) {
    const { data } = await supabase
      .from("results")
      .select("*")
      .eq("user_id", userId)
      .eq("mode", mode)
      .order("score", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? fromRow(data) : null;
  }
  const rows = readLocal().filter((r) => r.userId === userId && r.mode === mode);
  if (rows.length === 0) return null;
  return rows.reduce((best, r) => (r.score > best.score ? r : best));
}

export async function getResult(id: string): Promise<ResultRow | null> {
  if (isCloud && supabase) {
    const { data } = await supabase.from("results").select("*").eq("id", id).maybeSingle();
    return data ? fromRow(data) : null;
  }
  return readLocal().find((r) => r.id === id) ?? null;
}

// ── Durable submit dedupe ────────────────────────────────────────────────────
// A finished run must post exactly once — even across page reloads or re-viewing
// the report after a resume. A per-mount ref can't guarantee that; this persists
// the set of submitted run keys so the guard survives reloads.
//
// "Exactly once" is two obligations, and only the first was being met. A key
// written BEFORE the insert was awaited guarantees at-most-once and nothing else:
// one dropped connection at the report screen and the run was marked posted, never
// retried, and never mentioned again. The key is now written only on a confirmed
// insert, and the failures land in the retry queue below.
const SUBMITTED_KEY = "lifepatch.submittedRuns";

function readSubmitted(): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(SUBMITTED_KEY) ?? "[]"));
  } catch {
    return new Set<string>();
  }
}

export function alreadySubmitted(runKey: string): boolean {
  return readSubmitted().has(runKey);
}

export function markSubmitted(runKey: string): void {
  try {
    const set = readSubmitted();
    set.add(runKey);
    localStorage.setItem(SUBMITTED_KEY, JSON.stringify([...set]));
  } catch {}
}

// ── Interrupted submits ──────────────────────────────────────────────────────
//
// `markSubmitted` correctly fires only once the insert has landed, which leaves a
// window: kill the tab (or open a second one) while a submit is in flight and the
// next load has no idea one was ever started. An in-memory guard cannot survive a
// reload, so the fact that a submit BEGAN is written down too.
//
// The marker is not a lock and does not try to be — it is a hint that the direct
// path should check for an existing row before inserting, which it otherwise skips
// to keep the common case one round-trip. The durable fix for the concurrent-tab
// race is a unique index on `results`, which lands with the schema work.
const SUBMITTING_KEY = "lifepatch.submittingRuns";

function readSubmitting(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SUBMITTING_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

/** Was a submit for this run started and never seen to finish? */
export function wasInterrupted(runKey: string): boolean {
  return readSubmitting().includes(runKey);
}

export function markSubmitting(runKey: string): void {
  try {
    const keys = readSubmitting();
    if (!keys.includes(runKey)) localStorage.setItem(SUBMITTING_KEY, JSON.stringify([...keys, runKey]));
  } catch {}
}

export function clearSubmitting(runKey: string): void {
  try {
    const keys = readSubmitting();
    if (keys.includes(runKey)) {
      localStorage.setItem(SUBMITTING_KEY, JSON.stringify(keys.filter((k) => k !== runKey)));
    }
  } catch {}
}

// ── The retry queue ──────────────────────────────────────────────────────────

/**
 * Runs that finished but did not reach the board.
 *
 * A finished run is the whole point of playing, and the network is allowed to be
 * down when one ends. Rather than losing it, the row is parked here and re-tried
 * on the next page load. Bounded in both directions so it can never become the
 * thing that fills the player's storage quota: at most `MAX_PENDING` rows, at most
 * `MAX_ATTEMPTS` tries each, oldest dropped first.
 */
const PENDING_KEY = "lifepatch.pendingResults";
const MAX_PENDING = 12;
const MAX_ATTEMPTS = 6;

export type PendingResult = {
  runKey: string;
  playerId: string;
  result: NewResult;
  /**
   * The run's actions, so a retry can still go through the server.
   *
   * Without it a queued life-sim run would come back on the next load with no
   * ticket, fall through to the direct insert, and — once Part B of the schema has
   * closed that path — be refused by the database for a reason the queue cannot
   * fix. It costs bytes (a long run's journal is a few KB) against a queue already
   * bounded at `MAX_PENDING`, which is the cheaper side of that trade by far.
   */
  ticket?: ReplayTicket | null;
  attempts: number;
  queuedAt: string;
};

export function readPending(): PendingResult[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is PendingResult =>
        !!p && typeof (p as PendingResult).runKey === "string" && !!(p as PendingResult).result,
    );
  } catch {
    return [];
  }
}

function writePending(rows: PendingResult[]): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(rows.slice(-MAX_PENDING)));
  } catch {}
}

/**
 * Park a run that could not be posted.
 *
 * Deliberately does NOT touch `attempts`: parking is idempotent. `AppShell` fires
 * the submit effect for both `report` and `podium`, and the player can toggle
 * between them, so counting a try per CALL let six re-fires inside one offline
 * session exhaust the budget and delete the run — the precise outcome the queue
 * exists to prevent. `attempts` counts load-time retries, and only
 * `countPendingAttempt` increments it.
 */
export function queuePending(
  runKey: string,
  playerId: string,
  result: NewResult,
  ticket?: ReplayTicket | null,
): void {
  const all = readPending();
  const prev = all.find((p) => p.runKey === runKey);
  const others = all.filter((p) => p.runKey !== runKey);
  writePending([
    ...others,
    {
      runKey,
      playerId,
      result,
      // Never DOWNGRADE a queued row: an entry parked with a ticket must not lose
      // it to a later call that happens not to have one, or the retry silently
      // stops being verifiable.
      ticket: ticket ?? prev?.ticket ?? null,
      attempts: prev?.attempts ?? 0,
      queuedAt: prev?.queuedAt ?? new Date().toISOString(),
    },
  ]);
}

/**
 * Record that a load-time retry was spent on this run. Returns false once the
 * budget is gone and the row has been dropped — a run that has failed on six
 * separate loads is not failing for a reason a seventh will fix.
 */
export function countPendingAttempt(runKey: string): boolean {
  const all = readPending();
  const prev = all.find((p) => p.runKey === runKey);
  if (!prev) return false;
  const others = all.filter((p) => p.runKey !== runKey);
  const attempts = prev.attempts + 1;
  if (attempts > MAX_ATTEMPTS) {
    console.error(`pendingResults: giving up on ${runKey} after ${MAX_ATTEMPTS} retries`);
    writePending(others);
    return false;
  }
  writePending([...others, { ...prev, attempts }]);
  return true;
}

export function dropPending(runKey: string): void {
  const rows = readPending();
  if (rows.some((p) => p.runKey === runKey)) writePending(rows.filter((p) => p.runKey !== runKey));
}
