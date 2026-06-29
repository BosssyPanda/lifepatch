"use client";

import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

// ── pip layout (3×3 grid coordinates [col,row]) ──────────────────────────────
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
};

const SIZE = 58; // px
const H = SIZE / 2;

// fixed faces (opposite faces sum to 7)
const FACES: { v: number; t: string }[] = [
  { v: 1, t: `translateZ(${H}px)` },
  { v: 6, t: `rotateY(180deg) translateZ(${H}px)` },
  { v: 4, t: `rotateY(90deg) translateZ(${H}px)` },
  { v: 3, t: `rotateY(-90deg) translateZ(${H}px)` },
  { v: 5, t: `rotateX(90deg) translateZ(${H}px)` },
  { v: 2, t: `rotateX(-90deg) translateZ(${H}px)` },
];

// cube rotation that brings a given value's face to the front
const REST: Record<number, { x: number; y: number }> = {
  1: { x: 0, y: 0 },
  2: { x: -90, y: 0 },
  3: { x: 0, y: 90 },
  4: { x: 0, y: -90 },
  5: { x: 90, y: 0 },
  6: { x: 0, y: 180 },
};

/** Smallest angle ≥ min that is congruent to target (mod 360) — keeps spin forward. */
function nextCongruent(min: number, target: number): number {
  const t = ((target % 360) + 360) % 360;
  let v = Math.floor(min / 360) * 360 + t;
  while (v < min) v += 360;
  return v;
}

function Pip({ red }: { red: boolean }) {
  return (
    <span
      style={{
        width: "26%",
        height: "26%",
        borderRadius: "50%",
        background: red
          ? "radial-gradient(circle at 34% 30%, #ef7a45 0%, #d4541e 42%, #7a1f0c 100%)"
          : "radial-gradient(circle at 34% 30%, #5b5046 0%, #221b13 55%, #0c0907 100%)",
        boxShadow: "inset 0 1.2px 1.4px rgba(0,0,0,0.65), 0 1px 0 rgba(255,255,255,0.55)",
        alignSelf: "center",
        justifySelf: "center",
      }}
    />
  );
}

function Face({ v, transform }: { v: number; transform: string }) {
  const cells = Array.from({ length: 9 }, (_, i) => {
    const c = i % 3;
    const r = Math.floor(i / 3);
    return (PIPS[v] ?? []).some(([pc, pr]) => pc === c && pr === r);
  });
  return (
    <div
      style={{
        position: "absolute",
        width: SIZE,
        height: SIZE,
        transform,
        backfaceVisibility: "hidden",
        borderRadius: 13,
        border: "1px solid rgba(120,100,70,0.35)",
        background: "linear-gradient(150deg, #fdfbf4 0%, #f4eee2 52%, #e4dac4 100%)",
        boxShadow:
          "inset 0 0 7px rgba(255,255,255,0.85), inset 0 -4px 7px rgba(150,128,92,0.28), inset 0 3px 5px rgba(255,255,255,0.6)",
        overflow: "hidden",
      }}
    >
      {/* glossy specular highlight */}
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 13,
          background: "radial-gradient(60% 45% at 30% 22%, rgba(255,255,255,0.7), rgba(255,255,255,0) 60%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: "14%",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gridTemplateRows: "1fr 1fr 1fr",
        }}
      >
        {cells.map((on, i) => (on ? <Pip key={i} red={v === 1} /> : <span key={i} />))}
      </div>
    </div>
  );
}

function Burst() {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5 }}
    >
      {/* glow ring */}
      <motion.span
        initial={{ scale: 0.3, opacity: 0.75 }}
        animate={{ scale: 1.7, opacity: 0 }}
        transition={{ duration: 0.55, ease: "easeOut" }}
        style={{
          position: "absolute",
          inset: "10%",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(212,84,30,0.55), rgba(212,84,30,0) 70%)",
        }}
      />
      {/* dust particles */}
      {Array.from({ length: 7 }).map((_, i) => {
        const a = (i / 7) * Math.PI * 2;
        return (
          <motion.span
            key={i}
            initial={{ x: 0, y: 0, opacity: 0.9, scale: 1 }}
            animate={{ x: Math.cos(a) * (26 + (i % 3) * 7), y: Math.sin(a) * (20 + (i % 3) * 6) - 6, opacity: 0, scale: 0.4 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            style={{
              position: "absolute",
              left: "50%",
              top: "62%",
              width: 4,
              height: 4,
              marginLeft: -2,
              marginTop: -2,
              borderRadius: "50%",
              background: i % 2 ? "rgba(231,223,201,0.9)" : "rgba(201,162,74,0.9)",
            }}
          />
        );
      })}
    </motion.div>
  );
}

function Die({ value, rolling, index }: { value: number; rolling: boolean; index: number }) {
  const reduce = useReducedMotion();
  const acc = useRef({ x: -22, y: 26 });
  const wasRolling = useRef(false);
  const [rot, setRot] = useState(acc.current);
  const [airborne, setAirborne] = useState(false);
  const [burst, setBurst] = useState(0);
  const bounce = useAnimationControls();

  useEffect(() => {
    if (reduce) {
      setRot(REST[value]);
      return;
    }
    if (rolling) {
      acc.current = {
        x: acc.current.x + 900 + Math.random() * 540 + index * 160,
        y: acc.current.y + 1080 + Math.random() * 540,
      };
      setRot(acc.current);
      setAirborne(true);
      wasRolling.current = true;
      bounce.start({ y: -26, scaleX: 1, scaleY: 1 }, { duration: 0.18, ease: "easeOut" });
    } else {
      const rest = REST[value];
      acc.current = {
        x: nextCongruent(acc.current.x + 360, rest.x),
        y: nextCongruent(acc.current.y + 360, rest.y),
      };
      setRot(acc.current);
      setAirborne(false);
      if (wasRolling.current) {
        bounce.start(
          {
            y: [-26, 0, -14, 0, -5, 0],
            scaleX: [1, 1.14, 0.96, 1.05, 0.99, 1],
            scaleY: [1, 0.82, 1.06, 0.95, 1.02, 1],
          },
          { duration: 0.72, times: [0, 0.32, 0.52, 0.72, 0.88, 1], ease: "easeOut" },
        );
        setBurst((b) => b + 1);
      }
      wasRolling.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolling, value, reduce]);

  return (
    <div style={{ position: "relative", width: SIZE, height: SIZE + 16, perspective: 620 }}>
      {/* contact shadow */}
      <motion.span
        animate={airborne ? { scaleX: 0.62, opacity: 0.22 } : { scaleX: 1, opacity: 0.5 }}
        transition={{ type: "spring", stiffness: 200, damping: 18 }}
        style={{
          position: "absolute",
          left: "8%",
          right: "8%",
          bottom: 0,
          height: 12,
          borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(0,0,0,0.6), rgba(0,0,0,0) 70%)",
          filter: "blur(3px)",
        }}
      />

      {/* speed lines while spinning */}
      <AnimatePresence>
        {rolling && !reduce && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 4 }}
          >
            {[-14, 0, 14].map((dx, i) => (
              <motion.span
                key={i}
                animate={{ opacity: [0.1, 0.55, 0.1] }}
                transition={{ duration: 0.22, repeat: Infinity, delay: i * 0.06 }}
                style={{
                  position: "absolute",
                  top: "12%",
                  bottom: "30%",
                  left: `calc(50% + ${dx}px)`,
                  width: 2,
                  borderRadius: 2,
                  background: "linear-gradient(to bottom, rgba(231,223,201,0), rgba(231,223,201,0.7), rgba(231,223,201,0))",
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* bounce / squash wrapper */}
      <motion.div animate={bounce} style={{ position: "absolute", left: 0, top: 0, width: SIZE, height: SIZE, transformOrigin: "center bottom" }}>
        {/* rotating cube */}
        <motion.div
          animate={{ rotateX: rot.x, rotateY: rot.y }}
          transition={rolling ? { duration: 0.82, ease: [0.45, 0, 0.7, 1] } : { type: "spring", stiffness: 85, damping: 11 }}
          style={{
            position: "relative",
            width: SIZE,
            height: SIZE,
            transformStyle: "preserve-3d",
            filter: rolling && !reduce ? "blur(0.8px)" : "none",
          }}
        >
          {FACES.map((f) => (
            <Face key={f.v} v={f.v} transform={f.t} />
          ))}
        </motion.div>
      </motion.div>

      {/* landing glow + dust */}
      <AnimatePresence>{burst > 0 && <Burst key={burst} />}</AnimatePresence>
    </div>
  );
}

export function Dice({ values, rolling }: { values: number[]; rolling: boolean }) {
  return (
    <div className="flex items-end justify-center gap-3" style={{ minHeight: SIZE + 18 }}>
      {values.map((v, i) => (
        <Die key={i} value={v} rolling={rolling} index={i} />
      ))}
    </div>
  );
}
