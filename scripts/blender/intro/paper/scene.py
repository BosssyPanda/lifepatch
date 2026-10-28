"""Scene 04, paper money (Song China, 1023), built for real.

A Song office front, open to the street like the shops in the Qingming scroll. Behind the counter an official
in the winged cap of Song officials presents a new note upright in both hands; a depositor in a soft cap, on the
street, reaches for it; a porter comes along the street with two baskets of strung iron cash on a pole. On the
counter lie the deposit (coils of strung cash, loose coins), a bolt of silk, a stack of notes, an inkstone and a
brush. In front, on the money
spot every era shares (scenes.HERO), the hero note. The money spot covers the lower left of the frame, so the
handover and the porter are kept to the right of it.

    python scripts/blender/intro/paper/scene.py --figs DIR --out DIR [--res 1280x800 --samples 32]
        [--views main,overview] [--dim 0.025] [--note PNG] [--blend FILE]

--figs is where figures.py saved official.blend, depositor.blend and porter.blend.
"""
import argparse
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
INTRO = os.path.dirname(HERE)
sys.path[:0] = [HERE, os.path.join(INTRO, "proofs"), INTRO]

import bpy  # noqa: E402  (first: it puts bmesh and mathutils on the path)
from mathutils import Matrix, Vector  # noqa: E402

import figures  # noqa: E402
import hall  # noqa: E402
import kit  # noqa: E402
import note  # noqa: E402
import props  # noqa: E402
import scenes  # noqa: E402
from kit import mat  # noqa: E402

ROBE_TONE = "#6b665f"

CAMERAS = {
    # the overview's camera (scenes.paper): only for comparing one to one with paper_a
    "overview": ((-0.3, -2.7, 1.05), (0.1, 1.8, 1.4), 32),
    # the scene's camera: further back, so the whole hall and its roof are in the frame
    "main": ((-0.55, -4.55, 1.3), (0.12, 1.9, 1.62), 32),
}


def place(parts, loc, rot_z):
    """Stand a figure at loc turned by rot_z, its lowest point (sole or shoe) on loc's floor. figures.py
    drops the body's soles to the floor; shoes are skinned round the feet and reach 2.5 cm lower."""
    M = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(rot_z, 4, "Z")
    bpy.context.view_layer.update()  # appended objects' matrix_world is stale until the first update
    low = min((M @ o.matrix_world @ v.co).z for k in ("body", "shoes") if k in parts
              for o in (parts[k],) for v in o.data.vertices)
    M = Matrix.Translation(Vector((0, 0, loc[2] - low))) @ M
    for o in parts.values():
        o.matrix_world = M @ o.matrix_world
    return M


def facing_rot(d):
    """rot_z that turns a MakeHuman figure (facing -Y) to face horizontal direction d."""
    return math.atan2(d.x, -d.y)


def mid(a, b):
    return (Vector(a) + Vector(b)) / 2


def shoulder_top(body, near, radius=0.06):
    """Highest point of the (placed) body within radius of `near` in plan: where a pole rests."""
    mw = body.matrix_world
    best = None
    for v in body.data.vertices:
        p = mw @ v.co
        if (Vector((p.x - near.x, p.y - near.y))).length < radius and abs(p.z - near.z) < 0.25:
            if best is None or p.z > best.z:
                best = p
    return best


def build(figs, note_png=None):
    kit.island(radius=5.0, depth=0.7, seed=14)
    objs, H = hall.build()
    top = H["counter_top"]

    # --- the official, behind the counter, turned toward the depositor on his left (the camera's right). His
    # robe is a darker grey than the others' (Song officials' robes were coloured by rank), so the note in his
    # hands stands out against it; his belt and boots are black like his cap.
    off = figures.load(os.path.join(figs, "official.blend"), "official")
    figures.finish(off)
    off["cloth"].material_slots[0].material = mat("clay", tone=ROBE_TONE)
    for k in ("belt", "shoes"):
        off[k].material_slots[0].material = mat("clay", tone=figures.HAT_TONE)
    d_off = Vector((0.45, -0.89, 0)).normalized()
    d_dep = Vector((0.5, -0.87, 0)).normalized()          # from the note toward the depositor: seen from behind left
    M = place(off, (0.2, H["counter_back"] + 0.26, hall.PLAT_H), facing_rot(d_off))
    pl, pr = M @ Vector(off["body"]["palm_l"]), M @ Vector(off["body"]["palm_r"])
    c = mid(pl, pr) + Vector((0, 0, 0.018))
    # the note stands on his palms, leaning back a little, its face to the depositor: presented with both
    # hands. Lying flat it was edge-on to the camera and could not be seen at all.
    R = Matrix.Rotation(facing_rot(d_dep), 4, "Z") @ Matrix.Rotation(math.radians(68), 4, "X")
    held = note.sheet("note_held", note.SIZE, png=note_png)
    held.matrix_world = Matrix.Translation(c + (R @ Vector((0, note.SIZE[1] / 2, 0)))) @ R

    # --- the depositor, on the street, reaching for the note
    dep = figures.load(os.path.join(figs, "depositor.blend"), "depositor")
    figures.finish(dep)
    reach = -mid(dep["body"]["palm_l"], dep["body"]["palm_r"]).y
    P = Vector((c.x, c.y, 0)) + d_dep * (reach + 0.1)
    Md = place(dep, (P.x, P.y, 0.0), facing_rot(-d_dep))

    # --- the porter, coming up the street with two baskets of iron cash
    por = figures.load(os.path.join(figs, "porter.blend"), "porter")
    figures.finish(por)
    d_por = Vector((-1.0, 0.12, 0)).normalized()          # walking along the street toward the counter
    M = place(por, (2.12, 0.55, 0.0), facing_rot(d_por))
    grip = M @ Vector(por["body"]["palm_r"])
    sh = M @ Vector(por["body"]["shoulder_r"])
    st = shoulder_top(por["body"], sh) or (sh + Vector((0, 0, 0.07)))
    rest = st + Vector((0, 0, 0.022))
    print("[check] porter shoulder joint", tuple(round(x, 3) for x in sh), "pole rests at", tuple(round(x, 3) for x in rest),
          "grip", tuple(round(x, 3) for x in grip))
    ax = (grip - rest).normalized()        # the pole runs from the shoulder through the hand
    front, back = rest + ax * 0.72, rest - ax * 0.66
    props_objs = [props._sweep("pole", [back, front], 0.019, mat("wood"), segs=12)]
    for k, end in enumerate((front, back)):
        bc = Vector((end.x, end.y, 0.16))
        props_objs += props.basket(f"basket{k}", bc, r=0.19, h=0.27)
        for j in range(3):
            props_objs.append(props.coil(f"load{k}_{j}", (bc.x, bc.y, bc.z + 0.2 + j * 0.0), r=0.12 - j * 0.025,
                                         turns=1.3, rot=k + j, seed=k * 7 + j))
        rim_z = bc.z + 0.27
        for j in range(4):
            a = j / 4 * math.tau + 0.4
            p0 = Vector((bc.x + 0.19 * math.cos(a), bc.y + 0.19 * math.sin(a), rim_z))
            props_objs.append(props._sweep(f"cord{k}{j}", [p0, end - Vector((0, 0, 0.02))], 0.004, mat("wood"), segs=6))

    # --- on the counter: the deposit at the depositor's end, the office's things at the official's right
    t = top
    rnd_coins = [(0.0, 0.0, 0.3), (0.03, -0.02, 1.1), (-0.025, 0.02, 2.0), (0.012, 0.035, 0.6)]
    dep_spot = Vector((0.08, H["counter_front"] + 0.13, t))
    for k in range(3):
        props_objs.append(props.coil(f"dep{k}", (dep_spot.x + 0.02 * k, dep_spot.y - 0.01 * k, t), r=0.085 - 0.012 * k,
                                     turns=1.15, rot=k * 1.3, seed=20 + k))
    for k, (dx, dy, rz) in enumerate(rnd_coins):
        props_objs.append(props.coin(f"loose{k}", (dep_spot.x + 0.13 + dx, dep_spot.y + 0.02 + dy, t + 0.0012), (0, 0, rz)))
    props_objs += props.silk_bolt("silk", (-0.36, H["counter_back"] - 0.12, t + 0.065), rot_z=0.08)
    props_objs += props.note_stack("stack", (-0.4, H["counter_front"] + 0.13, t), n=26, size=note.SIZE, rot_z=0.12,
                                   paper=note.material(note_png))
    props_objs += props.inkstone("ink", (-0.16, H["counter_back"] - 0.12, t), rot_z=0.1)
    props_objs += props.brush("brush", (-0.2, H["counter_front"] + 0.1, t), rot_z=0.4)

    # --- inside: strongboxes against the back wall
    props_objs += props.strongbox("box0", (-1.35, hall.Y0 + hall.DEPTH - 0.45, hall.PLAT_H), rot_z=0.05)
    props_objs += props.strongbox("box1", (1.3, hall.Y0 + hall.DEPTH - 0.45, hall.PLAT_H), size=(0.6, 0.42, 0.36),
                                  rot_z=-0.08)
    report(off, dep, por, c, Md)
    return H


def report(off, dep, por, note_c, Md):
    """Print the checks a frame cannot be trusted without: hands at the note, feet clear of the platform."""
    def verts(o):
        mw = o.matrix_world
        return [mw @ v.co for v in o.data.vertices]
    pl = [Md @ Vector(dep["body"]["palm_" + s]) for s in "lr"]
    print("[check] note", tuple(round(x, 3) for x in note_c))
    for s, p in zip("lr", pl):
        print(f"[check] depositor palm_{s}", tuple(round(x, 3) for x in p), "to note", round((p - note_c).length, 3))
    ct = bpy.data.objects["counter_top"]
    cb = bpy.data.objects["counter_body"]
    boxes = {"platform": bpy.data.objects["platform"], "counter top": ct, "counter body": cb}
    for name, f in (("official", off), ("depositor", dep), ("porter", por)):
        pts = [p for o in f.values() if o.type == "MESH" for p in verts(o)]
        for bn, b in boxes.items():
            lo = b.matrix_world @ Vector(b.bound_box[0])
            hi = b.matrix_world @ Vector(b.bound_box[6])
            ins = [p for p in pts if lo.x < p.x < hi.x and lo.y < p.y < hi.y and lo.z < p.z < hi.z]
            if ins:
                depth = max(min(p.x - lo.x, hi.x - p.x, p.y - lo.y, hi.y - p.y, p.z - lo.z, hi.z - p.z) for p in ins)
                print(f"[check] {name}: {len(ins)} vertices inside the {bn}, up to {depth * 100:.1f} cm deep")
    print("[check] figures checked against platform and counter")


def lights():
    scenes._lights_studio(target=(0, 1.8, 1.1), key=900, fill=250, rim=420)
    # the room under the roof, and daylight behind the windows
    kit.area_light("room", (0.0, 2.4, 1.85), (0.0, 2.4, 0.0), 140, size=3.5, kind="fill")


def hero(cam, note_png=None):
    hp = scenes.hero_point(cam)
    st = scenes.stand("front_counter", cam, hp, hp.z - 0.05)
    hn = note.sheet("hero", note.SIZE, png=note_png, curl=0.02)
    hn.location = hp
    hn.rotation_euler = scenes.face_cam(cam, math.radians(42))
    scenes.mark_hero(hn)
    li = scenes.hero_light(cam, hp, 10.0)
    for o in (st, hn, li):
        o["hero_rig"] = True
    return hn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--figs", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--res", default="1280x800")
    ap.add_argument("--samples", type=int, default=32)
    ap.add_argument("--views", default="main")
    ap.add_argument("--dim", type=float, default=None)
    ap.add_argument("--note", default=None)
    ap.add_argument("--look", default="a")
    ap.add_argument("--blend", default=None, help="also save the built scene as a .blend")
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    w, h = (int(x) for x in args.res.split("x"))
    os.makedirs(args.out, exist_ok=True)
    kit.reset(args.look, res=(w, h), samples=args.samples)
    build(args.figs, args.note)
    lights()
    for v in args.views.split(","):
        loc, tgt, lens = CAMERAS[v]
        for o in [o for o in bpy.data.objects if o.get("hero_rig")]:
            bpy.data.objects.remove(o, do_unlink=True)
        cam = kit.camera(loc, tgt, lens=lens)
        hero(cam, args.note)
        if args.dim is not None:
            kit.dim(args.dim)
        if args.blend:
            bpy.ops.wm.save_as_mainfile(filepath=args.blend)
        kit.render(os.path.join(args.out, f"paper_{v}_{args.look}{'_dim' if args.dim is not None else ''}.png"))


if __name__ == "__main__":
    main()
