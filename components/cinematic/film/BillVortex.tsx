"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { FIRST_YEAR, LAST_YEAR, sp500Return } from "@/lib/markets";

/**
 * BillVortex — Act II of the intro film: flat ink bills spiral down into
 * darkness while the market's real worst yearly returns (% only — years are
 * spoilers, lib/cinematic.ts rule) drift past as faint numerals. Heavy half
 * behind ColdOpen's dynamic import; three only loads through this file when
 * Act II arms. Flat meshBasicMaterial, palette hexes, no lights (LEDGER law;
 * the film grain/flicker on top comes from FilmLayer, not from here).
 */

const INK = "#f2f1ea";
const INK_DIM = "#8f8e85";
const HAIRLINE = "#2a2a25";
const BG = "#0e0e0c";

const BILLS = 130;
const TOP_Y = 7;
const BOT_Y = -8;
const SPAN = TOP_Y - BOT_Y;

/** mulberry32 — deterministic per-instance params */
function rng(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The real worst S&P years' returns — sp500Return already yields percents. */
function worstReturns(n: number): string[] {
  const rs: number[] = [];
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) rs.push(sp500Return(y));
  return rs
    .sort((a, b) => a - b)
    .slice(0, n)
    .map((r) => `${r.toFixed(1)}%`.replace("-", "−"));
}

function Bills() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const params = useMemo(() => {
    const r = rng(90210);
    return Array.from({ length: BILLS }, () => ({
      theta0: r() * Math.PI * 2,
      spin: 0.35 + r() * 0.5, // orbit speed
      fall: 0.055 + r() * 0.075, // fraction of span per second
      phase: r(), // initial height fraction
      rMax: 3.2 + r() * 3.4,
      tumble: (r() - 0.5) * 3.4,
      scale: 0.7 + r() * 0.75,
    }));
  }, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colors = useMemo(() => {
    const r = rng(777);
    const arr = new Float32Array(BILLS * 3);
    const cs = [new THREE.Color(INK), new THREE.Color(INK_DIM), new THREE.Color(HAIRLINE)];
    for (let i = 0; i < BILLS; i++) {
      const c = cs[r() > 0.72 ? 0 : r() > 0.4 ? 1 : 2];
      arr.set([c.r, c.g, c.b], i * 3);
    }
    return arr;
  }, []);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.getElapsedTime();
    for (let i = 0; i < BILLS; i++) {
      const p = params[i];
      const f = (p.phase + t * p.fall) % 1; // 0 top → 1 bottom
      const y = TOP_Y - f * SPAN;
      const radius = p.rMax * (1 - f * 0.82); // funnel narrows toward the dark
      const theta = p.theta0 + t * p.spin + f * 2.4;
      dummy.position.set(Math.cos(theta) * radius, y, Math.sin(theta) * radius - 4.5);
      dummy.rotation.set(t * p.tumble + i, theta, f * 5);
      const s = p.scale * (1 - f * 0.45);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, BILLS]} frustumCulled={false}>
      <planeGeometry args={[0.52, 0.24]}>
        <instancedBufferAttribute attach="attributes-color" args={[colors, 3]} />
      </planeGeometry>
      <meshBasicMaterial vertexColors side={THREE.DoubleSide} transparent opacity={0.85} />
    </instancedMesh>
  );
}

/** Faint numeral plates of the real worst returns, drifting in the deep. */
function ReturnGhosts() {
  const group = useRef<THREE.Group>(null);
  const plates = useMemo(() => {
    const texts = worstReturns(6);
    const r = rng(1929);
    return texts.map((txt, i) => {
      const c = document.createElement("canvas");
      c.width = 512; c.height = 160;
      const x = c.getContext("2d")!;
      x.fillStyle = BG; x.fillRect(0, 0, 512, 160);
      x.font = "700 118px Arial Narrow, Impact, sans-serif";
      x.textAlign = "center"; x.textBaseline = "middle";
      x.fillStyle = INK_DIM;
      x.fillText(txt, 256, 86);
      const tex = new THREE.CanvasTexture(c);
      return {
        tex,
        x: (r() - 0.5) * 16,
        y: (r() - 0.5) * 9,
        z: -9 - r() * 6,
        drift: 0.12 + r() * 0.2,
        key: `${txt}-${i}`,
      };
    });
  }, []);

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    g.children.forEach((ch, i) => {
      const p = plates[i];
      ch.position.y = p.y + Math.sin(t * p.drift + i * 2.1) * 0.8;
    });
  });

  return (
    <group ref={group}>
      {plates.map((p) => (
        <mesh key={p.key} position={[p.x, p.y, p.z]}>
          <planeGeometry args={[4.4, 1.4]} />
          <meshBasicMaterial map={p.tex} transparent opacity={0.16} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

export function BillVortex({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 ${className}`}>
      <Canvas
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
        camera={{ position: [0, 0.6, 7.5], fov: 52, rotation: [-0.18, 0, 0] }}
      >
        <ReturnGhosts />
        <Bills />
      </Canvas>
    </div>
  );
}
