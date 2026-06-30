"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { TOKEN_RADIUS, TOKEN_REST_Y, hopArc, type TilePoint } from "./geometry";

const STEP_MS = 165; // per-tile hop duration — mirrors the original 2D timing
const LAND_RING_MS = 520;

type TokenProps = {
  points: TilePoint[];
  position: number;
  label: string;
  reduce: boolean;
  accent: string;
  paper: string;
  /** fired the instant the token settles onto its final tile */
  onSettle?: () => void;
};

/**
 * 3D player pawn. Walks the ring tile-by-tile from its previous square to
 * `position`, arcing through the air with squash/stretch, then drops a dust
 * ring pulse on landing. Under reduced motion it teleports instantly.
 */
export function PlayerToken({ points, position, label, reduce, accent, paper, onSettle }: TokenProps) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);

  const prev = useRef(position);
  const accentColor = useMemo(() => new THREE.Color(accent), [accent]);
  const paperColor = useMemo(() => new THREE.Color(paper), [paper]);

  // active hop animation state (held in refs so frames don't trigger renders)
  const anim = useRef<{ start: number; steps: number; from: number } | null>(null);
  const settled = useRef(true);
  const ringStart = useRef(-1);
  const [, force] = useState(0);

  // place at rest initially / on prop-driven jumps
  useEffect(() => {
    const from = prev.current;
    const size = points.length;
    const steps = (position - from + size) % size;

    if (steps === 0) {
      prev.current = position;
      return;
    }

    if (reduce) {
      prev.current = position;
      ringStart.current = performance.now();
      onSettle?.();
      force((n) => n + 1);
      return;
    }

    anim.current = { start: performance.now(), steps, from };
    settled.current = false;
    force((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, reduce]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const size = points.length;
    const now = performance.now();

    // ---- hop along the ring ----
    if (anim.current) {
      const { start, steps, from } = anim.current;
      const elapsed = now - start;
      const total = steps * STEP_MS;
      const tAll = Math.min(1, elapsed / total);
      const walked = tAll * steps;
      const seg = Math.min(steps - 1, Math.floor(walked));
      const tSeg = walked - seg;

      const a = points[(from + seg) % size];
      const b = points[(from + seg + 1) % size];
      // ease each individual hop for a snappier arc
      const te = tSeg < 0.5 ? 2 * tSeg * tSeg : 1 - Math.pow(-2 * tSeg + 2, 2) / 2;
      const p = hopArc(a, b, te, 0.95);
      g.position.set(p.x, p.y, p.z);

      // squash/stretch: stretched at apex, squashed near contact
      if (body.current) {
        const air = Math.sin(Math.PI * tSeg);
        const sy = 1 + air * 0.22 - (1 - air) * 0.08;
        const sxz = 1 - air * 0.12 + (1 - air) * 0.06;
        body.current.scale.set(sxz, sy, sxz);
      }

      if (tAll >= 1) {
        anim.current = null;
        prev.current = position;
        const f = points[position];
        g.position.set(f.x, TOKEN_REST_Y, f.z);
        if (body.current) body.current.scale.set(1, 1, 1);
        ringStart.current = now;
        if (!settled.current) {
          settled.current = true;
          onSettle?.();
        }
      }
    } else {
      // resting on the current tile with a gentle idle bob
      const f = points[prev.current];
      const bob = reduce ? 0 : Math.sin(now * 0.003) * 0.05;
      g.position.set(f.x, TOKEN_REST_Y + bob, f.z);
    }

    // ---- landing dust ring ----
    if (ring.current && ringMat.current) {
      if (ringStart.current >= 0) {
        const rt = Math.min(1, (now - ringStart.current) / LAND_RING_MS);
        const f = points[prev.current];
        ring.current.position.set(f.x, 0.02, f.z);
        ring.current.visible = rt < 1;
        const scale = 0.4 + rt * 1.5;
        ring.current.scale.set(scale, scale, scale);
        ringMat.current.opacity = (1 - rt) * 0.7;
        if (rt >= 1) ringStart.current = -1;
      } else {
        ring.current.visible = false;
      }
    }
  });

  return (
    <group>
      <group ref={group}>
        <group ref={body}>
          {/* pawn: rounded base + sphere head, emissive accent */}
          <mesh castShadow position={[0, 0, 0]}>
            <cylinderGeometry args={[TOKEN_RADIUS * 0.55, TOKEN_RADIUS, 0.34, 28]} />
            <meshStandardMaterial
              color={accentColor}
              emissive={accentColor}
              emissiveIntensity={0.55}
              roughness={0.32}
              metalness={0.35}
            />
          </mesh>
          <mesh castShadow position={[0, 0.32, 0]}>
            <sphereGeometry args={[TOKEN_RADIUS * 0.62, 28, 28]} />
            <meshStandardMaterial
              color={accentColor}
              emissive={accentColor}
              emissiveIntensity={0.65}
              roughness={0.28}
              metalness={0.4}
            />
          </mesh>
          <Text
            position={[0, 0.32, TOKEN_RADIUS * 0.62 + 0.01]}
            fontSize={0.26}
            color={paperColor}
            anchorX="center"
            anchorY="middle"
          >
            {label}
          </Text>
          <pointLight position={[0, 0.6, 0]} color={accentColor} intensity={1.1} distance={3} decay={2} />
        </group>
      </group>

      {/* landing dust ring (flat on the board plane) */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.34, 0.46, 40]} />
        <meshBasicMaterial ref={ringMat} color={accentColor} transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
