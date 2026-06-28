"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { MailIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/NeonButton";
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
  const { user, loading, linkSent, isCloud, signIn, signOut } = auth;
  const [email, setEmail] = useState("");
  const [save, setSave] = useState<RunState | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!user) return;
    setChecking(true);
    loadRun(user.id, mode)
      .then((s) => setSave(isCompatibleSave(s) ? s : null))
      .finally(() => setChecking(false));
  }, [user, mode]);

  return (
    <div className="mx-auto flex min-h-[100svh] w-full max-w-md flex-col justify-center px-5 py-14">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <p className="eyebrow text-center text-accent">{MODES[mode].name} · {MODES[mode].meta}</p>
        <h1 className="display-caps mt-3 text-center text-4xl text-ink">Save your life</h1>
        <p className="mx-auto mt-2 max-w-xs text-center font-serif text-sm italic text-ink-dim">
          Sign in with email so your run survives the tab closing.
        </p>

        <div className="mt-8 rounded-[5px] border border-ink/12 bg-bg2 p-5">
          {loading ? (
            <p className="text-center font-serif text-ink-dim">…</p>
          ) : !user ? (
            <form
              onSubmit={(e) => { e.preventDefault(); signIn(email); }}
              className="space-y-3"
            >
              <label className="eyebrow text-ink-dim" htmlFor="email">Email</label>
              <div className="flex items-center gap-2 rounded-[4px] border border-ink/20 bg-bg px-3 py-2 focus-within:border-accent">
                <MailIcon size={16} className="text-ink-dim" />
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@email.com"
                  className="w-full bg-transparent font-serif text-ink outline-none placeholder:text-ink-dim/60"
                />
              </div>
              {linkSent ? (
                <p className="font-serif text-sm text-olive">Check your inbox for a magic link.</p>
              ) : (
                <NeonButton type="submit" variant="primary" size="md" className="w-full">
                  {isCloud ? "Email me a magic link" : "Continue with email"}
                </NeonButton>
              )}
              {!isCloud && (
                <p className="font-serif text-xs italic text-ink-dim">
                  Dev mode: saves stay on this device until cloud keys are added.
                </p>
              )}
            </form>
          ) : (
            <div className="space-y-3">
              <p className="font-serif text-sm text-ink/80">
                Signed in as <span className="text-accent">{user.email}</span>
              </p>
              {checking ? (
                <p className="font-serif text-ink-dim">Looking for a saved run…</p>
              ) : save ? (
                <>
                  <NeonButton variant="primary" size="md" className="w-full" onClick={() => onResume(save)}>
                    Continue — Year {yearIndex(save)} (age {save.age})
                  </NeonButton>
                  <NeonButton variant="secondary" size="md" className="w-full" onClick={onNew}>
                    Start a new run (overwrites)
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
