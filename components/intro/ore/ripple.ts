import * as THREE from "three";

/**
 * The click ripple: a small, quick, damped ring that runs out over the gold from where the ore was
 * clicked, so it reads as metal flexing rather than jelly. The rock and quartz never move (the
 * mesh's `aGold` attribute is 1 on gold, 0 elsewhere).
 *
 * Two parts, as the ore-interaction research tested: the gold's vertices bend out by about 1% of
 * the ore's height, and its shading normals tilt with the ring's slope (after the normal map), so
 * the ring shows in the reflections even where the bend itself is too small to see. Four clicks
 * can run at once; a fifth replaces the oldest.
 *
 * Units are the ore mesh's own: metres, the ore 1.1 m tall.
 */

const SLOTS = 4;
const LIFE = 2.0; // seconds a ring is drawn for; it has faded to nothing well before this

export type Ripple = {
  /** Patch a lit three.js material (the ore's) so it draws the ripple. */
  patch: (material: THREE.MeshStandardMaterial) => void;
  /** Start a ring at a point in the ore mesh's own coordinates. */
  start: (local: THREE.Vector3, now: number) => void;
  /** Advance the clock; call once a frame. */
  tick: (now: number) => void;
};

export function createRipple(normalMatrix: THREE.Matrix3): Ripple {
  const uniforms = {
    uRip: { value: Array.from({ length: SLOTS }, () => new THREE.Vector4(0, 0, 0, -99)) },
    uTime: { value: 0 },
    uSpeed: { value: 0.65 }, // m/s: the ring crosses the ore's face in about half a second
    uWidth: { value: 0.07 }, // m: the ring's band
    uK: { value: 72 }, // waves per metre × 2π: a wavelength of ~9 cm
    uDecay: { value: 0.35 }, // s
    uAmp: { value: 0.011 }, // m: 1% of the ore's height
    uTilt: { value: 0.011 },
    uNormalMat: { value: normalMatrix },
  };
  let next = 0;

  const RIP = /* glsl */ `
uniform vec4 uRip[${SLOTS}];
uniform float uTime, uSpeed, uWidth, uK, uDecay, uAmp, uTilt;
float ripH(vec3 p, out vec3 grad) {
  float h = 0.0; grad = vec3(0.0);
  for (int i = 0; i < ${SLOTS}; i++) {
    float t = uTime - uRip[i].w;
    if (t < 0.0 || t > ${LIFE.toFixed(1)}) continue;
    vec3 dv = p - uRip[i].xyz; float d = length(dv) + 1e-5;
    float x = d - uSpeed * t;
    float w2 = uWidth * uWidth;
    float env = exp(-x * x / w2) * exp(-t / uDecay) * smoothstep(0.0, 0.04, t);
    float s = sin(uK * x), c = cos(uK * x);
    h += s * env;
    grad += env * (uK * c - 2.0 * x / w2 * s) * dv / d;
  }
  return h;
}`;

  return {
    patch(material) {
      material.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, uniforms);
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", `#include <common>\nattribute float aGold;\nvarying float vGold;\nvarying vec3 vObjPos;\n${RIP}`)
          .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
  vObjPos = position; vGold = aGold;
  { vec3 g; float h = ripH(position, g); transformed += objectNormal * h * uAmp * aGold; }`,
          );
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", `#include <common>\nvarying float vGold;\nvarying vec3 vObjPos;\nuniform mat3 uNormalMat;\n${RIP}`)
          .replace(
            "#include <normal_fragment_maps>",
            `#include <normal_fragment_maps>
  if (vGold > 0.001) {
    vec3 g; float h = ripH(vObjPos, g); vec3 gv = uNormalMat * g;
    normal = normalize(normal - uTilt * vGold * (gv - dot(gv, normal) * normal));
  }`,
          );
      };
      material.customProgramCacheKey = () => "ore-ripple";
      material.needsUpdate = true;
    },
    start(local, now) {
      uniforms.uRip.value[next].set(local.x, local.y, local.z, now);
      next = (next + 1) % SLOTS;
    },
    tick(now) {
      uniforms.uTime.value = now;
    },
  };
}
