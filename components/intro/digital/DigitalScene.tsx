"use client";

import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { PALETTE } from "@/lib/palette";
import { boardReveal, drift, pull, roomLight, smoothstep, DARK, PULL } from "./digitalMotion";

/**
 * Scene 07 of the intro: money becomes a number. A broker's office in August 1971, lit by its quote
 * board, and today's phone on the money stand in front of it.
 *
 * Everything is the Blender build (scripts/blender/intro/digital/), baked: each surface carries its
 * own light, already through the renders' view transform, so it is drawn unlit and untouched by tone
 * mapping. The parts are found by name: `room`, `people` and `hero` (baked maps), `board`, `ticker`,
 * `readouts` and `hero_screen` (the glowing numbers, from their own images), and the cameras
 * `cam_main` (the plateau) and `cam_wide` (the end of the pull-back).
 *
 * Heavy half: three only loads through this file, behind IntroDigital's dynamic import.
 */

export type DigitalState = {
  /** Scroll through the scene, 0 → 1. Written by the page every frame. */
  progress: number;
  reduced: boolean;
  onReady: () => void;
};

const URL = "/intro/digital/digital.glb";
const DECODERS = "/intro/decoders/";

// Tuned on the build's renders. One object, so dev tools can try values live (window.__digital.look).
const LOOK = {
  board: 1.0, // the board's lamps, as a multiple of their image
  tapeSpeed: 0.012, // the ticker band's crawl, in its image's widths per second
  // the plateau camera creeps toward the board and a little left, which holds the phone near its spot on
  // screen while the room slides behind it (0.35 m forward and 0.22 m right pushed the phone out of frame)
  driftForward: 0.2, // m
  driftSide: -0.08, // m, positive is right
};

const scratch = new THREE.Color();
/** A multiple of what the screen shows, as the multiple of light that gives it. */
const toLinear = (k: number) => scratch.setRGB(k, k, k, THREE.SRGBColorSpace).r;

let draco: DRACOLoader | null = null;
let ktx2: KTX2Loader | null = null;

type Parts = ReturnType<typeof prepare>;
// useLoader caches the file for the page's life and prepare() swaps its materials in place, so it runs
// once per file, not once per mount (React's strict mode mounts twice in development).
const prepared = new WeakMap<object, Parts>();

export default function DigitalScene({ state }: { state: React.RefObject<DigitalState> }) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: 41, near: 0.05, far: 80, position: [0, 1.4, 2] }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.NoToneMapping; // the bake is already tone mapped
        scene.background = new THREE.Color(PALETTE.bg);
      }}
    >
      <Suspense fallback={null}>
        <Room state={state} />
      </Suspense>
    </Canvas>
  );
}

/** A lamp board: its image, lit row by row from the top as `reveal` goes 0 → 1, and slid along by
 * `offset` (the ticker's tape). Drawn as the image's own colours, not tone mapped. */
function lampMaterial(map: THREE.Texture, wrap: boolean) {
  if (wrap) {
    map.wrapS = THREE.RepeatWrapping;
    map.needsUpdate = true;
  }
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, k: { value: 1 }, reveal: { value: 1 }, offset: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float k;
      uniform float reveal;
      uniform float offset;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(map, vec2(vUv.x + offset, vUv.y)).rgb;
        // rows light from the top: a soft edge a few lamps tall runs down the board
        // (glTF's v runs down the image: 0 is its top row)
        float lit = 1.0 - smoothstep(reveal * 1.08 - 0.08, reveal * 1.08, vUv.y);
        gl_FragColor = vec4(c * k * lit, 1.0);
        #include <colorspace_fragment>
      }`,
    toneMapped: false,
  });
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
 * boards the lamp shader. */
function prepare(scene: THREE.Group, aniso: number) {
  const mesh = (name: string) => {
    const o = scene.getObjectByName(name);
    if (!(o instanceof THREE.Mesh)) throw new Error(`digital.glb has no mesh named ${name}`);
    return o;
  };
  const cam = (name: string) => {
    const o = scene.getObjectByName(name);
    const c = o instanceof THREE.PerspectiveCamera ? o : o?.children.find((ch) => ch instanceof THREE.PerspectiveCamera);
    if (!(c instanceof THREE.PerspectiveCamera)) throw new Error(`digital.glb has no camera named ${name}`);
    scene.updateMatrixWorld(true);
    return {
      pos: c.getWorldPosition(new THREE.Vector3()),
      quat: c.getWorldQuaternion(new THREE.Quaternion()),
      fov: c.fov,
      aspect: c.aspect || 1.6,
    };
  };
  const unlit = (m: THREE.Mesh, emissive = false) => {
    const old = m.material as THREE.MeshStandardMaterial;
    const map = emissive ? old.emissiveMap : old.map;
    if (!map) throw new Error(`digital.glb's ${m.name} has no ${emissive ? "emissive " : ""}map`);
    map.anisotropy = aniso;
    const mat = new THREE.MeshBasicMaterial({ map, toneMapped: false });
    old.dispose();
    m.material = mat;
    return mat;
  };
  const room = unlit(mesh("room"));
  // the traders' light is baked into their vertices
  const peopleMesh = mesh("people");
  if (!peopleMesh.geometry.getAttribute("color")) throw new Error("digital.glb's people have no vertex colours");
  (peopleMesh.material as THREE.Material).dispose();
  const people = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  peopleMesh.material = people;
  const hero = unlit(mesh("hero"));
  const screen = unlit(mesh("hero_screen"), true);
  const readouts = unlit(mesh("readouts"), true);
  const boardMesh = mesh("board");
  const tickerMesh = mesh("ticker");
  const boardMap = (boardMesh.material as THREE.MeshStandardMaterial).emissiveMap!;
  const tickerMap = (tickerMesh.material as THREE.MeshStandardMaterial).emissiveMap!;
  boardMap.anisotropy = tickerMap.anisotropy = aniso;
  const board = lampMaterial(boardMap, false);
  const ticker = lampMaterial(tickerMap, true);
  boardMesh.material = board;
  tickerMesh.material = ticker;
  return {
    scene,
    mats: { room, people, hero, screen, readouts, board, ticker },
    main: cam("cam_main"),
    wide: cam("cam_wide"),
  };
}

function Room({ state }: { state: React.RefObject<DigitalState> }) {
  const parts = useParts();
  const { camera, size, scene } = useThree();

  useEffect(() => {
    state.current.onReady();
    if (process.env.NODE_ENV !== "production")
      (window as unknown as { __digital: unknown }).__digital = { scene, parts, look: LOOK, THREE };
  }, [state, scene, parts]);

  // Keep the Blender frame's width on narrow windows and its height on wide ones.
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const { fov, aspect } = parts.main;
    const a = size.width / Math.max(size.height, 1);
    const half = THREE.MathUtils.degToRad(fov / 2);
    cam.fov = a >= aspect ? fov : THREE.MathUtils.radToDeg(2 * Math.atan((Math.tan(half) * aspect) / a));
    cam.updateProjectionMatrix();
  }, [camera, size, parts]);

  const tmp = useMemo(
    () => ({ fwd: new THREE.Vector3(), right: new THREE.Vector3(), pos: new THREE.Vector3(), q: new THREE.Quaternion() }),
    [],
  );

  useFrame(({ clock }) => {
    const p = state.current.progress;
    const reduced = state.current.reduced;
    const { mats, main, wide } = parts;

    // the beats are written as multiples of what the screen shows; the materials multiply light
    const k = roomLight(p);
    for (const m of [mats.room, mats.people, mats.readouts]) m.color.setRGB(k, k, k, THREE.SRGBColorSpace);
    // the board leads the room up, and keeps a little more light than the room when it dims
    const reveal = boardReveal(p);
    const boardK = LOOK.board * (p < PULL[0] ? Math.max(DARK, reveal) : 0.4 + 0.6 * (1 - smoothstep(PULL[0], PULL[0] + 0.08, p)));
    mats.board.uniforms.reveal.value = reveal;
    mats.board.uniforms.k.value = toLinear(boardK);
    mats.ticker.uniforms.reveal.value = 1;
    mats.ticker.uniforms.k.value = toLinear(boardK * smoothstep(0.1, 0.25, reveal));
    if (!reduced) mats.ticker.uniforms.offset.value = (clock.elapsedTime * LOOK.tapeSpeed) % 1;

    // the plateau drift, then the pull-back to the wide camera
    const d = reduced ? 0 : drift(p);
    tmp.fwd.set(0, 0, -1).applyQuaternion(main.quat);
    tmp.fwd.y = 0;
    tmp.fwd.normalize();
    tmp.right.set(-tmp.fwd.z, 0, tmp.fwd.x);
    tmp.pos.copy(main.pos).addScaledVector(tmp.fwd, LOOK.driftForward * d).addScaledVector(tmp.right, LOOK.driftSide * d);
    const t = reduced ? 0 : pull(p); // reduced motion: the room only dims, as the ore skips its dive
    camera.position.lerpVectors(tmp.pos, wide.pos, t);
    tmp.q.copy(main.quat).slerp(wide.quat, t);
    camera.quaternion.copy(tmp.q);
  });

  return <primitive object={parts.scene} />;
}
