import Link from "next/link";

/**
 * The 404, in house grammar: a filing form that came back stamped. Same visual vocabulary as
 * the /r/[id] statement (mono eyebrow, hairline rails, Anton headline, dotted leaders) so a
 * bad link never drops the player onto Next's default page.
 */
export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-[100svh] w-full max-w-xl flex-col justify-center px-5 py-14">
      <div className="flex items-baseline justify-between border-b border-hairline pb-3">
        <span className="display-caps text-xl text-ink">LIFEPATCH</span>
        <span className="num text-tertiary" style={{ fontSize: "0.62rem", letterSpacing: "0.18em" }}>
          FORM 404
        </span>
      </div>

      <p className="eyebrow mt-10 text-secondary" style={{ fontSize: "0.6rem", letterSpacing: "0.3em" }}>
        Filing rejected · No matching record
      </p>
      <h1 className="display-caps mt-2 text-4xl leading-none text-ink sm:text-5xl">
        FORM 404 — PAGE NOT ON FILE
      </h1>

      <div className="mt-9 flex flex-col gap-3">
        <div className="flex items-baseline gap-3">
          <span className="num text-secondary" style={{ fontSize: "0.78rem" }}>Status</span>
          <span className="grow rule-dotted" aria-hidden />
          <span className="num text-[0.82rem] text-ink">NOT FOUND</span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="num text-secondary" style={{ fontSize: "0.78rem" }}>Cause</span>
          <span className="grow rule-dotted" aria-hidden />
          <span className="num text-[0.82rem] text-ink">BAD LINK OR RETIRED PAGE</span>
        </div>
      </div>

      <div className="mt-12 border-t border-hairline pt-6">
        <p className="voice text-[1.02rem] text-ink/85">
          Nothing here. The ledger, on the other hand, is always open.
        </p>
        <Link
          href="/"
          className="num mt-5 inline-flex items-center gap-2 border border-ink px-5 py-3 text-sm text-ink hover:bg-ink hover:text-bg"
        >
          [ RETURN TO THE LEDGER → ]
        </Link>
      </div>
    </main>
  );
}
