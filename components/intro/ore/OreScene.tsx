"use client";

import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { PALETTE } from "@/lib/palette";
import {
  MAX_SPIN,
  OPENING_ANGLE,
  TURN_END,
  crackFacing,
  diveAmount,
  easeInOutCubic,
  oreAngle,
  settle,
  smoothstep,
} from "./oreMotion";
import { addFinish } from "./finish";
import { createRipple } from "./ripple";
import { standGeometry, standMaterial } from "./stand";

RectAreaLightUniformsLib.init(); // the cursor's panel light needs its lookup tables before any render

/**
 * Scene one of the intro: the gold ore on its stand.
 *
 * The ore is the Blender build (scripts/blender/intro/ore/), baked to a light mesh with textures:
 * `ore` (gold, rock and quartz), `crack_glow` (a sheet across the crack) and `ore_pick` (an
 * invisible low-poly copy the cursor is hit-tested against). It is lit by the same studio HDR the
 * Blender look-dev renders used, plus a pool of light from above and a soft panel that follows the
 * cursor.
 *
 * Before scrolling, the visitor turns the ore by dragging it. Hovering shines the panel on it and
 * a click sends a small ripple through the gold. Scrolling then takes over: the ore turns the
 * short way until its crack faces the camera, the crack brightens, and the camera dives in.
 *
 * Heavy half: three only loads through this file, behind IntroOre's dynamic import.
 */

export type OreState = {
  /** Scroll through scene one, 0 → 1. Written by the page every frame. */
  progress: number;
  reduced: boolean;
  /** The page's hooks, called from inside the canvas. */
  onReady: () => void;
  onFirstDrag: () => void;
};

const ORE_URL = "/intro/ore/ore.glb";
const ENV_URL = "/intro/env/studio.hdr";
const DECODERS = "/intro/decoders/";

// The opening camera, after the approved overview frame: 60 mm lens on a 36 mm-wide sensor at
// 16:10 (21.2° tall), 3.9 m out, a little to the right and above the ore's middle.
const FOV = 21.2;
const CAM_OUT = 3.9;
const CAM_SIDE = 0.5;
const CAM_AZIMUTH = Math.atan2(CAM_SIDE, CAM_OUT); // the camera's direction round the ore

// Light and glow, tuned on real renders. Three's units: the spot in candela, the panel in nits,
// the crack's glow as a multiple of warm white (#f4f0e6) before tone mapping. One object so the
// dev tools can try values live (window.__ore.look in development).
const LOOK = {
  env: 0.8,
  pool: 60,
  // the hover panel: small and close, so it shines where the cursor is, not on the whole ore
  cursor: 180,
  cursorSize: 0.1, // m, the panel's side
  cursorOut: 0.12, // m in front of the point under the cursor
  // The crack's glow is drawn as the page's own warm white (#f4f0e6), not tone-mapped: a multiple
  // of it here, capped at 1 (the full token, the same white the dive fades to).
  glowRest: 0.2, // while it faces away
  glowFacing: 1.0, // once it faces the camera
  crackLight: 0.15, // candela: warms the crack's walls as it lights
  haloRest: 0.1, // the faint light leaking round the ore's edge from the hidden crack
  haloTurned: 0.28,
};

const DRAG_ACTIVE = 0.01; // scroll progress past which dragging stops: scroll owns the angle
const LIGHT_ACTIVE = TURN_END; // the cursor light and ripple stop once the dive begins

let draco: DRACOLoader | null = null;
let ktx2: KTX2Loader | null = null;

export default function OreScene({ state }: { state: React.RefObject<OreState> }) {
  return (
    <Canvas
      dpr={[1, 2]}
      shadows="percentage"
      camera={{ fov: FOV, near: 0.01, far: 30, position: [CAM_SIDE, 0.7, CAM_OUT] }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.AgXToneMapping;
        gl.toneMappingExposure = 1;
        scene.background = new THREE.Color(PALETTE.bg);
      }}
    >
      <Suspense fallback={null}>
        <OreWorld state={state} />
      </Suspense>
    </Canvas>
  );
}

function useOreParts() {
  const gl = useThree((s) => s.gl);
  const gltf = useLoader(GLTFLoader, ORE_URL, (loader) => {
    draco ??= new DRACOLoader().setDecoderPath(`${DECODERS}draco/`);
    ktx2 ??= new KTX2Loader().setTranscoderPath(`${DECODERS}basis/`).detectSupport(gl);
    loader.setDRACOLoader(draco);
    loader.setKTX2Loader(ktx2);
  });
  return useMemo(() => {
    const find = (name: string) => {
      const o = gltf.scene.getObjectByName(name);
      if (!(o instanceof THREE.Mesh)) throw new Error(`ore.glb has no mesh named ${name}`);
      return o;
    };
    const ore = find("ore");
    const glow = find("crack_glow");
    const pick = find("ore_pick");

    const gold = ore.geometry.getAttribute("_gold");
    if (!gold) throw new Error("ore.glb's ore mesh has no _gold attribute");
    ore.geometry.setAttribute("aGold", gold);

    const mat = ore.material as THREE.MeshStandardMaterial;
    mat.side = THREE.FrontSide;
    const aniso = gl.capabilities.getMaxAnisotropy();
    for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.aoMap]) if (t) t.anisotropy = Math.min(8, aniso);
    ore.castShadow = true;

    const glowMat = new THREE.MeshBasicMaterial({ color: PALETTE.ink, toneMapped: false });
    glow.material = glowMat;
    pick.material = new THREE.MeshBasicMaterial({ visible: false });

    // Measure rather than assume: the ore's size, its foot, and where its crack is.
    const box = new THREE.Box3().setFromObject(ore);
    const crack = new THREE.Box3().setFromObject(glow);
    const centre = box.getCenter(new THREE.Vector3());
    // Spin about the ore's own upright axis, with its foot on the stand's top (y = 0).
    const offset = new THREE.Vector3(-centre.x, -box.min.y - 0.004, -centre.z);
    const height = box.max.y - box.min.y;
    const crackCentre = crack.getCenter(new THREE.Vector3()).add(offset);
    const crackFront = new THREE.Vector3(crackCentre.x, crackCentre.y, box.max.z + offset.z);
    return { ore, oreMat: mat, glowMat, glow, pick, offset, height, radius: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2, crackCentre, crackFront };
  }, [gltf, gl]);
}

function glowTexture() {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  // bright where the ore hides it, falling off fast just past the ore's outline
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.6, "rgba(255,255,255,0.6)");
  r.addColorStop(0.78, "rgba(255,255,255,0.18)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function OreWorld({ state }: { state: React.RefObject<OreState> }) {
  const parts = useOreParts();
  const env = useLoader(HDRLoader, ENV_URL);
  const { scene, camera, gl, clock } = useThree();

  const spin = useRef<THREE.Group>(null);
  const cursor = useRef<THREE.RectAreaLight>(null);
  const crackLight = useRef<THREE.PointLight>(null);
  const halo = useRef<THREE.Sprite>(null);
  const pool = useRef<THREE.SpotLight>(null);

  // Everything the frame loop changes, kept out of React.
  const live = useRef({
    userAngle: OPENING_ANGLE + CAM_AZIMUTH,
    velocity: 0,
    dragging: false,
    lastX: 0,
    lastT: 0,
    moved: 0,
    dragged: false,
    hovering: false,
    hit: new THREE.Vector3(),
    lightPos: new THREE.Vector3(),
    lightAt: new THREE.Vector3(),
    lightK: 0,
  });

  const ripple = useMemo(() => {
    const r = createRipple(parts.ore.normalMatrix);
    r.patch(parts.oreMat);
    addFinish(parts.oreMat, parts.ore.normalMatrix); // after the ripple: it builds on its patch
    return r;
  }, [parts]);
  const haloMap = useMemo(() => glowTexture(), []);
  const stand = useMemo(() => standGeometry(), []);
  const standMat = useMemo(() => standMaterial(), []);
  const poolTarget = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    env.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = env;
    scene.environmentIntensity = LOOK.env;
    // The HDR was rendered in Blender (Z up, the front facing -Y); a half turn lines its key light
    // up with the same side of the ore here.
    scene.environmentRotation.set(0, Math.PI, 0);
    state.current.onReady();
  }, [env, scene, state]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") (window as unknown as { __ore: unknown }).__ore = { scene, parts, look: LOOK, THREE };
  }, [scene, parts]);

  // The opening camera, framed on the measured ore.
  const shot = useMemo(() => {
    const h = parts.height;
    const target = new THREE.Vector3(0, h * 0.47, 0);
    const from = new THREE.Vector3(CAM_SIDE, h * 0.62, CAM_OUT);
    // Where the crack ends up once scroll has turned it to face the camera.
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), CAM_AZIMUTH);
    const front = parts.crackFront.clone().applyQuaternion(q);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    // The dive stops at the crack's mouth, where the slit fills the frame: closer in, the light
    // mesh's facets show, and by then the screen is going white anyway.
    const end = front.clone().addScaledVector(normal, 0.09);
    const through = front.clone().addScaledVector(normal, -1.0);
    return { target, from, end, through };
  }, [parts]);

  // Drag: the move and release are tracked on the window so a drag may leave the ore.
  useEffect(() => {
    const el = gl.domElement;
    const radPerPx = () => 5.9 / Math.max(window.innerHeight, 1);
    const move = (e: PointerEvent) => {
      const L = live.current;
      if (!L.dragging) return;
      const now = performance.now();
      const dx = e.clientX - L.lastX;
      const dt = Math.max((now - L.lastT) / 1000, 1 / 240);
      L.userAngle += dx * radPerPx();
      L.velocity = THREE.MathUtils.lerp(L.velocity, (dx * radPerPx()) / dt, 0.5);
      L.moved += Math.abs(dx);
      L.lastX = e.clientX;
      L.lastT = now;
    };
    const up = () => {
      const L = live.current;
      if (!L.dragging) return;
      L.dragging = false;
      // a hand that stopped before letting go leaves the ore still
      if (performance.now() - L.lastT > 80) L.velocity = 0;
      L.velocity = state.current.reduced ? 0 : THREE.MathUtils.clamp(L.velocity, -MAX_SPIN, MAX_SPIN);
      if (L.moved > 4 && !L.dragged) {
        L.dragged = true;
        state.current.onFirstDrag();
      }
      el.style.cursor = L.hovering ? "grab" : "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [gl, state]);

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (state.current.progress > DRAG_ACTIVE) return;
    e.stopPropagation();
    const L = live.current;
    L.dragging = true;
    L.velocity = 0;
    L.moved = 0;
    L.lastX = e.nativeEvent.clientX;
    L.lastT = performance.now();
    gl.domElement.style.cursor = "grabbing";
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const L = live.current;
    L.hovering = true;
    L.hit.copy(e.point);
    if (!L.dragging) gl.domElement.style.cursor = state.current.progress <= DRAG_ACTIVE ? "grab" : "";
  };
  const onOut = () => {
    const L = live.current;
    L.hovering = false;
    if (!L.dragging) gl.domElement.style.cursor = "";
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    // a drag ends in a click too; only a still press ripples
    if (e.delta > 4 || state.current.reduced || state.current.progress > LIGHT_ACTIVE) return;
    ripple.start(parts.ore.worldToLocal(e.point.clone()), clock.elapsedTime);
  };

  const v = useMemo(() => ({ dir: new THREE.Vector3(), cam: new THREE.Vector3(), look: new THREE.Vector3(), c: new THREE.Vector3() }), []);

  useFrame((_, delta) => {
    const S = state.current;
    const L = live.current;
    const dt = Math.min(delta, 0.05);
    const p = S.progress;
    ripple.tick(clock.elapsedTime);

    // the ore's angle: the user's below the first scroll, then scroll's
    if (p > DRAG_ACTIVE) {
      L.velocity = 0;
      if (L.dragging) {
        L.dragging = false;
        gl.domElement.style.cursor = "";
      }
    } else if (!L.dragging && L.velocity !== 0) {
      L.userAngle += L.velocity * dt;
      L.velocity = settle(L.velocity, dt);
    }
    const angle = oreAngle(L.userAngle, CAM_AZIMUTH, p);
    if (spin.current) spin.current.rotation.y = angle;
    scene.environmentIntensity = LOOK.env;
    if (pool.current) pool.current.intensity = LOOK.pool;

    const turn = easeInOutCubic(p / TURN_END);
    const dive = S.reduced ? 0 : diveAmount(p);
    const facing = crackFacing(angle, CAM_AZIMUTH);

    // the crack: dim at rest, lit as it comes round, blinding as the camera goes in
    const lit = smoothstep(0.2, 1.0, facing) * (0.35 + 0.65 * turn);
    const k = Math.min(1, LOOK.glowRest + (LOOK.glowFacing - LOOK.glowRest) * lit + dive);
    parts.glowMat.color.set(PALETTE.ink).multiplyScalar(k);
    if (crackLight.current) crackLight.current.intensity = LOOK.crackLight * (lit + 4 * dive);

    // the halo sits just behind the ore's middle on the crack's side: the ore hides all of it but
    // the light round its edge
    if (halo.current) {
      v.dir.set(Math.sin(angle), 0, Math.cos(angle));
      halo.current.position.set(0, parts.height * 0.5, 0).addScaledVector(v.dir, 0.08);
      halo.current.material.opacity = (LOOK.haloRest + (LOOK.haloTurned - LOOK.haloRest) * turn) * (1 - dive);
    }

    // the cursor's panel light follows the point under it, eased so it glides
    const want = L.hovering && p <= LIGHT_ACTIVE ? LOOK.cursor : 0;
    L.lightK += (want - L.lightK) * (1 - Math.exp(-dt / (want > L.lightK ? 0.12 : 0.3)));
    if (cursor.current) {
      v.cam.copy(camera.position).sub(L.hit).normalize();
      v.c.copy(L.hit).addScaledVector(v.cam, LOOK.cursorOut);
      const ease = 1 - Math.exp(-dt / 0.06);
      if (L.lightK < 0.01) {
        L.lightPos.copy(v.c);
        L.lightAt.copy(L.hit);
      } else {
        L.lightPos.lerp(v.c, ease);
        L.lightAt.lerp(L.hit, ease);
      }
      cursor.current.position.copy(L.lightPos);
      cursor.current.lookAt(L.lightAt);
      cursor.current.intensity = L.lightK;
      cursor.current.width = cursor.current.height = LOOK.cursorSize;
    }

    // the camera: still until the turn is done, then straight into the crack
    v.cam.lerpVectors(shot.from, shot.end, dive);
    v.look.lerpVectors(shot.target, shot.through, smoothstep(0, 0.5, dive));
    camera.position.copy(v.cam);
    camera.lookAt(v.look);
  });

  return (
    <>
      <group ref={spin}>
        <group position={parts.offset}>
          <primitive object={parts.ore} />
          <primitive object={parts.glow} />
          <primitive
            object={parts.pick}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerOut={onOut}
            onClick={onClick}
          />
        </group>
        <pointLight
          ref={crackLight}
          position={[parts.crackFront.x, parts.crackFront.y, parts.crackFront.z + 0.05]}
          color={PALETTE.ink}
          intensity={0}
          distance={0.8}
          decay={2}
        />
      </group>

      <sprite ref={halo} scale={[parts.radius * 2 * 1.6, parts.height * 1.3, 1]}>
        <spriteMaterial map={haloMap} color={PALETTE.ink} transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={LOOK.haloRest} />
      </sprite>

      {/* lit mostly by the pool from above, so its sides fall away into the dark */}
      <mesh geometry={stand} material={standMat} receiveShadow />

      <primitive object={poolTarget} position={[0, parts.height * 0.45, 0]} />
      <spotLight
        ref={pool}
        target={poolTarget}
        position={[0.5, 4.2, 1.0]}
        intensity={LOOK.pool}
        angle={0.5}
        penumbra={0.85}
        decay={2}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-near={1}
        shadow-camera-far={8}
      />

      <rectAreaLight ref={cursor} width={LOOK.cursorSize} height={LOOK.cursorSize} color="#ffffff" intensity={0} />
    </>
  );
}
