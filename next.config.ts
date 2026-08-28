import type { NextConfig } from "next";

/**
 * Where this build is allowed to send data.
 *
 * The CSP below still declines to police script EXECUTION — that needs a nonce
 * pipeline through Next's hydration, which is real work and remains a deliberate
 * scope call. `connect-src` is the half of the problem that costs nothing: it does
 * not stop an injected script from running, but it does stop one from phoning
 * home, and exfiltration is the part of an injection that actually hurts a player.
 *
 * Derived from the same env var the client is built against rather than
 * hardcoded, and OMITTED entirely when that var is absent — a directive naming a
 * project this build cannot talk to would break every request it does make, which
 * is a worse outcome than the one being defended against. Realtime needs the
 * `wss:` origin as well as the `https:` one; Vercel Analytics and Speed Insights
 * both beacon to `/_vercel/...` on this origin, so `'self'` already covers them.
 */
function connectSrc(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return null;
  }
  return `connect-src 'self' ${origin} ${origin.replace(/^https:/, "wss:")}`;
}

// Phase O security headers — the pragmatic set: clickjacking + MIME-sniff +
// referrer/permissions lockdown, and a CSP that restricts only embedding,
// plugins, <base> and where data may be sent (no script-src, so Next
// hydration/audio/Supabase are untouched).
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
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
    ]
      .filter(Boolean)
      .join("; "),
  },
];

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
