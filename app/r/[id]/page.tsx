import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnnotatedLifeChart } from "@/components/share/AnnotatedLifeChart";
import { getResult } from "@/lib/cloud/results";
import { isCloud } from "@/lib/supabase";
import type { ResultRow } from "@/lib/cloud/types";
import { currency } from "@/lib/format";
import { VERDICTS } from "@/lib/verdict";

/**
 * Share-landing for one finished run (Addendum §13 #9). The URL that rides on
 * the share card / QR: crawlers get the per-run OG statement (/api/og/{id});
 * humans get the same statement as a LEDGER page one click from BEGIN. Runs
 * submitted with a `history` series (Phase M3) also get the annotated
 * net-worth chart; older rows fall back to the stat plates alone.
 */

function verdictHex(title: string): string {
  for (const v of Object.values(VERDICTS)) if (v.title === title) return v.hex;
  if (title === "Escaped the Rat Race") return "var(--color-gain)";
  if (title === "Still Racing") return "var(--color-secondary)";
  return "var(--color-ink)";
}

const MODE_LABEL: Record<string, string> = {
  story: "Story run",
  infinite: "Infinite run",
  cashflow: "Rat Race",
};

function statRows(row: ResultRow): { label: string; value: string }[] {
  const m = row.metrics ?? {};
  const scoreRow =
    row.mode === "cashflow"
      ? { label: "Passive income / mo", value: currency(row.score) }
      : { label: "Final net worth", value: currency(row.score) };
  if (row.mode === "cashflow") {
    return [
      scoreRow,
      { label: "Net worth", value: currency(Number(m.netWorth ?? 0)) },
      { label: "Turns", value: String(m.turns ?? "—") },
      { label: "Monthly expenses", value: currency(Number(m.expenses ?? 0)) },
    ];
  }
  return [
    scoreRow,
    { label: "Final age", value: String(m.age ?? "—") },
    { label: "Happiness", value: `${m.happiness ?? "—"}%` },
  ];
}

/**
 * Statements only exist where results are stored. Without Supabase env keys, `getResult`
 * falls through to localStorage — which does not exist on the server, so every /r/{id} threw
 * and rendered the bare 404. A deployment with no cloud records says so, in house grammar.
 */
function NoRecords() {
  return (
    <main className="mx-auto flex min-h-[100svh] w-full max-w-xl flex-col justify-center px-5 py-14">
      <div className="flex items-baseline justify-between border-b border-hairline pb-3">
        <span className="display-caps text-xl text-ink">LIFEPATCH</span>
        <span className="num text-tertiary" style={{ fontSize: "0.62rem", letterSpacing: "0.18em" }}>
          NO CENTRAL LEDGER
        </span>
      </div>

      <p className="eyebrow mt-10 text-secondary" style={{ fontSize: "0.6rem", letterSpacing: "0.3em" }}>
        Record lookup · Unavailable
      </p>
      <h1 className="display-caps mt-2 text-4xl leading-none text-ink sm:text-5xl">
        STATEMENT NOT ON FILE
      </h1>
      <p className="mt-4 max-w-md font-body text-[0.95rem] leading-relaxed text-ink-dim">
        This deployment keeps no cloud records — every run is filed in the player&apos;s own browser,
        so there is nothing here to look up.
      </p>

      <div className="mt-12 border-t border-hairline pt-6">
        <p className="voice text-[1.02rem] text-ink/85">Your ledger is the only one that counts anyway.</p>
        <Link
          href="/"
          className="num mt-5 inline-flex items-center gap-2 border border-ink px-5 py-3 text-sm text-ink hover:bg-ink hover:text-bg"
        >
          [ BEGIN A RUN → ]
        </Link>
      </div>
    </main>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const row = isCloud ? await getResult(id).catch(() => null) : null;
  if (!row) return { title: "LifePatch — Survive the Internet Economy" };
  const title = `LIFEPATCH — ${row.verdict}`;
  const description = `Run closed: ${row.verdict}. ${
    row.mode === "cashflow" ? "Passive income" : "Final net worth"
  } ${currency(row.score)}. Survive the internet economy — run your own life.`;
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

  const hex = verdictHex(row.verdict);
  const good = row.mode === "cashflow" ? Number(row.metrics?.escaped) === 1 : row.score >= 0;

  // per-year net-worth series, present only on runs submitted after Phase M3
  const rawHistory = row.metrics?.history;
  const startYear = Number(row.metrics?.startYear);
  const series = Array.isArray(rawHistory) ? rawHistory.map(Number).filter(Number.isFinite) : [];
  const chartPoints =
    series.length > 1 && Number.isFinite(startYear)
      ? series.map((v, i) => ({ year: startYear + i, netWorth: v }))
      : null;

  return (
    <main className="mx-auto flex min-h-[100svh] w-full max-w-xl flex-col justify-center px-5 py-14">
      {/* rail */}
      <div className="flex items-baseline justify-between border-b border-hairline pb-3">
        <span className="display-caps text-xl text-ink">LIFEPATCH</span>
        <span className="num text-tertiary" style={{ fontSize: "0.62rem", letterSpacing: "0.18em" }}>
          STATEMENT NO. {row.id.slice(0, 8).toUpperCase()}
        </span>
      </div>

      {/* verdict */}
      <p className="eyebrow mt-10 text-secondary" style={{ fontSize: "0.6rem", letterSpacing: "0.3em" }}>
        Run closed · {MODE_LABEL[row.mode] ?? row.mode} · Final verdict
      </p>
      <h1 className="display-caps mt-2 text-5xl leading-none sm:text-6xl" style={{ color: hex }}>
        {row.verdict}
      </h1>

      {/* statement rows */}
      <div className="mt-9 flex flex-col gap-3">
        {statRows(row).map((s, i) => (
          <div key={s.label} className="flex items-baseline gap-3">
            <span className="num text-secondary" style={{ fontSize: "0.78rem" }}>{s.label}</span>
            <span className="grow border-b border-dotted border-dotted" aria-hidden />
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
          <p className="eyebrow text-secondary" style={{ fontSize: "0.6rem", letterSpacing: "0.2em" }}>
            Net worth · year by year
          </p>
          <div className="mt-2">
            <AnnotatedLifeChart points={chartPoints} />
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="mt-12 border-t border-hairline pt-6">
        <p className="voice text-[1.02rem] text-ink/85">Could you do better? The market doesn&apos;t care. Prove it anyway.</p>
        <Link
          href="/"
          className="num mt-5 inline-flex items-center gap-2 border border-ink px-5 py-3 text-sm text-ink hover:bg-ink hover:text-bg"
        >
          [ BEGIN A RUN → ]
        </Link>
      </div>
    </main>
  );
}
