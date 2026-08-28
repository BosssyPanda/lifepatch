/**
 * Room codes. Six characters, read aloud over a call and typed on a phone, so the
 * alphabet drops every glyph pair people mishear or mistype: no 0/O, no 1/I/L.
 */

// `randomIndex` used to live here, and both files want the same CSPRNG draw — a
// room code and a friend code are the same problem at different stakes. It is
// defined over there rather than here because the `profile` Edge Function imports
// that file and Deno can only follow relative paths inside `supabase/functions`.
// The arrow has to point this way; it cannot point the other.
import { randomIndex } from "@/supabase/functions/_shared/generate";

export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 6;

export function makeRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomIndex(ROOM_CODE_ALPHABET.length)];
  return code;
}

/**
 * What the join field should show as the player types: uppercased, anything
 * outside the alphabet dropped (spaces, dashes, and the excluded glyphs alike),
 * capped at six. Deliberately no confusable "correction" — 0/O and 1/I/L are BOTH
 * absent from the alphabet, so there is nothing honest to fold them onto, and
 * guessing would silently hand the player a different room. Never throws: this is
 * an input formatter. Ask `isRoomCode` whether the result is joinable.
 */
export function normalizeRoomCode(raw: string): string {
  let out = "";
  for (const ch of String(raw ?? "").toUpperCase()) {
    if (ROOM_CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length === ROOM_CODE_LENGTH) break;
  }
  return out;
}

export function isRoomCode(v: unknown): v is string {
  if (typeof v !== "string" || v.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of v) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}
