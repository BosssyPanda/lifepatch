import { TerminalOp } from "@/components/ui/TerminalOp";

/**
 * Statement-shaped skeleton for /r/{id}. It holds the exact frame of the real page — rail,
 * eyebrow, headline block, four leader rows — so the statement resolves into place instead of
 * the layout jumping. Bars are flat hairline fields (no shimmer: DESIGN.md bans the sweep;
 * the TerminalOp caret is the house loading tell).
 */
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-[100svh] w-full max-w-xl flex-col justify-center px-5 py-14" aria-busy="true">
      <div className="flex items-baseline justify-between border-b border-hairline pb-3">
        <span className="display-caps text-xl text-ink">LIFEPATCH</span>
        <span className="num text-tertiary" style={{ fontSize: "0.62rem", letterSpacing: "0.18em" }}>
          STATEMENT NO. ————————
        </span>
      </div>

      <p className="eyebrow mt-10 text-secondary" style={{ fontSize: "0.6rem", letterSpacing: "0.3em" }}>
        Run closed · Retrieving record
      </p>
      <div aria-hidden className="mt-3 h-12 w-4/5 bg-hairline sm:h-14" />

      <div className="mt-9 flex flex-col gap-3" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-baseline gap-3">
            <span className="h-2.5 bg-hairline" style={{ width: `${34 - i * 4}%` }} />
            <span className="grow rule-dotted" />
            <span className="h-2.5 bg-hairline" style={{ width: i === 0 ? "24%" : "14%" }} />
          </div>
        ))}
      </div>

      <div className="mt-12 border-t border-hairline pt-6">
        <TerminalOp label="Retrieving statement" />
      </div>
    </main>
  );
}
