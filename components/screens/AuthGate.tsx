"use client";

import { motion } from "framer-motion";
import { useEffect, useId, useState } from "react";
import { MailIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/LedgerButton";
import { SoundCell } from "@/components/ui/SoundCell";
import { TerminalOp } from "@/components/ui/TerminalOp";
import { ArmedLabel, useArmedAction } from "@/components/ui/useArmedAction";
import type { useAuth } from "@/hooks/useAuth";
import { MODES, type ModeId } from "@/lib/modes";
import { recentRoom } from "@/lib/mp/matchStore";
import { loadRunChecked, OUTDATED_SAVE_MESSAGE } from "@/lib/saves";
import { yearIndex, type RunState } from "@/lib/runEngine";

/**
 * The three things that can be true of a save, and what to offer for each: a run to
 * continue, a run this engine can no longer read, or nothing yet — plus the failure
 * case, which is deliberately NOT treated as "no save" (starting fresh over a save
 * that may still be there is how a save gets destroyed).
 *
 * Extracted because guest play needs exactly the same four states as an account. The
 * only differences between the two gates are the line above this block and the way
 * out below it, and duplicating the block to say that would guarantee the two drift.
 */
function SaveActions({
  checking,
  loadFailed,
  outdated,
  save,
  roomBack,
  onRetry,
  onResume,
  onNew,
  overwrite,
}: {
  checking: boolean;
  loadFailed: boolean;
  outdated: boolean;
  save: RunState | null;
  /** A room this device is still in, if any — see the block below. */
  roomBack: string | null;
  onRetry: () => void;
  onResume: (state: RunState) => void;
  onNew: () => void;
  overwrite: ReturnType<typeof useArmedAction>;
}) {
  if (checking) return <p><TerminalOp label="Looking for a saved run" /></p>;
  if (loadFailed) {
    return (
      <>
        <p role="alert" className="num text-[0.72rem] leading-snug text-loss">
          Could not reach your saved run. Starting a new one now could overwrite it.
        </p>
        <NeonButton variant="secondary" size="md" className="w-full" onClick={onRetry}>
          Try again
        </NeonButton>
      </>
    );
  }
  if (outdated) {
    return (
      <>
        {/* Not an error and not loss-red: nothing playable is being destroyed, so
            this is information, not a warning. */}
        <p className="voice text-sm leading-snug text-ink-dim">{OUTDATED_SAVE_MESSAGE}</p>
        <NeonButton variant="primary" size="md" className="w-full" onClick={onNew}>
          Begin a new life →
        </NeonButton>
      </>
    );
  }
  if (save) {
    return (
      <>
        <NeonButton variant="primary" size="md" className="w-full" onClick={() => onResume(save)}>
          Continue — Year {yearIndex(save)} (age {save.age})
        </NeonButton>
        {/* A player who reloaded out of a live match lands here, and neither door
            above is theirs: "Continue" resumes an unrelated SOLO life, and the only
            other way through says it erases the save. The room is a third thing, and
            going to it destroys nothing — `onNew` only opens Setup, where the room
            is offered back. */}
        {roomBack && (
          <div className="border-l-2 border-hairline-strong bg-bg px-3 py-2.5">
            <p className="voice text-[0.8rem] leading-snug text-secondary">
              You were in room <span className="num tracking-[0.18em] text-ink">{roomBack}</span>.
            </p>
            <div className="mt-2">
              <NeonButton variant="secondary" size="sm" onClick={onNew}>
                Go back to it →
              </NeonButton>
            </div>
          </div>
        )}
        <NeonButton
          variant={overwrite.armed ? "danger" : "secondary"}
          size="md"
          className="w-full"
          onClick={overwrite.onClick}
          onBlur={overwrite.onBlur}
        >
          <ArmedLabel>{overwrite.label}</ArmedLabel>
        </NeonButton>
      </>
    );
  }
  return (
    <NeonButton variant="primary" size="md" className="w-full" onClick={onNew}>
      Begin a new life →
    </NeonButton>
  );
}

export function AuthGate({
  auth,
  mode,
  onResume,
  onNew,
  onBack,
}: {
  auth: ReturnType<typeof useAuth>;
  mode: ModeId;
  onResume: (state: RunState) => void;
  onNew: () => void;
  onBack: () => void;
}) {
  const { user, loading, linkSent, isCloud, guest, signIn, continueAsGuest, signOut, clearLinkSent } = auth;
  const [email, setEmail] = useState("");
  const [save, setSave] = useState<RunState | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  /** The save lookup failed — distinct from "no save", which is safe to overwrite. */
  const [loadFailed, setLoadFailed] = useState(false);
  /** A save exists but predates the current engine: say so instead of silently
   *  offering a fresh run, which reads as "my save vanished". */
  const [outdated, setOutdated] = useState(false);
  const [retry, setRetry] = useState(0);
  /** A room this device is still in. Read on mount, so the server and the first
   *  client paint agree. Story only — the other modes have no rooms. */
  const [roomBack, setRoomBack] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== "story") return;
    const r = recentRoom();
    setRoomBack(r && !r.ended ? r.roomCode : null);
  }, [mode]);
  const errorId = useId();

  useEffect(() => {
    if (!user) return;
    let active = true;
    setChecking(true);
    setLoadFailed(false);
    setOutdated(false);
    loadRunChecked(user.id, mode)
      .then((res) => {
        if (!active) return;
        setSave(res.kind === "ok" ? res.state : null);
        setOutdated(res.kind === "outdated");
      })
      // A rejection used to fall through the bare `.finally()` and quietly offer a fresh
      // run — which overwrites a save that may well still be there.
      .catch(() => {
        if (!active) return;
        setSave(null);
        setLoadFailed(true);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [user, mode, retry]);

  // Destroying an existing save takes two taps.
  const overwrite = useArmedAction({
    label: "Start a new run (overwrites)",
    armedLabel: "Tap again — this erases your save",
    onConfirm: onNew,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSignInError(null);
    setSubmitting(true);
    try {
      await signIn(email);
    } catch (err) {
      setSignInError(
        err instanceof Error && err.message
          ? err.message
          : "Could not send the link. Check the address and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[100svh] w-full max-w-md flex-col justify-center px-5 py-14">
      <SoundCell className="mb-4" />
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <p className="eyebrow text-center text-ink">{MODES[mode].name} · {MODES[mode].meta}</p>
        <h1 className="display-caps mt-3 text-center text-4xl text-ink">
          {guest ? "Playing as a guest" : "Save your life"}
        </h1>
        <p className="voice mx-auto mt-2 max-w-xs text-center text-sm text-ink-dim">
          {guest
            ? "Your run is saved on this device. Add an email whenever you want it on another one."
            : "Sign in with email so your run survives the tab closing — or play as a guest right now."}
        </p>

        <div className="mt-8 border border-hairline-strong bg-bg2 p-5">
          {loading ? (
            <p className="text-center"><TerminalOp label="Verifying ID" center /></p>
          ) : !user ? (
            linkSent ? (
              <div className="space-y-3">
                <p className="font-body text-sm text-gain">Check your inbox for a magic link.</p>
                <p className="font-body text-xs text-secondary">Sent to {email.trim().toLowerCase()}.</p>
                <NeonButton variant="ghost" size="sm" className="underline" onClick={() => { clearLinkSent(); setSignInError(null); }}>
                  Use a different email
                </NeonButton>
              </div>
            ) : (
              <>
              <form onSubmit={submit} className="space-y-3">
                <label className="eyebrow text-ink-dim" htmlFor="email">Email</label>
                <div className="flex items-center gap-2 border border-hairline-strong bg-bg px-3 py-2 focus-within:border-ink" data-radius="">
                  <MailIcon size={16} className="text-ink-dim" />
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@email.com"
                    aria-invalid={signInError ? true : undefined}
                    aria-describedby={signInError ? errorId : undefined}
                    className="w-full bg-transparent font-body text-ink outline-none placeholder:text-tertiary"
                  />
                </div>
                {signInError && (
                  <p id={errorId} role="alert" className="num text-[0.72rem] leading-snug text-loss">
                    {signInError}
                  </p>
                )}
                <NeonButton type="submit" variant="primary" size="md" className="w-full" loading={submitting}>
                  {isCloud ? "Email me a magic link" : "Continue with email"}
                </NeonButton>
                {!isCloud && (
                  <p className="voice text-xs text-ink-dim">
                    {process.env.NODE_ENV === "production"
                      ? "Saves stay on this device."
                      : "Dev mode: saves stay on this device until cloud keys are added."}
                  </p>
                )}
              </form>

              {/* The way in without an account. Below a rule and outside the form's
                  stack for the same reason "Sign out" is: a full-width 44px target
                  butted against the primary CTA makes the mis-tap likelier, not rarer.
                  `secondary`, never `primary` — one accent fill per screen, and the
                  email path is still the one being recommended. */}
              <div className="mt-5 space-y-2 border-t border-hairline pt-4">
                <NeonButton variant="secondary" size="md" className="w-full" onClick={continueAsGuest}>
                  Play as guest →
                </NeonButton>
                <p className="voice text-xs leading-snug text-ink-dim">
                  No email, no account. The run saves on this device and you can add an email later
                  without losing it.
                </p>
              </div>
              </>
            )
          ) : guest ? (
            /* The guest's own gate. Same three states as an account (a save to
               continue, a save this engine can't read, or nothing yet) — the only
               difference is where the save lives and that signing in is still open. */
            <div className="space-y-3">
              <p className="font-body text-sm text-ink/80">
                Playing as a <span className="text-ink">guest</span> — this device only.
              </p>
              <SaveActions
                checking={checking}
                loadFailed={loadFailed}
                outdated={outdated}
                save={save}
                roomBack={roomBack}
                onRetry={() => setRetry((n) => n + 1)}
                onResume={onResume}
                onNew={onNew}
                overwrite={overwrite}
              />
              {/* Behind a rule and out of the primary stack, same as Sign out below:
                  a 44px target directly under the CTA makes the mis-tap likelier. */}
              <div className="mt-5 space-y-2 border-t border-hairline pt-4 text-center">
                <p className="voice text-xs leading-snug text-ink-dim">
                  Clearing this browser&rsquo;s data clears the run. An email keeps it.
                </p>
                <NeonButton variant="ghost" size="sm" onClick={signOut}>
                  Sign in with email instead
                </NeonButton>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="font-body text-sm text-ink/80">
                Signed in as <span className="text-ink">{user.email}</span>
              </p>
              <SaveActions
                checking={checking}
                loadFailed={loadFailed}
                outdated={outdated}
                save={save}
                roomBack={roomBack}
                onRetry={() => setRetry((n) => n + 1)}
                onResume={onResume}
                onNew={onNew}
                overwrite={overwrite}
              />
              {/* Out of the stack and behind a rule: a 44px hit layer sitting directly under
                  the primary CTA would butt against it and make the mis-tap likelier, not rarer. */}
              <div className="mt-5 border-t border-hairline pt-4 text-center">
                <NeonButton variant="ghost" size="sm" onClick={signOut}>Sign out</NeonButton>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 text-center">
          <NeonButton variant="ghost" size="sm" onClick={onBack}>← Back</NeonButton>
        </div>
      </motion.div>
    </div>
  );
}
