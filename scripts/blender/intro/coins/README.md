# Scene three: Lydia's first coins (Blender)

The intro's third era built for real, after the overview frame `coins_a`. A small mint on the clay
island: a stoker on one knee at a raised hearth, gripping a crucible in the coals with tongs; a coiner
seated at a stone anvil, the punch held on the blank and the hammer up; a weigher holding a hand balance
over a bench of blanks and struck coins. The hero money is one lion-head electrum trite on its dark stand
at the intro's money spot (`scenes.HERO`), lit by the spot that stays on when the era goes dark.

- `figures.py`: the three statues at rung 1 of the figure ladder (cloth simulated on each pose, carved
  hair; see `../proofs/`). Poses use a two-bone arm IK (`reach`) and turn each closed hand so a handle
  runs through its curled fingers (`hold`); the grip centre is the mean of the curled fingers' joints, and
  the grip axis is stored on the baked figure so the scene can put the tools in its hands. `--sim 0`
  poses the bare body in seconds, for getting a pose right; `--check 1` renders stand-in tools at the
  grips, including close views of each hand.
- `coin.py`: the trite as a signed distance field between two height fields (a domed obverse plus the
  lion relief, a domed reverse minus the two punch squares), cut by a lumpy oval with a rounded rim, meshed
  by marching cubes and smoothed (Taubin). A `cavity` attribute darkens and roughens the recesses.
- `props.py`: anvil and die, punch, hammer, tongs, raised hearth with charcoal and crucible, stool,
  bench, bowl, blanks, struck coins, hand balance, mudbrick wall. None of these is a historical claim.
- `scene.py`: assembles the scene and renders the overview camera (`--cams wide`) or close checks
  (`strike`, `fist`, `bench`, `hearth`); `--dim 0.025` is the transition frame with only the money lit.

## Run

Needs `bpy` 5.2.3 with numpy, scipy, PyMCubes and Pillow (see `../README.md`), and MakeHuman's CC0
assets from MPFB2 (see `../proofs/README.md`; this scene also uses `caucasian-male-old`).

```sh
export MPFB_DATA=/tmp/mpfb2/src/mpfb/data
# the statues: about a minute and a half of cloth simulation each on four cores
.venv-bpy/bin/python scripts/blender/intro/coins/figures.py --out /tmp/coins/fig --fig coiner,stoker,weigher --check 1
# the coin alone (obverse, reverse, edge)
.venv-bpy/bin/python scripts/blender/intro/coins/coin.py --out /tmp/coins/coin --views obv,rev,edge
# the scene from the overview camera, lit and dimmed
.venv-bpy/bin/python scripts/blender/intro/coins/scene.py --figs /tmp/coins/fig --out /tmp/coins/frames
.venv-bpy/bin/python scripts/blender/intro/coins/scene.py --figs /tmp/coins/fig --out /tmp/coins/frames --dim 0.025
```

## The hand-off from the cave

The cave scene ends with its lion leaping into the gold at the money spot, so this scene opens on the hero
coin there: long axis 0.10 m (the 13 x 11.2 x 5 mm specimen scaled up), obverse leaned back 55 degrees toward
the lens (`scenes.face_cam`), resting on the stand top at `hero_point.z - 0.035`. From the overview camera
at 1280x800 it covers about x 354-495, y 503-609 px.

## Not done yet

- The lion. Its relief must be traced from a public-domain photo of a real lion-head trite (CC0 or
  public domain only); drawn from memory it read as a cartoon crocodile (`../proofs/lion_relief.py`).
  Until then the hero coin is the bare lump with its punch marks, and `coin.py --relief` takes the
  height map once it exists.
- The web file (`public/intro/coins/coins.glb`, merged by material, baked light) and the preview route
  `/intro/coins`.
