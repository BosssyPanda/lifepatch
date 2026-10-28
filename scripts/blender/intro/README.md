# Intro overview frames (Blender)

Scripts that build every scene of the new 3D scroll intro as a rough diorama and render it, so
the overall look can be judged before any scene is built for real. They are the overview's
source of truth: the frames on the overview page come from these files and nothing else.

- `kit.py`: the two candidate looks (LEDGER and Warm), clay and metal materials, clay statue
  figures, props, lights, camera, and the render that lays each frame on its backdrop.
- `scenes.py`: one function per scene (`ore`, `dive_a` to `dive_c`, `cave`, `silver`, `coins`,
  `paper`, `shares`, `goldwars`, `digital`, `atlas`) plus the money objects. Every era puts its
  money at the same spot in the frame (`HERO`), which is what carries the transitions.
- `render_overview.py`: renders scenes in one or both looks.

## Run

Needs Blender's Python module, `bpy` 5.2.3 (Python 3.13). No Blender install or GPU is needed;
it renders with Cycles on the CPU.

```sh
uv venv --python 3.13 .venv-bpy
uv pip install --python .venv-bpy/bin/python bpy==5.2.3 numpy
.venv-bpy/bin/python scripts/blender/intro/render_overview.py --out /tmp/frames --looks a,b --res 1280x800 --samples 32
# the transition frames: the scene in the dark with only its money lit
.venv-bpy/bin/python scripts/blender/intro/render_overview.py --out /tmp/frames --looks a,b --res 1280x800 --samples 32 \
    --dim 0.025 --scenes cave,silver,coins,paper,shares,goldwars,digital
```

A frame takes about a minute at 1280 × 800 and 32 samples on four CPU cores. For quick layout
checks use `--res 640x400 --samples 16` (a few seconds each).

EEVEE needs a display (libEGL), so in a headless container only Cycles works.

## What these are not

Everything here is a stand-in made from code: noise-built ore, metaball figures with mitten
hands, raised-stroke cave paintings, a box-and-loft ship. The real scenes are modelled one by one
after the overview is approved; these scripts only fix layout, camera, light and the money in
each frame.

## Scene one, built for real: the ore (`ore/`)

- `ore/ore.py`: the hero gold ore, a natural gold nugget sculpted from code as a signed distance
  field (`ore/sdf.py`) and meshed by marching cubes: lumps, dents, worn flats, knobs and folds,
  pits, hollows of host rock with broken quartz, and the crack. Its materials (polished highs,
  grimy hollows, dirt in the deepest grooves) read how raised or sunken each point is from vertex
  attributes, so they bake exactly as they render. `--out DIR --hdr public/intro/env/studio.hdr
  [--views front,back,close,crack,vug]` renders look-dev views. It needs scipy and PyMCubes in
  the venv: `uv pip install --python .venv-bpy/bin/python scipy pymcubes`.
- `ore/studio.py`: the softbox HDR the gold reflects, used by Blender and by the page
  (`public/intro/env/studio.hdr`).
- `ore/bake.py`: bakes the ~500k-triangle ore onto a ~54k-triangle copy with colour, ORM and
  normal maps, and exports `ore.glb` (the ore, the glowing sheet in its crack, and a light
  hit-test copy for the cursor). It takes about six minutes. The light copy is simplified evenly:
  sparing the crack's band from it starves the rest into sliver triangles, which shine as streaks.

The page loads a compressed copy (about 5.5 MB). Textures first, then Draco: compressing the
mesh before the textures silently undoes it. All four textures are UASTC: ETC1S, a megabyte
smaller, shares one colour between each 4x4 block of texels, which turned the gold next to the
dark dirt grey (11k gold texels against none) and showed as grey flecks in the grooves. With
[glTF-Transform](https://gltf-transform.dev) 4.5 and KTX-Software 4.4 on the PATH:

```sh
.venv-bpy/bin/python scripts/blender/intro/ore/bake.py --out /tmp/ore
gltf-transform uastc /tmp/ore/ore.glb /tmp/ore/1.glb --slots "{normalTexture,occlusionTexture,metallicRoughnessTexture,baseColorTexture}" --level 2 --rdo --zstd 18
gltf-transform draco /tmp/ore/1.glb public/intro/ore/ore.glb --method edgebreaker
```
