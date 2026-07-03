import { ImageResponse } from "next/og";
import { currency } from "@/lib/format";
import { VERDICTS } from "@/lib/verdict";

export const runtime = "edge";

/**
 * Per-run Open Graph statement (Addendum §13 #9). Renders a 1200×630
 * palette-locked LEDGER card for one `results` row so a shared /r/{id} link
 * unfurls as the player's actual verdict. Reads the row over Supabase REST with
 * the public anon key (the table is public-read by RLS); any failure renders the
 * generic wordmark card instead of erroring — an unfurl must never 500.
 */

const BG = "#0E0E0C";
const INK = "#F2F1EA";
const SECONDARY = "#8F8E85";
const TERTIARY = "#5C5B53";
const HAIRLINE = "#2A2A25";
const GAIN = "#2BD576";
const LOSS = "#FF3B30";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      { headers: { apikey: anon, authorization: `Bearer ${anon}` } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Row[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

function verdictHex(title: string): string {
  for (const v of Object.values(VERDICTS)) if (v.title === title) return v.hex;
  if (title === "Escaped the Rat Race") return GAIN;
  if (title === "Still Racing") return SECONDARY;
  return INK;
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
  const [anton, plex, row] = await Promise.all([
    fetch(new URL("../_fonts/Anton-Regular.ttf", import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL("../_fonts/IBMPlexMono-Regular.ttf", import.meta.url)).then((r) => r.arrayBuffer()),
    fetchRow(id),
  ]);

  const fonts = [
    { name: "Anton", data: anton, style: "normal" as const, weight: 400 as const },
    { name: "PlexMono", data: plex, style: "normal" as const, weight: 400 as const },
  ];
  const headers = { "cache-control": "public, immutable, no-transform, max-age=31536000" };

  // Unknown/missing run → generic wordmark card (never an error image).
  if (!row) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: BG,
            gap: 24,
          }}
        >
          <span style={{ fontFamily: "Anton", fontSize: 130, color: INK, letterSpacing: 2 }}>LIFEPATCH</span>
          <span style={{ fontFamily: "PlexMono", fontSize: 30, color: SECONDARY, letterSpacing: 8 }}>
            SURVIVE THE INTERNET ECONOMY
          </span>
        </div>
      ),
      { width: 1200, height: 630, fonts, headers },
    );
  }

  const hex = verdictHex(row.verdict);
  const isCash = row.mode === "cashflow";
  const scoreLabel = isCash ? "PASSIVE INCOME / MO" : "FINAL NET WORTH";
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
            fontSize: row.verdict.length > 14 ? 88 : 118,
            color: hex,
            letterSpacing: 2,
            marginTop: 10,
            textTransform: "uppercase",
          }}
        >
          {row.verdict}
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
