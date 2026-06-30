"use client";

import { Canvas } from "@react-three/fiber";
import { useReducedMotion } from "framer-motion";
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { Scene } from "./board3d/Scene";
import { disposeTileTextures } from "./board3d/tileTexture";
import { Board, type BoardSquareView } from "./Board";

export type { BoardSquareView };

/** One-time, cached check for a usable WebGL context. */
let webglOk: boolean | null = null;
function hasWebGL(): boolean {
  if (webglOk !== null) return webglOk;
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    webglOk = !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl2") || canvas.getContext("webgl"))
    );
  } catch {
    webglOk = false;
  }
  return webglOk;
}

type Board3DProps = {
  squares: BoardSquareView[];
  position: number;
  colorFor: (type: string) => string;
  labelFor: (type: string) => string;
  tokenLabel: string;
  title: string;
  /** fired when the token settles on a tile, with that tile's type */
  onLand?: (type: string) => void;
  /** fired when a tile is hovered, with that tile's type */
  onTileHover?: (type: string) => void;
  children?: ReactNode;
};

/**
 * WebGL 3D rendering of the Rat Race board. Same data contract as `Board`, and
 * keeps the center hub (dice / roll / meter) as a DOM overlay above the canvas.
 * Falls back to the flat 2D `Board` when WebGL is unavailable.
 */
export function Board3D({
  squares,
  position,
  colorFor,
  labelFor,
  tokenLabel,
  title,
  onLand,
  onTileHover,
  children,
}: Board3DProps) {
  const reduce = !!useReducedMotion();
  const [ready, setReady] = useState(false);
  const [webgl, setWebgl] = useState(false);

  useEffect(() => {
    setWebgl(hasWebGL());
    setReady(true);
    return () => disposeTileTextures();
  }, []);

  // Stable label resolver for the scene.
  const resolveLabel = useMemo(() => (t: string) => labelFor(t), [labelFor]);

  // Before client mount (and when WebGL is missing), render the proven 2D board.
  if (!ready || !webgl) {
    return (
      <Board
        squares={squares}
        position={position}
        colorFor={colorFor}
        labelFor={labelFor}
        tokenLabel={tokenLabel}
        title={title}
      >
        {children}
      </Board>
    );
  }

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[560px]">
      <Canvas
        shadows
        dpr={[1, reduce ? 1.5 : 2]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ position: [0, 9.4, 9.6], fov: 38 }}
        frameloop={reduce ? "demand" : "always"}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
        className="!absolute inset-0"
      >
        <Suspense fallback={null}>
          <Scene
            squares={squares}
            position={position}
            labelFor={resolveLabel}
            tokenLabel={tokenLabel}
            reduce={reduce}
            onTileHover={onTileHover}
            onSettle={(type) => onLand?.(type)}
          />
        </Suspense>
      </Canvas>

      {/* center hub — DOM overlay above the canvas (dice / roll / meter) */}
      <HubOverlay title={title}>{children}</HubOverlay>
    </div>
  );
}

/** The center hub card, layered above the WebGL canvas (pointer-events isolated). */
function HubOverlay({ title, children }: { title: string; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="pointer-events-none absolute inset-[18%] z-20 grid place-items-center">
      <div
        ref={ref}
        className="pointer-events-auto w-full rounded-[12px] border border-ink/10 bg-bg2/72 p-3 text-center shadow-[0_18px_40px_-26px_rgba(0,0,0,0.9)] backdrop-blur-[3px]"
      >
        <p className="eyebrow text-accent" style={{ fontSize: "0.58rem" }}>
          {title}
        </p>
        {children}
      </div>
    </div>
  );
}

export default Board3D;
