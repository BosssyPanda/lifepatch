"use client";

import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { PALETTE } from "@/lib/palette";
import { addFinish } from "../ore/finish";
import { createRipple } from "../ore/ripple";
import { DIM_START, PULL_END, caveLight, drift, flicker, pullBack, smoothstep } from "./caveMotion";
import { PAINTINGS, PAINTING_REACH } from "./paintings";

/**
 * Scene two of the intro: the cave, c. 30,000 BCE. Five people share meat round a fire under a wall
 * of hand stencils; a lump of gold stands ignored on a rock in the foreground.
 *
 * The cave is the Blender build (scripts/blender/intro/cave/), baked: `cave` (rock, hearth, logs)
 * and `people` (the statues, their food, the bow) each carry one texture that already holds the
 * fire's light and the renders' AgX look, so they are drawn unlit and untoned, only scaled for the
 * flicker and the dark at the end. `cave` also carries its bare colour (as its emissive texture),
 * which the torch's light is multiplied by; the people are plain clay. The flames are drawn here,
 * a glow that is brightest where a tongue is thickest. The gold is scene one's ore itself (ore.glb),
 * stood on `gold_spot`: the one lit, shiny thing in the scene.
 *
 * Scroll opens on scene one's white, pulls back out of the fire to the shot, holds, and ends with
 * the cave dark round its gold. While the shot holds, the cursor carries a torch (the paintings
 * read without it; it only brings them closer), and clicking a group of paintings says one line
 * about it.
 *
 * Heavy half: three only loads through this file, behind IntroCave's dynamic import.
 */

export type CaveState = {
  /** Scroll through scene two, 0 → 1. Written by the page every frame. */
  progress: number;
  reduced: boolean;
  onReady: () => void;
  /** A group of paintings was clicked (its key in PAINTINGS), or the click missed them (null). */
  onPainting: (key: string | null) => void;
};

const CAVE_URL = "/intro/cave/cave.glb";
const ORE_URL = "/intro/ore/ore.glb";
const ENV_URL = "/intro/env/studio.hdr";
const DECODERS = "/intro/decoders/";

/** The gold's height on its rock, as in the Blender scene (scene.nugget): about the coin's size. */
const NUGGET_HEIGHT = 0.13;
/**
 * Blender's glTF exporter turns a light's watts into candela at 683 lm/W; three applies a light's
 * intensity as it is, with no exposure for photometric units. Dividing the 683 back out gives the
 * radiant intensity Blender rendered with, which under the same AgX matches its renders.
 */
const CD_PER_WATT_SR = 683;
/** Clay, the statues' colour (kit.py LOOKS["a"].clay): what the torch lights on the people. */
const CLAY = "#e6e1d5";

// Light and glow, tuned against the Blender renders. One object so the dev tools can try values
// live (window.__cave.look in development).
const LOOK = {
  env: 0.12, // the studio HDR, faint: in the cave the gold should mirror dark, not softboxes
  heroKey: 1, // × the exported spot over the gold (Blender's hero light, kept on in the dark)
  fireOnGold: 1, // × the exported fire light, as it falls on the gold
  flame: 1.15, // the flames' glow, a multiple of warm white
  flickerReach: 1.6, // m: how far from the fire the flicker still shows on the baked light
  pullFrom: [-0.2, 0.2, 0.62], // m from the fire's light: where the camera starts, in the glow
  pullLift: 0.18, // m: the pull-back arcs up over the rock in the foreground
  push: 0.12, // m the camera eases in while the shot holds
  torch: 0.09, // the torch's light on the baked surfaces, at 1 m
  torchOut: 0.35, // m: it is held this far out from the surface under the cursor, towards the eye
  torchOnGold: 0.6, // candela: the torch's light on the gold
};

let draco: DRACOLoader | null = null;
let ktx2: KTX2Loader | null = null;

export default function CaveScene({ state }: { state: React.RefObject<CaveState> }) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: 30, near: 0.02, far: 40 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.AgXToneMapping; // the gold only: the baked parts are not tone mapped
        gl.toneMappingExposure = 1;
        scene.background = new THREE.Color(PALETTE.bg);
      }}
    >
      <Suspense fallback={null}>
        <CaveWorld state={state} />
      </Suspense>
    </Canvas>
  );
}

const BAKED_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const BAKED_FRAG = /* glsl */ `
uniform sampler2D map;
#ifdef HAS_ALBEDO
uniform sampler2D albedoMap;
#else
uniform vec3 uAlbedo;
#endif
uniform float uLight;
uniform float uFlicker;
uniform float uReach;
uniform vec3 uFire;
uniform vec3 uTorch;
uniform float uTorchK;
uniform vec3 uTorchColor;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec3 c = texture2D(map, vUv).rgb;
  float near = exp(-distance(vWorld, uFire) / uReach);
  c *= uLight * mix(1.0, uFlicker, near);
#ifdef HAS_ALBEDO
  vec3 albedo = texture2D(albedoMap, vUv).rgb;
#else
  vec3 albedo = uAlbedo;
#endif
  vec3 L = uTorch - vWorld;
  float d2 = max(dot(L, L), 1e-4);
  float lit = max(dot(normalize(vNormal), L * inversesqrt(d2)), 0.0);
  c += albedo * uTorchColor * (uTorchK * lit / (d2 + 0.03));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const FLAME_VERT = /* glsl */ `
uniform float uTime;
uniform float uHeight;
uniform float uSeed;
varying float vH;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vec3 p = position;
  float h = clamp(p.y / uHeight, 0.0, 1.0);
  // the tongue sways more the higher up it is
  p.x += 0.014 * h * h * sin(uTime * 3.3 + h * 5.0 + uSeed);
  p.z += 0.010 * h * h * sin(uTime * 2.7 + h * 4.0 + uSeed * 1.7);
  vH = h;
  vP = position + vec3(uSeed);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FLAME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGain;
uniform vec3 uColor;
varying float vH;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main() {
  // a volume seen through: brightest where the view crosses most of the tongue, which is where its
  // surface faces the eye; front and back faces both add, as the two walls of the glow
  float body = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
  float fade = 1.0 - smoothstep(0.15, 1.0, vH);
  float lick = noise(vP * 9.0 - vec3(0.0, uTime * 2.4, 0.0));
  float a = body * fade * (0.5 + 0.7 * lick);
  gl_FragColor = vec4(uColor * a * uGain, 1.0);
  #include <colorspace_fragment>
}`;

function useCaveParts() {
  const gl = useThree((s) => s.gl);
  const [cave, oreGltf] = useLoader(GLTFLoader, [CAVE_URL, ORE_URL], (loader) => {
    draco ??= new DRACOLoader().setDecoderPath(`${DECODERS}draco/`);
    ktx2 ??= new KTX2Loader().setTranscoderPath(`${DECODERS}basis/`).detectSupport(gl);
    loader.setDRACOLoader(draco);
    loader.setKTX2Loader(ktx2);
  });
  return useMemo(() => {
    // a copy, because this swaps materials and the loader caches the file: a second run (React's
    // dev double render) must find it as loaded
    const root = cave.scene.clone();
    root.updateMatrixWorld(true);
    cave.scene.updateMatrixWorld(true);
    const find = <T extends THREE.Object3D>(name: string, kind: new (...a: never[]) => T) => {
      const o = root.getObjectByName(name);
      if (!(o instanceof kind)) throw new Error(`cave.glb has no ${kind.name} named ${name}`);
      return o;
    };

    const fireLight = find("fire_light", THREE.PointLight);
    const heroKey = find("hero_key", THREE.SpotLight);
    const fire = fireLight.getWorldPosition(new THREE.Vector3());
    const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());

    // the baked parts: drawn as their textures, scaled for the flicker and the dark, plus the torch
    const uniforms = {
      uLight: { value: 1 },
      uFlicker: { value: 1 },
      uReach: { value: LOOK.flickerReach },
      uFire: { value: fire },
      uTorch: { value: new THREE.Vector3() },
      uTorchK: { value: 0 },
      uTorchColor: { value: new THREE.Color(PALETTE.ink) },
    };
    for (const name of ["cave", "people"]) {
      const mesh: THREE.Mesh = find(name, THREE.Mesh);
      const baked = mesh.material as THREE.MeshStandardMaterial;
      const map = baked.map;
      if (!map) throw new Error(`cave.glb's ${name} has no baked texture`);
      map.anisotropy = aniso;
      const albedo = baked.emissiveMap;
      if (albedo) albedo.anisotropy = aniso;
      mesh.material = new THREE.ShaderMaterial({
        defines: albedo ? { HAS_ALBEDO: "" } : {},
        uniforms: {
          ...uniforms,
          map: { value: map },
          ...(albedo ? { albedoMap: { value: albedo } } : { uAlbedo: { value: new THREE.Color(CLAY) } }),
        },
        vertexShader: BAKED_VERT,
        fragmentShader: BAKED_FRAG,
      });
    }

    // what the cursor is cast against: a light copy of all of it, never drawn
    const pick: THREE.Mesh = find("cave_pick", THREE.Mesh);
    pick.material = new THREE.MeshBasicMaterial({ visible: false });
    pick.removeFromParent();

    // where each group of paintings is
    const paintings = Object.keys(PAINTINGS).map((key) => ({ key, at: find(key, THREE.Object3D).getWorldPosition(new THREE.Vector3()) }));

    // the flames
    const time = { value: 0 };
    const gain = { value: LOOK.flame };
    const color = { value: new THREE.Color(PALETTE.ink) };
    const flames: THREE.Mesh[] = [];
    root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name.startsWith("flame")) flames.push(o);
    });
    flames.forEach((f, i) => {
      f.geometry.computeBoundingBox();
      f.material = new THREE.ShaderMaterial({
        uniforms: { uTime: time, uGain: gain, uColor: color, uHeight: { value: f.geometry.boundingBox!.max.y }, uSeed: { value: i * 1.37 } },
        vertexShader: FLAME_VERT,
        fragmentShader: FLAME_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      f.renderOrder = 1;
    });

    // The gold: scene one's ore, its own copy, measured and stood on its spot at the Blender
    // nugget's height, its foot on the rock, turned as the spot is turned (its crack away).
    const src = oreGltf.scene.getObjectByName("ore");
    if (!(src instanceof THREE.Mesh)) throw new Error("ore.glb has no mesh named ore");
    const gold = src.clone();
    const goldAttr = gold.geometry.getAttribute("_gold");
    if (goldAttr) gold.geometry.setAttribute("aGold", goldAttr);
    const goldMat = (src.material as THREE.MeshStandardMaterial).clone();
    goldMat.side = THREE.FrontSide;
    createRipple(gold.normalMatrix).patch(goldMat); // the finish builds on the ripple's patch
    addFinish(goldMat, gold.normalMatrix);
    gold.material = goldMat;
    gold.geometry.computeBoundingBox();
    const box = gold.geometry.boundingBox!;
    const k = NUGGET_HEIGHT / (box.max.y - box.min.y);
    const centre = box.getCenter(new THREE.Vector3());
    gold.scale.setScalar(k);
    gold.quaternion.identity();
    gold.position.set(-centre.x * k, -box.min.y * k, -centre.z * k);
    find("gold_spot", THREE.Object3D).add(gold);

    // the shot, as Blender framed it, and where the pull-back starts: in the fire's glow
    const cam = cave.cameras[0];
    if (!(cam instanceof THREE.PerspectiveCamera)) throw new Error("cave.glb has no perspective camera");
    const shotPos = cam.getWorldPosition(new THREE.Vector3());
    const shotDir = cam.getWorldDirection(new THREE.Vector3());
    const shotLook = shotPos.clone().addScaledVector(shotDir, 3);
    const startPos = fire.clone().add(new THREE.Vector3(...(LOOK.pullFrom as [number, number, number])));
    const startLook = fire.clone().add(new THREE.Vector3(0, -0.08, 0));

    return {
      root,
      pick,
      paintings,
      uniforms,
      time,
      gain,
      fireLight,
      fireBase: fireLight.intensity / CD_PER_WATT_SR,
      heroKey,
      heroBase: heroKey.intensity / CD_PER_WATT_SR,
      fov: cam.fov,
      shot: { shotPos, shotDir, shotLook, startPos, startLook },
    };
  }, [cave, oreGltf, gl]);
}

/** The torch is the visitor's while the shot holds: not during the pull-back, not in the dark. */
function torchWindow(p: number) {
  return smoothstep(PULL_END * 0.8, PULL_END, p) * (1 - smoothstep(DIM_START - 0.05, DIM_START + 0.05, p));
}

function CaveWorld({ state }: { state: React.RefObject<CaveState> }) {
  const parts = useCaveParts();
  const env = useLoader(HDRLoader, ENV_URL);
  const { scene, camera, clock, gl } = useThree();
  const torchLight = useRef<THREE.PointLight>(null);

  const live = useRef({
    hovering: false,
    hit: new THREE.Vector3(),
    out: new THREE.Vector3(),
    torch: new THREE.Vector3(),
    k: 0,
  });

  useEffect(() => {
    env.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = env;
    scene.environmentIntensity = LOOK.env;
    scene.environmentRotation.set(0, Math.PI, 0);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = parts.fov;
      camera.updateProjectionMatrix();
    }
    state.current.onReady();
  }, [env, scene, camera, parts, state]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") (window as unknown as { __cave: unknown }).__cave = { scene, camera, parts, look: LOOK, THREE };
  }, [scene, camera, parts]);

  const nearestPainting = (p: THREE.Vector3) => {
    let best: string | null = null;
    let d = PAINTING_REACH;
    for (const s of parts.paintings) {
      const e = s.at.distanceTo(p);
      if (e < d) {
        d = e;
        best = s.key;
      }
    }
    return best;
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const L = live.current;
    L.hovering = true;
    L.hit.copy(e.point);
    const active = torchWindow(state.current.progress) > 0.5;
    gl.domElement.style.cursor = active && nearestPainting(e.point) ? "pointer" : "";
  };
  const onOut = () => {
    live.current.hovering = false;
    gl.domElement.style.cursor = "";
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (torchWindow(state.current.progress) <= 0.5) return;
    state.current.onPainting(nearestPainting(e.point));
  };

  const v = useMemo(() => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), toEye: new THREE.Vector3() }), []);

  useFrame((_, delta) => {
    const S = state.current;
    const L = live.current;
    const dt = Math.min(delta, 0.05);
    const p = S.progress;
    const t = clock.elapsedTime;
    const light = caveLight(p);
    const fl = S.reduced ? 1 : flicker(t);

    parts.uniforms.uLight.value = light;
    parts.uniforms.uFlicker.value = fl;
    parts.uniforms.uReach.value = LOOK.flickerReach;
    parts.time.value = S.reduced ? 0 : t;
    parts.gain.value = LOOK.flame * light * fl;
    parts.fireLight.intensity = parts.fireBase * LOOK.fireOnGold * light * fl;
    parts.heroKey.intensity = parts.heroBase * LOOK.heroKey;
    scene.environmentIntensity = LOOK.env;

    // the torch: held out from the surface under the cursor, gliding after it, flickering a little
    v.toEye.copy(camera.position).sub(L.hit).normalize();
    L.out.copy(L.hit).addScaledVector(v.toEye, LOOK.torchOut);
    const want = L.hovering ? torchWindow(p) : 0;
    L.k += (want - L.k) * (1 - Math.exp(-dt / (want > L.k ? 0.15 : 0.4)));
    if (L.k < 0.01) L.torch.copy(L.out);
    else L.torch.lerp(L.out, 1 - Math.exp(-dt / 0.08));
    const tk = L.k * (S.reduced ? 1 : flicker(t * 1.7 + 3.0));
    parts.uniforms.uTorch.value.copy(L.torch);
    parts.uniforms.uTorchK.value = LOOK.torch * tk;
    if (torchLight.current) {
      torchLight.current.position.copy(L.torch);
      torchLight.current.intensity = LOOK.torchOnGold * tk;
    }

    // out of the fire's glow, back over the rock to the shot; then a slow push in
    const { shotPos, shotDir, shotLook, startPos, startLook } = parts.shot;
    const s = S.reduced ? 1 : pullBack(p);
    v.pos.lerpVectors(startPos, shotPos, s);
    v.pos.y += LOOK.pullLift * Math.sin(Math.PI * s);
    v.pos.addScaledVector(shotDir, LOOK.push * drift(p) * (S.reduced ? 0 : 1));
    v.look.lerpVectors(startLook, shotLook, s);
    camera.position.copy(v.pos);
    camera.lookAt(v.look);
  });

  return (
    <>
      <primitive object={parts.root} />
      <primitive object={parts.pick} onPointerMove={onMove} onPointerOut={onOut} onClick={onClick} />
      <pointLight ref={torchLight} color={PALETTE.ink} intensity={0} decay={2} />
    </>
  );
}
