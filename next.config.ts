import type { NextConfig } from "next";

/**
 * Where this build is allowed to send data.
 *
 * NO `script-src`, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT. Read this
 * before adding one, because the obvious fix is not free.
 *
 * Policing script EXECUTION means a nonce, and a nonce has to be minted per
 * request. That forces every route through middleware and makes all of them
 * dynamic — which costs `/r/{id}` its ISR entirely. That route is the share card:
 * it is fetched by every chat client that unfurls a link, it is the one page in
 * this app designed to be hit by strangers in bulk, and `app/api/og/[id]` caches
 * it hard on purpose. Turning it dynamic means every unfurl becomes an origin
 * render plus a Supabase read, and the leaderboard loses its cache in the same
 * change. The hardening is real; so is the bill.
 *
 * What makes deferring it defensible is that the usual way in is closed already.
 * This app renders no user-supplied HTML — there is no rich text, no bio, no chat,
 * no markdown, and no `dangerouslySetInnerHTML` anywhere in the tree. The only
 * player-authored string that reaches another player's screen is the username,
 * and that is charset-locked in three places at once: `USERNAME_RE` in
 * `supabase/functions/_shared/username.ts`, the `profiles_username_charset` CHECK
 * that mirrors it, and the `profile` Edge Function that is now the only writer of
 * the column. So there is no known injection vector for `script-src` to be the
 * second line of defence behind.
 *
 * `connect-src` below is the half that costs nothing and is therefore not
 * deferred: it does not stop an injected script from running, but it does stop
 * one from phoning home, and exfiltration is the part of an injection that
 * actually hurts a player.
 *
 * REOPEN THIS the day any of those premises stops holding — the app renders
 * user-supplied markup, a third-party script is added to the document, or a
 * free-text field reaches another player's screen. At that point `script-src`
 * stops being defence-in-depth behind a closed door and becomes the door.
 *
 * Derived from the same env var the client is built against rather than
 * hardcoded. Realtime needs the `wss:` origin as well as the `https:` one; Vercel
 * Analytics and Speed Insights both beacon to `/_vercel/...` on this origin, so
 * `'self'` already covers them.
 *
 * NO ENV, NO SILENCE. This used to return null when the var was absent and the
 * directive was then filtered out of the policy altogether — sound reasoning
 * (naming a project the build cannot reach would break every request it does
 * make) with the wrong floor under it. The condition it fires on is exactly the
 * one `cloudMisconfigured` already calls a foreseeable accident: a production
 * build cut before the vars landed. That build shipped with no `connect-src` at
 * all, so the single directive standing between an injected script and
 * exfiltration was gone, and nothing in the output said so.
 *
 * `'self'` is the honest floor. A build with no Supabase project makes no
 * cross-origin calls by definition, so it is both true and strictly tighter than
 * silence — and if a var lands later, the deploy that inlines it widens this in
 * the same breath.
 */
function connectSrc(): string {
  const SELF = "connect-src 'self'";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return warnNoCloud(SELF, "NEXT_PUBLIC_SUPABASE_URL is not set");
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return warnNoCloud(SELF, `NEXT_PUBLIC_SUPABASE_URL is not a URL: ${url}`);
  }
  return `${SELF} ${origin} ${origin.replace(/^https:/, "wss:")}`;
}

/**
 * Say it out loud at build time. The companion to `lib/supabase.ts`'s
 * `cloudMisconfigured`, which can only raise its flag once the bundle is running
 * in a browser — by then the header is already cut. This is the same fact, stated
 * at the one moment it is still cheap to act on, and it is a warning rather than a
 * `throw` for the reason given there: a momentarily missing variable should cost
 * one feature, not the whole site.
 */
function warnNoCloud(value: string, why: string): string {
  console.warn(
    `[lifepatch] ${why} — building with no cloud. CSP falls back to "${value}"; ` +
      "sign-in, leaderboards and streaks will run on their local fallbacks.",
  );
  return value;
}

// Phase O security headers — the pragmatic set: clickjacking + MIME-sniff +
// referrer/permissions lockdown, and a CSP that restricts only embedding,
// plugins, <base> and where data may be sent (no script-src, so Next
// hydration/audio/Supabase are untouched).
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // The host serves this app over HTTPS and redirects http:// to it — but a
  // redirect is a round trip the network gets to answer first, and the FIRST
  // request of a session is the one that carries the Supabase session out of
  // localStorage. This tells the browser not to make that request at all.
  //
  // Two years is the value the preload list requires and the one every scanner
  // expects. `includeSubDomains` because nothing is served off a subdomain that
  // is not also HTTPS, and a subdomain that stays downgradeable is a cookie-
  // setting position on the same site.
  //
  // NO `preload`, DELIBERATELY. The token does nothing on its own — it is an
  // opt-in that only takes effect once the domain is submitted at
  // hstspreload.org — and what it would signal is a commitment that is very slow
  // to reverse: removal takes months of browser releases, and until then every
  // current and future subdomain must serve valid HTTPS or become unreachable.
  // That is a decision for whoever owns the domain to make on purpose, not a
  // side effect of a security pass. Everything the header actually buys is above.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // `form-action` and `frame-src` are added on the same reasoning as the rest:
  // neither interacts with hydration, so neither costs a nonce pipeline.
  // `form-action 'self'` blocks an injected form from posting off-origin, and the
  // app embeds nothing, so `frame-src 'none'` is simply true.
  {
    key: "Content-Security-Policy",
    value: [
      "frame-ancestors 'none'",
      "frame-src 'none'",
      "form-action 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      connectSrc(),
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
