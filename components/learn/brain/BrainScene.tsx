"use client";

import { Environment, Lightformer } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { surfacePalette } from "@/components/cashflow/board/board3d/palette";

/**
 * The "Money Brain" constellation. Each financial concept is a glowing node,
 * grouped into category clusters on a slow-orbiting ring. A node's glow + size
 * scale with its mastery level (mastery-only): locked nodes are faint, seen-
 * but-unmastered ones are dim, mastered ones burn brighter as the level climbs.
 * Faint neuron lines tie each cluster together; a central core pulses with the
 * overall Money Brain %. No 3D text (titles live in the accessible list below);
 * lighting + the inline-Lightformer Environment are network-free (no CDN HDR).
 */

export type BrainCluster = {
  hex: string;
  nodes: { id: string; level: number; seen: boolean }[];
};

type Vec3 = [number, number, number];

const TAU = Math.PI * 2;
const CLUSTER_RADIUS = 3.55;
const NODE_SPREAD = 1.28;

type PlacedNode = { id: string; pos: Vec3; phase: number; level: number; seen: boolean };
type PlacedCluster = { hex: string; center: Vec3; nodes: PlacedNode[] };

function nodeLook(level: number, seen: boolean, max: number): { emissive: number; scale: number; opacity: number } {
  if (level >= 1) {
    const f = level / max; // 0.2 .. 1
    return { emissive: 0.55 + f * 1.3, scale: 0.85 + f * 0.5, opacity: 1 };
  }
  if (seen) return { emissive: 0.24, scale: 0.74, opacity: 0.9 };
  return { emissive: 0.06, scale: 0.55, opacity: 0.6 };
}

export function BrainScene({
  clusters,
  maxLevel,
  pct,
  reduce,
}: {
  clusters: BrainCluster[];
  maxLevel: number;
  pct: number;
  reduce: boolean;
}) {
  const pal = useMemo(() => surfacePalette(), []);

  const placed = useMemo<PlacedCluster[]>(() => {
    return clusters.map((cl, ci) => {
      const a = (ci / clusters.length) * TAU - TAU / 4;
      const center: Vec3 = [Math.cos(a) * CLUSTER_RADIUS, ci % 2 ? 0.5 : -0.35, Math.sin(a) * CLUSTER_RADIUS];
      const n = cl.nodes.length || 1;
      const nodes = cl.nodes.map((nd, j): PlacedNode => {
        const na = (j / n) * TAU;
        return {
          id: nd.id,
          level: nd.level,
          seen: nd.seen,
          phase: ci * 1.7 + j * 0.9,
          pos: [
            center[0] + Math.cos(na) * NODE_SPREAD,
            center[1] + Math.sin(na) * NODE_SPREAD * 0.66,
            center[2] + (j % 2 ? 0.42 : -0.42),
          ],
        };
      });
      return { hex: cl.hex, center, nodes };
    });
  }, [clusters]);

  const linePositions = useMemo(() => {
    const arr: number[] = [];
    placed.forEach((cl) =>
      cl.nodes.forEach((nd) => {
        arr.push(cl.center[0], cl.center[1], cl.center[2], nd.pos[0], nd.pos[1], nd.pos[2]);
      }),
    );
    return new Float32Array(arr);
  }, [placed]);

  const { camera } = useThree();
  const spin = useRef<THREE.Group>(null);
  useFrame(() => {
    camera.lookAt(0, 0, 0);
    if (spin.current && !reduce) spin.current.rotation.y += 0.0016;
  });

  const coreEmissive = 0.3 + (pct / 100) * 1.3;

  return (
    <>
      <ambientLight intensity={0.5} color={pal.ink} />
      <hemisphereLight args={[pal.ink, pal.bg, 0.45]} />
      <directionalLight position={[5, 9, 6]} intensity={1.1} color={pal.accent2} />
      <directionalLight position={[-6, 4, -5]} intensity={0.45} color={pal.accent} />

      {/* baked, network-free reflections (no `preset` CDN fetch) */}
      <Environment frames={1} resolution={256}>
        <color attach="background" args={[pal.bg]} />
        <Lightformer intensity={1.3} color={pal.accent2} position={[0, 5, 4]} scale={[9, 9, 1]} />
        <Lightformer intensity={0.7} color={pal.accent} position={[-6, 3, -5]} scale={[6, 6, 1]} />
        <Lightformer intensity={0.5} color={pal.paper} position={[6, 2, -3]} scale={[4, 4, 1]} />
      </Environment>

      <group ref={spin}>
        {/* central core — glows with the overall Money Brain % */}
        <mesh>
          <icosahedronGeometry args={[0.5, 1]} />
          <meshStandardMaterial
            color={pal.accent}
            emissive={pal.accent}
            emissiveIntensity={coreEmissive}
            roughness={0.3}
            metalness={0.2}
          />
        </mesh>

        {/* neuron lines (faint skeleton tying each cluster to its nodes) */}
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={pal.inkDim} transparent opacity={0.16} />
        </lineSegments>

        {placed.map((cl) =>
          cl.nodes.map((nd) => (
            <Node key={nd.id} pos={nd.pos} hex={cl.hex} phase={nd.phase} reduce={reduce} look={nodeLook(nd.level, nd.seen, maxLevel)} />
          )),
        )}
      </group>
    </>
  );
}

function Node({
  pos,
  hex,
  phase,
  reduce,
  look,
}: {
  pos: Vec3;
  hex: string;
  phase: number;
  reduce: boolean;
  look: { emissive: number; scale: number; opacity: number };
}) {
  const ref = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);

  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const bob = reduce ? 0 : Math.sin(performance.now() * 0.001 + phase) * 0.07;
    m.position.set(pos[0], pos[1] + bob, pos[2]);
    const target = look.scale * (hover ? 1.4 : 1);
    m.scale.setScalar(THREE.MathUtils.lerp(m.scale.x, target, 0.22));
  });

  return (
    <mesh
      ref={ref}
      position={pos}
      scale={look.scale}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
      }}
      onPointerOut={() => setHover(false)}
    >
      <icosahedronGeometry args={[0.28, 0]} />
      <meshStandardMaterial
        color={hex}
        emissive={hex}
        emissiveIntensity={hover ? look.emissive + 0.5 : look.emissive}
        roughness={0.32}
        metalness={0.15}
        transparent
        opacity={look.opacity}
      />
    </mesh>
  );
}
