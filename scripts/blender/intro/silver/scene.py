"""The silver era of the intro, built for real: Kanesh (Kultepe), 20th to 19th century BCE.

The scene is the loan the narration tells (The Met 66.245.17a-b): in his house in the merchants' quarter,
Ashur-idi weighs out silver on a hand balance against hematite weights, two men take it as a loan, and a
scribe writes the tablet that the witnesses will seal into a clay envelope. Behind them: the archive
(tablets packed in jars and in a reed basket), bales of cloth from the caravan, mudbrick walls on stone
footings with timber beams, a doorway onto the bright courtyard.

The era's money sits at the intro's fixed money spot (scenes.HERO): pieces of silver beside the sealed
loan envelope, on the dark pedestal every era's money stands on.

    python scripts/blender/intro/silver/scene.py --figs DIR --out DIR [--looks a] [--views main,dim,hero]
                                                 [--res 1280x800] [--samples 64]

--figs is where figure.py saved the four statues (merchant, scribe, borrower1, borrower2).
"""
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
INTRO = os.path.dirname(HERE)
sys.path[:0] = [HERE, INTRO]

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import kit  # noqa: E402
import props  # noqa: E402
import scenes  # noqa: E402
from kit import mat  # noqa: E402

FIG_CACHE = None

# where each statue stands and which way it faces (a direction on the floor); statues face -Y before turning
PLACES = {
    "merchant": dict(at=(0.32, 1.62), face=(0.28, -1.0)),
    "scribe": dict(at=(-1.08, 1.12), face=(0.55, -1.0)),
    "borrower1": dict(at=(1.05, 0.66), face=(-0.6, 0.62)),
    "borrower2": dict(at=(2.0, 0.88), face=(-1.0, 0.28)),
}
CAM = dict(loc=(-1.0, -2.5, 1.1), target=(0.3, 1.4, 0.8), lens=34)


def _yaw(face):
    return math.atan2(face[0], -face[1])


def _xf(name):
    p = PLACES[name]
    return Matrix.Translation((p["at"][0], p["at"][1], 0.0)) @ Matrix.Rotation(_yaw(p["face"]), 4, "Z")


def statue(name):
    """Append a baked statue and stand it in place. Returns its hand landmarks in world space."""
    path = os.path.join(FIG_CACHE, f"{name}.blend")
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = list(src.objects)
    m = _xf(name)
    for ob in dst.objects:
        bpy.context.scene.collection.objects.link(ob)
        ob.matrix_basis = m @ ob.matrix_basis
        if ob.type == "MESH":
            ob.data.materials.clear()
            ob.data.materials.append(mat("clay"))
        elif ob.type == "CURVE":
            ob.data.materials.clear()
            ob.data.materials.append(mat("clay"))
    with open(os.path.join(FIG_CACHE, f"{name}.json")) as f:
        marks = json.load(f)
    out = {}
    r = m.to_3x3()
    for k, v in marks.items():
        if k.startswith(("palm_n", "along", "across")):
            out[k] = r @ Vector(v)
        elif isinstance(v, list):
            out[k] = m @ Vector(v)
        else:
            out[k] = v
    return out


def room():
    kit.island(radius=4.6, depth=0.7, seed=12)
    # back wall with the doorway onto the courtyard; left wall with the archive
    props.wall("wallB", (-2.2, 2.75), (3.9, 2.75), 2.5, door=(3.05, 1.0, 1.9), beam_z=1.55, seed=1)
    props.wall("wallL", (-1.95, -0.4), (-2.2, 2.95), 2.5, beam_z=1.55, seed=2)
    # the courtyard beyond the door: a bright floor and the far wall, lit by daylight
    kit.box("yard", (2.6, 2.4, 0.05), loc=(0.85, 4.15, -0.02), material=mat("clay_dim"))
    kit.box("yard_wall", (2.6, 0.3, 2.2), loc=(0.85, 5.1, 1.1), material=mat("clay_dim"))


def archive():
    """The archive, in the corner behind the scribe: storage jars with tablets packed in their mouths and
    a reed basket of tablets."""
    obs = []
    for i, (x, y, h, r) in enumerate(((-1.72, 2.3, 0.62, 0.22), (-1.62, 1.78, 0.55, 0.2), (-1.55, 0.55, 0.5, 0.19))):
        j = props.jar(f"jar{i}", (x, y, 0.0), h=h, r=r, neck=0.62, seed=i)
        obs.append(j)
        if i != 1:
            props.tablets_in(f"jar{i}_t", j, n=5 + i, seed=10 * i)
    bx, by = -0.5, 2.3
    props.basket("basket", (bx, by, 0.0), r=0.2, h=0.2)
    for k in range(7):
        props.tablet(f"basket_t{k}", loc=(bx + (k % 4 - 1.5) * 0.06, by + (k // 4 - 0.5) * 0.08, 0.14 + (k // 4) * 0.03),
                     rot=(0.5 + 0.2 * k, 0.3 * (k % 3), 0.7 * k), seed=k + 20)
    return obs


def goods():
    """Bales of cloth from the caravan by the door, waiting to be opened."""
    props.bale("bale0", (2.55, 2.3, 0.0), size=(0.62, 0.44, 0.34), rot_z=0.15, seed=1)
    props.bale("bale1", (2.5, 2.32, 0.34), size=(0.58, 0.42, 0.3), rot_z=-0.05, seed=2)
    props.bale("bale2", (2.8, 1.75, 0.0), size=(0.6, 0.42, 0.34), rot_z=0.9, seed=3)


def the_loan(marks):
    """The merchant's table, the balance in his hand, the silver being weighed, the scribe's tablet."""
    mp = PLACES["merchant"]
    yaw = _yaw(mp["face"])
    fwd = Vector((math.sin(yaw), -math.cos(yaw), 0))
    left = Vector((math.cos(yaw), math.sin(yaw), 0))     # the merchant's own left
    t_c = Vector((*mp["at"], 0)) + fwd * 0.55
    tb = props.table("table", (t_c.x, t_c.y, 0.0), size=(1.3, 0.72, 0.74), rot_z=yaw)
    top = tb["top"]
    m = marks["merchant"]
    # the balance: from his right fist, beam across his front, the silver pan on his left under the
    # piece of silver he is dropping in; hematite weights in the other pan
    _root, pans = props.balance("balance", m["grip_r"], left, cord=0.10, half=0.17, drop=0.17)
    silver_pan, weight_pan = pans[1], pans[0]
    props.silver_heap("pan_silver", silver_pan, silver_pan.z, n=9, spread=0.03, seed=5, size=(0.007, 0.011))
    props.weight("pan_w0", (weight_pan.x, weight_pan.y, weight_pan.z), 0.05, rot_z=yaw + 0.3)
    props.weight("pan_w1", (weight_pan.x + 0.02, weight_pan.y - 0.025, weight_pan.z), 0.028, rot_z=yaw - 0.5)
    props.silver_piece("held_silver", m["pinch_l"] - Vector((0, 0, 0.006)), 0.0075, 77)
    # on the table: the silver still to weigh, and the weights from large to small
    heap = t_c - fwd * 0.08 + left * 0.18
    props.silver_heap("table_silver", heap, top, n=22, spread=0.07, seed=9)
    for k, s in enumerate((0.07, 0.055, 0.042, 0.032, 0.024, 0.018)):
        p = t_c - fwd * 0.18 - left * (0.12 + k * 0.075)
        props.weight(f"tw{k}", (p.x, p.y, top), s, rot_z=yaw + 0.2)
    # the scribe's stool and the tablet on his palm, the stylus in his hand
    s = marks["scribe"]
    sp = PLACES["scribe"]
    props.stool("stool", (sp["at"][0] + 0.0, sp["at"][1] + 0.0, 0.0), s["seat_top"], rot_z=_yaw(sp["face"]))
    palm, n = s["palm_l"], s["palm_n_l"]
    along = s["along_l"]
    # a letter-sized tablet, like the Met's caravan account (8.5 x 6.5 cm)
    t = props.tablet("scribe_tablet", size=(0.065, 0.085, 0.022), seed=31)
    rot = Matrix((along.cross(n), along, n)).transposed().to_euler()
    kit.place(t, palm + n * 0.02, rot)
    tip = palm + n * 0.032
    pinch = s["pinch_r"]
    kit.curve_tube("stylus", [tip, pinch + (pinch - tip).normalized() * 0.09], 0.0035, material=mat("wood"))


def settle(ob, top):
    """Lower (or raise) ob until its lowest point, modifiers included, touches a surface at height top."""
    bpy.context.view_layer.update()
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    zmin = min((ev.matrix_world @ v.co).z for v in ev.data.vertices)
    ob.location.z += top - zmin - 0.0005


def hero(cam):
    """The era's money at the fixed spot: pieces of silver beside the sealed loan envelope, on the dark
    pedestal every era's money stands on."""
    hp = scenes.hero_point(cam)
    fwd, right, yaw = scenes._cam_axes(cam)
    top = hp.z - 0.02
    stand = scenes.stand("bench", cam, hp, top)
    obs = props.silver_heap("hero_silver", hp + right * 0.04 + fwd * 0.01, top, n=9, spread=0.026, seed=8,
                            size=(0.007, 0.012))
    # the envelope leans back toward the lens (as every era's money does), so its written face and the
    # seal band can be read; its lower edge rests on the stand
    env = props.envelope("hero_envelope", loc=hp - right * 0.05 - fwd * 0.012, rot=scenes.face_cam(cam, math.radians(50)))
    settle(env, top)
    obs.append(env)
    scenes.mark_hero(*obs)
    scenes.hero_light(cam, hp, 12.0)
    return stand


def lights():
    scenes._lights_studio(target=(0, 1.2, 0.9), key=850, fill=260, rim=420)
    # daylight in the courtyard, spilling in through the door
    kit.area_light("yard_sun", (0.85, 4.6, 3.2), (0.85, 3.6, 0.0), 900, size=2.0)
    kit.area_light("door_spill", (0.85, 3.3, 1.2), (0.6, 1.4, 0.4), 120, size=0.9)
    # low sun through the doorway: a bright patch on the floor in the shape of the door
    kit.spot_light("door_sun", (0.95, 4.7, 1.7), (0.6, 1.4, 0.0), 2600, angle=math.radians(40), blend=0.15,
                   radius=0.05)
    # soft panels out of frame for the silver to mirror (bare metal goes black in a dark room)
    kit.area_light("softL", (-2.2, -1.6, 1.6), (0.3, 1.2, 1.0), 70, size=2.5, kind="fill")
    kit.area_light("softR", (1.6, -2.2, 2.0), (0.3, 1.2, 1.0), 50, size=2.5, kind="fill")


def build(cache):
    global FIG_CACHE
    FIG_CACHE = cache
    props._IMAGES.clear()   # kit.reset empties the file, images included
    marks = {n: statue(n) for n in PLACES if os.path.exists(os.path.join(cache, f"{n}.blend"))}
    room()
    archive()
    goods()
    the_loan(marks)
    lights()
    cam = kit.camera(CAM["loc"], CAM["target"], lens=CAM["lens"])
    hero(cam)
    return cam, marks


def main():
    def arg(name, default=None):
        return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default

    figs = arg("--figs")
    out = arg("--out")
    looks = arg("--looks", "a").split(",")
    views = arg("--views", "main").split(",")
    res = tuple(int(x) for x in arg("--res", "1280x800").split("x"))
    samples = int(arg("--samples", "64"))
    tag = arg("--tag", "")
    os.makedirs(out, exist_ok=True)
    for lk in looks:
        for v in views:
            t0 = time.time()
            kit.reset(lk, res=res, samples=samples)
            cam, marks = build(figs)
            if v == "dim":
                kit.dim(0.025)
            elif v == "hero":
                hp = scenes.hero_point(cam)
                fwd, right, _yaw = scenes._cam_axes(cam)
                kit.camera(hp - fwd * 0.42 + Vector((0, 0, 0.2)), hp + Vector((0, 0, 0.01)), lens=50)
            elif v == "balance":
                g = marks["merchant"]["grip_r"]
                kit.camera(g + Vector((-0.55, -1.25, -0.05)), g + Vector((0.12, 0.0, -0.2)), lens=50)
            elif v == "scribe":
                p = marks["scribe"]["palm_l"]
                kit.camera(p + Vector((0.35, -1.0, 0.3)), p + Vector((0, 0, 0.1)), lens=50)
            elif v == "tablet":
                p = marks["scribe"]["palm_l"]
                kit.camera(p + Vector((0.12, -0.3, 0.32)), p + Vector((0, 0, 0.02)), lens=50)
            path = os.path.join(out, f"silver_{lk}_{v}{tag}.png")
            kit.render(path)
            print(f"[silver] {lk} {v}: {time.time() - t0:.0f}s -> {path}", flush=True)


if __name__ == "__main__":
    main()
