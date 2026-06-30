"use client";

import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { ACTIVE_LIFT, HOVER_LIFT, TILE_BEVEL, TILE_D, TILE_H, TILE_W, type TilePoint } from "./geometry";
import { tileStyle } from "./palette";
import { tileFaceTexture } from "./tileTexture";

type TileProps = {
  point: TilePoint;
  type: string;
  label: string;
  active: boolean;
  reduce: boolean;
  onHover?: (type: string) => void;
};

/**
 * One extruded/beveled board tile. The body material is the tinted theme color;
 * the top face carries the canvas "stamp" texture (glyph + label). The active
 * tile lifts and pulses an emissive glow; hover gives a small lift + brighten.
 */
export function Tile({ point, type, label, active, reduce, onHover }: TileProps) {
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  const { color, glyph } = useMemo(() => tileStyle(type), [type]);
  const colorObj = useMemo(() => new THREE.Color(color), [color]);
  const faceTex = useMemo(() => tileFaceTexture(color, glyph, label), [color, glyph, label]);

  // Top face carries the texture; the rest of the box uses the solid tint.
  // Lower roughness on the face lets the bright legend catch the warm key light,
  // so the glyph/label read cleanly at the oblique camera instead of going matte.
  const topMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.42, metalness: 0.1 }),
    [faceTex],
  );
  const sideMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: colorObj, roughness: 0.62, metalness: 0.2 }),
    [colorObj],
  );

  // RoundedBox face/material order: px, nx, py(top), ny, pz, nz
  const materials = useMemo(
    () => [sideMat, sideMat, topMat, sideMat, sideMat, sideMat],
    [sideMat, topMat],
  );

  // Dispose this tile's own material (textures are cache-shared, freed by Board3D).
  useEffect(() => () => {
    topMat.dispose();
    sideMat.dispose();
  }, [topMat, sideMat]);

  const liftRef = useRef(0);
  const glowRef = useRef(0);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const k = reduce ? 1 : Math.min(1, dt * 9);

    const targetLift = active ? ACTIVE_LIFT : hovered ? HOVER_LIFT : 0;
    liftRef.current += (targetLift - liftRef.current) * k;
    g.position.y = liftRef.current;

    const goalGlow = active ? 1 : hovered ? 0.25 : 0;
    glowRef.current += (goalGlow - glowRef.current) * k;
    const pulse = active && !reduce ? 0.6 + 0.4 * Math.sin(performance.now() * 0.004) : 1;
    sideMat.emissive.copy(colorObj);
    sideMat.emissiveIntensity = glowRef.current * 0.7 * pulse;
  });

  return (
    <group
      ref={group}
      position={[point.x, 0, point.z]}
      rotation={[0, point.yaw, 0]}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        onHover?.(type);
      }}
      onPointerOut={() => setHovered(false)}
    >
      <RoundedBox
        args={[TILE_W, TILE_H, TILE_D]}
        radius={TILE_BEVEL}
        smoothness={4}
        castShadow
        receiveShadow
        material={materials}
      />
    </group>
  );
}
