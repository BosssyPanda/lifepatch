"use client";

import { AnimatePresence, motion } from "framer-motion";
import QRCode from "qrcode";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CloseIcon } from "@/components/icons";
import { Avatar } from "@/components/social/Avatar";
import { LedgerButton } from "@/components/ui/LedgerButton";
import { LedgerDialog } from "@/components/ui/LedgerDialog";
import { TerminalOp } from "@/components/ui/TerminalOp";
import { useAudio } from "@/hooks/useAudio";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { accept, addByCode, listIncoming } from "@/lib/cloud/friends";
import { isGuestId } from "@/lib/cloud/identity";
import { FRIEND_CODE_ALPHABET, FRIEND_CODE_LENGTH } from "@/supabase/functions/_shared/generate";
import { getProfiles } from "@/lib/cloud/profiles";
import type { PublicProfile } from "@/lib/cloud/types";
import { friendInviteUrl } from "@/lib/deepLink";
import { PALETTE } from "@/lib/palette";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { DUR, EASE } from "@/src/motion/tokens";

/**
 * The missing quarter of the friends feature.
 *
 * `lib/cloud/friends.ts` has been complete and unreachable: `addByCode`, `accept`
 * and `listIncoming` had no callers anywhere in the app, `listFriendIds`'s one
 * call site sat behind a leaderboard scope that no tab could select, and the
 * player's own friend code — fetched into memory on every load by `useProfile` —
 * was rendered by nothing. Three finished modules and a whole leaderboard scope,
 * stranded for want of a screen. This is the screen.
 *
 * It is deliberately only three things: your code (to give away), a field (to
 * spend someone else's in), and the requests waiting on you. There is no list of
 * accepted friends here on purpose — the leaderboard's `friends` scope IS that
 * list, and it shows what a player actually wants to know about them, which is
 * how they are doing.
 *
 * ── Why this is not nested inside the Leaderboard ───────────────────────────
 * `useDialog` binds its focus trap and Escape handler to `document` in the
 * CAPTURE phase, so two open `LedgerDialog`s both trap Tab and both answer one
 * Escape. The two overlays are mutually exclusive instead: whoever opens this
 * closes the board first (see `components/AppShell.tsx`).
 */

/**
 * Taken from the mint rather than restated. Both used to be re-declared here, a
 * third and fourth copy of values `generate.ts` and `lib/deepLink.ts` already
 * held — and the failure mode of a drifted copy is invisible: the field silently
 * rejects a character the server really does issue, locally, so the player never
 * even reaches the round trip whose answer would have explained it.
 */
const CODE_LENGTH = FRIEND_CODE_LENGTH;
/** Anything outside the mint alphabet, stripped as it is typed. */
const CODE_CHARS = new RegExp(`[^${FRIEND_CODE_ALPHABET}]`, "g");

type Status = { tone: "ok" | "bad"; text: string } | null;

export function FriendsSheet({
  open,
  onClose,
  onRosterChanged,
  /** A code the player arrived with (`?friend=…`), pre-loaded into the field. */
  prefillCode,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Called when this sheet actually changed who the player's friends are — an
   * accept that succeeded, or a request that was really written. The host uses it
   * to decide whether a board behind the sheet needs re-reading; bumping on every
   * close instead re-ran `listFriendIds`, up to six pages of `topResults` and a
   * profile lookup, and dropped the board back to "Fetching ledger", just because
   * somebody opened the sheet to read their own code.
   */
  onRosterChanged?: () => void;
  prefillCode?: string | null;
}) {
  const { profile, loading: profileLoading } = useProfile();
  const { user, isCloud } = useAuth();
  const { sfx } = useAudio();
  const { reduced } = useMotionCtx();

  const [entry, setEntry] = useState("");
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [incoming, setIncoming] = useState<PublicProfile[]>([]);
  const [loadingIncoming, setLoadingIncoming] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fieldId = useId();
  const statusId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);

  /**
   * A friend edge needs a real account, and in the cloud that is not a soft
   * preference — `profile_by_friend_code` is granted to `authenticated` and
   * revoked from `anon` (supabase/schema.sql), so a guest's lookup is refused
   * before it can fail on anything friendlier.
   *
   * `useProfile` still hands a guest a profile with a friend code in it, minted
   * locally by `ensureProfile`. Rendering that code would be the worst outcome
   * available: it looks exactly like a real one and resolves for nobody. So the
   * gate is on the CLOUD, not on the feature — with no Supabase configured the
   * whole friends layer runs against localStorage and works end to end, which is
   * how the dev build is meant to behave.
   *
   * The test is for an ACCOUNT, not for `useAuth`'s `guest`. `guest` is
   * `isGuestId(user?.id)`, which is false when `user` is null — and null is
   * exactly the state of someone who arrived from a shared statement, opened
   * /leaderboard and never passed the auth gate at all. Gating on `guest` let
   * that visitor straight through to a locally-minted code, which is the case
   * this comment calls the worst outcome available.
   */
  const account = Boolean(user && !isGuestId(user.id));
  const blocked = isCloud && !account;
  const playerId = profile?.id ?? null;
  const code = profile?.friendCode ?? null;

  useEffect(() => {
    if (open && prefillCode) {
      setEntry(prefillCode);
      setStatus(null);
    }
  }, [open, prefillCode]);

  // Requests waiting on this player. Ids first, then one lookup for the names —
  // `listIncoming` answers in user ids and a row with no name is not a person.
  const loadIncoming = useCallback(async () => {
    if (!playerId || blocked) return;
    setLoadingIncoming(true);
    try {
      const ids = await listIncoming(playerId);
      if (ids.length === 0) {
        setIncoming([]);
        return;
      }
      const profs = await getProfiles(ids);
      setIncoming(ids.map((id) => profs[id]).filter((p): p is PublicProfile => Boolean(p)));
    } catch {
      // An inbox that could not be read is not an empty inbox, but it is also not
      // worth an alarm on a screen whose main job is the code above it.
      setIncoming([]);
    } finally {
      setLoadingIncoming(false);
    }
  }, [playerId, blocked]);

  useEffect(() => {
    if (!open) return;
    void loadIncoming();
  }, [open, loadIncoming]);

  /**
   * The QR carries the invite LINK, not the bare code.
   *
   * A QR of six characters is decorative: the phone that scans it shows a string
   * the player then has to type in by hand anyway. The link opens the game with
   * the code already in this field, which is the only version that saves anyone
   * anything. Same ink-on-paper polarity as the share card's QR
   * (`components/share/drawShareCard.ts`) — dark modules on a paper quiet zone.
   */
  useEffect(() => {
    if (!open || !code || blocked || typeof window === "undefined") {
      setQr(null);
      return;
    }
    let active = true;
    void QRCode.toDataURL(friendInviteUrl(window.location.origin, code), {
      margin: 2,
      width: 320,
      color: { dark: PALETTE.bg, light: PALETTE.ink },
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (active) setQr(url);
      })
      .catch(() => {
        // No QR is fine — the code is printed right above it in full.
        if (active) setQr(null);
      });
    return () => {
      active = false;
    };
  }, [open, code, blocked]);

  // Reset the transient bits per open, so a stale "request sent" never greets the
  // next visit.
  useEffect(() => {
    if (open) return;
    setStatus(null);
    setCopied(false);
    setAdding(false);
    setAccepting(null);
  }, [open]);

  const onCopy = async () => {
    if (!code || typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(friendInviteUrl(window.location.origin, code));
      setCopied(true);
      sfx("uitick");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus({ tone: "bad", text: "Could not reach the clipboard — the code is above, ready to read out." });
    }
  };

  const onAdd = async () => {
    const clean = entry.trim().toUpperCase();
    if (!playerId || clean.length !== CODE_LENGTH || adding) return;
    setAdding(true);
    setStatus(null);
    try {
      const res = await addByCode(playerId, clean);
      if (res.ok) {
        setEntry("");
        setStatus({ tone: "ok", text: "Request sent. They'll see it the next time they open this sheet." });
        sfx("confirm");
        onRosterChanged?.();
        return;
      }
      setStatus({
        tone: "bad",
        text:
          res.reason === "self"
            ? "That is your own code."
            : res.reason === "exists"
              ? "You have already added them."
              : res.reason === "failed"
                // The insert reached the database and was refused by something
                // other than the primary key — a dropped connection, an expired
                // session, an RLS refusal. Saying "already added" here told the
                // player there was nothing to retry when in fact nothing had been
                // written at all.
                ? "The request did not go through. Check your connection and try again."
                : "No player has that code.",
      });
    } catch {
      setStatus({ tone: "bad", text: "The request did not go through. Check your connection and try again." });
    } finally {
      setAdding(false);
      fieldRef.current?.focus();
    }
  };

  const onAccept = async (them: PublicProfile) => {
    if (!playerId || accepting) return;
    setAccepting(them.id);
    setStatus(null);
    try {
      const ok = await accept(playerId, them.id);
      if (ok) {
        setIncoming((prev) => prev.filter((p) => p.id !== them.id));
        setStatus({ tone: "ok", text: `${them.username} is on your board now.` });
        sfx("confirm");
        onRosterChanged?.();
      } else {
        // The cloud refuses an `accepted` edge unless the reciprocal request still
        // exists, so a refusal here means it was withdrawn while this was open.
        setIncoming((prev) => prev.filter((p) => p.id !== them.id));
        setStatus({ tone: "bad", text: `${them.username}'s request is no longer open.` });
      }
    } catch {
      setStatus({ tone: "bad", text: "That did not go through. Try again in a moment." });
    } finally {
      setAccepting(null);
    }
  };

  const canAdd = entry.trim().length === CODE_LENGTH && !adding && Boolean(playerId);

  return (
    <AnimatePresence>
      {open && (
        <LedgerDialog
          open={open}
          onClose={onClose}
          label="Friends"
          dismissOnScrimClick
          maxWidth="max-w-lg"
          className="max-h-[88svh] overflow-hidden"
          card={{
            initial: { opacity: 0, y: 24, scale: 0.98 },
            animate: { opacity: 1, y: 0, scale: 1 },
            exit: { opacity: 0, y: 16, scale: 0.98 },
            transition: { duration: DUR.base, ease: EASE },
          }}
        >
          <header className="flex items-center justify-between border-b-2 border-hairline-strong px-5 py-4">
            <div>
              <p className="eyebrow text-ink">Compete</p>
              <h2 className="display-caps text-3xl text-ink">Friends</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close friends"
              data-radius=""
              className="grid h-11 w-11 place-items-center border-2 border-hairline-strong text-ink-dim transition-colors hover:border-ink hover:text-ink"
            >
              <CloseIcon size={16} />
            </button>
          </header>

          <div className="thin-scroll flex-1 overflow-y-auto px-5 py-5" data-lenis-prevent>
            {blocked ? (
              <GuestNotice pendingCode={prefillCode ?? null} />
            ) : profileLoading && !code ? (
              <p className="py-10 text-center">
                <TerminalOp label="Reading your record" center />
              </p>
            ) : (
              <>
                {/* ── your code ─────────────────────────────────────────── */}
                <section aria-labelledby={`${fieldId}-yours`}>
                  <h3 id={`${fieldId}-yours`} className="eyebrow text-ink-dim">
                    Your code
                  </h3>
                  <p className="voice mt-1.5 text-sm text-secondary">
                    Added by code, never by search. Hand this to someone and they can put you on
                    their board.
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-4 border border-hairline bg-bg3 p-4">
                    <div className="min-w-0 flex-1">
                      {/* `select-all` so one tap lifts the whole code on a phone, where
                          dragging a selection across six characters is a chore. */}
                      <p className="num select-all break-all font-anton text-3xl tracking-[0.18em] text-ink">
                        {code ?? "——————"}
                      </p>
                      <div className="mt-3">
                        <LedgerButton
                          variant="secondary"
                          size="sm"
                          onClick={onCopy}
                          disabled={!code}
                        >
                          {copied ? "Link copied" : "Copy invite link"}
                        </LedgerButton>
                      </div>
                    </div>

                    {qr && (
                      /* eslint-disable-next-line @next/next/no-img-element --
                         a runtime-generated data: URL has no path for next/image to
                         optimise, and its dimensions are fixed here. */
                      <img
                        src={qr}
                        alt={`QR code containing an invite link for friend code ${code ?? ""}`}
                        width={104}
                        height={104}
                        className="shrink-0 border border-hairline"
                      />
                    )}
                  </div>
                </section>

                {/* ── spend someone else's ──────────────────────────────── */}
                <section className="mt-7 border-t border-hairline pt-6">
                  <label htmlFor={fieldId} className="eyebrow text-ink-dim">
                    Add by code
                  </label>
                  <div className="mt-1.5 flex flex-wrap items-stretch gap-2">
                    <input
                      id={fieldId}
                      ref={fieldRef}
                      value={entry}
                      onChange={(e) =>
                        setEntry(e.target.value.toUpperCase().replace(CODE_CHARS, "").slice(0, CODE_LENGTH))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && canAdd) {
                          e.preventDefault();
                          void onAdd();
                        }
                      }}
                      placeholder="ABC123"
                      inputMode="text"
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={CODE_LENGTH}
                      aria-describedby={status ? statusId : undefined}
                      data-radius=""
                      className="num min-w-0 flex-1 border border-hairline-strong bg-bg px-3 py-2.5 font-mono uppercase tracking-[0.3em] text-ink outline-none placeholder:tracking-[0.3em] placeholder:text-tertiary focus:border-ink"
                    />
                    {/* The one accent control on this card — DESIGN.md allows a single
                        primary per card, and this is the thing the sheet is for. */}
                    <LedgerButton variant="primary" size="md" onClick={onAdd} disabled={!canAdd} loading={adding}>
                      Add
                    </LedgerButton>
                  </div>

                  {/* Announced rather than merely painted: the outcome of an add is the
                      whole point of pressing it, and it lands well below the button on
                      a narrow screen. */}
                  <p
                    id={statusId}
                    role="status"
                    aria-live="polite"
                    className={`mt-2 min-h-[1.25rem] font-body text-xs ${
                      status?.tone === "bad" ? "text-loss" : "text-secondary"
                    }`}
                  >
                    {status?.text ?? ""}
                  </p>
                </section>

                {/* ── waiting on you ────────────────────────────────────── */}
                <section className="mt-5 border-t border-hairline pt-6">
                  <h3 className="eyebrow text-ink-dim">
                    Requests{incoming.length > 0 && <span className="num text-ink"> · {incoming.length}</span>}
                  </h3>

                  {loadingIncoming ? (
                    <p className="py-4">
                      <TerminalOp label="Checking the post" />
                    </p>
                  ) : incoming.length === 0 ? (
                    <p className="mt-2 font-body text-xs text-tertiary">
                      Nothing waiting. A request appears here when someone spends your code.
                    </p>
                  ) : (
                    <ul className="mt-3 flex flex-col gap-1.5">
                      <AnimatePresence initial={false}>
                        {incoming.map((p) => (
                          <motion.li
                            key={p.id}
                            layout
                            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: DUR.base, ease: EASE }}
                            className="flex items-center gap-3 border border-hairline bg-bg3 px-3 py-2"
                          >
                            <Avatar seed={p.avatarSeed} username={p.username} size={30} />
                            <span className="min-w-0 flex-1 truncate font-body text-ink">{p.username}</span>
                            <LedgerButton
                              variant="secondary"
                              size="sm"
                              onClick={() => onAccept(p)}
                              loading={accepting === p.id}
                              aria-label={`Accept ${p.username}'s friend request`}
                            >
                              Accept
                            </LedgerButton>
                          </motion.li>
                        ))}
                      </AnimatePresence>
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>

          <footer className="border-t-2 border-hairline px-5 py-3">
            <LedgerButton variant="ghost" size="sm" onClick={onClose}>
              Close
            </LedgerButton>
          </footer>
        </LedgerDialog>
      )}
    </AnimatePresence>
  );
}

/**
 * A guest has a friend code and it is worth nothing.
 *
 * Saying so plainly beats every alternative: printing the local code would hand
 * out an identifier that resolves for nobody, and hiding the sheet entirely would
 * leave the friends tab pointing at a door with no handle.
 *
 * `pendingCode` is the one thing that must survive this screen. A `?friend=CODE`
 * link is consumed on read — `consumeInvite` strips the parameter from the
 * address bar — and the code is then held only in React state, which a magic-link
 * sign-in destroys along with the rest of the page. A guest who followed an
 * invitation and was shown this notice had their invitation deleted by the act of
 * reading it: the URL was gone, the field that would have held the code is not
 * rendered, and the friend who sent it never hears back. So it is printed here,
 * where they can write it down before they go.
 */
function GuestNotice({ pendingCode }: { pendingCode: string | null }) {
  return (
    <div className="mx-auto my-6 max-w-sm border-2 border-ink/30 p-1.5 text-center">
      <div className="border border-ink/25 px-4 py-6">
        <p className="font-anton text-xl leading-tight tracking-[0.06em] text-ink">
          FRIENDS NEED AN ACCOUNT
        </p>
        <p className="mt-2 font-body text-xs text-secondary">
          A friend code has to point at somebody the server has heard of, and a guest is only
          known to this device. Sign in with an email from the title screen and a code is minted
          for you.
        </p>
        {pendingCode && (
          <div className="mt-4 border-t border-ink/20 pt-4">
            <p className="eyebrow text-tertiary" style={{ fontSize: "0.55rem" }}>
              The code you were invited with
            </p>
            <p className="num mt-1.5 text-2xl tracking-[0.22em] text-ink">{pendingCode}</p>
            <p className="voice mt-1.5 text-xs text-tertiary">
              Keep it — signing in reloads the page and this link has already been spent.
            </p>
          </div>
        )}
        <p className="voice mt-3 text-xs text-tertiary">Your runs and progress carry over.</p>
      </div>
    </div>
  );
}
