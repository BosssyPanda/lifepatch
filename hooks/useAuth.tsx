"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isGuestId, localPlayerId } from "@/lib/cloud/identity";
import { mergeLocalMastery } from "@/lib/cloud/mastery";
import { adoptGuestSaves } from "@/lib/saves";
import { cloudMisconfigured, isCloud, supabase } from "@/lib/supabase";

export type AuthUser = { id: string; email: string };

const DEV_KEY = "lifepatch.devUser";
/** Set once a player has chosen to play without an account; cleared on sign-out. */
const GUEST_KEY = "lifepatch.guest";

export type AuthApi = {
  user: AuthUser | null;
  loading: boolean;
  linkSent: boolean;
  isCloud: boolean;
  /** True while `user` is the anonymous device rather than a real account. */
  guest: boolean;
  signIn: (email: string) => Promise<void>;
  /** Play now, on this device, with no email. Reversible: `signIn` still works. */
  continueAsGuest: () => void;
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
  const guest = isGuestId(user?.id);

  /** The guest chosen on a previous visit, if one was — restored on every load. */
  const storedGuest = useCallback((): AuthUser | null => {
    try {
      return localStorage.getItem(GUEST_KEY) === "1" ? { id: localPlayerId(), email: "" } : null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (isCloud && supabase) {
      supabase.auth
        .getSession()
        .then(async ({ data }) => {
          if (!active) return;
          const u = data.session?.user;
          // The magic link lands on a fresh page load, so this is where a cloud
          // sign-in gets the guest's run carried across (no-op after the first time).
          // Wrapped on its own: carrying the runs across must never cost the player
          // their session. A failed adoption is a lost migration, not a lost sign-in,
          // and it must not fall through to the guest fallback below.
          if (u) {
            try {
              await adoptGuestSaves(localPlayerId(), u.id);
            } catch {}
          }
          if (!active) return;
          // A real session always wins over a remembered guest; otherwise the guest
          // is restored, so "Play as guest" survives a reload the same way a sign-in does.
          setUser(u ? { id: u.id, email: u.email ?? "" } : storedGuest());
        })
        .catch(() => {
          // The network is not the gate. A session we could not REACH is not a
          // session that refused us — an offline start, a DNS blip or a Supabase
          // outage used to leave `loading` true forever, which hid the sign-in form
          // AND the guest button for the life of the page. Guest play touches no
          // network at all, so a player who was entirely unaffected was locked out
          // of the game. Fall back to any remembered guest and let them in.
          if (active) setUser(storedGuest());
        })
        .finally(() => {
          // The ONLY place `loading` is cleared on the cloud path. It runs on both
          // outcomes by construction — that is the whole point of it being here.
          if (active) setLoading(false);
        });
      const { data: sub } = supabase.auth.onAuthStateChange(async (_e, session) => {
        // Async listener: nothing awaits it, so an unhandled rejection here would be
        // silent. Same rule as above — adoption failing never costs you the session.
        const u = session?.user;
        if (u) {
          try {
            await adoptGuestSaves(localPlayerId(), u.id);
          } catch {}
        }
        setUser(u ? { id: u.id, email: u.email ?? "" } : storedGuest());
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
      else setUser(storedGuest());
    } catch {}
    setLoading(false);
    return () => {
      active = false;
    };
  }, [storedGuest]);

  /**
   * Play without an account.
   *
   * The Rat Race already did exactly this — it runs on `localPlayerId()` and has
   * never asked for an email — so Story and Infinite were the only two of the three
   * modes behind a wall, which on a school laptop is a wall in front of the game.
   * The device id IS the player id here: `lib/saves` keys by it and keeps a guest's
   * runs on the device (see `cloudSavesFor`), and `resolvePlayerId` withholds it from
   * the cloud leaderboard, where RLS would refuse it anyway.
   */
  const continueAsGuest = useCallback(() => {
    try { localStorage.setItem(GUEST_KEY, "1"); } catch {}
    setUser({ id: localPlayerId(), email: "" });
    setLinkSent(false);
  }, []);

  /**
   * Throws on failure. It used to discard the Supabase error and set `linkSent`
   * unconditionally, so a rate-limited or rejected address showed "check your inbox"
   * forever — the caller now owns surfacing it.
   */
  const signIn = useCallback(async (email: string) => {
    const clean = email.trim().toLowerCase();
    if (!clean) throw new Error("Enter an email address.");
    // Signing in ends guest mode either way; in cloud that takes effect when the
    // magic link lands, so the flag is dropped now and the session decides.
    try { localStorage.removeItem(GUEST_KEY); } catch {}
    if (isCloud && supabase) {
      const { error } = await supabase.auth.signInWithOtp({
        email: clean,
        options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined },
      });
      if (error) throw error;
      setLinkSent(true);
      return;
    }
    // The dev fallback is a DEVELOPMENT convenience and must never stand in for
    // sign-in on a deployed site. Without this a production build that shipped
    // without the Supabase keys accepted any address as an account — see
    // `cloudMisconfigured`. Guest play is unaffected: it never comes through here.
    if (cloudMisconfigured) {
      throw new Error(
        "Sign-in isn't available on this deployment. You can still play as a guest — " +
          "your progress stays on this device.",
      );
    }
    const u = { id: `dev-${clean}`, email: clean };
    try {
      localStorage.setItem(DEV_KEY, JSON.stringify(u));
    } catch {}
    // Anything learned before signing in was filed under the device id; carry it
    // across so entering an email never looks like it wiped your progress. A run in
    // progress is the same promise, one level up — a guest who signs in mid-run
    // keeps the run.
    mergeLocalMastery(localPlayerId(), u.id);
    // AWAITED, not fired and forgotten: `AuthGate` looks for a save the moment
    // `user` changes, and an in-flight copy loses that race — the gate offered
    // "Begin a new life" over a run that was still being carried across.
    await adoptGuestSaves(localPlayerId(), u.id);
    setUser(u);
  }, []);

  /** Back to the form — "that wasn't the address I meant". */
  const clearLinkSent = useCallback(() => setLinkSent(false), []);

  const signOut = useCallback(async () => {
    if (isCloud && supabase) await supabase.auth.signOut();
    try {
      localStorage.removeItem(DEV_KEY);
      // Leaving guest mode too, or "Sign out" on a guest would sign them back in on
      // the next render from the remembered flag.
      localStorage.removeItem(GUEST_KEY);
    } catch {}
    setUser(null);
    setLinkSent(false);
  }, []);

  return useMemo(
    () => ({ user, loading, linkSent, isCloud, guest, signIn, continueAsGuest, signOut, clearLinkSent }),
    [user, loading, linkSent, guest, signIn, continueAsGuest, signOut, clearLinkSent],
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
