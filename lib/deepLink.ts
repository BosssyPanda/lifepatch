/**
 * The link the player arrived on.
 *
 * No `"use client"` directive, deliberately. `consumeInvite` is browser-only and
 * guards for it, but the two URL builders below are pure string functions and one
 * of them is called by `app/r/[id]/page.tsx`, which is a SERVER component —
 * marking this module client-only would make that import a client reference and
 * the call a build error. Every client consumer imports it perfectly well without
 * the directive.
 *
 * Nothing else in this app reads the URL. `components/AppShell.tsx` is a pure
 * in-memory phase machine and every screen it shows is reached by a tap, which is
 * the right shape for a game and the wrong shape for an INVITATION. A friend code
 * and a shared statement are both things one player hands to another, and a link
 * is the only way that hand-off actually happens — so this is the one seam where
 * the outside world gets to say what screen opens first.
 *
 * (`hooks/useCashflow.ts` also reads `?seed`, but that one is dev-gated on purpose
 * — it exists so a bug can be reproduced turn for turn, and a production build
 * ignores it so nobody can hand a friend a "lucky" link. This module is the
 * opposite: it only carries things a player is MEANT to pass on.)
 *
 * ── Read once, and take the parameter out of the address bar ────────────────
 * Both invites start something (a run, an overlay), and neither should start it
 * twice. Stripping the query on the first read is what makes that true through a
 * refresh, a restored tab and a back-navigation: without it, reloading halfway
 * through a challenge would abandon the life in progress and deal a new one from
 * the top. It also stops the address bar from quietly advertising someone else's
 * friend code for the rest of the session, which is the one capability the whole
 * "added by code, never by search" posture rests on (supabase/schema.sql).
 *
 * The consumed flag is module-level rather than per-caller because a client-side
 * navigation (`/leaderboard` → `/`) does not re-evaluate this module, and an
 * invite that survived one would fire again on a screen the player reached by
 * hand.
 */

import { FRIEND_CODE_ALPHABET, FRIEND_CODE_LENGTH } from "@/supabase/functions/_shared/generate";

/**
 * The alphabet `generateFriendCode` mints from, exactly — no I, L, O, 0 or 1,
 * because a code is read off one screen and typed into another
 * (`supabase/functions/_shared/generate.ts`).
 */
/** Built from the mint rather than restated, so this cannot come to reject a code
 *  the server actually issues. */
const FRIEND_CODE_RE = new RegExp(`^[${FRIEND_CODE_ALPHABET}]{${FRIEND_CODE_LENGTH}}$`);

/**
 * A result id is a uuid in the cloud and `local-<ts>-<rand>` in dev
 * (`lib/cloud/results.ts`), so this bounds the SHAPE rather than pinning either
 * form. It is a sanity gate, not a security one — `getResult` swallows the error
 * a malformed id would raise and answers null — but a bounded string keeps
 * arbitrary junk out of a value that ends up in a fetch.
 */
const RESULT_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

/** Every parameter this module owns. Stripped together, so one invite cannot
 *  leave the other's parameter behind in the URL. */
const PARAMS = ["friend", "vs"] as const;

export type Invite =
  /** `?friend=K7M2P9` — a friend code, from the QR or the copied link. */
  | { kind: "friend"; code: string }
  /** `?vs=<resultId>` — play the world that statement was played on. */
  | { kind: "challenge"; resultId: string };

let consumed = false;

/** Drop our parameters and rewrite the address bar, keeping anything we do not own. */
function strip(params: URLSearchParams): void {
  try {
    for (const p of PARAMS) params.delete(p);
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  } catch {
    // A sandboxed or file:// document can refuse replaceState. The invite is still
    // returned — firing it once and re-firing on a manual refresh is a far smaller
    // failure than never firing it at all.
  }
}

/**
 * The invite this page was opened with, or null. Answers at most once per load.
 *
 * `vs` wins when both are present: it is the more consequential of the two (it
 * starts a life), and a URL carrying both was not built by anything here.
 */
export function consumeInvite(): Invite | null {
  if (consumed || typeof window === "undefined") return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return null;
  }

  const vs = params.get("vs");
  const friend = params.get("friend");
  // Burned only once an invite is actually HERE. Setting it on the way in spent
  // the single answer on any visit that carried no parameters — and one such
  // visit is on the shortest path to a challenge: a reader opens `/r/abc`, taps
  // [ A WORLD OF MY OWN ] to `/` (client navigation, so this module stays
  // resident and `consumed` is now true), goes Back, then taps
  // [ PLAY THIS WORLD → ]. `/?vs=abc` would return null, no run would start,
  // and `strip` never running leaves the parameter sitting in the address bar
  // as though it had been ignored.
  if (vs === null && friend === null) return null;
  consumed = true;

  strip(params);

  if (vs !== null) {
    const resultId = vs.trim();
    return RESULT_ID_RE.test(resultId) ? { kind: "challenge", resultId } : null;
  }
  // Codes are stored and compared uppercase (`getByFriendCode` upper-cases too), so
  // a link typed in lower case still resolves.
  const code = (friend ?? "").trim().toUpperCase();
  return FRIEND_CODE_RE.test(code) ? { kind: "friend", code } : null;
}

/** The link that puts a friend code into someone else's game. Used by the QR and
 *  the copy button, so the two can never encode different things. */
export function friendInviteUrl(origin: string, code: string): string {
  return `${origin}/?friend=${encodeURIComponent(code)}`;
}

/**
 * The link that offers a statement's world as a challenge.
 *
 * Relative, unlike `friendInviteUrl`: the only place that mints one is the
 * statement page, which is a SERVER component with no `window.location.origin` to
 * read and no need for one — the link points at the same deployment it is served
 * from. It exists as a function anyway so the parameter name lives beside the
 * reader that consumes it and the two cannot drift.
 */
export function challengeUrl(resultId: string): string {
  return `/?vs=${encodeURIComponent(resultId)}`;
}
