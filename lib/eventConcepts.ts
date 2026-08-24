import { conceptsForText } from "./concepts";
import { LIFE_EVENTS } from "./lifeEvents";

/**
 * Which concepts a life event can teach.
 *
 * `LifeEvent` carries no concept field, and deliberately so: concepts are derived
 * from the OUTCOME TEXT by `conceptsForText`, at the moment a card resolves
 * (`components/run/LifeEventCard.tsx`). Hand-tagging events would be a second
 * source of truth that drifts from the copy the first time someone rewrites a
 * lesson, and the drift would be silent.
 *
 * Weighting the draw needs the same answer one step earlier — before a card is
 * dealt, not after it resolves — so this unions `conceptsForText` over every
 * outcome of every choice. It is the set of concepts the card COULD teach, which
 * is exactly the right question for "is this card about something you keep getting
 * wrong".
 *
 * Built once, lazily, on first use: the whole event table is a few hundred strings
 * of keyword matching, and no run that never looks at a weak spot should pay for it.
 */
let index: Map<string, string[]> | null = null;

function build(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const e of LIFE_EVENTS) {
    const ids = new Set<string>();
    for (const c of e.choices) {
      for (const o of c.outcomes) for (const id of conceptsForText(o.lesson, o.consequence)) ids.add(id);
    }
    m.set(e.id, [...ids]);
  }
  return m;
}

/** The concepts this event could teach. Empty for a card that teaches none. */
export function conceptsForEvent(eventId: string): string[] {
  index ??= build();
  return index.get(eventId) ?? [];
}

/** Does this event touch any of these concepts? The draw's question, asked directly. */
export function eventTeachesAny(eventId: string, conceptIds: readonly string[]): boolean {
  if (conceptIds.length === 0) return false;
  const mine = conceptsForEvent(eventId);
  for (const id of mine) if (conceptIds.includes(id)) return true;
  return false;
}
