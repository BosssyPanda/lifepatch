export type Screen = "start" | "select" | "dashboard" | "report";

export type Tone = "good" | "bad" | "neutral" | "warning";

export type StatKey =
  | "cash"
  | "debt"
  | "credit"
  | "stress"
  | "skill"
  | "freedom";

export type GameStats = {
  cash: number;
  debt: number;
  credit: number;
  stress: number;
  skill: number;
  freedom: number;
};

/** Partial change applied to stats when an option is chosen. */
export type StatEffect = Partial<GameStats>;

export type LocationId =
  | "apartment"
  | "work"
  | "bank"
  | "feed"
  | "market";

export type TimelineItem = {
  id: string;
  month: number;
  title: string;
  description: string;
  tone: Tone;
};

export type Character = {
  id: string;
  name: string;
  tagline: string;
  story: string;
  emoji: string;
  difficulty: "Chill" | "Normal" | "Brutal";
  accent: StatKey | "social";
  cash: number;
  debt: number;
  credit: number;
  stress: number;
  skill: number;
  freedom: number;
  mainRisk: string;
  income: string;
};

export type DecisionOption = {
  id: string;
  label: string;
  blurb: string;
  effect: StatEffect;
  tone: Tone;
  consequence: string;
  lesson: string;
  timeline: { title: string; description: string; tone: Tone; delay?: number };
};

export type Decision = {
  id: string;
  location: LocationId;
  tag: string;
  emoji: string;
  title: string;
  prompt: string;
  options: DecisionOption[];
};

export type FeedKind = "scam" | "flex" | "offer" | "pressure";

export type FeedColor =
  | "cash"
  | "debt"
  | "risk"
  | "skill"
  | "social"
  | "freedom";

export type FeedPost = {
  id: string;
  handle: string;
  avatar: string;
  color: FeedColor;
  kind: FeedKind;
  body: string;
  redFlags: string[];
  isScam: boolean;
  onAccept: StatEffect;
  onReport: StatEffect;
};

export type Totals = {
  earned: number;
  debtTaken: number;
  interestPaid: number;
  scamsAvoided: number;
  scamsFallen: number;
  bigWin: string | null;
  bigLoss: string | null;
};

/* ---------------- Scroll-story engine ---------------- */
export type Phase = "intro" | "select" | "story" | "report";

export type DetourTarget = "feed" | "market" | "bank";

export type StoryBeat =
  | { kind: "chapter"; id: string; month: number; title: string }
  | {
      kind: "narrative";
      id: string;
      text: string;
      lead?: string;
      mascot?: string;
      mood?: "idle" | "smug" | "gloating" | "rattled" | "defeated";
    }
  | { kind: "decision"; id: string; decisionId: string }
  | { kind: "detour"; id: string; target: DetourTarget; prompt: string; cta: string }
  | { kind: "finale"; id: string; text: string };
