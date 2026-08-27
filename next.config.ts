import type { NextConfig } from "next";

// Phase O security headers — the pragmatic set: clickjacking + MIME-sniff +
// referrer/permissions lockdown, and a CSP that restricts only embedding,
// plugins, and <base> (no script-src, so Next hydration/audio/Supabase are
// untouched).
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
    value: "frame-ancestors 'none'; frame-src 'none'; form-action 'self'; object-src 'none'; base-uri 'self'",
  },
];

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
