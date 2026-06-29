import type { Dream } from "./types";

// Fast Track dreams. Buying one (or reaching +$50k/mo cash flow) wins the game.
export const DREAMS: Dream[] = [
  {
    id: "shelter",
    title: "Build a Children's Shelter",
    blurb: "Endow a home that takes kids off the street for good.",
    cost: 100000,
  },
  {
    id: "scholarship",
    title: "Fund a Scholarship Foundation",
    blurb: "Send a hundred first-generation students to college every year.",
    cost: 120000,
  },
  {
    id: "cars",
    title: "Restore a Classic-Car Collection",
    blurb: "A warehouse of chrome and horsepower, all yours.",
    cost: 90000,
  },
  {
    id: "office",
    title: "Run for Public Office",
    blurb: "Self-fund a clean campaign and actually win.",
    cost: 130000,
  },
  {
    id: "dinner",
    title: "Dinner With a World Leader",
    blurb: "A seat at the table where the big decisions get made.",
    cost: 80000,
  },
  {
    id: "sail",
    title: "Sail Around the World",
    blurb: "Two years, one boat, every horizon.",
    cost: 150000,
  },
  {
    id: "island",
    title: "Own a Private Island",
    blurb: "Your name on the map. Your rules on the beach.",
    cost: 250000,
  },
  {
    id: "space",
    title: "Go to Space",
    blurb: "Strap in. See the curve of the Earth with your own eyes.",
    cost: 250000,
  },
];

export function getDream(id: string): Dream {
  return DREAMS.find((d) => d.id === id) ?? DREAMS[0];
}

/** Fast Track alternate win: extra monthly cash flow that ends the game. */
export const FAST_TRACK_CASHFLOW_GOAL = 50000;
