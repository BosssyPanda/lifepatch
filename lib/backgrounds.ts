export type Background = {
  id: string;
  name: string;
  tagline: string;
  story: string;
  difficulty: "Chill" | "Normal" | "Brutal";
  startAge: number;
  cash: number;
  debt: number;
  salary: number;
  job: string;
  health: number;
  happiness: number;
};

export const BACKGROUNDS: Background[] = [
  {
    id: "student",
    name: "The Broke Grad",
    tagline: "Degree in hand, debt on back.",
    story:
      "You start with a fresh diploma, a junior salary, and a student loan that compounds while you sleep. High ceiling, low floor.",
    difficulty: "Normal",
    startAge: 22,
    cash: 1500,
    debt: 24000,
    salary: 34000,
    job: "Junior Associate",
    health: 80,
    happiness: 65,
  },
  {
    id: "trade",
    name: "The Tradesperson",
    tagline: "No debt, no degree, all grind.",
    story:
      "You skipped college, learned a trade, and start debt-free with cash in hand and a steady paycheck. Lower ceiling, sturdier floor.",
    difficulty: "Chill",
    startAge: 20,
    cash: 6000,
    debt: 0,
    salary: 41000,
    job: "Apprentice Electrician",
    health: 85,
    happiness: 70,
  },
  {
    id: "hustler",
    name: "The Hustler",
    tagline: "Five side gigs, zero stability.",
    story:
      "You sell, flip, and freelance. Income is spiky, taxes are lurking, and stability is a rumor. Highest variance run.",
    difficulty: "Brutal",
    startAge: 24,
    cash: 3000,
    debt: 3000,
    salary: 28000,
    job: "Freelancer",
    health: 72,
    happiness: 68,
  },
];

export function getBackground(id: string): Background {
  return BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0];
}
