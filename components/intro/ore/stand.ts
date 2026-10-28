import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { NOISE } from "./finish";

/**
 * The stand the ore sits on: a round plinth of dark honed stone, as a museum shows a specimen.
 *
 * Its top is honed, not polished: a soft sheen that catches the spot's pool of light and blurs
 * the gold's reflection rather than mirroring it. The stone's grain is made in the shader from
 * the surface's own position (no texture, so no seams or stretching on the round top): fine
 * flecks, a little mottling, and the honed sheen varying with both.
 *
 * Units are metres; the top is at y = 0, where the ore's foot stands.
 */

const RADIUS = 0.7;
const HEIGHT = 0.4;
const CHAMFER = 0.012; // the top edge's bevel: a crisp arris catches a thin line of light

const LOOK = {
  colour: "#1d1c1a", // dark neutral stone (DESIGN.md: no warm browns)
  fleck: "#4a4845", // its lighter flecks
  rough: 0.42, // honed
  env: 0.5,
  grain: 140, // per metre: flecks a few millimetres across, a few pixels in the opening shot
  cloud: 9, // per metre: the slow mottling
};

/** Side, bevel and top as separate lathes, so each keeps flat normals and the edges stay crisp
 * (one lathe through all three would average its normals round the corners and shade the whole
 * side as a gradient). */
export function standGeometry() {
  const lathe = (a: [number, number], b: [number, number]) =>
    new THREE.LatheGeometry([new THREE.Vector2(...a), new THREE.Vector2(...b)], 160);
  // each runs bottom to top, outwards first: the lathe's faces point outwards only in this order
  return mergeGeometries([
    lathe([RADIUS, -HEIGHT], [RADIUS, -CHAMFER]),
    lathe([RADIUS, -CHAMFER], [RADIUS - CHAMFER, 0]),
    lathe([RADIUS - CHAMFER, 0], [0, 0]),
  ]);
}

export function standMaterial() {
  const material = new THREE.MeshStandardMaterial({
    color: LOOK.colour,
    roughness: LOOK.rough,
    metalness: 0,
    envMapIntensity: LOOK.env,
  });
  const uniforms = {
    uStoneFleck: { value: new THREE.Color(LOOK.fleck) },
    uStoneGrain: { value: LOOK.grain },
    uStoneCloud: { value: LOOK.cloud },
  };
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vStonePos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vStonePos = transformed;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vStonePos;
uniform vec3 uStoneFleck;
uniform float uStoneGrain, uStoneCloud;
${NOISE}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  float stoneGrain = finNoised(vStonePos * uStoneGrain).x;
  float stoneFleck = smoothstep(0.7, 0.8, finNoised(vStonePos * uStoneGrain * 1.7 + 3.1).x);
  float stoneCloud = finNoised(vStonePos * uStoneCloud + 9.0).x;
  diffuseColor.rgb *= 0.86 + 0.16 * stoneGrain + 0.12 * stoneCloud;
  diffuseColor.rgb = mix(diffuseColor.rgb, uStoneFleck, 0.6 * stoneFleck);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
  roughnessFactor = clamp(roughnessFactor + 0.1 * (stoneCloud - 0.5) - 0.08 * stoneFleck, 0.0, 1.0);`,
      );
  };
  material.customProgramCacheKey = () => "stone";
  return material;
}
