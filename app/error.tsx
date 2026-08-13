"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * The route error boundary, in house grammar — a rejected transaction rather than a stack
 * trace. `reset()` re-renders the segment, so the retry is a real retry, not a reload.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[100svh] w-full max-w-xl flex-col justify-center px-5 py-14">
      <div className="flex items-baseline justify-between border-b border-hairline pb-3">
        <span className="display-caps text-xl text-ink">LIFEPATCH</span>
        <span className="num text-tertiary" style={{ fontSize: "0.62rem", letterSpacing: "0.18em" }}>
          {error.digest ? `REF. ${error.digest.slice(0, 8).toUpperCase()}` : "REF. UNLOGGED"}
        </span>
      </div>

      <p className="eyebrow mt-10 text-secondary" style={{ fontSize: "0.6rem", letterSpacing: "0.3em" }}>
        Transaction rejected · The house is looking into it
      </p>
      <h1 className="display-caps mt-2 text-4xl leading-none sm:text-5xl" style={{ color: "var(--color-loss)" }}>
        PROCESSING ERROR
      </h1>

      <div className="mt-9 flex flex-col gap-3">
        <div className="flex items-baseline gap-3">
          <span className="num text-secondary" style={{ fontSize: "0.78rem" }}>Status</span>
          <span className="grow rule-dotted" aria-hidden />
          <span className="num text-[0.82rem]" style={{ color: "var(--color-loss)" }}>FAILED</span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="num text-secondary" style={{ fontSize: "0.78rem" }}>Your run</span>
          <span className="grow rule-dotted" aria-hidden />
          <span className="num text-[0.82rem] text-ink">SAVED LOCALLY</span>
        </div>
      </div>

      <div className="mt-12 border-t border-hairline pt-6">
        <p className="voice text-[1.02rem] text-ink/85">
          Something in the pipe broke. Nothing you did — try the entry again.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            data-radius=""
            className="num inline-flex items-center gap-2 border border-ink px-5 py-3 text-sm text-ink transition-colors hover:bg-ink hover:text-bg"
          >
            [ TRY AGAIN → ]
          </button>
          <Link
            href="/"
            data-radius=""
            className="num inline-flex items-center gap-2 border border-hairline-strong px-5 py-3 text-sm text-ink-dim transition-colors hover:border-ink hover:text-ink"
          >
            [ BACK TO THE LEDGER ]
          </Link>
        </div>
      </div>
    </main>
  );
}
