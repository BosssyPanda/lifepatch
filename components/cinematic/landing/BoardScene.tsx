"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useScroll } from "framer-motion";
import type { MotionValue } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RAT_BOARD, RAT_SQUARE_META } from "@/lib/cashflow/board";
import type { RatSquareType } from "@/lib/cashflow/types";

/**
 * The live 3D Rat Race diorama (spectacle Phase L) — the heavy half behind
 * BoardDiorama's dynamic import; three only ever loads through this file.
 * Written justification (brief §2): a continuous user-driven camera —
 * scroll-orbit + damped pointer parallax + per-tile raycast hover — cannot be
 * pre-rendered. Flat meshBasicMaterial, palette hexes only, no lights or
 * shadows (LEDGER law). All 24 tiles come from RAT_BOARD; nothing invented.
 */

const BG = "#0e0e0c";
const BG2 = "#131211";
const BG3 = "#191714";
const INK = "#f2f1ea";
const INK_DIM = "#8f8e85";
const TERTIARY = "#5c5b53";
const HAIRLINE = "#2a2a25";
const LOSS = "#ff3b30";
const GAIN = "#2bd576";

const TILE = 1; // tile footprint
const TILE_H = 0.16;
const PITCH = 1.06; // tile center-to-center
const SIDE = 6; // RAT_BOARD is a 24-ring, 6 per side
const EDGE = 3 * PITCH; // straight-edge offset from center
const LIFT = 0.22; // hover raise

const ORBIT_BASE = -0.35;
const ORBIT_SWEEP = 2.1; // ~120° across the section scroll
const PARALLAX_YAW = 0.06;
const PARALLAX_PITCH = 0.035;

function toneFor(type: RatSquareType): string {
  if (type === "doodad" || type === "downsized") return LOSS;
  if (type === "payday") return GAIN;
  if (type === "charity") return INK_DIM;
  return INK;
}

/** Perimeter walk: 24 squares, 6 per side, clockwise from the front edge. */
function ringPosition(i: number): [number, number] {
  const side = Math.floor(i / SIDE);
  const u = ((i % SIDE) - (SIDE - 1) / 2) * PITCH;
  switch (side) {
    case 0: return [u, EDGE]; // front, left→right
    case 1: return [EDGE, -u]; // right, front→back
    case 2: return [-u, -EDGE]; // back, right→left
    default: return [-EDGE, u]; // left, back→front
  }
}

/** next/font hashes family names — read the real one off a probe element. */
const familyCache = new Map<string, string>();
function familyOf(className: string, fallback: string): string {
  const hit = familyCache.get(className);
  if (hit) return hit;
  const el = document.createElement("span");
  el.className = className;
  el.style.position = "absolute";
  el.style.visibility = "hidden";
  document.body.appendChild(el);
  const fam = getComputedStyle(el).fontFamily || fallback;
  el.remove();
  familyCache.set(className, fam);
  return fam;
}

function plateCanvas(size: number): CanvasRenderingContext2D {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return c.getContext("2d")!;
}

/** Tile top plate: index numeral + the square's real short code, LEDGER inks. */
function tileTexture(index: number, type: RatSquareType): THREE.CanvasTexture {
  const S = 256;
  const ctx = plateCanvas(S);
  const mono = familyOf("num", "monospace");
  ctx.fillStyle = BG2;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, S - 4, S - 4);
  ctx.fillStyle = TERTIARY;
  ctx.font = `500 26px ${mono}`;
  ctx.textBaseline = "top";
  ctx.fillText(String(index + 1).padStart(2, "0"), 20, 18);
  ctx.fillStyle = toneFor(type);
  ctx.font = `700 52px ${mono}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(RAT_SQUARE_META[type].short, S / 2, S / 2 + 14);
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Center slab: the board's filing plate — double rule + wordmark. */
function centerTexture(): THREE.CanvasTexture {
  const S = 1024;
  const ctx = plateCanvas(S);
  const mono = familyOf("num", "monospace");
  const anton = familyOf("font-anton", "sans-serif");
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, S - 28, S - 28);
  ctx.strokeRect(44, 44, S - 88, S - 88);
  ctx.textAlign = "center";
  ctx.fillStyle = INK;
  ctx.font = `400 148px ${anton}`;
  ctx.textBaseline = "middle";
  ctx.fillText("RAT RACE", S / 2, S / 2 - 30);
  ctx.fillStyle = TERTIARY;
  ctx.font = `500 34px ${mono}`;
  ctx.fillText("LIFEPATCH — FORM 01", S / 2, S / 2 + 96);
  ctx.fillText(`${RAT_BOARD.length} SQUARES · NO EXITS`, S / 2, S / 2 + 152);
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Die top face (static prop, echoes DiceRollOverlay's pip language). */
const PIPS: Record<number, [number, number][]> = {
  3: [[0, 0], [1, 1], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
};
function dieTexture(value: number): THREE.CanvasTexture {
  const S = 128;
  const ctx = plateCanvas(S);
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, S - 3, S - 3);
  ctx.fillStyle = BG;
  const cell = S / 4.2;
  const origin = S / 2 - cell;
  for (const [col, row] of PIPS[value]) {
    ctx.beginPath();
    ctx.arc(origin + col * cell, origin + row * cell, S * 0.075, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

type Hover = { index: number; type: RatSquareType } | null;

function Diorama({
  progress,
  hoverCapable,
  onHover,
}: {
  progress: MotionValue<number>;
  hoverCapable: boolean;
  onHover: (sq: Hover) => void;
}) {
  const rig = useRef<THREE.Group>(null);
  const yaw = useRef(ORBIT_BASE);
  const pitch = useRef(0);
  const lifts = useRef<number[]>(RAT_BOARD.map(() => 0));
  const tiles = useRef<(THREE.Mesh | null)[]>(RAT_BOARD.map(() => null));
  const [hovered, setHovered] = useState<number | null>(null);
  const gl = useThree((s) => s.gl);

  // fonts arrive after first paint — rebuild plates once, so the type is real
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) setFontsReady(true); });
    return () => { alive = false; };
  }, []);

  const tileTextures = useMemo(
    () => RAT_BOARD.map((sq) => tileTexture(sq.index, sq.type)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fontsReady],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const slabTexture = useMemo(() => centerTexture(), [fontsReady]);
  const dieTop3 = useMemo(() => dieTexture(3), []);
  const dieTop5 = useMemo(() => dieTexture(5), []);
  useEffect(() => {
    return () => {
      tileTextures.forEach((t) => t.dispose());
      slabTexture.dispose();
    };
  }, [tileTextures, slabTexture]);
  useEffect(() => () => { dieTop3.dispose(); dieTop5.dispose(); }, [dieTop3, dieTop5]);

  useEffect(() => {
    gl.domElement.style.cursor = hovered != null ? "pointer" : "auto";
    onHover(hovered != null ? { index: hovered, type: RAT_BOARD[hovered].type } : null);
  }, [hovered, gl, onHover]);

  useFrame(({ pointer }, delta) => {
    const damp = 1 - Math.exp(-4 * delta);
    const p = progress.get();
    const yawTarget = ORBIT_BASE + p * ORBIT_SWEEP + (hoverCapable ? pointer.x * PARALLAX_YAW : 0);
    const pitchTarget = hoverCapable ? -pointer.y * PARALLAX_PITCH : 0;
    yaw.current += (yawTarget - yaw.current) * damp;
    pitch.current += (pitchTarget - pitch.current) * damp;
    if (rig.current) {
      rig.current.rotation.y = yaw.current;
      rig.current.rotation.x = pitch.current;
    }
    for (let i = 0; i < RAT_BOARD.length; i++) {
      const target = hovered === i ? LIFT : 0;
      lifts.current[i] += (target - lifts.current[i]) * damp;
      const mesh = tiles.current[i];
      if (mesh) mesh.position.y = TILE_H / 2 + lifts.current[i];
    }
  });

  return (
    <group ref={rig}>
      {/* center filing slab */}
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[EDGE * 2 - TILE - 0.12, 0.1, EDGE * 2 - TILE - 0.12]} />
        <meshBasicMaterial attach="material-0" color={BG3} />
        <meshBasicMaterial attach="material-1" color={BG3} />
        <meshBasicMaterial attach="material-2" map={slabTexture} />
        <meshBasicMaterial attach="material-3" color={BG} />
        <meshBasicMaterial attach="material-4" color={BG3} />
        <meshBasicMaterial attach="material-5" color={BG3} />
      </mesh>

      {/* the 24 squares of the real ring */}
      {RAT_BOARD.map((sq) => {
        const [x, z] = ringPosition(sq.index);
        return (
          <mesh
            key={sq.index}
            ref={(m) => { tiles.current[sq.index] = m; }}
            position={[x, TILE_H / 2, z]}
            onPointerOver={hoverCapable ? (e) => { e.stopPropagation(); setHovered(sq.index); } : undefined}
            onPointerOut={hoverCapable ? () => setHovered((h) => (h === sq.index ? null : h)) : undefined}
          >
            <boxGeometry args={[TILE, TILE_H, TILE]} />
            <meshBasicMaterial attach="material-0" color={BG3} />
            <meshBasicMaterial attach="material-1" color={BG3} />
            <meshBasicMaterial attach="material-2" map={tileTextures[sq.index]} />
            <meshBasicMaterial attach="material-3" color={BG} />
            <meshBasicMaterial attach="material-4" color={BG3} />
            <meshBasicMaterial attach="material-5" color={BG3} />
          </mesh>
        );
      })}

      {/* props on the slab — dice pair, ledger book, coin stack (Phase G comp) */}
      <group position={[0.7, 0, 0.55]} rotation={[0, 0.5, 0]}>
        <mesh position={[0, 0.37, 0]}>
          <boxGeometry args={[0.56, 0.56, 0.56]} />
          <meshBasicMaterial attach="material-0" color={INK} />
          <meshBasicMaterial attach="material-1" color={INK} />
          <meshBasicMaterial attach="material-2" map={dieTop5} />
          <meshBasicMaterial attach="material-3" color={INK} />
          <meshBasicMaterial attach="material-4" color={INK} />
          <meshBasicMaterial attach="material-5" color={INK} />
        </mesh>
        <mesh position={[0.74, 0.37, -0.3]} rotation={[0, -0.7, 0]}>
          <boxGeometry args={[0.56, 0.56, 0.56]} />
          <meshBasicMaterial attach="material-0" color={INK} />
          <meshBasicMaterial attach="material-1" color={INK} />
          <meshBasicMaterial attach="material-2" map={dieTop3} />
          <meshBasicMaterial attach="material-3" color={INK} />
          <meshBasicMaterial attach="material-4" color={INK} />
          <meshBasicMaterial attach="material-5" color={INK} />
        </mesh>
      </group>
      <group position={[-1.2, 0, -0.7]} rotation={[0, -0.35, 0]}>
        <mesh position={[0, 0.15, 0]}>
          <boxGeometry args={[1.5, 0.14, 1.05]} />
          <meshBasicMaterial color={BG3} />
        </mesh>
        <mesh position={[0.03, 0.23, 0]}>
          <boxGeometry args={[1.32, 0.025, 0.9]} />
          <meshBasicMaterial color={INK} />
        </mesh>
      </group>
      <group position={[1.35, 0, -1.05]}>
        {[0, 1, 2].map((n) => (
          <mesh key={n} position={[n * 0.045, 0.1 + n * 0.052, n * -0.03]}>
            <cylinderGeometry args={[0.22, 0.22, 0.045, 28]} />
            <meshBasicMaterial color={INK_DIM} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export function BoardScene({
  targetRef,
  active,
  hoverCapable,
  onHover,
  onReady,
}: {
  targetRef: React.RefObject<HTMLElement | null>;
  active: boolean;
  hoverCapable: boolean;
  onHover: (sq: Hover) => void;
  onReady: () => void;
}) {
  const { scrollYProgress } = useScroll({ target: targetRef, offset: ["start end", "end start"] });

  return (
    <Canvas
      dpr={[1, 1.75]}
      frameloop={active ? "always" : "demand"}
      camera={{ position: [7.4, 6.6, 7.4], fov: 34 }}
      onCreated={({ camera }) => {
        camera.lookAt(0, 0, 0);
        onReady();
      }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
    >
      <Diorama progress={scrollYProgress} hoverCapable={hoverCapable} onHover={onHover} />
    </Canvas>
  );
}
