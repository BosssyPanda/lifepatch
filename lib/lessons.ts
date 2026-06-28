/** Fallback / ambient micro-lessons used when no decision-specific lesson fires. */
export const AMBIENT_LESSONS: string[] = [
  "Monthly payments hide the true cost. Compare the total price, not the cute little installment.",
  "Credit builds trust, but maxing it out makes every future option more expensive.",
  "Guaranteed returns plus urgency equals danger. Always.",
  "More income does not automatically create more freedom. Lifestyle inflation eats raises alive.",
  "An emergency fund is boring until it's the only thing standing between you and debt.",
  "The cheapest version of most things is the one you didn't autopilot into buying.",
];

export function randomLesson(seed: number): string {
  return AMBIENT_LESSONS[seed % AMBIENT_LESSONS.length];
}
