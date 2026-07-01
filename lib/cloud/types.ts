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
  friendCode: string;
  createdAt: string;
};

export type ResultMetrics = Record<string, number | string>;

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
