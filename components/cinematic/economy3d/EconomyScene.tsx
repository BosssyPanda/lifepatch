"use client";

import { Environment, Lightformer } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { surfacePalette, token } from "@/components/cashflow/board/board3d/palette";

/**
 * A small floating "internet economy" — a low-poly skyline on a slow-turning
 * disc, ringed by orbiting market objects (a minted coin, a house, green/red
 * candlesticks, a rising chart). The signature 3D moment behind the Gate and
 * title hero. Lighting + the inline-Lightformer Environment are network-free
 * (no CDN HDR), mirroring the board's `Scene.tsx`. No 3D text.
 */

export type EconomyVariant = "gate" | "title";

type Vec3 = [number, number, number];
type Building = { pos: Vec3; size: Vec3; tint: number };
type OrbiterKind = "coin" | "house" | "candleUp" | "candleDown" | "chart";
type OrbiterDef = { angle: number; radius: number; y: number; kind: OrbiterKind; spin: number };

const BUILDINGS: Building[] = [
  { pos: [0, 0, 0], size: [1.1, 2.6, 1.1], tint: 5 },
  { pos: [-1.5, 0, 0.4], size: [0.9, 1.7, 0.9], tint: 0 },
  { pos: [1.4, 0, -0.5], size: [0.95, 2.1, 0.95], tint: 3 },
  { pos: [0.3, 0, 1.6], size: [0.8, 1.2, 0.8], tint: 4 },
  { pos: [-0.9, 0, -1.5], size: [0.85, 1.5, 0.85], tint: 2 },
  { pos: [1.7, 0, 1.2], size: [0.7, 0.9, 0.7], tint: 1 },
  { pos: [-2.0, 0, -0.8], size: [0.7, 1.1, 0.7], tint: 5 },
];

const ORBITERS: OrbiterDef[] = [
  { angle: 0.0, radius: 3.7, y: 1.4, kind: "coin", spin: 0.9 },
  { angle: 1.15, radius: 3.5, y: 0.5, kind: "house", spin: 0.2 },
  { angle: 2.3, radius: 3.8, y: 1.9, kind: "candleUp", spin: 0.4 },
  { angle: 3.7, radius: 3.55, y: 0.9, kind: "chart", spin: 0.3 },
  { angle: 4.9, radius: 3.75, y: 1.6, kind: "candleDown", spin: 0.4 },
];

export function EconomyScene({ variant, reduce }: { variant: EconomyVariant; reduce: boolean }) {
  const pal = useMemo(() => surfacePalette(), []);
  const tints = useMemo(
    () => ["--color-olive", "--color-brick", "--color-ochre", "--color-brass", "--color-steel", "--color-accent"].map((t) => token(t)),
    [],
  );
  const emissiveFactor = variant === "gate" ? 0.5 : 0.34;
  const spinSpeed = (variant === "gate" ? 0.0022 : 0.0014) * (reduce ? 0 : 1);

  const spin = useRef<THREE.Group>(null);
  const { camera } = useThree();

  useFrame(({ pointer }) => {
    camera.lookAt(0, 0.7, 0);
    const g = spin.current;
    if (!g) return;
    g.rotation.y += spinSpeed;
    if (!reduce) {
      // gentle parallax tilt toward the pointer
      g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, pointer.y * 0.12, 0.05);
      g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, -pointer.x * 0.06, 0.05);
    }
  });

  return (
    <>
      <ambientLight intensity={0.5} color={pal.ink} />
      <hemisphereLight args={[pal.ink, pal.bg, 0.4]} />
      <directionalLight position={[5, 10, 6]} intensity={1.3} color={pal.accent2} />
      <directionalLight position={[-6, 4, -5]} intensity={0.5} color={pal.accent} />

      {/* baked, network-free reflections (no `preset` CDN fetch) */}
      <Environment frames={1} resolution={256}>
        <color attach="background" args={[pal.bg]} />
        <Lightformer intensity={1.4} color={pal.accent2} position={[0, 6, 4]} scale={[9, 9, 1]} />
        <Lightformer intensity={0.7} color={pal.accent} position={[-6, 3, -5]} scale={[6, 6, 1]} />
        <Lightformer intensity={0.5} color={pal.paper} position={[6, 2, -3]} scale={[4, 4, 1]} />
      </Environment>

      <group ref={spin} position={[0, -0.6, 0]}>
        {/* the platform the city sits on */}
        <mesh position={[0, -0.18, 0]} receiveShadow>
          <cylinderGeometry args={[4.6, 4.9, 0.36, 48]} />
          <meshStandardMaterial color={pal.bg2} roughness={0.85} metalness={0.15} />
        </mesh>
        <mesh position={[0, 0.02, 0]}>
          <torusGeometry args={[4.55, 0.03, 8, 64]} />
          <meshStandardMaterial color={pal.accent} emissive={pal.accent} emissiveIntensity={0.6} roughness={0.4} />
        </mesh>

        {/* skyline */}
        {BUILDINGS.map((b, i) => (
          <mesh key={i} position={[b.pos[0], b.size[1] / 2, b.pos[2]]} castShadow receiveShadow>
            <boxGeometry args={b.size} />
            <meshStandardMaterial
              color={tints[b.tint]}
              emissive={tints[b.tint]}
              emissiveIntensity={emissiveFactor}
              roughness={0.5}
              metalness={0.25}
            />
          </mesh>
        ))}

        {/* orbiting market objects */}
        {ORBITERS.map((o, i) => (
          <Orbiter key={i} o={o} tints={tints} reduce={reduce} emissive={emissiveFactor} />
        ))}
      </group>
    </>
  );
}

function Orbiter({ o, tints, reduce, emissive }: { o: OrbiterDef; tints: string[]; reduce: boolean; emissive: number }) {
  const ref = useRef<THREE.Group>(null);

  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const t = reduce ? 0 : performance.now() * 0.001;
    const a = o.angle + t * 0.12;
    g.position.set(Math.cos(a) * o.radius, o.y + Math.sin(t + o.angle) * 0.18, Math.sin(a) * o.radius);
    g.rotation.y += reduce ? 0 : o.spin * 0.02;
  });

  return (
    <group ref={ref}>
      <OrbiterMesh kind={o.kind} tints={tints} emissive={emissive} />
    </group>
  );
}

function OrbiterMesh({ kind, tints, emissive }: { kind: OrbiterKind; tints: string[]; emissive: number }) {
  const [olive, brick, ochre, brass, , accent] = tints;
  const mat = (color: string, emi = emissive, metal = 0.3, rough = 0.45) => (
    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emi} metalness={metal} roughness={rough} />
  );

  switch (kind) {
    case "coin":
      return (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.46, 0.46, 0.12, 28]} />
          {mat(brass, emissive + 0.1, 0.7, 0.3)}
        </mesh>
      );
    case "house":
      return (
        <group>
          <mesh position={[0, -0.12, 0]}>
            <boxGeometry args={[0.62, 0.5, 0.62]} />
            {mat(ochre)}
          </mesh>
          <mesh position={[0, 0.28, 0]} rotation={[0, Math.PI / 4, 0]}>
            <coneGeometry args={[0.5, 0.42, 4]} />
            {mat(brick)}
          </mesh>
        </group>
      );
    case "candleUp":
      return (
        <group>
          <mesh><boxGeometry args={[0.3, 0.7, 0.3]} />{mat(olive)}</mesh>
          <mesh><boxGeometry args={[0.06, 1.2, 0.06]} />{mat(olive, emissive + 0.1)}</mesh>
        </group>
      );
    case "candleDown":
      return (
        <group>
          <mesh><boxGeometry args={[0.3, 0.6, 0.3]} />{mat(brick)}</mesh>
          <mesh><boxGeometry args={[0.06, 1.1, 0.06]} />{mat(brick, emissive + 0.1)}</mesh>
        </group>
      );
    case "chart":
      return (
        <group>
          {[0.4, 0.7, 1.05].map((h, i) => (
            <mesh key={i} position={[(i - 1) * 0.34, h / 2 - 0.4, 0]}>
              <boxGeometry args={[0.24, h, 0.24]} />
              {mat(accent, emissive + 0.15)}
            </mesh>
          ))}
        </group>
      );
  }
}
