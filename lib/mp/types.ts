/**
 * "With Friends" match types.
 *
 * These live OUTSIDE `RunState` on purpose. A match run is an ordinary seeded
 * `RunState` — the room only carries the config that made it, a clock, and the
 * lightweight status rows the live standings read. Nothing here is ever written
 * into a save (`lib/saves.ts`) or into the engine's shape.
 */

/** The host-tunable per-year countdown. A closed set so a peer can't hand us 0.001s. */
export type YearSeconds = 30 | 45 | 60 | 90;

export type MatchPhase = "lobby" | "running" | "finished";

export type PeerInfo = {
  playerId: string;
  name: string;
  avatarSeed: string;
  joinedAt: number;
};

export type MatchConfig = {
  /** Protocol version this room speaks. Mismatches are dropped, never coerced. */
  v: number;
  roomCode: string;
  /**
   * The shared world. `initRun(mode, bg, name, seed)` makes every player's markets
   * identical — that, and nothing else, is the fairness story.
   */
  seed: number;
  yearSeconds: YearSeconds;
  /** Host's pick in the lobby; every player starts from the same background. */
  backgroundId: string;
  hostId: string;
  startedAt: number;
  /** Frozen at start. Doubles as the rejoin gate — join-after-start needs a row here. */
  roster: PeerInfo[];
};

export type PeerStatus = {
  playerId: string;
  yearIndex: number;
  netWorth: number;
  status: "playing" | "ended";
  endReason?: string;
  /** "Lock in the year" — the all-ready skip fires when every live peer is ready. */
  ready: boolean;
  /** True when the acting host fast-forwarded this row on a disconnected player's behalf. */
  ghost?: boolean;
};
