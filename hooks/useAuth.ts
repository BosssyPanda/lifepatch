"use client";

import { useCallback, useEffect, useState } from "react";
import { isCloud, supabase } from "@/lib/supabase";

export type AuthUser = { id: string; email: string };

const DEV_KEY = "lifepatch.devUser";

/**
 * Email auth with a dev fallback.
 * - Cloud (Supabase keys present): magic-link sign-in; session restored on load.
 * - Dev (no keys): "continue with email" stores a local pseudo-user. Fully playable.
 */
export function useAuth() {
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

  const signIn = useCallback(async (email: string) => {
    const clean = email.trim().toLowerCase();
    if (!clean) return;
    if (isCloud && supabase) {
      await supabase.auth.signInWithOtp({
        email: clean,
        options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined },
      });
      setLinkSent(true);
      return;
    }
    const u = { id: `dev-${clean}`, email: clean };
    try {
      localStorage.setItem(DEV_KEY, JSON.stringify(u));
    } catch {}
    setUser(u);
  }, []);

  const signOut = useCallback(async () => {
    if (isCloud && supabase) await supabase.auth.signOut();
    try {
      localStorage.removeItem(DEV_KEY);
    } catch {}
    setUser(null);
    setLinkSent(false);
  }, []);

  return { user, loading, linkSent, isCloud, signIn, signOut };
}
