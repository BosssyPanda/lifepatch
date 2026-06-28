import type { Character } from "./types";

export const CHARACTERS: Character[] = [
  {
    id: "student",
    name: "Broke Student",
    tagline: "Ramen budget, billionaire dreams.",
    story:
      "Two jobs, three group chats, zero savings. Your brain is sharp but your wallet is allergic to weekends.",
    emoji: "🎒",
    difficulty: "Normal",
    accent: "skill",
    cash: 430,
    debt: 0,
    credit: 640,
    stress: 45,
    skill: 62,
    freedom: 58,
    mainRisk: "Student debt, social pressure, burnout",
    income: "Part-time + chaos",
  },
  {
    id: "grad",
    name: "New Grad",
    tagline: "Salaried and slightly doomed.",
    story:
      "First real paycheck, first real loan statement. Everyone says treat yourself. The loan does not care.",
    emoji: "💼",
    difficulty: "Chill",
    accent: "cash",
    cash: 1800,
    debt: 28000,
    credit: 690,
    stress: 40,
    skill: 55,
    freedom: 50,
    mainRisk: "Lifestyle inflation",
    income: "Stable salary",
  },
  {
    id: "hustler",
    name: "Side-Hustle Grinder",
    tagline: "Five income streams, all leaking.",
    story:
      "You sell, you flip, you freelance. Money comes in waves and taxes come for the survivors. Sleep is optional.",
    emoji: "⚡",
    difficulty: "Brutal",
    accent: "social",
    cash: 700,
    debt: 500,
    credit: 610,
    stress: 68,
    skill: 70,
    freedom: 46,
    mainRisk: "Irregular cash flow and taxes",
    income: "Unstable / spiky",
  },
];

export function getCharacter(id: string): Character {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}
