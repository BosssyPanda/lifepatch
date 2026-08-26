"use client";

import { useId, useState } from "react";
import { CheckIcon } from "@/components/icons";
import { Avatar } from "@/components/social/Avatar";
import { LedgerButton } from "@/components/ui/LedgerButton";
import { ArmedLabel, useArmedAction } from "@/components/ui/useArmedAction";
import { TerminalOp } from "@/components/ui/TerminalOp";
import { useAudio } from "@/hooks/useAudio";
import type { useFriends } from "@/hooks/useFriends";
import { friendsNeedAccount } from "@/lib/cloud/friends";
import { FRIEND_CODE_LENGTH, isFriendCode, normalizeFriendCode } from "@/lib/cloud/generate";
import type { Profile } from "@/lib/cloud/types";

/**
 * The Friends tab's front door — your code, a field to add someone else's, the
 * requests waiting on you, and the list itself.
 *
 * ── Why the list is here and not only on the board ─────────────────────────
 * The Friends scope has been a tab since the social layer shipped, and until now
 * it could only ever be empty: `addByCode` had no caller anywhere in the repo, so
 * no edge was ever written. Building only the "add" half would not have fixed
 * that, because a friend who has not finished a run does not appear on a
 * leaderboard — you would type a code, be told nothing, and see the same empty
 * board. The roster is the confirmation the board cannot give.
 *
 * ── LEDGER ────────────────────────────────────────────────────────────────
 * No accent anywhere in this panel. The leaderboard is a board, not a screen with
 * a primary path, and DESIGN.md gives the accent exactly six homes — none of them
 * is "the most useful button on a card". Everything here is `secondary` or
 * `ghost`, and the one destructive control paints its own armed state in `loss`,
 * per § Palette hard rule 1 and the note in `useArmedAction`.
 */

/** What a mutation had to say, if anything. `tone` is a second channel, never the only one. */
type Note = { tone: "ok" | "bad"; text: string } | null;

export function FriendsPanel({
  userId,
  friendCode,
  friends,
}: {
  userId: string;
  /** Your own code. Absent for a profile resolved from someone else's row — see `Profile`. */
  friendCode?: string;
  /**
   * The lists and the four actions, owned by the Leaderboard rather than by this
   * panel. Not a style preference: the tab strip sits ABOVE the panel and has to
   * show a count when somebody is waiting on you, because a request nobody is told
   * about is a request nobody answers. One hook instance feeds both, and the board
   * below reuses the same friend list instead of reading the table a second time.
   */
  friends: ReturnType<typeof useFriends>;
}) {
  const { sfx } = useAudio();
  const f = friends;
  const [code, setCode] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [copied, setCopied] = useState(false);
  const codeId = useId();
  const noteId = useId();

  const needsAccount = friendsNeedAccount(userId);

  async function copyCode() {
    if (!friendCode) return;
    try {
      await navigator.clipboard.writeText(friendCode);
      setCopied(true);
      sfx("uitick");
    } catch {
      // No clipboard permission, or no API. The code is selectable text right
      // there, so this needs no error state — only an unchanged button.
      setCopied(false);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    // The Send button is disabled while anything is in flight, but Enter in the
    // field submits the form regardless — and two mutations at once against one
    // edge list is a lost write.
    if (f.busy !== null) return;
    if (!isFriendCode(code)) {
      setNote({ tone: "bad", text: `A friend code is ${FRIEND_CODE_LENGTH} letters and numbers.` });
      return;
    }
    sfx("uitick");
    const res = await f.add(code);
    if (res.ok) {
      setCode("");
      setNote({ tone: "ok", text: `Request sent to ${res.username}. It shows up for them next time they open this board.` });
      return;
    }
    setNote({
      tone: "bad",
      text:
        res.reason === "not-found"
          ? "No player has that code. Check it against what they read out — there is no O, I, L or zero in a code."
          : res.reason === "self"
            ? "That is your own code."
            : res.reason === "exists"
              ? "You have already asked them. They see it next time they open this board."
              : "That did not go through. Try again in a moment.",
    });
  }

  async function onAccept(id: string) {
    sfx("uitick");
    const ok = await f.accept(id);
    setNote(ok ? null : { tone: "bad", text: "Could not accept that request. Try again in a moment." });
  }

  async function onDecline(id: string) {
    sfx("uitick");
    const ok = await f.decline(id);
    setNote(ok ? null : { tone: "bad", text: "Could not dismiss that request. Try again in a moment." });
  }

  async function onRemove(id: string) {
    const ok = await f.remove(id);
    setNote(ok ? null : { tone: "bad", text: "Could not remove that friend. Try again in a moment." });
  }

  if (needsAccount) {
    return (
      <section aria-label="Friends" className="mt-4 border-y border-hairline-strong py-4">
        <p className="eyebrow text-secondary">Friends</p>
        <p className="voice mt-2 text-[0.82rem] leading-snug text-ink-dim">
          A friend code belongs to an account, not to a browser. Yours exists only on this
          device right now, so nobody else could resolve it. Add an email the next time you
          start a run and your list follows you anywhere.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Friends" className="mt-4 border-y border-hairline-strong py-4">
      {/* ── your code ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-hairline pb-3">
        <div>
          <p className="eyebrow text-secondary" style={{ fontSize: "0.58rem" }}>
            Your friend code
          </p>
          {/* `textIndent` cancels the trailing letter-space so wide tracking stays
              optically aligned — the same correction the lobby's room code makes. */}
          {friendCode ? (
            <p className="num mt-1.5 text-2xl leading-none text-ink" style={{ letterSpacing: "0.28em", textIndent: "0.28em" }}>
              {friendCode}
            </p>
          ) : (
            <p className="mt-1.5 font-body text-sm text-tertiary">Not loaded yet.</p>
          )}
        </div>
        {friendCode && (
          <button
            type="button"
            onClick={copyCode}
            data-radius=""
            className="inline-flex min-h-11 items-center gap-1.5 border border-hairline-strong px-3 eyebrow text-ink-dim transition-colors hover:border-ink hover:text-ink"
            style={{ fontSize: "0.6rem" }}
          >
            {copied ? (
              <>
                <CheckIcon size={13} /> Copied
              </>
            ) : (
              "Copy the code"
            )}
          </button>
        )}
      </div>

      {/* ── add somebody ──────────────────────────────────────────────────── */}
      <form onSubmit={send} className="mt-3.5">
        <label htmlFor={codeId} className="eyebrow text-ink-dim">
          Add a friend by code
        </label>
        <div className="mt-1.5 flex items-end gap-2">
          {/* The stamp typography of a code, at input scale: what they read out and
              what you type should look like the same object. */}
          <input
            id={codeId}
            value={code}
            onChange={(e) => {
              setCode(normalizeFriendCode(e.target.value));
              setNote(null);
            }}
            maxLength={FRIEND_CODE_LENGTH}
            placeholder="K7X2FM"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby={note ? noteId : undefined}
            aria-invalid={note?.tone === "bad" ? true : undefined}
            data-radius=""
            className="num min-w-0 flex-1 border border-hairline-strong bg-bg2 px-3 py-2.5 text-lg uppercase text-ink outline-none placeholder:text-tertiary focus:border-ink"
            style={{ letterSpacing: "0.3em" }}
          />
          <LedgerButton variant="secondary" size="md" type="submit" loading={f.busy === "add"} disabled={f.busy !== null}>
            Send
          </LedgerButton>
        </div>
        {note && (
          // Colour is never the only channel: the mark and the sentence both carry it.
          <p
            id={noteId}
            role={note.tone === "bad" ? "alert" : "status"}
            className={`mt-2 font-body text-[0.8rem] leading-snug ${note.tone === "bad" ? "text-loss" : "text-gain"}`}
          >
            <span aria-hidden>{note.tone === "bad" ? "▲ " : "— "}</span>
            {note.text}
          </p>
        )}
      </form>

      {/* ── the lists ─────────────────────────────────────────────────────── */}
      {f.loading ? (
        <p className="py-5 text-center">
          <TerminalOp label="Reading the roster" center />
        </p>
      ) : f.failed ? (
        <p role="alert" className="mt-4 border-l-2 border-l-loss bg-bg2 px-3 py-2.5 font-body text-[0.8rem] leading-snug text-loss">
          <span aria-hidden>▲ </span>
          Your list did not come back. This is a connection problem, not an empty list.
        </p>
      ) : (
        <>
          {f.incoming.length > 0 && (
            <Group title={`Requests · ${f.incoming.length}`}>
              {f.incoming.map((id) => {
                // The visible word is still the whole label, so the accessible
                // name CONTAINS it — WCAG 2.5.3. A column of identical "Accept"
                // buttons is otherwise unanswerable without the row's context.
                const who = f.profiles[id]?.username ?? "this player";
                return (
                  <Row key={id} id={id} profile={f.profiles[id]}>
                    <LedgerButton
                      variant="secondary"
                      size="sm"
                      aria-label={`Accept ${who}`}
                      onClick={() => void onAccept(id)}
                      disabled={f.busy !== null}
                      loading={f.busy === id}
                    >
                      Accept
                    </LedgerButton>
                    <LedgerButton
                      variant="ghost"
                      size="sm"
                      aria-label={`Dismiss the request from ${who}`}
                      onClick={() => void onDecline(id)}
                      disabled={f.busy !== null}
                    >
                      Dismiss
                    </LedgerButton>
                  </Row>
                );
              })}
            </Group>
          )}

          <Group title={f.friends.length > 0 ? `Friends · ${f.friends.length}` : "Friends"}>
            {f.friends.length === 0 ? (
              <p className="py-2 font-body text-[0.8rem] leading-snug text-secondary">
                Nobody yet. Send someone your code, or add theirs above — a friendship takes
                both of you, so a request does nothing until they say yes.
              </p>
            ) : (
              f.friends.map((id) => (
                <Row key={id} id={id} profile={f.profiles[id]}>
                  <RemoveButton
                    name={f.profiles[id]?.username ?? "this player"}
                    busy={f.busy !== null}
                    onConfirm={() => void onRemove(id)}
                  />
                </Row>
              ))
            )}
          </Group>

          {f.outgoing.length > 0 && (
            <Group title={`Sent · ${f.outgoing.length}`}>
              {f.outgoing.map((id) => (
                <Row key={id} id={id} profile={f.profiles[id]}>
                  <span className="eyebrow text-tertiary" style={{ fontSize: "0.55rem" }}>
                    Waiting
                  </span>
                </Row>
              ))}
            </Group>
          )}
        </>
      )}
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="eyebrow border-b border-hairline pb-1 text-secondary" style={{ fontSize: "0.58rem" }}>
        {title}
      </p>
      <ul className="mt-1" aria-label={title}>
        {children}
      </ul>
    </div>
  );
}

function Row({ id, profile, children }: { id: string; profile?: Profile; children: React.ReactNode }) {
  // A profile that did not resolve still gets a row: the edge is real, and hiding
  // it would make a friend you definitely have look like one you do not.
  const name = profile?.username ?? "anonymous";
  return (
    <li className="flex items-center gap-2.5 border-b border-hairline py-2 last:border-b-0">
      <Avatar seed={profile?.avatarSeed ?? id} username={name} size={30} />
      <span className="min-w-0 flex-1 truncate font-body text-[0.9rem] text-ink">{name}</span>
      <span className="flex shrink-0 items-center gap-1.5">{children}</span>
    </li>
  );
}

/**
 * Two-tap remove. Unfriending deletes BOTH edges — theirs as well as mine — and
 * the only way back is to ask again and be accepted, so it takes the same confirm
 * the house gives ending a run.
 *
 * The armed state names the person. A roster is a column of near-identical rows
 * and "Tap again to confirm" beside the wrong one is the exact mistake this
 * pattern exists to prevent.
 */
function RemoveButton({ name, busy, onConfirm }: { name: string; busy: boolean; onConfirm: () => void }) {
  const { sfx } = useAudio();
  const armed = useArmedAction({
    label: "Remove",
    armedLabel: `Tap again — remove ${name}`,
    onConfirm,
    onArm: () => sfx("uitick"),
  });
  return (
    <LedgerButton
      variant={armed.armed ? "danger" : "ghost"}
      size="sm"
      onClick={armed.onClick}
      onBlur={armed.onBlur}
      disabled={busy}
    >
      <ArmedLabel reserve={armed.reserve} align="end">
        {armed.label}
      </ArmedLabel>
    </LedgerButton>
  );
}
