import { ImageResponse } from "next/og";
import { PALETTE } from "@/lib/palette";

export const runtime = "edge";
export const alt = "LifePatch — Survive the Internet Economy";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Phase O — the landing page's Open Graph card. Same LEDGER wordmark language
 * as the /api/og generic fallback: palette hexes, Anton wordmark, double-rule
 * frame, FORM 01 filing line. Fonts load from the og route's _fonts dir.
 */

// Edge-rendered: no CSS custom properties available here.
const BG = PALETTE.bg;
const INK = PALETTE.ink;
const SECONDARY = PALETTE.secondary;
const TERTIARY = PALETTE.tertiary;
const HAIRLINE = PALETTE.hairline;

export default async function OgImage() {
  const [anton, mono] = await Promise.all([
    fetch(new URL("./api/og/_fonts/Anton-Regular.ttf", import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL("./api/og/_fonts/IBMPlexMono-Regular.ttf", import.meta.url)).then((r) => r.arrayBuffer()),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: BG,
          border: `1px solid ${HAIRLINE}`,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 84px", border: `1px solid ${HAIRLINE}` }}>
          <span style={{ fontFamily: "IBMPlexMono", fontSize: 22, color: TERTIARY, letterSpacing: 6 }}>
            FORM 01 · LEDGER OF A LIFE
          </span>
          <span style={{ fontFamily: "Anton", fontSize: 150, color: INK, letterSpacing: 2, marginTop: 18 }}>
            LIFEPATCH
          </span>
          <div style={{ display: "flex", width: 640, height: 2, background: INK, marginTop: 26 }} />
          <div style={{ display: "flex", width: 640, height: 1, background: HAIRLINE, marginTop: 5 }} />
          <span style={{ fontFamily: "IBMPlexMono", fontSize: 26, color: SECONDARY, letterSpacing: 4, marginTop: 26 }}>
            SURVIVE THE INTERNET ECONOMY
          </span>
        </div>
        <span style={{ fontFamily: "IBMPlexMono", fontSize: 18, color: TERTIARY, letterSpacing: 3, marginTop: 34 }}>
          THE HOUSE ALWAYS COUNTS.
        </span>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Anton", data: anton, style: "normal" as const, weight: 400 as const },
        { name: "IBMPlexMono", data: mono, style: "normal" as const, weight: 400 as const },
      ],
      /**
       * This card has no inputs — it is the same 1200x630 render on every request,
       * and it only changes when a deploy changes it. It was still being rendered
       * per request: `runtime = "edge"` disables static generation for the route
       * (the build says so out loud), and Next's default for a dynamic route is
       * `max-age=0, must-revalidate`, which no CDN will hold.
       *
       * That matters more since app/api/og/[id] started redirecting its
       * unknown-run fallback here instead of drawing its own copy. The redirect is
       * what takes a stream of random UUIDs off the per-request render path, and it
       * only does that if the ONE url they all land on is cacheable. Uncached, the
       * redirect would move the render rather than remove it.
       *
       * A week at the edge, an hour in browsers. Vercel invalidates its CDN on
       * deploy, so a long `s-maxage` cannot outlive the design it is caching.
       */
      headers: {
        "cache-control": "public, no-transform, max-age=3600, s-maxage=604800, stale-while-revalidate=604800",
      },
    },
  );
}
