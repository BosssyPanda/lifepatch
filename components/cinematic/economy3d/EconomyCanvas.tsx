"use client";

import { Canvas } from "@react-three/fiber";
import { useReducedMotion } from "framer-motion";
import { Suspense, useEffect, useState } from "react";
import * as THREE from "three";
import { EconomyScene, type EconomyVariant } from "./EconomyScene";

/** One-time, cached check for a usable WebGL context (mirrors Board3D/BrainCanvas). */
let webglOk: boolean | null = null;
function hasWebGL(): boolean {
  if (webglOk !== null) return webglOk;
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    webglOk = !!(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
  } catch {
    webglOk = false;
  }
  return webglOk;
}

const CAMERA: Record<EconomyVariant, { position: [number, number, number]; fov: number }> = {
  gate: { position: [0, 2.6, 7.2], fov: 40 },
  title: { position: [0, 3.4, 9], fov: 38 },
};

/**
 * Decorative WebGL hero for the opening: the floating "internet economy" world,
 * rendered as a full-bleed layer BEHIND the 2D hero/HUD (pointer-events-none, so
 * the Begin/CTA buttons stay clickable). Renders nothing until mounted / when
 * WebGL is unavailable — the existing flat hero is the accessible fallback.
 * Lazy-imported ({ ssr:false }) by Gate/Intro so three/drei stay out of the
 * base bundle; the 2D screen paints first, then this fades in over it.
 */
export function EconomyCanvas({ variant }: { variant: EconomyVariant }) {
  const reduce = !!useReducedMotion();
  const [ready, setReady] = useState(false);

  useEffect(() => setReady(true), []);

  if (!ready || !hasWebGL()) return null;

  const cam = CAMERA[variant];
  return (
    <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
      <Canvas
        dpr={[1, reduce ? 1.5 : 2]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ position: cam.position, fov: cam.fov }}
        frameloop={reduce ? "demand" : "always"}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
        className="!absolute inset-0"
      >
        <Suspense fallback={null}>
          <EconomyScene variant={variant} reduce={reduce} />
        </Suspense>
      </Canvas>
    </div>
  );
}

export default EconomyCanvas;
