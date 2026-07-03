import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getResult } from "@/lib/cloud/results";
import type { ResultRow } from "@/lib/cloud/types";
import { currency } from "@/lib/format";
import { VERDICTS } from "@/lib/verdict";

/**
 * Share-landing for one finished run (Addendum §13 #9). The URL that rides on
 * the share card / QR: crawlers get the per-run OG statement (/api/og/{id});
 * humans get the same statement as a LEDGER page one click from BEGIN.
 * Server-rendered, zero client JS beyond the framework.
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

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const row = await getResult(id).catch(() => null);
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
  const row = await getResult(id).catch(() => null);
  if (!row) notFound();

  const hex = verdictHex(row.verdict);
  const good = row.mode === "cashflow" ? Number(row.metrics?.escaped) === 1 : row.score >= 0;

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
