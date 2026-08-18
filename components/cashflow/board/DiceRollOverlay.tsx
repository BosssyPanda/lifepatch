"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { PALETTE, CANVAS } from "@/lib/palette";
import { CuboidCollider, Physics, type RapierRigidBody, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useSkippable } from "@/src/motion/useSkippable";

/**
 * Full-screen physics dice roll (Addendum §13 #10) — the one live-R3F moment.
 * Written justification (brief §2): the roll happens every turn with a
 * different engine-decided outcome; 21 value combinations × continuous physics
 * states cannot be pre-rendered at sane size or latency, so this is the narrow
 * case pre-render cannot cover. The whole three/R3F/Rapier stack loads lazily
 * behind a dynamic import on the board screen only.
 *
 * THE ENGINE'S NUMBERS ARE LAW: real Rapier simulation for the tumble, then a
 * short kinematic correction slerps each die onto the rolled face — physics
 * performs the result, never decides it. Any input skips straight to the
 * settled result (useSkippable). Reduced motion never mounts this component
 * (gated by the caller).
 */

const BG2 = PALETTE.bg2;
const INK = PALETTE.ink;
const HAIRLINE = CANVAS.hairline;
const LOSS = PALETTE.loss;
const BG = PALETTE.bg;

// pip layouts on a 3×3 grid (mirrors the 2D Dice.tsx convention)
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
};

// BoxGeometry material order: +x, -x, +y, -y, +z, -z — opposite faces sum to 7
const FACE_VALUES = [3, 4, 1, 6, 5, 2] as const;
// local normal that shows `value` when pointing world-up
const VALUE_NORMAL: Record<number, THREE.Vector3> = {
  3: new THREE.Vector3(1, 0, 0),
  4: new THREE.Vector3(-1, 0, 0),
  1: new THREE.Vector3(0, 1, 0),
  6: new THREE.Vector3(0, -1, 0),
  5: new THREE.Vector3(0, 0, 1),
  2: new THREE.Vector3(0, 0, -1),
};

const UP = new THREE.Vector3(0, 1, 0);

/** Quaternions putting `value` face-up — 4 yaw variants to pick the nearest. */
function targetQuats(value: number): THREE.Quaternion[] {
  const align = new THREE.Quaternion().setFromUnitVectors(VALUE_NORMAL[value], UP);
  return [0, 1, 2, 3].map((k) => {
    const yaw = new THREE.Quaternion().setFromAxisAngle(UP, (k * Math.PI) / 2);
    return yaw.multiply(align.clone());
  });
}

function faceTexture(value: number): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, S - 3, S - 3);
  ctx.fillStyle = value === 1 ? LOSS : BG;
  const cell = S / 4.2;
  const origin = S / 2 - cell;
  for (const [col, row] of PIPS[value]) {
    ctx.beginPath();
    ctx.arc(origin + col * cell, origin + row * cell, S * 0.075, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

type Phase = "sim" | "correct" | "rest";

function Die({
  value,
  index,
  count,
  phaseRef,
  correctStart,
  registry,
}: {
  value: number;
  index: number;
  count: number;
  phaseRef: React.MutableRefObject<Phase>;
  correctStart: React.MutableRefObject<number>;
  registry: React.MutableRefObject<Set<RapierRigidBody>>;
}) {
  const body = useRef<RapierRigidBody>(null);
  const fromQuat = useRef(new THREE.Quaternion());
  const toQuat = useRef(new THREE.Quaternion());
  const fromPos = useRef(new THREE.Vector3());
  const captured = useRef(false);

  // Six canvas textures + six materials per die, per roll. Nothing disposed them, so
  // every roll leaked 12 textures and 12 materials into the GPU for the life of the
  // session. They are released on unmount, which is the end of each roll since the
  // overlay unmounts.
  const materials = useMemo(
    () =>
      FACE_VALUES.map(
        (v) =>
          new THREE.MeshStandardMaterial({
            map: faceTexture(v),
            roughness: 0.82,
            metalness: 0.05,
          }),
      ),
    [],
  );
  useEffect(
    () => () => {
      for (const m of materials) {
        m.map?.dispose();
        m.dispose();
      }
    },
    [materials],
  );

  const spawn = useMemo(() => {
    const spread = count > 1 ? (index === 0 ? -1.1 : 1.1) : 0;
    return {
      pos: [spread + (Math.random() - 0.5) * 0.4, 2.6 + index * 0.7, (Math.random() - 0.5) * 0.6] as [number, number, number],
      rot: [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI] as [number, number, number],
      linvel: [(Math.random() - 0.5) * 3, -4, (Math.random() - 0.5) * 3] as [number, number, number],
      angvel: [(Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22] as [number, number, number],
    };
  }, [index, count]);

  useEffect(() => {
    const rb = body.current;
    const reg = registry.current;
    if (!rb) return;
    reg.add(rb);
    rb.setLinvel({ x: spawn.linvel[0], y: spawn.linvel[1], z: spawn.linvel[2] }, true);
    rb.setAngvel({ x: spawn.angvel[0], y: spawn.angvel[1], z: spawn.angvel[2] }, true);
    return () => {
      reg.delete(rb);
    };
  }, [spawn, registry]);

  useFrame((state) => {
    const rb = body.current;
    if (!rb) return;
    const phase = phaseRef.current;
    if (phase === "sim") return;

    if (!captured.current) {
      captured.current = true;
      const q = rb.rotation();
      fromQuat.current.set(q.x, q.y, q.z, q.w);
      const p = rb.translation();
      fromPos.current.set(p.x, p.y, p.z);
      // nearest of the 4 face-up orientations → smallest visible correction
      let best = targetQuats(value)[0];
      let bestAngle = Infinity;
      for (const cand of targetQuats(value)) {
        const a = fromQuat.current.angleTo(cand);
        if (a < bestAngle) {
          bestAngle = a;
          best = cand;
        }
      }
      toQuat.current.copy(best);
      rb.setBodyType(2, true); // kinematicPosition — physics hands over to choreography
    }

    const t = Math.min(1, (state.clock.elapsedTime - correctStart.current) / 0.24);
    const ease = phase === "rest" ? 1 : 1 - Math.pow(1 - t, 3);
    const q = fromQuat.current.clone().slerp(toQuat.current, ease);
    const restX = count > 1 ? (index === 0 ? -1.05 : 1.05) : 0;
    rb.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    rb.setNextKinematicTranslation({
      x: THREE.MathUtils.lerp(fromPos.current.x, restX, ease),
      y: THREE.MathUtils.lerp(fromPos.current.y, 0.5, ease),
      z: THREE.MathUtils.lerp(fromPos.current.z, 0, ease),
    });
  });

  return (
    <RigidBody ref={body} colliders="cuboid" position={spawn.pos} rotation={spawn.rot} restitution={0.35} friction={0.9}>
      <mesh material={materials}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
    </RigidBody>
  );
}

/** Watches the simulation and advances the phase machine. */
function Director({
  phaseRef,
  correctStart,
  registry,
  onRest,
}: {
  phaseRef: React.MutableRefObject<Phase>;
  correctStart: React.MutableRefObject<number>;
  registry: React.MutableRefObject<Set<RapierRigidBody>>;
  onRest: () => void;
}) {
  const restFired = useRef(false);

  const settled = () => {
    if (registry.current.size === 0) return false;
    for (const rb of registry.current) {
      const lv = rb.linvel();
      const av = rb.angvel();
      if (Math.hypot(lv.x, lv.y, lv.z) > 0.35 || Math.hypot(av.x, av.y, av.z) > 0.6) return false;
    }
    return true;
  };

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (phaseRef.current === "sim" && ((t > 0.5 && settled()) || t > 1.35)) {
      phaseRef.current = "correct";
      correctStart.current = t;
    }
    if (phaseRef.current === "correct" && t - correctStart.current > 0.26) {
      phaseRef.current = "rest";
      if (!restFired.current) {
        restFired.current = true;
        onRest();
      }
    }
  });
  return null;
}

export default function DiceRollOverlay({ values, onDone }: { values: number[]; onDone: () => void }) {
  const phaseRef = useRef<Phase>("sim");
  const correctStart = useRef(0);
  const registry = useRef<Set<RapierRigidBody>>(new Set());
  const [stamped, setStamped] = useState(false);
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  };

  // rest → stamp the total → brief hold → hand control back to the game
  const handleRest = () => {
    setStamped(true);
    window.setTimeout(finish, 520);
  };

  // any input skips the choreography and lands the result instantly
  useSkippable(!stamped, () => {
    phaseRef.current = "rest";
    setStamped(true);
    window.setTimeout(finish, 140);
  });

  // safety: never trap the game behind the overlay
  useEffect(() => {
    const cap = window.setTimeout(finish, 3200);
    return () => window.clearTimeout(cap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = values.reduce((a, b) => a + b, 0);

  return (
    // Announced as a dialog, but deliberately no focus trap: it holds no controls, it is
    // self-dismissing, and trapping focus in a 3-second animation would strand a keyboard user.
    <div
      role="dialog"
      aria-label="Rolling the dice"
      className="fixed inset-0 z-[95] flex items-center justify-center"
      style={{ backgroundColor: "rgba(14,14,12,0.9)" }}
    >
      <div className="relative h-full max-h-[560px] w-full max-w-[720px]">
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [0, 6.4, 5.2], fov: 42 }}
          onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
          gl={{ antialias: true, alpha: true }}
        >
          <ambientLight intensity={0.85} />
          <directionalLight position={[-4, 7, 3]} intensity={1.6} />
          <Physics gravity={[0, -14, 0]}>
            {/* stage floor — the flat ledger slab */}
            <RigidBody type="fixed">
              <mesh position={[0, -0.05, 0]}>
                <boxGeometry args={[10, 0.1, 10]} />
                <meshStandardMaterial color={BG2} roughness={0.95} />
              </mesh>
            </RigidBody>
            {/* containment walls (invisible colliders) — tight so dice stay center-frame at 390px */}
            <CuboidCollider position={[0, 2, -1.9]} args={[4, 4, 0.2]} />
            <CuboidCollider position={[0, 2, 1.9]} args={[4, 4, 0.2]} />
            <CuboidCollider position={[-2.3, 2, 0]} args={[0.2, 4, 4]} />
            <CuboidCollider position={[2.3, 2, 0]} args={[0.2, 4, 4]} />

            {values.map((v, i) => (
              <Die
                key={i}
                value={v}
                index={i}
                count={values.length}
                phaseRef={phaseRef}
                correctStart={correctStart}
                registry={registry}
              />
            ))}
            <Director phaseRef={phaseRef} correctStart={correctStart} registry={registry} onRest={handleRest} />
          </Physics>
        </Canvas>

        {/* hairline double rule — the board slab frame language */}
        <div aria-hidden className="pointer-events-none absolute inset-0 border border-hairline" />
        <div aria-hidden className="pointer-events-none absolute inset-3 border border-hairline" />

        {/* result stamp */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-7 flex justify-center"
          style={{ opacity: stamped ? 1 : 0, transition: "opacity 160ms linear" }}
        >
          <span className="num border border-ink bg-bg px-4 py-2 text-xl text-ink" style={{ letterSpacing: "0.18em" }}>
            {values.join(" + ")}{values.length > 1 ? ` = ${total}` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
