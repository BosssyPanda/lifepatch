import * as THREE from "three";

/**
 * The ore's surface finish, added to its material's shader on top of the ripple (it reads the
 * ripple's `vGold` and `vObjPos`, so `createRipple(...).patch` must run first).
 *
 * - Close-up grain. The baked textures hold about a millimetre of surface per texel: plenty until
 *   the dive's last stretch, where each texel covers several pixels and the gold turns soft. There
 *   a fine grain, made in the shader from the surface's own position (so it has no seams), fades
 *   in: it breaks the shine up, roughens it a touch and shades the grain's pits. Farther out it
 *   fades away before it is fine enough to shimmer.
 * - Dirt sheen. In Blender the dirt packed into the grooves reflects less than other non-metals
 *   (its specular level is 0.15 against 0.5); glTF cannot carry that, and at full strength it
 *   caught the light as grey flecks. The dirt is the gold's non-metal part, so its reflection is
 *   turned down here to match.
 *
 * Units are the ore mesh's own: metres.
 */

const LOOK = {
  grain: 400, // per metre: the grain is about 2.5 mm across, with a second layer twice as fine
  nearPx: 0.3e-3, // m of surface per pixel at which the grain is at full strength...
  farPx: 0.6e-3, // ...and where it has gone: about where the baked texels start to magnify
  tilt: 0.16, // how far the grain tilts the surface
  rough: 0.12, // roughness added in its pits, taken off its tops
  shade: 0.1, // darkening in its pits
  rockShare: 0.6, // rock and quartz take this much of it
  dirtSpecular: 0.3, // the dirt's reflection against an ordinary non-metal's (Blender: 0.15 / 0.5)
};

/** Value noise and its gradient, in GLSL (also used by the stand's stone, stand.ts). */
export const NOISE = /* glsl */ `
float finHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
// value noise and its gradient (Inigo Quilez's analytic derivatives)
vec4 finNoised(vec3 x) {
  vec3 i = floor(x), w = fract(x);
  vec3 u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * w * w * (w * (w - 2.0) + 1.0);
  float a = finHash(i), b = finHash(i + vec3(1, 0, 0)), c = finHash(i + vec3(0, 1, 0)), d = finHash(i + vec3(1, 1, 0));
  float e = finHash(i + vec3(0, 0, 1)), f = finHash(i + vec3(1, 0, 1)), g = finHash(i + vec3(0, 1, 1)), h = finHash(i + vec3(1, 1, 1));
  float k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + g, k6 = a - b - e + f;
  float k7 = -a + b + c - d + e - f - g + h;
  return vec4(a + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z,
              du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z,
                        k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x,
                        k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y));
}`;

export function addFinish(material: THREE.MeshStandardMaterial, normalMatrix: THREE.Matrix3) {
  const uniforms = {
    uFinNormalMat: { value: normalMatrix },
    uFinGrain: { value: LOOK.grain },
    uFinNear: { value: LOOK.nearPx },
    uFinFar: { value: LOOK.farPx },
    uFinTilt: { value: LOOK.tilt },
    uFinRough: { value: LOOK.rough },
    uFinShade: { value: LOOK.shade },
    uFinRock: { value: LOOK.rockShare },
    uFinDirtSpec: { value: LOOK.dirtSpecular },
  };
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (sh, renderer) => {
    before.call(material, sh, renderer);
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform mat3 uFinNormalMat;
uniform float uFinGrain, uFinNear, uFinFar, uFinTilt, uFinRough, uFinShade, uFinRock, uFinDirtSpec;
${NOISE}`,
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
  float finNear = smoothstep(uFinFar, uFinNear, length(fwidth(vObjPos))) * mix(uFinRock, 1.0, vGold);
  vec3 finGrad = vec3(0.0);
  if (finNear > 0.0) {
    vec4 n1 = finNoised(vObjPos * uFinGrain);
    vec4 n2 = finNoised(vObjPos * uFinGrain * 2.13 + 7.1);
    float pit = 0.5 - (0.65 * n1.x + 0.35 * n2.x);          // > 0 in the grain's hollows
    finGrad = 0.65 * n1.yzw + 0.35 * n2.yzw;
    roughnessFactor = clamp(roughnessFactor + uFinRough * finNear * pit, 0.0, 1.0);
    diffuseColor.rgb *= 1.0 - uFinShade * finNear * max(pit, 0.0) * 2.0;
  }
  float finDirt = vGold * (1.0 - metalnessFactor);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
  if (finNear > 0.0) {
    vec3 fg = uFinNormalMat * finGrad;
    normal = normalize(normal - uFinTilt * finNear * (fg - dot(fg, normal) * normal));
  }`,
      )
      .replace(
        "#include <lights_physical_fragment>",
        `#include <lights_physical_fragment>
  {
    float s = mix(1.0, uFinDirtSpec, finDirt);
    material.specularColor *= s;
    material.specularColorBlended = mix(material.specularColor, diffuseColor.rgb, metalnessFactor);
    material.specularF90 *= s;
  }`,
      );
  };
  material.customProgramCacheKey = () => `${key()}+finish`;
  material.needsUpdate = true;
}
