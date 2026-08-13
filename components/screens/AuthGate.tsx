"use client";

import { motion } from "framer-motion";
import { useEffect, useId, useState } from "react";
import { MailIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/LedgerButton";
import { TerminalOp } from "@/components/ui/TerminalOp";
import { ArmedLabel, useArmedAction } from "@/components/ui/useArmedAction";
import type { useAuth } from "@/hooks/useAuth";
import { MODES, type ModeId } from "@/lib/modes";
import { loadRun } from "@/lib/saves";
import { isCompatibleSave, yearIndex, type RunState } from "@/lib/runEngine";

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
  const { user, loading, linkSent, isCloud, signIn, signOut, clearLinkSent } = auth;
  const [email, setEmail] = useState("");
  const [save, setSave] = useState<RunState | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  /** The save lookup failed — distinct from "no save", which is safe to overwrite. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const errorId = useId();

  useEffect(() => {
    if (!user) return;
    let active = true;
    setChecking(true);
    setLoadFailed(false);
    loadRun(user.id, mode)
      .then((s) => {
        if (active) setSave(isCompatibleSave(s) ? s : null);
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
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <p className="eyebrow text-center text-ink">{MODES[mode].name} · {MODES[mode].meta}</p>
        <h1 className="display-caps mt-3 text-center text-4xl text-ink">Save your life</h1>
        <p className="mx-auto mt-2 max-w-xs text-center font-body text-sm italic text-ink-dim">
          Sign in with email so your run survives the tab closing.
        </p>

        <div className="mt-8 border border-hairline-strong bg-bg2 p-5">
          {loading ? (
            <p className="text-center"><TerminalOp label="Verifying ID" center /></p>
          ) : !user ? (
            linkSent ? (
              <div className="space-y-3">
                <p className="font-body text-sm text-gain">Check your inbox for a magic link.</p>
                <p className="font-body text-xs text-secondary">Sent to {email.trim().toLowerCase()}.</p>
                <button
                  type="button"
                  onClick={() => { clearLinkSent(); setSignInError(null); }}
                  className="eyebrow text-ink-dim underline transition-colors hover:text-ink"
                >
                  Use a different email
                </button>
              </div>
            ) : (
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
                  <p className="font-body text-xs italic text-ink-dim">
                    {process.env.NODE_ENV === "production"
                      ? "Saves stay on this device."
                      : "Dev mode: saves stay on this device until cloud keys are added."}
                  </p>
                )}
              </form>
            )
          ) : (
            <div className="space-y-3">
              <p className="font-body text-sm text-ink/80">
                Signed in as <span className="text-ink">{user.email}</span>
              </p>
              {checking ? (
                <p><TerminalOp label="Looking for a saved run" /></p>
              ) : loadFailed ? (
                <>
                  <p role="alert" className="num text-[0.72rem] leading-snug text-loss">
                    Could not reach your saved run. Starting a new one now could overwrite it.
                  </p>
                  <NeonButton variant="secondary" size="md" className="w-full" onClick={() => setRetry((n) => n + 1)}>
                    Try again
                  </NeonButton>
                </>
              ) : save ? (
                <>
                  <NeonButton variant="primary" size="md" className="w-full" onClick={() => onResume(save)}>
                    Continue — Year {yearIndex(save)} (age {save.age})
                  </NeonButton>
                  <NeonButton
                    variant={overwrite.armed ? "danger" : "secondary"}
                    size="md"
                    className="w-full"
                    onClick={overwrite.onClick}
                    onBlur={overwrite.onBlur}
                  >
                    <ArmedLabel armed={overwrite.armed}>{overwrite.label}</ArmedLabel>
                  </NeonButton>
                </>
              ) : (
                <NeonButton variant="primary" size="md" className="w-full" onClick={onNew}>
                  Begin a new life →
                </NeonButton>
              )}
              <button type="button" onClick={signOut} className="w-full eyebrow text-ink-dim hover:text-ink">
                Sign out
              </button>
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
