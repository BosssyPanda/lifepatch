# DESIGN.md — LifePatch "LEDGER" design contract

Read this before generating or editing ANY UI. LifePatch is a **printed-ledger / filing-form**
game — a dark accounting document that stamps, flips, and counts. Every screen should read as
*art-directed*, never templated. When a generated screen could belong to any SaaS starter, it
is wrong. (This contract replaced the earlier "SPENT" warm-paper direction; anything brown,
grainy, or Oswald-set is legacy and must not come back.)

Tokens live in `app/globals.css` (Tailwind v4 `@theme`). Reuse them and the utility classes —
never hardcode hex outside the sanctioned palette, never invent fonts.

## Palette (RISOGRAPH — warm near-black paper, one orange signature, red/green for money)

**Amendment E, approved 2026-08-18 — the press.** The earlier contract read "nothing else
gets color", and it was right about *outcomes* and wrong about *identity*. A document with no
signature colour reads as a spreadsheet, and this one is played by teenagers. The ground, the
flatness, the hairlines and the money pair are unchanged; what changes is that the ledger is
now printed on a **risograph press** rather than a laser printer. That buys exactly two hues,
each with a job and a ceiling:

- **`--color-accent` `#FF5A1F` (safety orange) — identity and interaction, never an outcome.**
  The primary CTA, the square you are standing on, the player's stamp, section numerals, the
  focused/armed state of a control. It says *here*, *you*, *do this*. It never says good or
  bad — an orange number is not a gain and an orange panel is not a warning.
- **`--color-highlight` `#D8E04B` (acid chartreuse) — a reward, spent sparingly.** Streaks,
  mastery ticks, a dream square, the moment a lesson lands. If more than one chartreuse thing
  is on screen at once, one of them is wrong. It is never a *state* (nothing is "in
  chartreuse"), only a punctuation mark on something already earned.

Red and green are untouched and still mean only money. Orange and chartreuse are not a third
and fourth money colour and must never be used to grade a number.

- **Ground:** `--color-bg` `#131110` (warm near-black paper), `--color-bg2` `#1A1714`,
  `--color-bg3` `#211D19`.
- **Ink:** `--color-ink` `#F4F0E6` (16.5:1 on bg); dim `--color-ink-dim` / secondary `#9A968C`
  (6.4:1 bg / 6.1:1 bg2 / 5.7:1 bg3); tertiary `#8F8B81` (5.5:1 bg / 5.3:1 bg2 / 4.9:1 bg3 —
  folio numbers, tile indices, fine print). Tertiary is the floor for anything that is *text*:
  it must clear 4.5:1 on whatever ground it sits on, and it now does on all three.
- **Hairline:** `--color-hairline` `#4C4B47` (2.2:1) — the default border color, for rules,
  frames, plates, dot-leader scaffolding. Decorative separation, not a component boundary.
- **Hairline strong:** `--color-hairline-strong` `#6B6964` (3.4:1 on bg, 3.1:1 on bg3) — the
  border color for anything a user can *operate*: buttons, inputs, selection cards, tabs,
  dialog frames, and the board's 2px tile keylines. WCAG 1.4.11 requires 3:1 for a UI
  component's visual boundary, so an interactive edge never uses the base hairline.
- **Dotted:** `--color-dotted` `#55544F` (2.5:1) — dot leaders only.
- **Semantic accents (never decorative):** loss `--color-loss` `#FE4030` (5.4:1 on bg), gain
  `--color-gain` `#2FCC71` (9.0:1 on bg). Red means losing money; green means making it.
  (`#E23B2E` was proposed during the riso pass and rejected — it measured 4.39:1 and failed.)
- **Knockout is paper, never ink.** Text or a glyph sitting *on* an accent / highlight / gain /
  loss fill is painted `--color-bg`. Ink on orange measures **2.74:1 and fails**; paper on
  orange is 6.04:1. There is no exception to this and no fill is ever tinted to make one.
- **Colour is never the only channel.** Every gain or loss also carries its sign, the debt
  warning also carries `▲`, and a board tile also carries a glyph and a word. Strip the hue
  out of any screen and it must still be readable — that is the test, and it is not optional.
- **Board tile coding (`--color-tile-*`).** The one place colour is used as a *category* rather
  than a meaning. Each token aliases one of the above — DEAL → accent, PAYDAY → gain,
  EXPENSE / MARKET / LAID OFF → loss, DREAM → highlight — plus one new value,
  `--color-tile-life` `#A9B04E` (8.1:1 on bg), a chartreuse pulled down to a printable ink so a
  whole ring of CHARITY/BABY squares cannot out-shout the accent.
- **Verdicts are not a palette.** End-of-run verdicts (`lib/verdict.ts`) read as money or as
  ink, never as a mood color: "Financially Free" = gain green, "Underwater" = loss red, every
  intermediate verdict = an ink-scale tier (`#F4F0E6` / `#CBC6BA` / `#9A968C`, brighter = better).
  Orange is *not* a verdict tier. The old warm-brown/olive/amber seal hexes are SPENT-era
  legacy and must not come back.
- No cool blues/purples, no warm browns, no second orange, no gradients as decoration — flat
  fields only. Every value above is audited: `node scratchpad/palette-audit.js` re-runs all 28
  contrast checks, and a palette change means all three of `app/globals.css` (`@theme`),
  `lib/palette.ts` and this section, in the same commit.

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

The default is still flat, square, and shadowless. Six narrow amendments (A–D approved
2026-08-13, E in § Palette and F below approved 2026-08-18) buy back mainstream comfort
without buying the generic "AI slop" look. Each is a *permission with a gate*, not a new
default: if an element does not opt in explicitly, the global reset in `app/globals.css`
still forces `border-radius: 0` and `box-shadow: none`.

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
*ramp* in the system** — it is interaction feedback, not ornament.

**F — The halftone screen.** A print dot screen (`.halftone` in `app/globals.css`) may be laid
over a flat fill at **≤8% ink** (≤16% when knocked out of an accent fill). It is two offset
radial-gradients, not a raster and not a noise texture: a flat ink at a fixed alpha, screened
on a 4px lattice, with no colour ramp and nothing to interpolate. It exists because a riso
print has a screen and a laser print does not. Rules: it is always `pointer-events: none`, it
**never animates** (a moving texture is the one thing on a printed page that cannot happen), it
never carries information, and it is never applied to a text-bearing surface large enough to
cost legibility. Today the board tiles are its only caller. The generic "grain overlay" is
still banned — a grain layer is noise over the whole page; this is a screen on one fill.

Still banned, inside and outside the amendments — these are what make generated UI look
generated:

- **Colored glow of any kind** — no `box-shadow` with a hue, no neon rims, no `drop-shadow`
  accents, no "glowing border" on focus/hover/active.
- **Gradient meshes, orbs, blobs, aurora/blurred-circle backdrops, animated conic sweeps.**
- **Glassmorphism** — no `backdrop-filter`, no `blur()`, no translucent frosted panels.
- **Shimmer / border-beam / spotlight-border / marching-ants effects** and the whole shadcn
  "aceternity"-style effect kit. Skeletons load with a `TerminalOp` caret, not a sweep.
- Radius on structural surfaces, shadows on resting surfaces, decorative gradients anywhere
  except amendments D and F. Full-page grain/noise overlays remain banned outside § Film.

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
