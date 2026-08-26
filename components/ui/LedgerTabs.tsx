"use client";

import { useRef } from "react";

/**
 * The house tab strip. Almanac and the Leaderboard each hand-rolled their own row of
 * plain `<button>`s — no tablist semantics, no arrow-key navigation, sub-30px targets,
 * and (in the Leaderboard) two different visual languages in one overlay. One component
 * now covers all of them.
 *
 * Selection is never colour alone: the active tab also carries bracket marks, so it
 * still reads in monochrome or with a colour-vision deficiency.
 */

type Item<T extends string> = { id: T; label: string };

export function LedgerTabs<T extends string>({
  items,
  value,
  onChange,
  label,
  panelId,
  idPrefix = panelId,
  size = "md",
  className = "",
}: {
  items: readonly Item<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Accessible name for the tablist (there can be more than one per overlay). */
  label: string;
  /** id of the `role="tabpanel"` these tabs drive. */
  panelId: string;
  /**
   * Namespace for the tabs' OWN ids. Defaults to `panelId`, which is right whenever
   * one strip drives one panel — but the Leaderboard points three strips at a single
   * panel, and two of them carry an item called "all". One seed minted
   * `…-tab-all` twice, so `aria-labelledby` resolved to whichever node the browser
   * found first. Distinct prefixes, one panel: both facts stay true.
   */
  idPrefix?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const n = items.length;
    const next =
      e.key === "ArrowRight" ? (i + 1) % n
      : e.key === "ArrowLeft" ? (i - 1 + n) % n
      : e.key === "Home" ? 0
      : e.key === "End" ? n - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].id);
    refs.current[next]?.focus();
  };

  const type = size === "md" ? "display-caps text-sm tracking-[0.08em]" : "eyebrow text-[0.62rem]";

  return (
    // `flex-wrap`, not a scroller: the strip is `whitespace-nowrap` and `shrink-0`,
    // so at 390px a three-tab row already ran 23px past the viewport and a four-tab
    // row ran 213px past it — putting whole controls off screen with nothing to
    // scroll them back. Wrapping keeps every tab reachable and needs no scroll
    // affordance, which the ledger has no vocabulary for.
    <div role="tablist" aria-label={label} className={`flex flex-wrap gap-1 ${className}`}>
      {items.map((t, i) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, t.id)}
            aria-selected={on}
            aria-controls={panelId}
            // roving tabindex: one stop for the whole strip, arrows move within it
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            data-radius=""
            className={`inline-flex min-h-11 shrink-0 grow items-center justify-center gap-1 whitespace-nowrap border px-3 transition-colors ${type} ${
              on ? "border-ink bg-ink text-bg" : "border-hairline-strong text-ink-dim hover:bg-ink/10 hover:text-ink"
            }`}
          >
            {/* non-colour selection cue — kept in flow so switching tabs never reflows */}
            <span aria-hidden className={on ? "opacity-100" : "opacity-0"}>[</span>
            {t.label}
            <span aria-hidden className={on ? "opacity-100" : "opacity-0"}>]</span>
          </button>
        );
      })}
    </div>
  );
}

/** The id of one tab — panels use it for `aria-labelledby`. Pass the same
 *  `idPrefix` the strip was given, not the panel id, when they differ. */
export function tabId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`;
}
