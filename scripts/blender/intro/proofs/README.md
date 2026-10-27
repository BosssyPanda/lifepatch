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
| `ladder.py` | The figure quality ladder: standing, seated and kneeling figures built four ways (`--rung 1`-`4`), most ambitious first; `--web 12000` decimates and exports GLB; `--tablet 1` puts a tablet on the scribe's lap | Rung 1 (cloth simulated per pose) is clean in all three poses and about 41 KB per figure at 12k triangles; rungs 2-4 fail seated or kneeling |
| `cloth.py` | Rung 1: T-pose rest, a wide tunic tube with arm holes, belt and shoulder pins cinched in by a shape key, cloth simulated while the rig moves into the pose | About 1 minute of simulation per figure on 4 cores |
| `hair.py` | A hair shell grown off the scalp along a hairline set from each body's head bone, smooth or carved with a cell pattern | Reads as carved short hair |
| `robe_loft.py` | Rung 3: the lofted robe from `proof_robe.py` as a module | |
| `compose_ladder.py` | Lays the ladder renders out as one sheet per view (system Python with Pillow) | |

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
# the figure ladder (rung 1 simulates cloth: about 2 minutes per figure with the render)
for r in 1 2 3 4; do for f in offer scribe atlas; do
  .venv-bpy/bin/python scripts/blender/intro/proofs/ladder.py --out /tmp/proofs/ladder --rung $r --fig $f --views full,side
done; done
python3 scripts/blender/intro/proofs/compose_ladder.py /tmp/proofs/ladder /tmp/proofs/ladder_front.jpg full
```

Pose directions in `mh_figure.py` are given in the body's own frame before it is turned into place:
it faces -Y, +X is its left, Z is up.
