"use client";

import { animate, motion, useAnimationControls, useMotionValue, useMotionValueEvent } from "framer-motion";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { TileIcon } from "./TileIcon";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { DUR, EASE } from "@/src/motion/tokens";
import { currency } from "@/lib/format";

/**
 * `BoardView` — the board as pure presentation.
 *
 * It knows about a ring of squares, a token index, and how a token hops between
 * indices. It knows NOTHING about the run: no engine state, no audio, no turn
 * machine, no hooks that need a game to be running. That is deliberate — the
 * landing page mounts this same component (see
 * `components/cinematic/landing/BoardPreview.tsx`) with the real `RAT_BOARD`
 * data and a scripted token, so the marketing shot and the game render from one
 * source of truth instead of two.
 *
 * The game-shaped wrapper lives next door in `Board.tsx`; it maps run props
 * (`position`, `tokenLabel`, `onLand(type)`) onto the view props below.
 *
 * ── The riso overprint (2026-08-18) ──────────────────────────────────────────
 * The ring used to be twenty-four identical `bg2` squares with a 1px hairline
 * and a three-letter code, which is a wireframe, not a board. It is now printed:
 * every tile is a flat panel behind a 2px keyline, wearing an 8% halftone dot
 * screen (`.halftone`, DESIGN.md amendment F — two offset radial-gradients, no
 * raster, never animated), with its category plate deliberately misregistered
 * 1.5px off the corner the way a second pass through a riso drum lands, a plate
 * number in the corner, and a plain English word instead of a code. Category
 * colour comes from the `--color-tile-*` tokens, so the board cannot invent a
 * hue: it can only spend one the palette already sanctioned.
 */

/**
 * Tile geometry, in board-percent. `PAD` is the ring's distance in from the frame,
 * `TILE` the square's side. They are solved together against the longest label the
 * ring carries ("EXPENSE", 7 characters at 0.6em advance in Plex Mono): a tile has
 * to hold `4.2 × fontSize` of text inside its 2px keylines at EVERY board width the
 * layout produces — 310px inside the landing page's framed stage on a 390px phone,
 * 366px for the in-game board on the same phone, 560px capped on a desktop. The
 * label's own `2.55cqi` sizing is the other half of that equation; move one and
 * re-check the other, or the last letter of EXPENSE walks off the square.
 */
const PAD = 6.8;
const TILE = 12.4;

/** One hop of the token, in ms. `useCashflowTurn` budgets travel at this cadence. */
const HOP_MS = 165;

/**
 * The token's landing: squash-and-stretch, the same shape the dice already use
 * when they come to rest (`scaleX` opposed to `scaleY`, settling over four
 * decreasing rebounds). A thing that stops moving without deforming reads as a
 * thing that was never moving.
 *
 * It runs on the token's INNER element. The outer node's `transform` is written
 * by hand every frame by `writeToken` below (that is how the hop stays
 * compositor-only), so anything that also wanted the transform would be
 * overwritten mid-flight — the squash composes with it instead of fighting it.
 */
const LAND_SQUASH = {
  scaleX: [1, 1.14, 0.96, 1.05, 0.99, 1],
  scaleY: [1, 0.82, 1.06, 0.95, 1.02, 1],
};
const LAND_TIMES = [0, 0.32, 0.52, 0.72, 0.88, 1];

/**
 * One hop = one spring. Not one tween across the whole path.
 *
 * The move used to be a single `easeInOut` tween through every tile index, which
 * meant a six-step roll read as one long glide that happened to pass over five
 * squares — the player could not count their move. Each step is now its own
 * spring, retargeted on a fixed `HOP_MS` cadence rather than awaited: a spring
 * that is re-aimed while it is still travelling inherits the velocity it already
 * had, so the chain reads as a bouncing token counting squares out loud, and
 * only the LAST hop is left alone to overshoot and settle. Retarget-not-await
 * also keeps total travel time exactly `steps × HOP_MS`, which is the budget the
 * turn machine already schedules its card against.
 */
const HOP_SPRING = { type: "spring", visualDuration: 0.19, bounce: 0.34 } as const;

export type BoardSquareView = { index: number; type: string };

/** A money move to stamp over a square. Bump `id` to fire a new one. */
export type BoardDelta = { id: number; index: number; amount: number };

/**
 * Category coding for the ring — the one place in the system colour marks a
 * *kind* rather than a meaning (DESIGN.md § Palette). Every entry resolves to a
 * `--color-tile-*` token, which in turn resolves to a sanctioned palette value,
 * so a tile can never introduce a hue; and because a tile always carries a glyph
 * AND a word as well, the coding is decoration on top of a label, never the
 * label itself.
 */
const TILE_TINT: Record<string, string> = {
  deal: "var(--color-tile-deal)",
  ftdeal: "var(--color-tile-deal)",
  dream: "var(--color-tile-dream)",
  payday: "var(--color-tile-payday)",
  cashflowday: "var(--color-tile-payday)",
  doodad: "var(--color-tile-expense)",
  market: "var(--color-tile-market)",
  downsized: "var(--color-tile-setback)",
  ftloss: "var(--color-tile-setback)",
  charity: "var(--color-tile-life)",
  baby: "var(--color-tile-life)",
};
const tintOf = (t: string) => TILE_TINT[t] ?? "var(--color-secondary)";

/** Squares that pay you. They get a double top rule — a tile you can find without reading it. */
const PAYS = new Set(["payday", "cashflowday"]);

// four L-shaped crop-ticks at the board frame corners (editorial print marks)
type CropTick = { top?: string; left?: string; right?: string; bottom?: string; v: "top" | "bottom"; h: "left" | "right" };
const CROP_TICKS: CropTick[] = [
  { top: "4.6%", left: "4.6%", v: "top", h: "left" },
  { top: "4.6%", right: "4.6%", v: "top", h: "right" },
  { bottom: "4.6%", left: "4.6%", v: "bottom", h: "left" },
  { bottom: "4.6%", right: "4.6%", v: "bottom", h: "right" },
];

/** Evenly space `n` points around a rectangle perimeter, in % coords. */
function perimeterPoints(n: number, pad: number) {
  const a = 100 - 2 * pad;
  const per = 4 * a;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const d = (i / n) * per;
    let x: number;
    let y: number;
    if (d < a) {
      x = pad + d;
      y = pad;
    } else if (d < 2 * a) {
      x = pad + a;
      y = pad + (d - a);
    } else if (d < 3 * a) {
      x = pad + a - (d - 2 * a);
      y = pad + a;
    } else {
      x = pad;
      y = pad + a - (d - 3 * a);
    }
    pts.push({ x, y });
  }
  return pts;
}

/**
 * How loud a money stamp is, 0..1, on a log scale — a $200 doodad and a $40,000
 * property sale must not float the same distance, and a linear scale would make
 * every small move invisible next to one big one. log10 over five decades.
 */
function juice(amount: number) {
  return Math.min(1, Math.log10(1 + Math.abs(amount)) / 4.5);
}

export type BoardViewProps = {
  /** the ring, in order */
  squares: BoardSquareView[];
  /** where the token stands; `null` renders the ring with no token at all */
  tokenIndex: number | null;
  /** which chip reads "you are here" (inverted); `null` inverts nothing */
  activeIndex?: number | null;
  /** short chip label for a square type — a plain word, stamped on the tile */
  labelFor: (type: string) => string;
  /** full name for a square type, exposed as the tile's `title` on hover */
  describeFor?: (type: string) => string;
  /** the single glyph stamped inside the token */
  playerInitial?: string;
  /** hub eyebrow */
  title: string;
  /** Fires when the token settles on its destination square (post-hop), with the square's % coords. */
  onSettle?: (index: number, at: { xPct: number; yPct: number }) => void;
  /** Bump this counter to ink-flash the payday squares (a payday was passed). */
  paydayFlash?: number;
  /** A money move to float off a square. Bump `id` to fire a new stamp. */
  delta?: BoardDelta | null;
  /** Optional read-a-square affordance. Omitted ⇒ no pointer/focus handlers are attached at all. */
  onSquareHover?: (square: BoardSquareView | null) => void;
  /** center hub content */
  children?: ReactNode;
};

export function BoardView({
  squares,
  tokenIndex,
  activeIndex = null,
  labelFor,
  describeFor,
  playerInitial = "",
  title,
  onSettle,
  paydayFlash = 0,
  delta = null,
  onSquareHover,
  children,
}: BoardViewProps) {
  const { reduced: reduce } = useMotionCtx();
  const size = squares.length;
  const pts = useMemo(() => perimeterPoints(size, PAD), [size]);
  // `null` (no token) parks the path math at the ring origin; nothing renders.
  const position = tokenIndex ?? 0;
  const prev = useRef(position);
  const [moving, setMoving] = useState(false);
  // Bumped every time the token finishes a move. The landing pulse keys off this
  // (not off `activeIndex`), so the ink hits the paper when the token ARRIVES —
  // `activeIndex` flips at roll time, a whole hop-chain earlier.
  const [landed, setLanded] = useState(0);
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;

  // Build the hop path from the previous square to the current one.
  const path = useMemo(() => {
    const from = prev.current;
    const steps = (position - from + size) % size;
    const xs = [pts[from].x];
    const ys = [pts[from].y];
    for (let j = 1; j <= steps; j++) {
      const idx = (from + j) % size;
      xs.push(pts[idx].x);
      ys.push(pts[idx].y);
    }
    return { xs, ys, steps };
  }, [position, pts, size]);

  useEffect(() => {
    if (path.steps > 0) {
      setMoving(true);
      const t = setTimeout(() => {
        setMoving(false);
        setLanded((n) => n + 1);
        if (pts[position]) onSettleRef.current?.(position, { xPct: pts[position].x, yPct: pts[position].y });
      }, reduce ? 0 : path.steps * HOP_MS + 250);
      prev.current = position;
      return () => clearTimeout(t);
    }
    prev.current = position;
  }, [position, path.steps, reduce, pts]);

  // ── token transport (compositor-only) ──────────────────────────────────────
  // This used to animate `left`/`top` percentage KEYFRAME ARRAYS across the whole
  // path — up to ~2s of continuous layout + paint on the busiest screen in the
  // game, while the board also ran a scale pulse and the token an infinite bob.
  // DESIGN.md § Motion bans width/height/top/left outright, so the hop now rides a
  // single px `translate3d`: the board is measured with a ResizeObserver, springs
  // drive a progress value through the tile indices one step at a time, and each
  // frame resolves the %-path to px against the *current* board width and writes
  // one transform. Consequences:
  //   • the final keyframe IS the destination tile's % coord, so the token lands
  //     pixel-exact at every board size;
  //   • a resize mid-move only re-reads the width and re-writes at the same
  //     progress — the hop keeps running instead of restarting or drifting;
  //   • zero React re-renders during the move (the writer touches the DOM node).
  const boardRef = useRef<HTMLDivElement | null>(null);
  const tokenRef = useRef<HTMLDivElement | null>(null);
  const boardPx = useRef(0);
  const pathRef = useRef(path);
  pathRef.current = path;
  const progress = useMotionValue(0);

  /** Resolve the %-path at fractional tile index `p` and stamp it as a transform. */
  const writeToken = useCallback((p: number) => {
    const el = tokenRef.current;
    if (!el) return;
    const { xs, ys } = pathRef.current;
    const last = xs.length - 1;
    const i = Math.min(last, Math.max(0, Math.floor(p)));
    const j = Math.min(last, i + 1);
    const t = p - i;
    const s = boardPx.current;
    const px = ((xs[i] + (xs[j] - xs[i]) * t) / 100) * s;
    // The token rides in the UPPER part of its square, not dead centre: centred,
    // a 28px stamp sits exactly on top of the word the tile is trying to tell you.
    // A fifth of a tile up clears the label and still reads as "standing on it".
    const py = ((ys[i] + (ys[j] - ys[i]) * t) / 100) * s - s * TILE * 0.0022;
    // the -50% pair is the old `-translate-x-1/2 -translate-y-1/2` centering,
    // folded into the same transform so nothing fights over the property.
    el.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -50%)`;
  }, []);

  useMotionValueEvent(progress, "change", writeToken);

  // Measure before first paint, and re-resolve (never restart) on every resize.
  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const read = () => {
      boardPx.current = el.getBoundingClientRect().width;
      writeToken(progress.get());
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [progress, writeToken]);

  // ── token bob + landing squash ─────────────────────────────────────────────
  const hop = useAnimationControls();
  const wasMoving = useRef(false);

  useEffect(() => {
    if (reduce) {
      hop.set({ y: 0, scaleX: 1, scaleY: 1 });
      wasMoving.current = false;
      return;
    }
    if (moving) {
      wasMoving.current = true;
      // One bob per hop: the bob loop and the transport cadence are the same
      // number, so the token is at the top of its arc between squares and flat
      // on one. They used to run at 330ms and 165ms — a hop every other bob.
      void hop.start(
        { y: [0, -9, 0], scaleX: [1, 1.1, 1], scaleY: [1, 1.1, 1] },
        { duration: HOP_MS / 1000, repeat: Infinity, ease: EASE },
      ).catch(() => {});
      return;
    }
    if (!wasMoving.current) return;
    wasMoving.current = false;
    // plant it, then let the squash play out from a settled y
    hop.set({ y: 0 });
    void hop
      .start(LAND_SQUASH, { duration: DUR.slow, times: LAND_TIMES, ease: "easeOut" })
      .catch(() => {});
  }, [moving, reduce, hop]);

  // The hop chain. Reduced motion keeps its old duty: jump straight to the end.
  useEffect(() => {
    const steps = path.steps;
    if (reduce || steps <= 0) {
      progress.jump(steps > 0 ? steps : 0);
      writeToken(steps > 0 ? steps : 0);
      return;
    }
    progress.jump(0);
    writeToken(0);
    let k = 1;
    let controls = animate(progress, k, HOP_SPRING);
    const tick = window.setInterval(() => {
      if (k >= steps) {
        window.clearInterval(tick);
        return;
      }
      // Retarget rather than restart: the running spring's velocity carries into
      // the next square, which is what makes a chain of hops read as one bounce.
      controls.stop();
      controls = animate(progress, ++k, HOP_SPRING);
    }, HOP_MS);
    return () => {
      window.clearInterval(tick);
      controls.stop();
    };
    // `path` is rebuilt whenever `position` changes; keying off both is redundant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, path.steps, reduce]);

  // ── money stamp ────────────────────────────────────────────────────────────
  // The parent hands over a delta; the view owns how long it stays up, so a
  // reduced-motion viewer (who gets no float, just a printed figure) still sees
  // it clear itself instead of sitting on the board until the next one.
  const [bubble, setBubble] = useState<BoardDelta | null>(null);
  useEffect(() => {
    if (!delta || delta.amount === 0) return;
    setBubble(delta);
    const t = window.setTimeout(() => setBubble(null), reduce ? 1100 : 1500);
    return () => window.clearTimeout(t);
  }, [delta, reduce]);

  return (
    /* `containerType` so the chip labels size off the *board* (366px at a 390px
       viewport, capped at 560px) rather than off the page. */
    <div ref={boardRef} className="relative mx-auto aspect-square w-full max-w-[560px]" style={{ containerType: "inline-size" }}>
      {/* flat board field — a terminal ledger spread, hairline double-rule frame */}
      <div className="absolute inset-[2%] border border-hairline bg-bg" />
      <div aria-hidden className="absolute inset-[3.6%] border border-hairline" />

      {/* newspaper corner crop-ticks */}
      {CROP_TICKS.map((c, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute h-3 w-3"
          style={{
            top: c.top,
            left: c.left,
            right: c.right,
            bottom: c.bottom,
            borderTop: c.v === "top" ? "1px solid var(--color-accent)" : undefined,
            borderBottom: c.v === "bottom" ? "1px solid var(--color-accent)" : undefined,
            borderLeft: c.h === "left" ? "1px solid var(--color-accent)" : undefined,
            borderRight: c.h === "right" ? "1px solid var(--color-accent)" : undefined,
          }}
        />
      ))}

      {/* center hub — a flat ledger panel (dice / roll live here via children) */}
      <div className="absolute inset-[17%] grid place-items-center border border-hairline bg-bg2 p-3 text-center">
        <span aria-hidden className="halftone pointer-events-none absolute inset-0" style={{ "--halftone-alpha": 0.05 } as CSSProperties} />
        <div className="relative w-full">
          <p className="eyebrow text-secondary" style={{ fontSize: "0.58rem", letterSpacing: "0.24em" }}>
            {title}
          </p>
          {children}
        </div>
      </div>

      {/* squares — riso-printed panels: a 2px keyline, an 8% halftone screen, a
          misregistered category plate, a plate number, a glyph and a plain word.
          The read-a-square affordance is opt-in: with no `onSquareHover`, not one
          listener is attached and the in-game board keeps exactly the DOM it had.
          Pointer only, never focusable — 24 tabbable divs would bury the next real
          control under two dozen dead tab stops; the full name rides `title`. */}
      {squares.map((sq) => {
        const p = pts[sq.index];
        const active = sq.index === activeIndex;
        const tint = tintOf(sq.type);
        const pays = PAYS.has(sq.type);
        // Knockout law (DESIGN.md § Palette): anything on an accent fill is
        // painted in paper, never in ink. Ink on orange measures 2.74:1.
        const knockout = "var(--color-bg)";
        const chipStyle: CSSProperties = {
          left: `${p.x}%`,
          top: `${p.y}%`,
          width: `${TILE}%`,
          height: `${TILE}%`,
          border: `2px solid ${active ? "var(--color-accent)" : "var(--color-hairline-strong)"}`,
          background: active ? "var(--color-accent)" : "var(--color-bg2)",
          // NOT percentages: an absolutely positioned box resolves percentage
          // padding/gap against its CONTAINING BLOCK (the board), not itself, so
          // `pt-[11%]` here would be 11% of 560px and swallow the tile whole.
          // `cqi` is the board too, but deliberately and at a sane scale.
          paddingTop: "clamp(3px, 1.1cqi, 7px)",
          gap: "clamp(1px, 0.5cqi, 3px)",
        };
        return (
          <motion.div
            key={sq.index}
            title={describeFor?.(sq.type)}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 select-none flex-col items-center justify-center"
            style={chipStyle}
            animate={active && !reduce ? { scale: [1, 1.14, 1.07] } : { scale: 1 }}
            transition={{ duration: DUR.base }}
            {...(onSquareHover
              ? { onPointerEnter: () => onSquareHover(sq), onPointerLeave: () => onSquareHover(null) }
              : null)}
          >
            {/* the dot screen — DESIGN.md amendment F. Static, always. */}
            <span
              aria-hidden
              className="halftone pointer-events-none absolute inset-0"
              style={{ "--halftone-ink": active ? knockout : tint, "--halftone-alpha": active ? 0.16 : 0.08 } as CSSProperties}
            />

            {/* category plate, off-register: 1.5px up and right of the keyline,
                the way a second colour pass lands when the drum is a hair out.
                Payday squares get a second rule under it — the one tile in the
                ring you should be able to find without reading it. */}
            <span
              aria-hidden
              className="pointer-events-none absolute"
              style={{ top: "-3.5px", left: "1.5px", right: "-1.5px", height: "3px", background: active ? knockout : tint }}
            />
            {pays && (
              <span
                aria-hidden
                className="pointer-events-none absolute"
                style={{ top: "1.5px", left: "0", right: "0", height: "1.5px", background: active ? knockout : tint }}
              />
            )}

            {/* plate number — the folio a printed board carries in its corner */}
            <span
              aria-hidden
              className="num pointer-events-none absolute leading-none"
              style={{
                top: "6%",
                left: "8%",
                color: active ? knockout : "var(--color-tertiary)",
                fontSize: "clamp(0.4rem, 1.5cqi, 0.5rem)",
                letterSpacing: "0.02em",
              }}
            >
              {String(sq.index + 1).padStart(2, "0")}
            </span>

            <TileIcon
              type={sq.type}
              className="relative h-[32%] w-auto"
              style={{ color: active ? knockout : tint }}
            />
            <span
              className="num relative flex flex-col items-center leading-[1.05]"
              style={{
                color: active ? knockout : "var(--color-ink)",
                fontSize: "clamp(0.44rem, 2.55cqi, 0.72rem)",
                letterSpacing: "0",
                maxWidth: "100%",
                overflow: "hidden",
              }}
            >
              {/* one word per line: "LAID OFF" is two lines at every board size
                  rather than an abbreviation nobody can decode. */}
              {labelFor(sq.type).split(" ").map((word) => (
                <span key={word}>{word}</span>
              ))}
            </span>

            {/* landing pulse — an ink ring thrown off the tile the token just hit.
                Keyed on the token's square, not the inverted one: on the landing
                page those are different squares (hover inverts, the token walks). */}
            {!reduce && landed > 0 && sq.index === position && (
              <motion.span
                key={`land-${landed}`}
                aria-hidden
                className="pointer-events-none absolute -inset-[3px] border-2"
                style={{ borderColor: "var(--color-accent)" }}
                initial={{ opacity: 0.85, scale: 1 }}
                animate={{ opacity: 0, scale: 1.4 }}
                transition={{ duration: DUR.base, ease: "easeOut" }}
              />
            )}

            {/* payday-passed blink: one ink flash per bump, payday squares only */}
            {paydayFlash > 0 && !reduce && pays && (
              <motion.span
                key={paydayFlash}
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gain"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.9, 0] }}
                transition={{ duration: 0.28, times: [0, 0.3, 1] }}
              />
            )}
          </motion.div>
        );
      })}

      {/* money stamp — a signed figure thrown off the square that produced it,
          with the travel, the size and the dwell all scaled by how much money
          actually moved. The sign is always printed, so the colour is the second
          channel and never the only one. */}
      {bubble && pts[bubble.index] && (() => {
        const at = pts[bubble.index];
        const j = juice(bubble.amount);
        const travel = 22 + 40 * j;
        // A "+$" pops upward by convention — except off the TOP row, where upward
        // walks the figure straight off the board and onto the HUD. There it falls
        // into the ring instead. Every other side has room either way.
        const rise = (at.y < 20 ? 1 : -1) * travel;
        return (
        <motion.span
          key={bubble.id}
          aria-hidden
          className="num pointer-events-none absolute z-30 -translate-x-1/2 whitespace-nowrap leading-none"
          style={{
            left: `${at.x}%`,
            top: `${at.y}%`,
            color: bubble.amount > 0 ? "var(--color-gain)" : "var(--color-loss)",
            fontSize: `clamp(0.66rem, ${2.4 + 1.6 * j}cqi, ${0.8 + 0.5 * j}rem)`,
            letterSpacing: "0.02em",
          }}
          initial={reduce ? { opacity: 1, y: rise * 0.4 } : { opacity: 0, y: 0, scale: 0.7 }}
          animate={
            reduce
              ? { opacity: 1, y: rise * 0.4 }
              : { opacity: [0, 1, 1, 0], y: rise, scale: 1 }
          }
          transition={reduce ? { duration: 0 } : { duration: 0.85 + 0.55 * j, times: [0, 0.12, 0.7, 1], ease: "easeOut" }}
        >
          {bubble.amount > 0 ? "+" : ""}
          {currency(bubble.amount)}
        </motion.span>
        );
      })()}

      {/* player token — a paper stamp inside an accent keyline, so it stays legible
          both on the near-black field and on the orange square it lands on.
          Position lives entirely in `transform` (written by `writeToken`);
          `left/top` stay pinned at the board origin. */}
      {tokenIndex !== null && (
        <div
          ref={tokenRef}
          className="absolute left-0 top-0 z-20"
          style={{ willChange: moving ? "transform" : undefined }}
        >
          <motion.div
            className="grid place-items-center bg-ink"
            style={{
              // Sized off the BOARD, like everything else on it: a fixed 28px stamp
              // covered two thirds of a 44px tile on a 390px phone.
              width: "clamp(17px, 5cqi, 28px)",
              height: "clamp(17px, 5cqi, 28px)",
              transformOrigin: "center bottom",
              border: "2px solid var(--color-accent)",
              // `outline`, not a ring: `box-shadow` is dead system-wide (globals.css
              // reset). Two keylines because the token has to read on BOTH grounds —
              // the accent edge against the near-black field, the paper edge against
              // the accent-filled square it lands on.
              outline: "2px solid var(--color-bg)",
            }}
            animate={hop}
          >
            <span className="display-caps" style={{ color: "var(--color-bg)", fontSize: "clamp(0.5rem, 2.6cqi, 0.7rem)" }}>
              {playerInitial}
            </span>
          </motion.div>
        </div>
      )}
    </div>
  );
}
