// The palette gate.
//
//   node scripts/qa/palette-audit.mjs
//
// `DESIGN.md` § Palette states the rule this enforces: "a pairing that has not been
// measured does not ship", and "a palette change means all three of app/globals.css
// (@theme), lib/palette.ts and this section, in the same commit".
//
// Both documents cited `node scratchpad/palette-audit.js` as the thing that enforced
// it. That file was never committed and `scratchpad/` is not in the tree — so for the
// life of the contract, the gate behind it could not be run by anyone. Every published
// figure below was re-derived from the two source files and reproduces exactly, which
// says the original audit was real; what was missing was any way to re-run it.
//
// This reads TEXT, deliberately. It does not import `lib/palette.ts`, because that
// would drag in the TypeScript build for a file whose entire content is sixteen hex
// literals — and a gate that needs a build step is a gate that gets skipped.
//
// Sections 1–4 measure the palette. Sections 5–6 measure where it is SPENT — every
// `text-<token>/NN` in the tree, composited and held to 4.5:1, plus the pairings the
// record says were measured and refused. That half was missing for the life of the
// contract, which is exactly how twelve text sites drifted under the floor wearing
// alpha classes no named-token check could see.
//
// What it still does NOT do: judge the accent budget (~1–2% of pixels, six sanctioned
// homes). That stays a human call, exactly as DESIGN.md writes it — nothing static can
// count pixels, and a gate that guesses is a gate that gets switched off.
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CSS = readFileSync(join(ROOT, "app/globals.css"), "utf8");
const TS = readFileSync(join(ROOT, "lib/palette.ts"), "utf8");

let checks = 0;
let failures = 0;

function check(name, fn) {
  checks++;
  try {
    const note = fn();
    console.log(`  ok   ${name}${note ? `  ${note}` : ""}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}

// ── Contrast, per WCAG 2.1 ──────────────────────────────────────────────────
function luminance(hex) {
  const h = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`not a 6-digit hex: ${hex}`);
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// ── Read both sources ───────────────────────────────────────────────────────
/** Every `--color-*: #hex` in globals.css. `var()` aliases are skipped — they cannot drift. */
function cssTokens() {
  const out = {};
  for (const m of CSS.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out[m[1]] = m[2].toLowerCase();
  }
  return out;
}

/**
 * One `export const NAME = { … }` object, resolved to hexes.
 *
 * Entries written as `high: PALETTE.ink` are references, not literals, and resolving
 * them is the point rather than a convenience: a tier that ALIASES the ink ramp is
 * correct, and a tier that has quietly become its own hex is the drift this file
 * exists to catch. Both have to be readable to tell them apart.
 */
function tsObject(name, refs = {}) {
  const i = TS.indexOf(`export const ${name} = {`);
  if (i < 0) throw new Error(`lib/palette.ts has no ${name}`);
  const body = TS.slice(i, TS.indexOf("} as const;", i));
  const out = {};
  for (const m of body.matchAll(/(\w+):\s*(?:"(#[0-9a-fA-F]{3,8})"|([A-Z_]+)\.(\w+))/g)) {
    const [, key, hex, obj, prop] = m;
    if (hex) out[key] = hex.toLowerCase();
    else {
      const from = refs[obj];
      if (!from || !from[prop]) throw new Error(`${name}.${key} points at ${obj}.${prop}, which does not resolve`);
      out[key] = from[prop];
    }
  }
  return out;
}

const CSS_T = cssTokens();
const PALETTE = tsObject("PALETTE");
const CANVAS = tsObject("CANVAS");
const INK_TIER = tsObject("INK_TIER", { PALETTE });

const P = (k) => {
  const v = PALETTE[k];
  if (!v) throw new Error(`PALETTE has no ${k}`);
  return v;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. The mirror. `lib/palette.ts` exists for the surfaces CSS cannot reach — the
//    OG routes, canvas painting, the themeColor meta tag — and its own docblock
//    says the two files must be edited together. Nothing has ever checked that.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nThe mirror (app/globals.css @theme ↔ lib/palette.ts)");

/** camelCase in TS → the kebab CSS custom property it mirrors. */
const MIRROR = {
  bg: "bg",
  bg2: "bg2",
  bg3: "bg3",
  ink: "ink",
  inkBright: "ink-bright",
  inkDim: "ink-dim",
  secondary: "secondary",
  tertiary: "tertiary",
  hairline: "hairline",
  hairlineStrong: "hairline-strong",
  dotted: "dotted",
  accent: "accent",
  highlight: "highlight",
  gain: "gain",
  loss: "loss",
};

for (const [tsKey, cssKey] of Object.entries(MIRROR)) {
  check(`${tsKey} agrees with --color-${cssKey}`, () => {
    const a = P(tsKey);
    const b = CSS_T[cssKey];
    if (!b) throw new Error(`app/globals.css has no --color-${cssKey}`);
    if (a !== b) throw new Error(`lib/palette.ts ${a} vs app/globals.css ${b} — edit both, in one commit`);
    return a;
  });
}

check("every mirrored token exists on both sides", () => {
  const missing = Object.keys(MIRROR).filter((k) => !PALETTE[k]);
  if (missing.length) throw new Error(`lib/palette.ts is missing ${missing.join(", ")}`);
  // A new --color-* in CSS that is not a var() alias and not mirrored is the drift
  // this check exists to catch. `tile-life` is the one sanctioned exception, and
  // lib/palette.ts:16-18 says why: the tile tokens are DOM-only by design.
  const known = new Set([...Object.values(MIRROR), "tile-life"]);
  const strays = Object.keys(CSS_T).filter((k) => !known.has(k));
  if (strays.length) throw new Error(`--color-${strays.join(", --color-")} is in CSS with no mirror and no exemption`);
  return `${Object.keys(MIRROR).length} tokens`;
});

check("the ink tiers resolve to the ink ramp, not to new hexes", () => {
  if (INK_TIER.high !== P("ink")) throw new Error(`INK_TIER.high ${INK_TIER.high} is not ink ${P("ink")}`);
  if (INK_TIER.low !== P("secondary")) throw new Error(`INK_TIER.low ${INK_TIER.low} is not secondary`);
  // `mid` is the one value that exists nowhere else. It is measured below.
  if (!INK_TIER.mid) throw new Error("INK_TIER.mid is missing");
  return INK_TIER.mid;
});

check("the canvas hairline is dimmer than the document one, not drifted from it", () => {
  // lib/palette.ts calls this out explicitly: a hairline at document contrast reads
  // far too bright against an unlit material. The check is that it is DARKER — if it
  // ever went brighter, that is drift wearing the docblock's clothes.
  if (luminance(CANVAS.hairline) >= luminance(P("hairline"))) {
    throw new Error(`CANVAS.hairline ${CANVAS.hairline} is not dimmer than ${P("hairline")}`);
  }
  return CANVAS.hairline;
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The measurements. Each row asserts the figure DESIGN.md, docs/QA-REPORT.md or
//    app/globals.css already publishes, not merely a threshold — so a changed hex
//    fails loudly instead of quietly re-measuring itself into a new number that no
//    document agrees with.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nMeasured pairings (each against its published figure)");

const GROUND = { bg: () => P("bg"), bg2: () => P("bg2"), bg3: () => P("bg3") };

/**
 * @param fg   foreground hex
 * @param bg   ground key
 * @param min  the floor this pairing must clear — 4.5 body text, 3.0 a UI boundary
 *             or a graphical object, 0 decorative.
 * @param want the ratio a DOCUMENT publishes, to 2dp, or null when none does.
 *
 * `want` is only ever a figure written down in `DESIGN.md`, `docs/QA-REPORT.md` or the
 * comments in `app/globals.css`. Asserting a number this script computed itself would
 * be circular — it would pass by construction and prove nothing. Where no document
 * publishes a figure, the floor is the whole check and the measurement is printed so
 * it can be read, and published, by a human who decides it is worth publishing.
 */
function pair(label, fg, bg, min, want = null) {
  check(label, () => {
    const got = ratio(fg, GROUND[bg]());
    if (want != null && Math.abs(got - want) > 0.006) {
      throw new Error(`measures ${got.toFixed(2)}:1, but the docs publish ${want}:1 — a hex moved`);
    }
    if (got < min) throw new Error(`${got.toFixed(2)}:1 is under the ${min}:1 floor`);
    return `${got.toFixed(2)}:1${want == null ? "" : "  (published)"}`;
  });
}

// Ink ramp. Tertiary is the floor for anything that is TEXT and must clear 4.5 on
// all three grounds — DESIGN.md says so, and it is the tightest margin in the system.
pair("ink on bg", P("ink"), "bg", 4.5, 16.54);
pair("ink on bg2", P("ink"), "bg2", 4.5);
pair("ink on bg3", P("ink"), "bg3", 4.5);
pair("ink-dim on bg", P("inkDim"), "bg", 4.5, 6.38);
pair("ink-dim on bg2", P("inkDim"), "bg2", 4.5, 6.05);
pair("ink-dim on bg3", P("inkDim"), "bg3", 4.5, 5.67);
pair("tertiary on bg", P("tertiary"), "bg", 4.5, 5.54);
pair("tertiary on bg2", P("tertiary"), "bg2", 4.5, 5.25);
pair("tertiary on bg3", P("tertiary"), "bg3", 4.5, 4.92);
pair("ink-tier mid on bg", INK_TIER.mid, "bg", 4.5, 11.05);

// Structure. A hairline is decorative and has no floor; a hairline-strong is a
// component boundary and owes WCAG 1.4.11 its 3:1 on every ground it frames.
pair("hairline on bg", P("hairline"), "bg", 0, 2.16);
pair("hairline-strong on bg", P("hairlineStrong"), "bg", 3, 3.43);
pair("hairline-strong on bg2", P("hairlineStrong"), "bg2", 3);
pair("hairline-strong on bg3", P("hairlineStrong"), "bg3", 3, 3.05);
pair("dotted on bg", P("dotted"), "bg", 0, 2.48);

// Identity and reward.
pair("accent on bg", P("accent"), "bg", 4.5, 6.04);
pair("accent on bg2", P("accent"), "bg2", 4.5, 5.72);
pair("accent on bg3", P("accent"), "bg3", 4.5, 5.37);
pair("highlight on bg", P("highlight"), "bg", 4.5, 13.17);
pair("highlight on bg2", P("highlight"), "bg2", 4.5);
pair("highlight on bg3", P("highlight"), "bg3", 4.5);
pair("tile-life on bg", CSS_T["tile-life"], "bg", 4.5, 8.08);
pair("tile-life on bg2", CSS_T["tile-life"], "bg2", 4.5, 7.66);
pair("tile-life on bg3", CSS_T["tile-life"], "bg3", 4.5, 7.18);

// Money.
pair("gain on bg", P("gain"), "bg", 4.5, 8.96);
pair("gain on bg2", P("gain"), "bg2", 4.5);
pair("gain on bg3", P("gain"), "bg3", 4.5);
pair("loss on bg", P("loss"), "bg", 4.5, 5.37);
pair("loss on bg2", P("loss"), "bg2", 4.5, 5.09);
pair("loss on bg3", P("loss"), "bg3", 4.5);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Knockout. "Knockout is paper, never ink" is the one palette rule stated with
//    no exception, so it is checked in BOTH directions: paper must pass on every
//    fill, and ink must still fail — if a fill were ever lightened until ink passed
//    on it, the rule would have been silently repealed rather than changed.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nKnockout (paper on a fill passes; ink on a fill must still fail)");

for (const fill of ["accent", "highlight", "gain", "loss"]) {
  check(`paper knocks out of ${fill}`, () => {
    const got = ratio(P("bg"), P(fill));
    if (got < 4.5) throw new Error(`${got.toFixed(2)}:1 — paper no longer clears 4.5 on ${fill}`);
    return `${got.toFixed(2)}:1`;
  });
}

check("ink on accent still fails, as the contract records", () => {
  const got = ratio(P("ink"), P("accent"));
  if (Math.abs(got - 2.74) > 0.006) throw new Error(`measures ${got.toFixed(2)}:1; the docs publish 2.74:1`);
  if (got >= 4.5) throw new Error("ink now passes on accent — the knockout rule needs rewriting, not ignoring");
  return `${got.toFixed(2)}:1`;
});

check("the red rejected during the riso pass would still fail", () => {
  // #E23B2E was proposed and measured 4.39:1 — just under the floor — which is why
  // #FE4030 is the loss red. Kept as a live check so nobody re-proposes it from memory.
  const got = ratio("#e23b2e", P("bg"));
  if (Math.abs(got - 4.39) > 0.006) throw new Error(`measures ${got.toFixed(2)}:1; the record says 4.39:1`);
  if (got >= 4.5) throw new Error("the rejected red now passes — the record is wrong");
  return `${got.toFixed(2)}:1`;
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Pairings this pass introduced. Measured here first, then published — which is
//    the order DESIGN.md requires and the order that was impossible while the gate
//    did not exist.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nNew this pass (the ghost line, the daily grid, the weak-spot section)");

check("the ghost line's dashed stroke, ink-dim on the report's panel", () => {
  // components/share/AnnotatedLifeChart.tsx draws the counterfactual in --color-ink-dim,
  // dashed 6 5, under the life line. It is a data line, so it owes 3:1 as a graphical
  // object (WCAG 1.4.11) — and it clears the 4.5 text floor as well.
  const got = ratio(P("inkDim"), P("bg2"));
  if (got < 3) throw new Error(`${got.toFixed(2)}:1 — a data line under the 3:1 floor`);
  return `${got.toFixed(2)}:1`;
});

check("the daily grid's glyphs, ink on the report's panel", () => {
  // components/screens/LifeReport.tsx renders ▲ ▬ ▼ in text-ink. The glyphs differ in
  // SHAPE, not hue — colour is never the only channel — so this is a text measurement
  // and nothing about the grid depends on it being any particular colour.
  const got = ratio(P("ink"), P("bg2"));
  if (got < 4.5) throw new Error(`${got.toFixed(2)}:1 — under the text floor`);
  return `${got.toFixed(2)}:1`;
});

check("the weak-spot section stays in the ink scale", () => {
  // The section names a gap. It is deliberately NOT chartreuse (that hue has exactly
  // four sanctioned homes and a fifth is a contract change) and NOT loss-red (a gap is
  // not a loss). Both figures below are already-measured ink-ramp pairings, which is
  // the whole reason those tones were chosen while this gate was missing.
  const label = ratio(P("ink"), P("bg"));
  const prose = ratio(P("secondary"), P("bg"));
  if (label < 4.5 || prose < 4.5) throw new Error(`${label.toFixed(2)}:1 / ${prose.toFixed(2)}:1`);
  return `${label.toFixed(2)}:1 label · ${prose.toFixed(2)}:1 prose`;
});


// ─────────────────────────────────────────────────────────────────────────────
// 5. Spent colour.
//
//    Everything above measures the PALETTE. Nothing has ever measured where it
//    LANDS — and that is the hole every contrast defect in this codebase fell
//    through. Tailwind's `/NN` suffix composites a token against whatever is
//    behind it and paints a colour that exists in no source file and in no
//    document, so `text-ink/45` (4.10:1) and `text-ink-dim/55` (2.74:1) shipped
//    straight past a gate that asserts every named token to two decimal places.
//
//    A utility class is reusable by construction, so the scanner cannot know
//    which panel any given use lands on. It measures against ALL THREE grounds
//    and takes the worst — `bg3` is the brightest, so that is the honest read.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSpent colour (every `text-<token>/NN` in the tree, worst ground)");

const SRC_DIRS = ["app", "components", "src"];
const SRC_EXT = /\.(tsx?|css)$/;

/**
 * Comments are not styling.
 *
 * `InsolvencyNotice.tsx` documents the rejected `border-loss/60` by name and
 * `ModeSelect.tsx` cites `text-ink/60` when it explains a dim floor — a gate
 * that read those as usages would punish the two files that get this right for
 * saying so. Block comments go whole; a line comment only counts when the line
 * IS one, so a `https://` in the middle of a className never truncates it.
 * Blanked lines are kept in place so reported line numbers stay true.
 */
function code(text) {
  return text
    // blank the characters, keep the newlines: a `.replace(…, "")` would collapse
    // every multi-line docblock and report line numbers that point at nothing.
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => (/^\s*(\/\/|\*)/.test(l) ? "" : l));
}

const FILES = (() => {
  const out = [];
  for (const dir of SRC_DIRS) {
    const root = join(ROOT, dir);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true })) {
      const abs = join(root, String(entry));
      if (!SRC_EXT.test(abs) || !statSync(abs).isFile()) continue;
      out.push({ rel: abs.slice(ROOT.length + 1), lines: code(readFileSync(abs, "utf8")) });
    }
  }
  return out;
})();

/** Every `file:line` where `needle` appears in code (not in a comment). */
function sites(needle) {
  const out = [];
  for (const f of FILES) {
    f.lines.forEach((l, i) => {
      if (l.includes(needle)) out.push(`${f.rel}:${i + 1}`);
    });
  }
  return out;
}

/** What a browser actually paints for `token/alpha` sitting on `ground`. */
function composite(hex, alpha, ground) {
  const byte = (h, i) => parseInt(h.replace("#", "").slice(i, i + 2), 16);
  return (
    "#" +
    [0, 2, 4]
      .map((i) => Math.round(alpha * byte(hex, i) + (1 - alpha) * byte(ground, i)))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** The worst of the three grounds, which is the one that decides. */
function worstGround(hex, alpha) {
  return ["bg", "bg2", "bg3"]
    .map((g) => ({ g, r: ratio(composite(hex, alpha, GROUND[g]()), GROUND[g]()) }))
    .reduce((lo, x) => (x.r < lo.r ? x : lo));
}

// `ink-dim` before `ink`: alternation is ordered, and `text-ink-dim/55` must not
// match as `text-ink` with a stray `-dim`.
const TEXT_ALPHA = /\btext-(ink-bright|ink-dim|ink|secondary|tertiary|accent|highlight|gain|loss)\/(\d{1,3})\b/g;

/**
 * Sites the contract deliberately exempts — and it is empty on purpose.
 *
 * The cold open's set-dressing HUD (`Gate.tsx`) was the one real candidate: it
 * is `aria-hidden`, decorative, and inside § Film. It was RAISED rather than
 * exempted, because 0.55rem type at 2.74:1 is hard to read for everyone, not
 * only for a spec. Adding an entry here is a decision that needs a reason
 * written beside it.
 */
const TEXT_EXEMPT = new Set();

const spent = new Map();
for (const f of FILES) {
  f.lines.forEach((line, i) => {
    for (const m of line.matchAll(TEXT_ALPHA)) {
      if (!spent.has(m[0])) spent.set(m[0], []);
      spent.get(m[0]).push(`${f.rel}:${i + 1}`);
    }
  });
}

check("the scan reached the source tree", () => {
  // A walk that silently matches nothing passes every check under it. This is the
  // guard against a moved directory turning the whole section into a no-op.
  if (FILES.length < 100) throw new Error(`only ${FILES.length} source files found — the walk is broken, not the tree`);
  return `${FILES.length} files · ${spent.size} distinct alpha text classes`;
});

for (const [cls, at] of [...spent].sort()) {
  const [, token, pct] = cls.match(/^text-(.+)\/(\d+)$/);
  check(`${cls} clears the text floor`, () => {
    const hex = CSS_T[token];
    if (!hex) throw new Error(`${cls} names --color-${token}, which app/globals.css does not define`);
    const worst = worstGround(hex, Number(pct) / 100);
    const live = at.filter((s) => !TEXT_EXEMPT.has(s));
    if (worst.r < 4.5 && live.length > 0) {
      throw new Error(
        `${worst.r.toFixed(2)}:1 on ${worst.g} — under the 4.5:1 floor (WCAG 1.4.3).\n` +
          `       The named tiers pass on every ground: text-tertiary (4.92:1 worst), text-ink-dim (5.67:1 worst).\n` +
          `       ${live.join("\n       ")}`,
      );
    }
    return `${worst.r.toFixed(2)}:1 worst on ${worst.g}  ×${at.length}`;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Rejected values.
//
//    Section 3 already asserts that the red turned down during the riso pass
//    still fails, so nobody re-proposes it from memory. The same idea, applied
//    to USAGE: a pairing that was measured and refused must not quietly come
//    back. Each entry asserts both halves — that the value still fails its
//    floor, and that it is absent from the tree — because if a hex ever moves,
//    the record is what is out of date, not the code.
//
//    Borders are not blanket-scanned. Nothing static separates a decorative rule
//    from an operable control's boundary, and a gate that guesses is a gate that
//    gets switched off. The named refusals are the honest subset.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRejected values (measured, refused, and still out of the tree)");

const REJECTED = [
  {
    cls: "border-loss/60",
    token: "loss",
    alpha: 0.6,
    floor: 3,
    where: "components/run/InsolvencyNotice.tsx",
    why: "a warning or operable boundary owes 3:1 (WCAG 1.4.11); the solid left rule is 5.09:1",
  },
  {
    cls: "bg-black/80",
    token: null,
    where: "app/globals.css .scrim",
    why: "#000 is not in the palette at all — the modal scrim is --color-bg, through .scrim",
  },
];

for (const r of REJECTED) {
  check(`${r.cls} is not in the tree`, () => {
    let note = "";
    if (r.token) {
      const worst = worstGround(CSS_T[r.token], r.alpha);
      if (worst.r >= r.floor) {
        throw new Error(`${r.cls} now measures ${worst.r.toFixed(2)}:1 — ${r.where}'s record is out of date, not the code`);
      }
      note = `${worst.r.toFixed(2)}:1 worst — still under ${r.floor}:1`;
    }
    const back = sites(r.cls);
    if (back.length) throw new Error(`${r.cls} is back at ${back.join(", ")}\n       ${r.why} — see ${r.where}`);
    return note || "absent";
  });
}
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
