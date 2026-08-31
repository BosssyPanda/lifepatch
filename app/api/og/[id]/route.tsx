import { ImageResponse } from "next/og";
import { cachedFonts } from "../_fonts/cache";
import { PALETTE } from "@/lib/palette";
import { currency } from "@/lib/format";
import { CASHFLOW_VERDICTS, safeVerdict, VERDICTS } from "@/lib/verdict";

export const runtime = "edge";

/**
 * Per-run Open Graph statement (Addendum §13 #9). Renders a 1200×630
 * palette-locked LEDGER card for one `results` row so a shared /r/{id} link
 * unfurls as the player's actual verdict. Reads the row over Supabase REST with
 * the public anon key (the table is public-read by RLS); any failure renders the
 * generic wordmark card instead of erroring — an unfurl must never 500.
 */

// Satori renders this on the edge with no document, so the tokens have to arrive
// as values. `lib/palette.ts` is the shared source these mirror.
const BG = PALETTE.bg;
const INK = PALETTE.ink;
const SECONDARY = PALETTE.secondary;
const TERTIARY = PALETTE.tertiary;
const HAIRLINE = PALETTE.hairline;
const GAIN = PALETTE.gain;
const LOSS = PALETTE.loss;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Immutable build assets — read once per isolate. See `_fonts/cache.ts`. */
const loadFonts = cachedFonts([
  new URL("../_fonts/Anton-Regular.ttf", import.meta.url),
  new URL("../_fonts/IBMPlexMono-Regular.ttf", import.meta.url),
]);

type Row = {
  id: string;
  mode: "story" | "infinite" | "cashflow";
  score: number;
  verdict: string;
  metrics: Record<string, number | string>;
};

async function fetchRow(id: string): Promise<Row | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !anon || !UUID_RE.test(id)) return null;
  try {
    const res = await fetch(
      `${base}/rest/v1/results?id=eq.${id}&select=id,mode,score,verdict,metrics`,
      {
        headers: { apikey: anon, authorization: `Bearer ${anon}` },
        // An unfurl is a scraper waiting on a socket, and this call had no ceiling:
        // a slow or wedged Supabase held an edge invocation open until the platform's
        // own limit and billed the whole of it. 2.5s is well past a healthy round
        // trip and well short of any scraper's patience. The abort lands in the
        // `catch` below, which is already the "render the generic card" path — a
        // timeout and a missing row want the same answer.
        signal: AbortSignal.timeout(2500),
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Row[];
    const row = rows[0] ?? null;
    // The same stance `/r/{id}` takes, for the same reason: `score` is a
    // client-written `numeric`, and a value that is not a finite number is not a
    // statement this origin should render at 84px. Returning null falls through to
    // the generic card below, which is the right answer for a row that is not one.
    if (!row || !Number.isFinite(Number(row.score))) return null;
    return row;
  } catch {
    return null;
  }
}

function verdictHex(title: string): string {
  for (const v of Object.values(VERDICTS)) if (v.title === title) return v.hex;
  if (title === CASHFLOW_VERDICTS.escaped) return GAIN;
  if (title === CASHFLOW_VERDICTS.racing) return SECONDARY;
  // Matches /r/[id]: the Rat Race's losing verdict reads as a loss, like Underwater.
  if (title === CASHFLOW_VERDICTS.buried) return LOSS;
  return INK;
}

/**
 * Anton at 118px fills the 1056px usable width at about 14 characters. The old two-step
 * ramp dropped straight to 88px, which still ran long for the longest verdict in the
 * game — "Escaped the Rat Race" (20) — so there is a third step for those.
 */
function verdictSize(verdict: string): number {
  const n = verdict.length;
  return n > 18 ? 72 : n > 14 ? 88 : 118;
}

const MODE_LABEL: Record<Row["mode"], string> = {
  story: "STORY RUN",
  infinite: "INFINITE RUN",
  cashflow: "RAT RACE",
};

function statRows(row: Row): { label: string; value: string }[] {
  const m = row.metrics ?? {};
  if (row.mode === "cashflow") {
    return [
      { label: "Net worth", value: currency(Number(m.netWorth ?? 0)) },
      { label: "Turns", value: String(m.turns ?? "—") },
      { label: "Monthly expenses", value: currency(Number(m.expenses ?? 0)) },
    ];
  }
  return [
    { label: "Final age", value: String(m.age ?? "—") },
    { label: "Happiness", value: `${m.happiness ?? "—"}%` },
  ];
}

function Leader({ label, value, size }: { label: string; value: string; size: number }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", width: "100%", gap: 18 }}>
      <span style={{ fontFamily: "PlexMono", fontSize: size, color: SECONDARY }}>{label}</span>
      {/* satori supports only solid|dashed — dashed is the dot-leader stand-in */}
      <div style={{ display: "flex", flexGrow: 1, borderBottom: `3px dashed ${HAIRLINE}` }} />
      <span style={{ fontFamily: "PlexMono", fontSize: size, color: INK }}>{value}</span>
    </div>
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // `fetchRow` has its own try/catch because this route must never 500 — an
  // unfurl that errors shows a broken card in every chat client that renders it.
  // The two font reads sitting beside it did not, so a transient failure reading a
  // bundled .ttf threw the whole route; and because `Promise.all` rejects fast, it
  // discarded a row lookup that may already have succeeded. Rare, since these are
  // static assets — and rare is the entire case the fallback card exists for.
  //
  // Each half now carries its own catch, because the reads no longer fail together:
  // the fonts are cached for the life of the isolate, so after the first request
  // they are not a read at all. A font fault no longer discards a good row.
  const [ttf, row] = await Promise.all([loadFonts().catch(() => null), fetchRow(id)]);
  const [anton, plex] = ttf ?? [null, null];

  // Without a typeface there is no card to draw at all. The static wordmark image
  // is the one thing left that always renders, so hand the scraper that instead of
  // a 500.
  //
  // THIS CHECK MUST STILL COME FIRST, for the surviving half of the original
  // reason: a font fault answered by the row branch below would be handed that
  // branch's `s-maxage=60`, pinning a platform hiccup at the edge for a minute —
  // exactly what the comment down there says must not happen. No cache-control
  // here on purpose: this is a fault, not a fact about this id.
  if (!anton || !plex) {
    return new Response(null, { status: 302, headers: { location: "/opengraph-image" } });
  }

  /**
   * Unknown or missing run → the static wordmark card, by REDIRECT rather than by
   * rendering one.
   *
   * A known id is cheap after its first hit — `s-maxage=86400` below. An unknown one
   * never was: the short TTL here is deliberate and correct (a link shared in the
   * window between the share URL being minted and its row landing must not pin the
   * WRONG card at every CDN and scraper for a year), but the consequence is that a
   * stream of random UUIDs never hits cache, and each one cost a Supabase round trip
   * plus a full 1200x630 Satori render billed to this origin.
   *
   * The 302 keeps the 60-second semantics exactly and takes the render off the
   * abusable path — the same move the missing-font branch above makes, for a
   * different reason. It only pays off because `/opengraph-image` is cacheable:
   * every unknown id lands on that ONE url, so the render happens once at the edge
   * rather than once per id. See the headers set there.
   */
  if (!row) {
    return new Response(null, {
      status: 302,
      headers: {
        location: "/opengraph-image",
        "cache-control": "public, no-transform, max-age=0, s-maxage=60",
      },
    });
  }

  const fonts = [
    { name: "Anton", data: anton, style: "normal" as const, weight: 400 as const },
    { name: "PlexMono", data: plex, style: "normal" as const, weight: 400 as const },
  ];
  /**
   * A real row never CHANGES — but it can cease to exist. `results` carries a
   * delete policy, so a player can remove a run whose card is already pinned at
   * every CDN and scraper under `immutable, max-age=31536000`: the `/r/{id}` page
   * revalidates hourly and starts 404ing while the unfurl keeps showing the
   * statement for a year. A shared link's traffic arrives in a burst, so a day at
   * the edge keeps essentially all of the benefit and lets a deletion take effect.
   */
  const headers = {
    "cache-control": "public, no-transform, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
  };
  // The unfurl card is the widest-travelling surface this string reaches — up to
  // 118px of display type on an image served from this origin. Guarded exactly as
  // the page's <h1> is; see `safeVerdict`.
  const verdict = safeVerdict(row.verdict);
  const hex = verdictHex(verdict);
  const isCash = row.mode === "cashflow";
  // Not "PASSIVE INCOME / MO": the Rat Race score is net worth plus a year of
  // cash flow (lib/scoreLabel.ts), and the `/mo` printed it as a wage.
  const scoreLabel = isCash ? "RAT RACE SCORE" : "FINAL NET WORTH";
  const scoreColor = isCash ? (Number(row.metrics?.escaped) === 1 ? GAIN : SECONDARY) : row.score >= 0 ? GAIN : LOSS;
  const score = currency(row.score);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: BG,
          padding: "56px 72px",
        }}
      >
        {/* top rail */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", width: "100%" }}>
          <span style={{ fontFamily: "Anton", fontSize: 40, color: INK, letterSpacing: 1 }}>LIFEPATCH</span>
          <span style={{ fontFamily: "PlexMono", fontSize: 24, color: TERTIARY, letterSpacing: 3 }}>
            STATEMENT NO. {row.id.slice(0, 8).toUpperCase()}
          </span>
        </div>
        <div style={{ display: "flex", width: "100%", borderBottom: `2px solid ${HAIRLINE}`, marginTop: 18 }} />

        {/* verdict */}
        <span style={{ fontFamily: "PlexMono", fontSize: 24, color: SECONDARY, letterSpacing: 10, marginTop: 44 }}>
          RUN CLOSED · {MODE_LABEL[row.mode]} · FINAL VERDICT
        </span>
        <span
          style={{
            fontFamily: "Anton",
            fontSize: verdictSize(verdict),
            color: hex,
            letterSpacing: 2,
            marginTop: 10,
            textTransform: "uppercase",
          }}
        >
          {verdict}
        </span>

        {/* score + stats */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 64, marginTop: 40, width: "100%" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontFamily: "PlexMono", fontSize: 22, color: SECONDARY, letterSpacing: 6 }}>{scoreLabel}</span>
            <span style={{ fontFamily: "Anton", fontSize: 84, color: scoreColor, marginTop: 6 }}>{score}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, gap: 16, paddingBottom: 10 }}>
            {statRows(row).map((s) => (
              <Leader key={s.label} label={s.label} value={s.value} size={26} />
            ))}
          </div>
        </div>

        {/* bottom rail */}
        <div style={{ display: "flex", flexGrow: 1 }} />
        <div style={{ display: "flex", width: "100%", borderBottom: `2px solid ${HAIRLINE}` }} />
        <div style={{ display: "flex", justifyContent: "space-between", width: "100%", marginTop: 16 }}>
          <span style={{ fontFamily: "PlexMono", fontSize: 24, color: SECONDARY, letterSpacing: 6 }}>
            SURVIVE THE INTERNET ECONOMY
          </span>
          <span style={{ fontFamily: "PlexMono", fontSize: 24, color: INK, letterSpacing: 2 }}>[ BEGIN A RUN → ]</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts, headers },
  );
}
