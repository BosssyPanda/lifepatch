/**
 * Local "seen concepts" set — the cheap teaching cue behind the first-encounter
 * "You just learned: X" toast and the map's Introduced state. Device-local only:
 * merely *seeing* a concept isn't an achievement, so it never touches the cloud
 * mastery table (which is reserved for proven, correct application).
 */

const SEEN_KEY = "lifepatch.seenConcepts";

function read(): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"));
  } catch {
    return new Set<string>();
  }
}

export function getSeen(): string[] {
  return [...read()];
}

export function hasSeen(conceptId: string): boolean {
  return read().has(conceptId);
}

/** Mark concepts seen; return only the ones that were newly seen (for the toast). */
export function markSeen(conceptIds: string[]): string[] {
  const set = read();
  const newly = conceptIds.filter((id) => id && !set.has(id));
  if (newly.length === 0) return [];
  for (const id of newly) set.add(id);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...set]));
  } catch {}
  return newly;
}
