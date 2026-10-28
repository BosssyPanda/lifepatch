# Scene two: the cave (`cave/`)

Stone Age, c. 30,000 BCE, "Debts before money". A hunter shares meat round a fire; nobody hands
anything back; his bow stays untraded against the wall. The gold from scene one stands on a dark
mound in the foreground, at the money spot every era shares, and nobody looks at it.

- `shell.py`: the cave and the mound, sculpted as distance fields with `../ore/sdf.py`. The shell is
  a hollow, so `sdf.mesh` winds it facing into the rock; `scene.cave()` flips it to face the room
  (a bake shades the side a face points to, and the browser culls the back).
- `figures.py`: the five MakeHuman (CC0) statues in cloth-simulated tunics. Run it first; the scene
  loads them from `--cache`.
- `hands.py`, `paintings.py`: the hand-stencil panel, made from the statues' own hands, as a
  grey-scale map projected onto the back wall.
- `scene.py`: puts it together and renders a frame. `--dim 0.025` renders the dark the scene hands
  over in (only the gold lit), `--border x0,y0,x1,y1` a crop of it.
- `bake.py`: bakes the light into two meshes (`cave`, `people`) and exports `cave.glb` with the
  flames, a light hit-test copy (`cave_pick`), the gold's spot, the camera, the two lights that
  fall on the gold and an empty at the middle of each group of paintings.

```sh
MPFB_DATA=... .venv-bpy/bin/python scripts/blender/intro/cave/scene.py --cache /tmp/cave_cache \
    --paint panel.png --out frame.png --res 1280x800 --samples 64
MPFB_DATA=x .venv-bpy/bin/python scripts/blender/intro/cave/bake.py --cache /tmp/cave_cache \
    --paint panel.png --out /tmp/cave_bake --tex 2048 --samples 64
gltf-transform draco /tmp/cave_bake/cave.glb public/intro/cave/cave.glb --method edgebreaker
```

The bake at 2048 px and 64 samples takes about BAKE_TIME on four cores; the page's copy is
GLB_SIZE. Textures are WebP from Blender's exporter (KTX2 needs the KTX-Software binary, which
this setup does not run); Draco comes after.

The page (`components/intro/cave/`, preview at `/intro/cave`) draws the baked meshes unlit, as
their textures, and only scales them: by the fire's flicker near the hearth, by the dark at the
end, and by the visitor's torch (the cursor), which adds albedo times a falloff. The gold is
scene one's `ore.glb` mesh, hung under `gold_spot` at 0.13 m, still lit as PBR by `hero_key`,
`fire_light` and the torch.

## Traps hit

- `kit.dim` only scales Emission Strength values that are not linked. The flame material keeps its
  strength as a plain value and scales the colour instead.
- Cycles shows point-light spheres to the camera: every light gets `visible_camera = False`.
- The volumetric flames make a selected-to-active bake about 13 times slower; `bake.py` hides them
  while baking (`--flames-in-bake` keeps them).
- The statues decimated and unwrapped as one mesh broke into thousands of specks, each a seam.
  They keep their quads and are unwrapped per object, then packed.
- `bpy.ops.object.join` segfaulted joining the hit-test copy; `_pick` builds it with `from_pydata`.
- glTF light intensities come out in candela at 683 lm/W; the page divides by 683 to match Blender.
- The loader caches `cave.glb`, and the page swaps its materials: it works on a clone, or React's
  second development render finds the materials already swapped.
