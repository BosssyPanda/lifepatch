# Buildability proofs for the intro's eras

Quick tests that answer "can this really be built?" before a scene is built for real. Each one
renders in the LEDGER look with the kit in the folder above. Results and verdicts are in the
asset research doc linked from the project thread.

| Script | What it tests | Result (2026-10-27) |
| --- | --- | --- |
| `mh_figure.py` | Loads the CC0 MakeHuman body (MPFB2 assets), builds its 53-bone game-engine rig with MakeHuman's own weights, and poses it by aiming bones | Works; 27k triangles per body |
| `proof_figures.py` | Today's metaball stand-in beside posed MakeHuman bodies: exchange, seated scribe, Atlas under a sphere | Bodies and poses read; robes cut from MakeHuman's fitting helpers look torn |
| `proof_robe.py` | A long robe lofted from slices of the posed body (convex hull per slice, flaring to the hem) | Clean robe for standing poses; not for seated or kneeling ones |
| `proof_decimate.py` | The posed body decimated to 7.3k triangles, rendered beside the full one, exported as GLB | Hard to tell apart at this framing; 24 KB with Draco |
| `export_scenes.py` | Exports each overview scene as one GLB to count triangles and measure the compressed size | 58k to 139k triangles, 0.21 to 0.49 MB with Draco |
| `lion_relief.py` | A Lydian lion's head relief drawn from primitives, with no reference | Fails: reads as a cartoon crocodile; the coin needs a traced reference |

## Run

Needs `bpy` 5.2.3 (see the README in the folder above) and MakeHuman's assets from MPFB2, which are
CC0 (`LICENSE.ASSETS.md` in that repository):

```sh
git clone --depth 1 --filter=blob:none --no-checkout https://github.com/makehumancommunity/mpfb2.git /tmp/mpfb2
cd /tmp/mpfb2 && git checkout HEAD -- src/mpfb/data/3dobjs/base.obj \
  src/mpfb/data/rigs/standard/rig.game_engine.json src/mpfb/data/rigs/standard/weights.game_engine.json \
  src/mpfb/data/targets/macrodetails/caucasian-male-young.target.gz \
  src/mpfb/data/targets/macrodetails/caucasian-female-young.target.gz \
  src/mpfb/data/targets/macrodetails/african-male-young.target.gz \
  src/mpfb/data/targets/macrodetails/asian-male-old.target.gz \
  src/mpfb/data/targets/macrodetails/universal-male-young-maxmuscle-averageweight.target.gz
cd -
export MPFB_DATA=/tmp/mpfb2/src/mpfb/data
.venv-bpy/bin/python scripts/blender/intro/proofs/proof_figures.py --out /tmp/proofs --variant lineup
.venv-bpy/bin/python scripts/blender/intro/proofs/proof_robe.py --out /tmp/proofs
.venv-bpy/bin/python scripts/blender/intro/proofs/export_scenes.py --out /tmp/proofs/glb --scenes cave,coins
npx @gltf-transform/cli draco /tmp/proofs/glb/cave.glb /tmp/proofs/glb/cave_draco.glb
python3 scripts/blender/intro/proofs/lion_relief.py /tmp/proofs/lion_height.png
```

Pose directions in `mh_figure.py` are given in the body's own frame before it is turned into place:
it faces -Y, +X is its left, Z is up.
