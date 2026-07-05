# DESIGN.md — LifePatch "LEDGER" design contract

Read this before generating or editing ANY UI. LifePatch is a **printed-ledger / filing-form**
game — a dark accounting document that stamps, flips, and counts. Every screen should read as
*art-directed*, never templated. When a generated screen could belong to any SaaS starter, it
is wrong. (This contract replaced the earlier "SPENT" warm-paper direction; anything brown,
grainy, or Oswald-set is legacy and must not come back.)

Tokens live in `app/globals.css` (Tailwind v4 `@theme`). Reuse them and the utility classes —
never hardcode hex outside the sanctioned palette, never invent fonts.

## Palette (near-black ledger; ink dominates, red/green only carry meaning)

- **Ground:** `--color-bg` `#0E0E0C`, `--color-bg2` `#131211`, `--color-bg3` `#191714`.
- **Ink:** `--color-ink` `#F2F1EA`; dim `--color-ink-dim` / secondary `#8F8E85`; tertiary
  `#5C5B53` (folio numbers, fine print).
- **Hairline:** `--color-hairline` `#2A2A25` — the only border color.
- **Semantic accents (never decorative):** loss `--color-loss` `#FF3B30`, gain `--color-gain`
  `#2BD576`. Red means losing money; green means making it. Nothing else gets color.
- No cool blues/purples, no warm browns, no gradients — flat fields only.

## Typography (four fonts, one job each)

- **Anton** (`--font-anton`) — wordmark + big display numerals ONLY (`.font-anton`,
  `.display-caps` scale). Condensed, uppercase, tight leading.
- **IBM Plex Mono** (`--font-plex-mono`) — all chrome: eyebrows, labels, buttons, HUD cells,
  tickers, tabular numbers (`.num`, `.eyebrow`). Wide letter-spacing on labels (0.08–0.28em).
- **Instrument Serif italic** (`--font-instrument`) — the house "voice": editorial asides,
  taglines, one-line commentary. Always italic, never for data.
- **Archivo** (`--font-archivo`) — body prose (`.font-body`).
- Never introduce Inter, Roboto, Arial, system-ui, Oswald, or Newsreader.

## Surfaces & bans (the LEDGER law)

- **Radius 0.** No rounded corners on anything new. (Some legacy game-screen chrome still
  carries small radii; new and rebuilt elements are flat — converge, don't imitate.)
- **No glow, no gradient, no drop shadow, no blur, no grain, no vignette.** Flat panels
  separated by 1px hairlines. `.paper` = flat `--color-bg` + hairline border.
- Depth comes from hairline framing (double rules, inset frames), stacking, and motion —
  never from shadows.
- Section grammar: numbered mono eyebrows (`003 — The Arena`), hairline-framed stages,
  dotted leaders connecting label→value, stamped plates, folio/footer rules.

## Motion (compositor-only, ceremonial)

- Animate **transform / opacity / clip-path** only (filter sparingly). Never
  width/height/top/left/margin/font-size.
- House vocabulary: split-flap flips (rotateX), stamp-ins (scale 1.3–1.6 → 1 + opacity),
  number tickers (rAF count-ups), drawn SVG lines (pathLength), type-ins, marquees
  (translateX loops), scroll-driven orbit/parallax on the R3F set pieces.
- Tokens in `src/motion/tokens.ts` (`DUR`, `STAGGER`, `SPRING`, `EASE`) — use them, don't
  re-spell numbers.
- **Reduced motion is a duty:** every ceremony has a static or instant equivalent via
  `useMotionCtx().reduced`. Every cinematic is skippable.
- Heavy things (WebGL, video, canvases) load lazily (IntersectionObserver + dynamic import),
  freeze off-screen and on hidden tabs, and never touch the landing's eager JS budget.

## Data honesty

- Every number and name shown comes from `lib/` (markets, board, professions, verdicts,
  almanac). Presentational headers are authored; game data is never invented.
- Calendar years are spoilers — never surface `startYear`/`endYear` in pre-game UI
  (`lib/modes.ts`); use relative years (`YEAR 01`).

## Audio

- Synth-only (Tone.js engine in `src/audio/`), gesture-gated, mute persisted (`lp_muted`).
  No sampled music. SFX ids live in `src/audio/sfxBank.ts` (`stamp`, `uitick`, `page`…).

## Accessibility

- Focus ring: 2px ink outline (global). Skip-link jumps to `#main`.
- Every icon-only control has an `aria-label`; live counters use `aria-live="polite"`.
- Both breakpoints are first-class: design at 390, confirm at 1440.
