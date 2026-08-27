/**
 * Shared types for the v2 cloud layer (profiles, results, streaks, friends,
 * mastery). DB columns are snake_case (see supabase/schema.sql); these TS shapes
 * are camelCase. All identities are pseudonymous — no real names, no PII.
 */

export type GameMode = "story" | "infinite" | "cashflow";

/**
 * What anyone may see about a player. This is the whole public surface, and it is
 * a real boundary rather than a convention: `profiles_public` is a view with these
 * four columns and no others, so there is no query that returns a friend code for
 * someone else. Leaderboard rows and friend-code lookups both land here.
 */
export type PublicProfile = {
  id: string;
  username: string;
  avatarSeed: string;
  createdAt: string;
};

/**
 * Your OWN profile — the public columns plus the friend code.
 *
 * Only ever your own: the `profiles` table's select policy is `auth.uid() = id`.
 * A function that can hand you one of these for an arbitrary player id would be a
 * bug, which is why `getProfiles` and `getByFriendCode` return `PublicProfile`.
 */
export type Profile = PublicProfile & {
  friendCode: string;
};

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
