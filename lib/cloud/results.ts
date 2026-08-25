import { isCloud, supabase } from "../supabase";
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

function fromRow(row: Record<string, unknown>): ResultRow {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    mode: row.mode as GameMode,
    score: Number(row.score),
    verdict: String(row.verdict),
    metrics: (row.metrics as ResultRow["metrics"]) ?? {},
    createdAt: String(row.created_at),
  };
}

function readLocal(): ResultRow[] {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    return raw ? (JSON.parse(raw) as ResultRow[]) : [];
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

export async function submitResult(userId: string, result: NewResult): Promise<ResultRow> {
  const metrics = result.metrics ?? {};
  if (isCloud && supabase) {
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
    if (error || !data) throw new Error(error?.message ?? "Result submit failed");
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
    // Over-fetch so best-per-user dedupe still fills the board.
    const { data } = await query.limit(limit * 5);
    return bestPerUser((data ?? []).map(fromRow)).slice(0, limit);
  }

  let rows = readLocal().filter((r) => r.mode === mode);
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
