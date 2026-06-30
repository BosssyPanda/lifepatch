"use client";

import { Canvas } from "@react-three/fiber";
import { useReducedMotion } from "framer-motion";
import { Suspense, useEffect, useState } from "react";
import * as THREE from "three";
import { BrainScene, type BrainCluster } from "./BrainScene";

/** One-time, cached check for a usable WebGL context (mirrors Board3D). */
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

/**
 * WebGL hero for the Money Brain map: a slow-orbiting constellation of concept
 * nodes whose glow tracks mastery. Renders nothing until mounted / when WebGL is
 * unavailable — the category list beneath it is the accessible fallback. Lazy-
 * imported ({ ssr:false }) so three/drei stay out of the base bundle.
 */
export function BrainCanvas({ clusters, maxLevel, pct }: { clusters: BrainCluster[]; maxLevel: number; pct: number }) {
  const reduce = !!useReducedMotion();
  const [ready, setReady] = useState(false);

  useEffect(() => setReady(true), []);

  if (!ready || !hasWebGL()) return null;

  return (
    <div className="relative mx-5 mt-4 h-44 overflow-hidden rounded-[6px] bg-bg shadow-[inset_0_2px_26px_rgba(0,0,0,0.6)] sm:h-56">
      <Canvas
        dpr={[1, reduce ? 1.5 : 2]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ position: [0, 4.1, 7.4], fov: 42 }}
        frameloop={reduce ? "demand" : "always"}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
        className="!absolute inset-0"
      >
        <Suspense fallback={null}>
          <BrainScene clusters={clusters} maxLevel={maxLevel} pct={pct} reduce={reduce} />
        </Suspense>
      </Canvas>
    </div>
  );
}

export default BrainCanvas;
