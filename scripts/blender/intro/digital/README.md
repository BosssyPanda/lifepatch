# Scene 07: money becomes a number (`digital/`)

A broker's office in August 1971, lit by its own numbers, with today's phone on the money stand in
front of it. Cindy chose the 1971 room over a modern trading floor on 2026-10-28; the overview frame
`digital_a` had flat chart screens, which did not exist in 1971.

What the room is built from, and why it is believable for 1971 (source:
[Stock market data systems](https://en.wikipedia.org/wiki/Stock_market_data_systems)): brokers'
desks had quote units with a keyboard from 1960-61 (Quotron); over 650 brokerage offices had a wall
quote board by 1964; electronic wall tickers came in 1963 (Lectrascan) and over 3,000 Trans-Lux
moving tickers were in use by mid-1969. The board's symbols and prices are invented decoration (three
made-up letters, prices in eighths as US prices were quoted until 2001); nothing on screen claims a
real 1971 quote.

| File | What it does |
| --- | --- |
| `textures.py` | Draws the glowing numbers: the lamp board (a 5 x 7 lamp font defined in the file, every unlit lamp a faint dot), the moving ticker strip, the desk readouts, and the phone's balance screen in the game's own fonts (Anton, IBM Plex Mono from `app/api/og/_fonts`). Ink on near-black only: DESIGN.md amendment G keeps digital money in the ink scale. |
| `trader.py` | One trader per run: the MakeHuman CC0 body in the tailored 1971 suit from `proofs/` (`tailor.py`, `details.py`), posed by a two-bone reach so the hands land on the desk: `--pose phone` (handset at the left ear, the right hand writing), `type`, `lookup` (head raised to the board), `read` (standing, a sheet in both hands). Saves `trader_<pose>.blend` + `.json` (seat height, desk edge). About 3-4 minutes each on 4 cores. |
| `room.py` | The diorama: island, back wall with the board and ticker, nine 1970s desks (drawer pedestals, knee space), swivel chairs, quote units, push-button phones, papers, the traders, the caller's coiled cord, and the hero phone leaning on a wedge on the money stand at `scenes.HERO`. `--views main,dim,wide,floor` renders look-dev frames. |
| `bake.py` | The web file: every surface's light baked (diffuse, direct + indirect) and saved through the frames' AgX view transform, so the page draws it unlit. The room and the hero get maps; the traders get vertex colours (see Traps). The glowing parts keep their own images; cameras `cam_main` and `cam_wide` are exported. About 15 minutes on 4 cores. |

## Run

```sh
# once: bpy, scipy, Pillow in .venv-bpy (see ../README.md) and MakeHuman's assets (see ../proofs/README.md)
export MPFB_DATA=/tmp/mpfb2/src/mpfb/data
.venv-bpy/bin/python -I scripts/blender/intro/digital/textures.py /tmp/digital/tex
for p in phone type lookup read; do
  .venv-bpy/bin/python scripts/blender/intro/digital/trader.py --pose $p --out /tmp/digital/sim
done
.venv-bpy/bin/python scripts/blender/intro/digital/room.py --figs /tmp/digital/sim --tex /tmp/digital/tex \
  --out /tmp/digital/look --views main,dim,wide --res 1280x800 --samples 32
.venv-bpy/bin/python scripts/blender/intro/digital/bake.py --figs /tmp/digital/sim --tex /tmp/digital/tex --out /tmp/digital/web \
  --room 4096 --hero 512 --samples 48 --people_samples 512
```

Compress for the page with [glTF-Transform](https://gltf-transform.dev) 4.5 and KTX-Software 4.4 on
the PATH. Textures first, Draco last (Draco before the textures silently undoes it):

```sh
# the glowing images are flat ink on black: ETC1S holds them small; the baked light needs UASTC
gltf-transform etc1s /tmp/digital/web/digital.glb /tmp/digital/web/1.glb --slots "emissiveTexture" --quality 255
gltf-transform uastc /tmp/digital/web/1.glb /tmp/digital/web/2.glb --slots "baseColorTexture" --level 2 --rdo --zstd 18
gltf-transform draco /tmp/digital/web/2.glb public/intro/digital/digital.glb --method edgebreaker --quantize-color 12
```

`--slots` takes the bare slot name; `"{emissiveTexture}"` matches nothing and compresses nothing, silently.
The traders' light is a vertex colour, which Draco quantizes to 8 bits by default: 8-bit linear
values band in the dark, hence `--quantize-color 12`.

## Traps hit

- A desk collider slid up from below during the cloth simulation caught the trouser legs and dragged
  them up to the hip. The desk stands in place from frame 1: the arms come down onto it from the
  T-pose and the legs swing in under it.
- The head's forward axis had the wrong sign, which put the handset behind the head.
- A phone tilted on a flat stand floats unless it is seated by its lowest corner; it also needs
  something to lean on (the wedge), or it reads as balancing.
- The caller's cord is hidden behind him unless his desk phone stands on his handset side.
- `pkill -f trader.py` inside a shell whose own command line contains `trader.py` kills that shell.
- Baking the decimated traders into a map failed: smart-project cut each figure into thousands of
  islands a few texels wide, which bled into each other and mottled the figures green and black on
  the page. They are baked into their vertices instead (one shading point per vertex, so 512 samples
  and two passes of neighbour smoothing), through the same view transform by way of a float image.
- `bpy.ops.object.join` segfaulted on the decimated figures (bpy 5.2.3); `bake.py` merges through bmesh.
- The glTF exporter exported the vertex colour only when named (`export_vertex_color="NAME"`); with
  `"ACTIVE"` it wrote either nothing or a white `COLOR_0` beside the real one.
- On the page: `prepare()` swaps the file's materials in place, so it must run once per loaded file.
  Run per mount, React's strict mode (development) ran it twice and the second pass found the unlit
  materials it had made and threw.
- glTF's texture v runs down the image (0 is the top row), so the board's "light from the top" reveal
  tests `vUv.y` rising, not falling.
- Light levels on the page (`digitalMotion.ts`) are multiples of what the screen shows; the materials
  multiply light, so they are converted (`setRGB(k, k, k, SRGBColorSpace)`). Multiplying the light
  by 0.025 left the "dark" room at about a fifth of its brightness.
