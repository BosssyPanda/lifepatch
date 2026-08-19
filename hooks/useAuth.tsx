"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { localPlayerId } from "@/lib/cloud/identity";
import { mergeLocalMastery } from "@/lib/cloud/mastery";
import { isCloud, supabase } from "@/lib/supabase";

export type AuthUser = { id: string; email: string };

const DEV_KEY = "lifepatch.devUser";

export type AuthApi = {
  user: AuthUser | null;
  loading: boolean;
  linkSent: boolean;
  isCloud: boolean;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearLinkSent: () => void;
};

/**
 * Email auth with a dev fallback.
 * - Cloud (Supabase keys present): magic-link sign-in; session restored on load.
 * - Dev (no keys): "continue with email" stores a local pseudo-user. Fully playable.
 *
 * PRIVATE. This is the state itself, and exactly one of it may exist — see
 * `AuthProvider` below for why.
 */
function useAuthState(): AuthApi {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [linkSent, setLinkSent] = useState(false);

  useEffect(() => {
    let active = true;
    if (isCloud && supabase) {
      supabase.auth.getSession().then(({ data }) => {
        if (!active) return;
        const u = data.session?.user;
        setUser(u ? { id: u.id, email: u.email ?? "" } : null);
        setLoading(false);
      });
      const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
        const u = session?.user;
        setUser(u ? { id: u.id, email: u.email ?? "" } : null);
      });
      return () => {
        active = false;
        sub.subscription.unsubscribe();
      };
    }
    // dev fallback
    try {
      const raw = localStorage.getItem(DEV_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {}
    setLoading(false);
    return () => {
      active = false;
    };
  }, []);

  /**
   * Throws on failure. It used to discard the Supabase error and set `linkSent`
   * unconditionally, so a rate-limited or rejected address showed "check your inbox"
   * forever — the caller now owns surfacing it.
   */
  const signIn = useCallback(async (email: string) => {
    const clean = email.trim().toLowerCase();
    if (!clean) throw new Error("Enter an email address.");
    if (isCloud && supabase) {
      const { error } = await supabase.auth.signInWithOtp({
        email: clean,
        options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined },
      });
      if (error) throw error;
      setLinkSent(true);
      return;
    }
    const u = { id: `dev-${clean}`, email: clean };
    try {
      localStorage.setItem(DEV_KEY, JSON.stringify(u));
    } catch {}
    // Anything learned before signing in was filed under the device id; carry it
    // across so entering an email never looks like it wiped your progress.
    mergeLocalMastery(localPlayerId(), u.id);
    setUser(u);
  }, []);

  /** Back to the form — "that wasn't the address I meant". */
  const clearLinkSent = useCallback(() => setLinkSent(false), []);

  const signOut = useCallback(async () => {
    if (isCloud && supabase) await supabase.auth.signOut();
    try {
      localStorage.removeItem(DEV_KEY);
    } catch {}
    setUser(null);
    setLinkSent(false);
  }, []);

  return useMemo(
    () => ({ user, loading, linkSent, isCloud, signIn, signOut, clearLinkSent }),
    [user, loading, linkSent, signIn, signOut, clearLinkSent],
  );
}

const AuthCtx = createContext<AuthApi | null>(null);

/**
 * One auth state for the whole app.
 *
 * This used to be a bare hook, so every caller got its OWN `user`. That is fine
 * until two of them sit on opposite sides of a sign-in: `ConceptLearnProvider`
 * wraps the shell, so its instance mounted before the gate and kept `user = null`
 * for the entire session, and every concept a player earned was filed under the
 * anonymous device id. The report and the mastery map mount *after* the gate,
 * resolve the real id, and read a key nobody had written to — so a run could
 * announce "this run sharpened Compounding, Windfalls, Negotiation" and the Money
 * Brain behind it would still read 0%, every concept locked.
 *
 * Mount this ABOVE anything that records or reads progress.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  return <AuthCtx.Provider value={useAuthState()}>{children}</AuthCtx.Provider>;
}

/** The shared auth state. Throws outside the provider rather than quietly
 *  handing back a second copy — a second copy is the bug this replaced. */
export function useAuth(): AuthApi {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>.");
  return ctx;
}
