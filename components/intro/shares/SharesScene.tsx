"use client";

import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { PALETTE } from "@/lib/palette";
import { eraLight, sway } from "./sharesMotion";

/**
 * Era five of the intro: the first company shares (the VOC, 1602). On a quay a buyer holds out a purse
 * to a seated bookkeeper writing in the register, a porter carries a chest to a ship, and on the money
 * spot an open coffer of pieces of eight holds Pieter Harmensz's 1606 receipt.
 *
 * Everything is the Blender build (scripts/blender/intro/shares/), baked: each surface but the silver
 * carries its own light, already through the renders' view transform, so it is drawn unlit and
 * untouched by tone mapping. The silver stays a metal, as the intro keeps its money: it reflects
 * silver_env.hdr (the scene itself seen from the top of the coffer, rendered with the bake) and is
 * darkened by its own occlusion, baked into its vertex colours. Parts by name: `world`, `hero` (the receipt) with baked maps, `people` (light in
 * vertex colours), `money` (the silver in the coffer) and `coins` (the silver on the table), the
 * camera `cam_main` and the empty `hero_point` (the receipt's centre, on the intro's money spot).
 *
 * Heavy half: three only loads through this file, behind IntroShares' dynamic import.
 */

export type SharesState = {
  /** Scroll through the scene, 0 → 1. Written by the page every frame. */
  progress: number;
  reduced: boolean;
  onReady: () => void;
};

const URL = "/intro/shares/shares.glb";
const ENV_URL = "/intro/shares/silver_env.hdr";
const DECODERS = "/intro/decoders/";

// Tuned against the build's renders. One object, so dev tools can try values live (window.__shares.look).
const LOOK = {
  env: 0.8, // the reflected scene on the silver (1.0 read whiter than the frames)
  sway: 0.04, // m, sideways at the height of the plateau (0.12 slid the near coins off the receipt)
};

let draco: DRACOLoader | null = null;
let ktx2: KTX2Loader | null = null;

type Parts = ReturnType<typeof prepare>;
// useLoader caches the file for the page's life and prepare() swaps its materials in place, so it runs
// once per file, not once per mount (React's strict mode mounts twice in development).
const prepared = new WeakMap<object, Parts>();

export default function SharesScene({ state }: { state: React.RefObject<SharesState> }) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: 41, near: 0.05, far: 300, position: [0, 1.4, 2] }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl, scene }) => {
        // the bake is already tone mapped and its materials opt out; the silver goes through AgX as in Blender
        gl.toneMapping = THREE.AgXToneMapping;
        gl.toneMappingExposure = 1;
        scene.background = new THREE.Color(PALETTE.bg);
      }}
    >
      <Suspense fallback={null}>
        <Quay state={state} />
      </Suspense>
    </Canvas>
  );
}

function useParts() {
  const gl = useThree((s) => s.gl);
  const gltf = useLoader(GLTFLoader, URL, (loader) => {
    draco ??= new DRACOLoader().setDecoderPath(`${DECODERS}draco/`);
    ktx2 ??= new KTX2Loader().setTranscoderPath(`${DECODERS}basis/`).detectSupport(gl);
    loader.setDRACOLoader(draco);
    loader.setKTX2Loader(ktx2);
  });
  return useMemo(() => {
    let parts = prepared.get(gltf);
    if (!parts) prepared.set(gltf, (parts = prepare(gltf.scene, Math.min(8, gl.capabilities.getMaxAnisotropy()))));
    return parts;
  }, [gltf, gl]);
}

/** Finds the build's parts by name and gives them the page's materials: the baked maps unlit, the
 * silver left as the metal the file carries. */
function prepare(scene: THREE.Group, aniso: number) {
  const mesh = (name: string) => {
    const o = scene.getObjectByName(name);
    if (!(o instanceof THREE.Mesh)) throw new Error(`shares.glb has no mesh named ${name}`);
    return o;
  };
  const unlit = (m: THREE.Mesh) => {
    const old = m.material as THREE.MeshStandardMaterial;
    if (!old.map) throw new Error(`shares.glb's ${m.name} has no map`);
    old.map.anisotropy = aniso;
    const mat = new THREE.MeshBasicMaterial({ map: old.map, toneMapped: false });
    old.dispose();
    m.material = mat;
    return mat;
  };
  const world = unlit(mesh("world"));
  const hero = unlit(mesh("hero"));
  const peopleMesh = mesh("people");
  if (!peopleMesh.geometry.getAttribute("color")) throw new Error("shares.glb's people have no vertex colours");
  (peopleMesh.material as THREE.Material).dispose();
  const people = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  peopleMesh.material = people;
  // the table's coins dim with the quay, the coffer's stay lit: one material each
  const moneyMesh = mesh("money");
  const coinsMesh = mesh("coins");
  const money = moneyMesh.material as THREE.MeshStandardMaterial;
  if (!money.normalMap) throw new Error("shares.glb's silver has no relief map");
  money.normalMap.anisotropy = aniso;
  money.vertexColors = true; // its occlusion
  const coins = money.clone();
  coinsMesh.material = coins;

  scene.updateMatrixWorld(true);
  const camObj = scene.getObjectByName("cam_main");
  const c = camObj instanceof THREE.PerspectiveCamera ? camObj : camObj?.children.find((ch) => ch instanceof THREE.PerspectiveCamera);
  if (!(c instanceof THREE.PerspectiveCamera)) throw new Error("shares.glb has no camera named cam_main");
  const main = {
    pos: c.getWorldPosition(new THREE.Vector3()),
    quat: c.getWorldQuaternion(new THREE.Quaternion()),
    fov: c.fov,
    aspect: c.aspect || 1.6,
  };
  return { scene, mats: { world, hero, people, money, coins }, main };
}

function Quay({ state }: { state: React.RefObject<SharesState> }) {
  const parts = useParts();
  const env = useLoader(HDRLoader, ENV_URL);
  const { camera, size, scene } = useThree();

  useEffect(() => {
    env.mapping = THREE.EquirectangularReflectionMapping;
    for (const m of [parts.mats.money, parts.mats.coins]) {
      m.envMap = env;
      m.envMapIntensity = LOOK.env;
      // rendered in Blender (Z up, the panorama's centre down +X), as the ore's studio: a half turn
      // lines it up here
      m.envMapRotation.set(0, Math.PI, 0);
      m.needsUpdate = true;
    }
    state.current.onReady();
    if (process.env.NODE_ENV !== "production")
      (window as unknown as { __shares: unknown }).__shares = { scene, parts, look: LOOK, THREE };
  }, [env, scene, state, parts]);

  // Keep the Blender frame's width on narrow windows and its height on wide ones.
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const { fov, aspect } = parts.main;
    const a = size.width / Math.max(size.height, 1);
    const half = THREE.MathUtils.degToRad(fov / 2);
    cam.fov = a >= aspect ? fov : THREE.MathUtils.radToDeg(2 * Math.atan((Math.tan(half) * aspect) / a));
    cam.updateProjectionMatrix();
  }, [camera, size, parts]);

  const right = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const p = state.current.progress;
    const { mats, main } = parts;
    // light levels are multiples of what the screen shows; the unlit materials multiply light
    const k = eraLight(p);
    for (const m of [mats.world, mats.people]) m.color.setRGB(k, k, k, THREE.SRGBColorSpace);
    mats.coins.envMapIntensity = LOOK.env * k;
    // the money and the receipt keep their light throughout

    // a slow sideways sway on the plateau, back to the money spot at both ends (none with reduced motion)
    const s = state.current.reduced ? 0 : sway(p);
    right.set(1, 0, 0).applyQuaternion(main.quat);
    right.y = 0;
    right.normalize();
    camera.position.copy(main.pos).addScaledVector(right, LOOK.sway * s);
    camera.quaternion.copy(main.quat);
  });

  return <primitive object={parts.scene} />;
}
