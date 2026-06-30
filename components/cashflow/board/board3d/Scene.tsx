"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { RING, TILE_H, ringPoints } from "./geometry";
import { surfacePalette } from "./palette";
import { Tile } from "./Tile";
import { PlayerToken } from "./PlayerToken";
import type { BoardSquareView } from "../Board";

type SceneProps = {
  squares: BoardSquareView[];
  position: number;
  labelFor: (type: string) => string;
  tokenLabel: string;
  reduce: boolean;
  onTileHover?: (type: string) => void;
  onSettle?: (type: string) => void;
};

/**
 * The full 3D board scene: a recessed base plate + inner hub frame, the ring of
 * extruded tiles, the player token, layered lighting and soft contact shadows,
 * and a gentle idle camera parallax (disabled under reduced motion).
 */
export function Scene({
  squares,
  position,
  labelFor,
  tokenLabel,
  reduce,
  onTileHover,
  onSettle,
}: SceneProps) {
  const pal = useMemo(() => surfacePalette(), []);
  const points = useMemo(() => ringPoints(squares.length), [squares.length]);

  const settledType = useRef(squares[position]?.type ?? "");
  settledType.current = squares[position]?.type ?? "";

  const baseColor = useMemo(() => new THREE.Color(pal.bg2), [pal.bg2]);
  const hubColor = useMemo(() => new THREE.Color(pal.bg), [pal.bg]);
  const frameColor = useMemo(() => new THREE.Color(pal.bg3), [pal.bg3]);

  return (
    <>
      <IdleCamera reduce={reduce} />

      {/* lighting: warm key + cool rim + soft ambient */}
      <ambientLight intensity={0.55} color={pal.ink} />
      <hemisphereLight args={[pal.ink, pal.bg, 0.4]} />
      <directionalLight
        position={[6, 11, 5]}
        intensity={1.5}
        color={pal.accent2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={1}
        shadow-camera-far={30}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-bias={-0.0006}
      />
      <directionalLight position={[-7, 5, -6]} intensity={0.5} color={pal.accent} />
      <Environment preset="night" />

      {/* board base plate (slightly recessed under the tiles) */}
      <mesh position={[0, -TILE_H / 2 - 0.14, 0]} receiveShadow>
        <boxGeometry args={[RING * 2 + 2, 0.28, RING * 2 + 2]} />
        <meshStandardMaterial color={baseColor} roughness={0.85} metalness={0.1} />
      </mesh>

      {/* inner hub frame ring (visual base for the DOM hub overlay above) */}
      <mesh position={[0, -TILE_H / 2 - 0.02, 0]} receiveShadow>
        <boxGeometry args={[RING * 1.18, 0.18, RING * 1.18]} />
        <meshStandardMaterial color={hubColor} roughness={0.9} metalness={0.05} />
      </mesh>
      <lineSegments position={[0, -TILE_H / 2 + 0.08, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(RING * 1.18, 0.18, RING * 1.18)]} />
        <lineBasicMaterial color={frameColor} />
      </lineSegments>

      {/* the tiles */}
      {squares.map((sq, i) => (
        <Tile
          key={sq.index}
          point={points[i]}
          type={sq.type}
          label={labelFor(sq.type)}
          active={sq.index === position}
          reduce={reduce}
          onHover={onTileHover}
        />
      ))}

      {/* player token */}
      <PlayerToken
        points={points}
        position={position}
        label={tokenLabel}
        reduce={reduce}
        accent={pal.accent}
        paper={pal.paper}
        onSettle={() => onSettle?.(settledType.current)}
      />

      {/* soft grounding shadow under the whole board */}
      <ContactShadows
        position={[0, -TILE_H / 2 - 0.27, 0]}
        opacity={0.55}
        scale={RING * 2.6}
        blur={2.6}
        far={6}
        resolution={512}
        color="#000000"
      />
    </>
  );
}

/** Subtle breathing camera parallax; a no-op under reduced motion. */
function IdleCamera({ reduce }: { reduce: boolean }) {
  const { camera } = useThree();
  const base = useRef<THREE.Vector3 | null>(null);
  if (!base.current) base.current = camera.position.clone();

  useFrame(() => {
    if (reduce || !base.current) {
      camera.lookAt(0, 0, 0);
      return;
    }
    const t = performance.now() * 0.00018;
    camera.position.x = base.current.x + Math.sin(t) * 0.6;
    camera.position.z = base.current.z + Math.cos(t * 0.8) * 0.5;
    camera.lookAt(0, -0.3, 0);
  });

  return null;
}
