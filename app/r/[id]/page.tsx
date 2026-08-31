import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnnotatedLifeChart } from "@/components/share/AnnotatedLifeChart";
import { BACKGROUNDS } from "@/lib/backgrounds";
import { getResult } from "@/lib/cloud/results";
import { challengeableWorld } from "@/lib/challenge";
import { finiteNumber, finiteSeries } from "@/lib/metrics";
import { challengeUrl } from "@/lib/deepLink";
import { isCloud } from "@/lib/supabase";
import type { ResultRow } from "@/lib/cloud/types";
import { currency } from "@/lib/format";
import { scoreLabel } from "@/lib/scoreLabel";
import { CASHFLOW_VERDICTS, safeVerdict, VERDICTS } from "@/lib/verdict";

/**
 * A `results` row is immutable — the table has insert, select and delete policies
 * and no update — so the only thing an hour of caching can serve is the same bytes.
 * Without it every visit to a shared link, from a crawler or a person, is an
 * uncached and unauthenticated database read. A link is never minted before its row
 * exists (`useShareUrl` looks the id up), so this cannot cache a premature 404.
 */
export const revalidate = 3600;

/**
 * Returning NOTHING here is the point: it opts `/r/[id]` into incremental static
 * regeneration without naming a single id up front. `dynamicParams` defaults to
 * true, so any id is still generated on first request — and then cached and reused
 * for `revalidate` seconds instead of hitting the database again.
 *
 * `revalidate` alone does not do this. Verified against `.next/prerender-manifest.json`:
 * with only the export above, `/r/[id]` was absent from `dynamicRoutes` entirely and
 * every request re-rendered and re-queried.
 */
export function generateStaticParams(): { id: string }[] {
  return [];
}

/**
 * Share-landing for one finished run (Addendum §13 #9). The URL that rides on
 * the share card / QR: crawlers get the per-run OG statement (/api/og/{id});
 * humans get the same statement as a LEDGER page one click from BEGIN. Runs
 * submitted with a `history` series (Phase M3) also get the annotated
 * net-worth chart; older rows fall back to the stat plates alone.
 */

function verdictHex(title: string): string {
  for (const v of Object.values(VERDICTS)) if (v.title === title) return v.hex;
  if (title === CASHFLOW_VERDICTS.escaped) return "var(--color-gain)";
  if (title === CASHFLOW_VERDICTS.racing) return "var(--color-secondary)";
  // "Buried in Debt" fell through to plain ink, which made the Rat Race's only
  // losing verdict the one outcome in the game that does not read as one. DESIGN.md
  // § Palette: red means losing money, and "Underwater" — its exact counterpart in
  // the life sim — is already loss red.
  if (title === CASHFLOW_VERDICTS.buried) return "var(--color-loss)";
  return "var(--color-ink)";
}

/**
 * Where the number came from.
 *
 * A leaderboard figure with no provenance is an assertion. These four lines are
 * everything that fixes the world this run was played in — which background it
 * opened from, the seed that fixed its markets and its cards, the engine build
 * that resolved them, and whether the run re-simulated to the score it claims.
 *
 * The replay check runs on the player's own device before the row is posted, so it
 * catches a corrupted or half-recorded run, not a determined forger. The line says
 * so. Overstating it would be the one thing worse than not checking at all.
 *
 * Rows written before any of this was recorded simply omit the lines they lack —
 * an absent field claims nothing, which is the correct thing for it to claim.
 */
function provenanceRows(row: ResultRow): { label: string; value: string }[] {
  const m = row.metrics ?? {};
  const out: { label: string; value: string }[] = [];
  const bg = BACKGROUNDS.find((b) => b.id === m.backgroundId);
  if (bg) out.push({ label: "Started as", value: bg.name });
  // `finiteNumber`, not `!== undefined`: a JSON null is not undefined, so a
  // malformed row printed "World seed  null" on a public page while the challenge
  // gate three lines down correctly refused to offer the same row as a world.
  if (finiteNumber(m.seed)) out.push({ label: "World seed", value: String(m.seed) });
  if (finiteNumber(m.engine)) out.push({ label: "Engine", value: `build ${m.engine}` });
  if (m.verified === 1) out.push({ label: "Replayed", value: "re-simulated to this score" });
  return out;
}

/**
 * Every one of these reads a field some other player's browser wrote, and the
 * generous coercions they used to use printed nonsense rather than nothing:
 * `Number(null)` is a confident $0, and `String(v ?? "—")` renders an
 * object-valued field as "[object Object]" on a public, cached page. An absent or
 * unreadable field claims nothing, which is the correct thing for it to claim.
 */
const money = (v: unknown) => (finiteNumber(v) ? currency(v) : "—");
const plain = (v: unknown) => (finiteNumber(v) ? String(v) : "—");

const MODE_LABEL: Record<string, string> = {
  story: "Story run",
  infinite: "Infinite run",
  cashflow: "Rat Race",
};

function statRows(row: ResultRow): { label: string; value: string }[] {
  const m = row.metrics ?? {};
  const scoreRow = { label: scoreLabel(row.mode), value: currency(row.score) };
  if (row.mode === "cashflow") {
    // The score's own two parts, directly under it: it is net worth plus twelve
    // paydays, and printing the pieces is what stops the total reading as a wage.
    return [
      scoreRow,
      { label: "Net worth", value: money(m.netWorth) },
      { label: "Cash flow / mo", value: money(m.payday) },
      { label: "Turns", value: plain(m.turns) },
      { label: "Monthly expenses", value: money(m.expenses) },
    ];
  }
  return [
    scoreRow,
    { label: "Final age", value: plain(m.age) },
    { label: "Happiness", value: finiteNumber(m.happiness) ? `${m.happiness}%` : "—" },
  ];
}

/**
 * Statements only exist where results are stored. Without Supabase env keys, `getResult`
 * falls through to localStorage — which does not exist on the server, so every /r/{id} threw
 * and rendered the bare 404. A deployment with no cloud records says so, in house grammar.
 */
/**
 * `my-auto` rather than `justify-center` on the page: a tall statement under
 * `justify-center` clips its own top off on a short viewport, with no way to scroll to it.
 */
const PAGE = "mx-auto flex min-h-[100svh] w-full max-w-xl flex-col px-5 py-14";

const CTA =
  "num inline-flex items-center gap-2 border border-ink px-5 py-3 text-sm text-ink hover:bg-ink hover:text-bg";

/**
 * The accent-filled primary, for the one action this page exists to offer.
 *
 * This is a server component, so it cannot use `LedgerButton` (a client component
 * carrying framer-motion) without pulling the whole motion runtime onto an
 * otherwise static, cacheable page. Same contract, spelled out: the label is
 * knocked out in PAPER — ink on orange measures 2.74:1 and fails — and there is
 * exactly one of these on the screen, which is why `CTA` above is now the
 * secondary and not a second accent.
 */
const CTA_PRIMARY =
  "num inline-flex items-center gap-2 border border-accent bg-accent px-5 py-3 text-sm text-bg hover:bg-transparent hover:text-accent";

function NoRecords() {
  return (
    <main className={PAGE}>
      <div className="my-auto w-full">
        <div className="flex items-baseline justify-between border-b border-hairline pb-3">
          <span className="display-caps text-xl text-ink">LIFEPATCH</span>
          <span className="eyebrow text-tertiary">No central ledger</span>
        </div>

        <p className="eyebrow mt-10 text-secondary">Record lookup · Unavailable</p>
        <h1 className="display-caps mt-2 text-4xl leading-none text-ink sm:text-5xl">
          STATEMENT NOT ON FILE
        </h1>
        <p className="mt-4 max-w-md font-body text-[0.95rem] leading-relaxed text-ink-dim">
          This deployment keeps no cloud records — every run is filed in the player&apos;s own browser,
          so there is nothing here to look up.
        </p>

        <div className="mt-12 border-t border-hairline pt-6">
          <p className="voice text-[1.02rem] text-ink/85">Your ledger is the only one that counts anyway.</p>
          <Link href="/" className={`${CTA} mt-5`}>[ BEGIN A RUN → ]</Link>
        </div>
      </div>
    </main>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const row = isCloud ? await getResult(id).catch(() => null) : null;
  if (!row) return { title: "LifePatch — Survive the Internet Economy" };
  // The row's own text reaches the <title> and og:description here, so it goes
  // through the same guard as the heading. See `safeVerdict`.
  const verdict = safeVerdict(row.verdict);
  const title = `LIFEPATCH — ${verdict}`;
  const description = `Run closed: ${verdict}. ${scoreLabel(row.mode)} ${currency(
    row.score,
  )}. Survive the internet economy — run your own life.`;
  return {
    title,
    description,
    openGraph: { title, description, images: [`/api/og/${id}`] },
    twitter: { card: "summary_large_image", title, description, images: [`/api/og/${id}`] },
  };
}

export default async function RunStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isCloud) return <NoRecords />;
  const row = await getResult(id).catch(() => null);
  if (!row) notFound();

  const verdict = safeVerdict(row.verdict);
  const hex = verdictHex(verdict);
  // Matched strictly rather than coerced, like every other read of this blob:
  // `escaped` is written as a literal 0 or 1, and `Number("")` being 0 is not a
  // distinction worth leaving to chance on the one line that decides the verdict.
  const good = row.mode === "cashflow" ? row.metrics?.escaped === 1 : row.score >= 0;

  /**
   * The chart's series, read the way every other reader of `metrics` reads it.
   *
   * This used to be `.map(Number).filter(Number.isFinite)`, which is wrong in both
   * directions at once on client-written jsonb: `null` survives as a $0 year that
   * never happened, and a string is DROPPED — compacting the array so that every
   * year after the hole is drawn one place early, on a public, cached page. See
   * `lib/metrics.ts`; a series that cannot be trusted is not drawn at all.
   */
  const read = finiteSeries(row.metrics?.history);
  const startYear = row.metrics?.startYear;
  const chartPoints =
    read && read.series.length > 1 && finiteNumber(startYear)
      ? read.series.map((v, i) => ({ year: startYear + i, netWorth: v }))
      : null;
  const provenance = provenanceRows(row);

  /**
   * Can this statement be offered as a world to play?
   *
   * The rules live in `lib/challenge.ts` and are stated once there, because the
   * link this button points at is honoured by a second reader — `AppShell`'s
   * invite effect — and the two agreeing is not something to leave to matching
   * copies. Where the row is not a world, the button simply does not appear.
   */
  const world = challengeableWorld(row);

  return (
    <main className={PAGE}>
      <div className="my-auto w-full">
        {/* rail */}
        <div className="flex items-baseline justify-between border-b border-hairline pb-3">
          <span className="display-caps text-xl text-ink">LIFEPATCH</span>
          <span className="eyebrow text-tertiary">Statement no. {row.id.slice(0, 8).toUpperCase()}</span>
        </div>

        {/* verdict */}
        <p className="eyebrow mt-10 text-secondary">
          Run closed · {MODE_LABEL[row.mode] ?? row.mode} · Final verdict
        </p>
        <h1 className="display-caps mt-2 text-5xl leading-none sm:text-6xl" style={{ color: hex }}>
          {verdict}
        </h1>

        {/* statement rows — `.rule-dotted`, the same dot leader the in-app statement uses.
            The old `border-dotted border-dotted` collided with Tailwind's border-style
            utility and printed a heavier leader than anywhere else in the product. */}
        <div className="mt-9 flex flex-col gap-3">
          {statRows(row).map((s, i) => (
            <div key={s.label} className="flex items-baseline gap-3">
              <span className="eyebrow text-secondary">{s.label}</span>
              <span className="rule-dotted h-px grow" aria-hidden />
              <span
                className={i === 0 ? "num text-lg" : "num text-[0.82rem] text-ink"}
                style={i === 0 ? { color: good ? "var(--color-gain)" : "var(--color-loss)" } : undefined}
              >
                {s.value}
              </span>
            </div>
          ))}
        </div>

        {/* annotated life line (when the run shipped its history) */}
        {chartPoints && (
          <div className="mt-9">
            <p className="eyebrow text-secondary">Net worth · year by year</p>
            <div className="mt-2">
              <AnnotatedLifeChart points={chartPoints} />
            </div>
          </div>
        )}

        {/* provenance — what fixed this world, and whether the run replayed */}
        {provenance.length > 0 && (
          <div className="mt-9">
            <p className="eyebrow text-secondary">Provenance</p>
            <div className="mt-2 flex flex-col gap-2">
              {provenance.map((s) => (
                <div key={s.label} className="flex items-baseline gap-3">
                  <span className="eyebrow text-tertiary">{s.label}</span>
                  <span className="rule-dotted h-px grow" aria-hidden />
                  <span className="num text-[0.72rem] text-ink-dim">{s.value}</span>
                </div>
              ))}
            </div>
            <p className="voice mt-3 text-xs text-tertiary">
              The replay runs on the device that played the run, before the row is posted. It
              catches a run that does not add up. It is not a proof against a determined forger.
            </p>
          </div>
        )}

        {/* CTA */}
        <div className="mt-12 border-t border-hairline pt-6">
          <p className="voice text-[1.02rem] text-ink/85">
            {world
              ? "Same markets. Same opening. Your decisions."
              : "Could you do better? The market doesn’t care. Prove it anyway."}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {world ? (
              <>
                <Link href={challengeUrl(row.id)} className={CTA_PRIMARY}>[ PLAY THIS WORLD → ]</Link>
                <Link href="/" className={CTA}>[ A WORLD OF MY OWN ]</Link>
              </>
            ) : (
              <Link href="/" className={CTA}>[ BEGIN A RUN → ]</Link>
            )}
            {/* a second exit, so a shared statement isn't a one-way door */}
            <Link
              href="/leaderboard"
              className="eyebrow text-secondary underline underline-offset-4 transition-colors hover:text-ink"
            >
              See the standings →
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
