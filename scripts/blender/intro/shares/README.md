# Era five, c. 1602: the first company shares (`shares/`)

The scene: on a quay, a buyer hands silver across a writing table to a bookkeeper of the Dutch East
India Company (VOC), who enters him in the company's register. A porter carries a chest of silver
toward the cargo, and a full-size merchant ship lies across the harbour. At the intro's fixed money
spot (`scenes.HERO`) stands a strongbox of Spanish pieces of eight on a barrel head, with the oldest
known VOC share document propped against its open lid.

Everything is built from code or from CC0 MakeHuman assets; nothing is downloaded at render time.

| File | What it builds |
| --- | --- |
| `figures.py` | The three statues, simulated once each with the tailored-clothes recipe from `../proofs` (doublet and knee breeches cut from MakeHuman's tights helper) and saved as `.blend`: the bookkeeper seated writing, the buyer holding out silver, the porter walking with a chest. Adds a capotain that sits down on the head and empties marking hands, seat and head |
| `ship.py` | A Dutch merchant ship of about 1600 at full size: hull surface with tumblehome and planking, wales, gunports, flat stern with windows, quarter galleries and lanterns, beakhead, three masts with tops, square sails, a lateen yard, shrouds with ratlines, stays, a banded ensign and pennant. Not a model of a named ship |
| `props.py` | The strongbox, cobs of eight reales (cross of Jerusalem with castles and lions, clipped flan), the coin heap, the hand-written receipt and register pages (strokes drawn with a broad quill nib that read as handwriting without forming letters), the trestle table, stool, register, inkwell, quill, barrels, mooring posts, rope and the quay |
| `shares.py` | Composes the scene, sets the camera from the money spot, lights it and renders `main`, `dim` (the transition frame), `close`, `table` and `wide` views |
| `bake.py` | The web file `public/intro/shares/shares.glb`: every surface's light baked (diffuse, direct + indirect) and saved through the frames' AgX view transform, so the page draws it unlit. The quay, ship and props share one map, the receipt has its own, the figures carry theirs in vertex colours. The silver stays metal: each cob becomes a 256-triangle copy with its relief in a normal atlas, darkened by baked occlusion, reflecting `silver_env.hdr` (the scene seen from the top of the coffer, rendered in the same run). Exports `cam_main` and the empty `hero_point` |

## Run

Set up `bpy` and MakeHuman's assets as in `../README.md` and `../proofs/README.md` (the figures also need
every file in `targets/macrodetails/`), then:

```sh
export MPFB_DATA=/tmp/mpfb2/src/mpfb/data
for f in bookkeeper buyer porter; do
  .venv-bpy/bin/python scripts/blender/intro/shares/figures.py --out /tmp/shares/figs --fig $f   # ~7 min each
done
.venv-bpy/bin/python scripts/blender/intro/shares/shares.py --figs /tmp/shares/figs --out /tmp/shares/r \
    --views main,dim,close --res 1280x800 --samples 64
```

The web file (about 25 minutes on 4 cores), then compression with [glTF-Transform](https://gltf-transform.dev)
4.5 (textures first, Draco last; Draco before the textures silently undoes it). The vertex colours carry
the figures' light, so Draco keeps 12 bits of them (8 bits band in the dark):

```sh
.venv-bpy/bin/python scripts/blender/intro/shares/bake.py --figs /tmp/shares/figs --out /tmp/shares/web \
    --world 4096 --hero 1024 --samples 64 --people_samples 384
gltf-transform webp /tmp/shares/web/shares.glb /tmp/shares/web/1.glb --slots "baseColorTexture" --quality 92
gltf-transform draco /tmp/shares/web/1.glb public/intro/shares/shares.glb --method edgebreaker --quantize-color 12
cp /tmp/shares/web/silver_env.hdr public/intro/shares/
```

The other scenes' maps are KTX2 (`gltf-transform uastc`, which needs KTX-Software's `toktx`); this one is
WebP only because `toktx` could not be run in the container that built it. Swap the first step for the
`uastc` line in `../README.md` where `toktx` is available: the page reads either.

`SHIP_YAW`, `SHIP_X` and `SHIP_Y` (environment) move the ship; the defaults are the reviewed framing.
`props.py` needs Pillow and SciPy in the venv (`uv pip install --python .venv-bpy/bin/python pillow scipy`).

## Facts the scene relies on

- The VOC issued no share certificates; it kept its shareholders in its own ledgers. The oldest known
  share document is a note of remittance: Pieter Harmensz bought a share of the Enkhuizen chamber in 1602
  (face value 150 guilders, paid in instalments) and made the last payment on 9 September 1606
  ([Westfries Archief](https://westfriesarchief.nl/historie/thema-s/geld-en-handel/the-oldest-share)).
  A caption must call the 1606 paper a receipt, not a share certificate.
- In Amsterdam people registered for shares at the house of the director Dirck van Os
  ([The Low Countries](https://www.the-low-countries.com/article/dirk-van-os-antwerp-native-in-the-dutch-east-india-company/)).
  The quay is the scene's setting so the ship can share the frame; no caption should say where shares
  were bought.
- Spanish eight reales of the period were hammered cobs with the cross of Jerusalem, lions and castles on
  one side ([Numista 14999](https://en.numista.com/14999)); the VOC shipped the Spanish coin to Asia in
  large quantities ([Netherlands Indies guilder](https://en.wikipedia.org/wiki/Netherlands_Indies_guilder)).
  Whether subscribers paid for shares in reales is not checked, so no caption says so.
