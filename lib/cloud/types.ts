/**
 * Shared types for the v2 cloud layer (profiles, results, streaks, friends,
 * mastery). DB columns are snake_case (see supabase/schema.sql); these TS shapes
 * are camelCase. All identities are pseudonymous — no real names, no PII.
 */

export type GameMode = "story" | "infinite" | "cashflow";

export type Profile = {
  id: string;
  username: string;
  avatarSeed: string;
  /**
   * Only ever present on your OWN profile.
   *
   * A friend code is the thing that lets someone send you a request, so it is a
   * secret in the same sense a room code is. `profiles` is no longer world-readable
   * and the display view (`profiles_public`) does not carry the column, so a
   * profile resolved for a leaderboard row genuinely does not have one. Optional
   * rather than an empty string, because "" is a value that renders.
   */
  friendCode?: string;
  createdAt: string;
};

/** Who a friend code belongs to. All `find_by_friend_code` will tell you, and all
 *  the friends UI needs to show a confirmation before a request is sent. */
export type FriendCodeMatch = { id: string; username: string };

// number[] carries the per-year net-worth series for the share-page chart (Phase M3)
export type ResultMetrics = Record<string, number | string | number[]>;

export type ResultRow = {
  id: string;
  userId: string;
  mode: GameMode;
  score: number;
  verdict: string;
  metrics: ResultMetrics;
  createdAt: string;
};

export type NewResult = {
  mode: GameMode;
  score: number;
  verdict: string;
  metrics?: ResultMetrics;
};

export type Streak = {
  current: number;
  longest: number;
  lastPlayedOn: string | null;
};

export type MasteryRow = {
  conceptId: string;
  level: number;
  updatedAt: string;
};

export type FriendStatus = "pending" | "accepted";

export type FriendEdge = {
  userId: string;
  friendId: string;
  status: FriendStatus;
  createdAt: string;
};
