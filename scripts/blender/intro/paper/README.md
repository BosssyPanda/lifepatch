# Scene 04, paper money (Song China, 1023)

Built for real in code, like the ore scene: a Song office front open to the street, where an official in the
winged cap of Song officials presents a new printed note to a depositor across the counter, while a porter
comes along the street with two baskets of strung iron cash on a pole. Heavy money in, light money out. In front,
on the money spot every era shares (`scenes.HERO`), the hero note.

- `figures.py`: the three statues. MakeHuman bodies (CC0) posed in code, robes cloth-simulated (rung 1 of the
  figure ladder in `../proofs/`): a tunic tube with sleeves joined into it, so self-collision covers both, and
  the back edges of its arm holes pinned to the skin so reaching arms do not open a slit behind the armpit. Caps
  are lofted round each head (the official's futou with its long level wings, the depositor's soft cap); the
  porter has a bamboo hat. Each figure takes 1 to 1.5 minutes; run all three at once.
- `hall.py`: platform, columns, bracket sets, a tiled hip-and-gable roof (a height field with tile ridges, round
  tile ends and ridge ends), a back wall with lattice windows whose paper glows, and the counter.
- `props.py`: iron cash (coins with a real square hole, strings with a ridged bump per coin, coils), the
  porter's baskets, a bolt of silk, a stack of notes, an inkstone, a brush, strongboxes, and a pine (used only in
  the note's printed picture).
- `note.py`: the note's face, printed in black ink only (LEDGER keeps paper money ink-scale): a row of coins, a
  picture panel, a key-fret band, an empty column where the amount was written in by hand, and three seals. Its
  docstring gives the source (Li You's description) and what was left out and why.
- `woodcut.py`: the picture on the note, cut like a woodblock from the scene's own hall and people.
- `scene.py`: lays out the scene, lights it, renders `main` (the scene's camera), `overview` (the overview's
  camera, for comparing with `paper_a`), and the dimmed transition frame. It prints checks a frame cannot be
  trusted without: hands at the note, figures not inside the platform or counter.

## Run

Needs `bpy` 5.2.3 (see `../README.md`) and MakeHuman's assets from MPFB2 (CC0): as in `../proofs/README.md`,
plus these targets:

```sh
cd /tmp/mpfb2 && git checkout HEAD -- src/mpfb/data/targets/macrodetails/asian-male-young.target.gz \
  src/mpfb/data/targets/macrodetails/asian-male-old.target.gz \
  src/mpfb/data/targets/macrodetails/universal-male-young-maxmuscle-minweight.target.gz && cd -
export MPFB_DATA=/tmp/mpfb2/src/mpfb/data
P=scripts/blender/intro/paper
for f in official depositor porter; do .venv-bpy/bin/python $P/figures.py --out /tmp/paper/figs --fig $f & done; wait
.venv-bpy/bin/python $P/woodcut.py --figs /tmp/paper/figs --out /tmp/paper/woodcut.png
.venv-bpy/bin/python $P/note.py --out /tmp/paper/note.png --picture /tmp/paper/woodcut.png
.venv-bpy/bin/python $P/scene.py --figs /tmp/paper/figs --note /tmp/paper/note.png --out /tmp/paper/frames \
    --res 1280x800 --samples 32 --views main,overview
.venv-bpy/bin/python $P/scene.py --figs /tmp/paper/figs --note /tmp/paper/note.png --out /tmp/paper/frames \
    --res 1280x800 --samples 32 --views main --dim 0.025
```

A frame takes about 40 to 55 seconds at 1280 × 800 and 32 samples on four CPU cores.

## Pitfalls met

- Appended figures keep a stale `matrix_world` until the view layer updates: update before reading or moving
  them, or they lose their lift off the floor.
- Shoes are skinned round the feet and reach 2.5 cm below the soles: `scene.place` stands each figure on its
  lowest point, shoes included.
- A note held flat at hand height is edge-on to a camera at eye height, and vanishes: it is presented upright.
- The money spot covers the lower left of the frame: the handover and the porter are kept right of it.
- Signature marks drawn as monograms read as Latin and Greek letters ("2l", "Φ"); they were dropped.
