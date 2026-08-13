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
- **Ink:** `--color-ink` `#F2F1EA`; dim `--color-ink-dim` / secondary `#8F8E85` (5.9:1 on bg);
  tertiary `#818076` (4.9:1 on bg, 4.7:1 on bg2 — folio numbers, fine print). Tertiary is the
  floor for anything that is *text*: it must clear 4.5:1 on whatever ground it sits on.
- **Hairline:** `--color-hairline` `#4A4943` (2.1:1) — the default border color, for rules,
  frames, plates, dot-leader scaffolding. Decorative separation, not a component boundary.
- **Hairline strong:** `--color-hairline-strong` `#67665E` (3.3:1 on bg, 3.1:1 on bg3) — the
  border color for anything a user can *operate*: buttons, inputs, selection cards, tabs,
  dialog frames. WCAG 1.4.11 requires 3:1 for a UI component's visual boundary, so an
  interactive edge never uses the base hairline.
- **Dotted:** `--color-dotted` `#54534A` (2.5:1) — dot leaders only.
- **Semantic accents (never decorative):** loss `--color-loss` `#FF3B30`, gain `--color-gain`
  `#2BD576`. Red means losing money; green means making it. Nothing else gets color.
- **Verdicts are not a palette.** End-of-run verdicts (`lib/verdict.ts`) read as money or as
  ink, never as a mood color: "Financially Free" = gain green, "Underwater" = loss red, every
  intermediate verdict = an ink-scale tier (`#F2F1EA` / `#C9C8BF` / `#8F8E85`, brighter = better).
  The old warm-brown/olive/amber seal hexes are SPENT-era legacy and must not come back.
- No cool blues/purples, no warm browns, no gradients as decoration — flat fields only.

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

The default is still flat, square, and shadowless. Four narrow amendments (A–D, approved
2026-08-13) buy back mainstream comfort without buying the generic "AI slop" look. Each is a
*permission with a gate*, not a new default: if an element does not opt in explicitly, the
global reset in `app/globals.css` still forces `border-radius: 0` and `box-shadow: none`.

**A — Micro-radius on interactive controls.** `--radius-control` (`3px`) is allowed on
elements a user operates: buttons, inputs, selection/choice cards, tabs, chips. True circles
(`50%`) are allowed only on elements that are *intrinsically* circular: dice pips, status
dots, avatars, meter nubs. Everything structural — panels, frames, plates, stages, rails,
dialog cards, `.paper`, `.panel` — stays radius-0. Opt in with the `data-radius` attribute
(`data-radius` = control radius, `data-radius="round"` = true circle); nothing else can carry
a radius, because the reset exempts that attribute and only that attribute.

**B — Functional elevation for floating surfaces.** A neutral-black shadow (`--shadow-float`)
plus a lighter ground (`bg-bg2`/`bg-bg3`) is allowed *only* on surfaces that float above the
page: modals, dialogs, toasts, popovers, and the card inside a full-screen overlay. It exists
to solve near-black-on-near-black separation, nothing else. The shadow is never colored, never
a glow, never larger than it needs to be to read as "in front of". Resting surfaces — cards in
a grid, panels, HUD rails, the board — stay flat and separate by hairline alone. Opt in with
`data-elevated`; the reset blocks `box-shadow` everywhere else.

**C — Contrast-raised structure.** Structural tokens carry real contrast (see § Palette):
hairlines are legible, interactive boundaries clear 3:1, and small text clears 4.5:1. A border
that a sighted user cannot find is a bug, not a style.

**D — Monochrome pointer spotlight.** Interactive cards may carry a cursor-following radial
wash (`.spotlight`): white ink at 4–6% max, fading to transparent, opacity 0 until hover,
`pointer-events: none`, driven by `--spot-x`/`--spot-y` from `src/motion/useSpotlight.ts`.
Disabled for touch pointers and reduced motion. **This is the only sanctioned decorative
gradient in the system** — it is interaction feedback, not ornament.

Still banned, inside and outside the amendments — these are what make generated UI look
generated:

- **Colored glow of any kind** — no `box-shadow` with a hue, no neon rims, no `drop-shadow`
  accents, no "glowing border" on focus/hover/active.
- **Gradient meshes, orbs, blobs, aurora/blurred-circle backdrops, animated conic sweeps.**
- **Glassmorphism** — no `backdrop-filter`, no `blur()`, no translucent frosted panels.
- **Shimmer / border-beam / spotlight-border / marching-ants effects** and the whole shadcn
  "aceternity"-style effect kit. Skeletons load with a `TerminalOp` caret, not a sweep.
- Radius on structural surfaces, shadows on resting surfaces, decorative gradients anywhere
  except amendment D.

Everything else holds:

- Depth comes from hairline framing (double rules, inset frames), stacking, elevation only
  where B allows it, and motion — never from shadows on resting surfaces.
- Flat panels separated by 1px hairlines. `.paper` = flat `--color-bg` + hairline border;
  `.panel` = `--color-bg2` + hairline border + standard padding.
- Section grammar: numbered mono eyebrows (`003 — The Arena`), hairline-framed stages,
  dotted leaders connecting label→value, stamped plates, folio/footer rules.

## § Film Exception (cinematics only)

The four ceremonial surfaces — **Gate, ColdOpen, Outro, and the landing hero** — may carry
the film vocabulary, and ONLY via `components/cinematic/film/FilmLayer.tsx`:

- **Grain** — one small tiled canvas layer (~128px noise tile, ~12fps re-roll), opacity only.
- **Flicker** — per-frame random dim pass (projector flutter). Ceremonies only; never on
  resting surfaces (the hero carries grain + vignette + flash, but no flicker).
- **Flash frames** — one-shot ink or loss-red full-frame hits, keyed to stamps/beats.
- **Vignette** — canvas radial pre-render, opacity composite. No CSS blur involved.

Still banned even inside the exception: CSS blur, gradients as decoration (amendment D does
not extend here), color casts (palette hexes only), rounded corners — ceremonial surfaces are
not interactive controls, so amendment A never applies to them. Reduced motion collapses FilmLayer to a single
static faint frame. Do NOT mount FilmLayer anywhere else in the app — everything outside
these four surfaces stays strict LEDGER.

## Motion (compositor-only, ceremonial)

- Animate **transform / opacity / clip-path** only (filter sparingly). Never
  width/height/top/left/margin/font-size.
- House vocabulary: split-flap flips (rotateX), stamp-ins (scale 1.3–1.6 → 1 + opacity),
  number tickers (rAF count-ups), drawn SVG lines (pathLength), type-ins, marquees
  (translateX loops), scroll-driven orbit/parallax on the R3F set pieces.
- Tokens in `src/motion/tokens.ts` (`DUR`, `STAGGER`, `SPRING`, `EASE`, `HITSTOP`) — use them,
  don't re-spell numbers. Springs move things in space (`SPRING.press` for taps,
  `SPRING.lift` for hover, `SPRING.reward` for payoff pops); duration + ease drives opacity and
  color. Exits run ~30% faster than enters (`DUR.exitFast`). Impact magnitude comes from one
  place — `juiceTier()` in `src/motion/juice.ts` — so shake, particle count, pop scale, and
  pitch always agree.
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
