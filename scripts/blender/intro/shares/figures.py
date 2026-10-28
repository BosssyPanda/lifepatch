"""The three statues of the shares scene (c. 1602), simulated once each and saved as .blend files that
shares.py appends: the VOC bookkeeper seated at his table writing in the register, the buyer standing
across from him handing over silver, and a porter carrying a chest of silver toward the ship.

Built with the tailored-clothes recipe from ../proofs (rung 1: MakeHuman body, doublet and knee breeches
cut from the tights helper, simulated from the rest pose into the target pose). What is new here: the
three poses, a capotain that sits down on the head instead of perching on it (the proof's read as a
flowerpot), and empties marking the hands, seat and head so the scene can put the props where the
figure actually ended up.

    MPFB_DATA=.../mpfb2/src/mpfb/data .venv-bpy/bin/python scripts/blender/intro/shares/figures.py \
        --out /tmp/shares/figs --fig bookkeeper [--views full,side]
"""
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
INTRO = os.path.dirname(HERE)
sys.path[:0] = [HERE, os.path.join(INTRO, "proofs"), INTRO]

import bpy  # noqa: E402
import bmesh  # noqa: E402  (after bpy: the bpy module only provides it once loaded)
from mathutils import Vector  # noqa: E402

import cloth  # noqa: E402
import details  # noqa: E402
import hair  # noqa: E402
import kit  # noqa: E402
import mh_figure as mh  # noqa: E402
import scenes  # noqa: E402
import tailor  # noqa: E402

FLOOR = -0.818  # the MakeHuman body's soles before it is lowered


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


# ---------------------------------------------------------------------------- poses
# Body frame: the figure faces -Y, +X is its left, Z is up (see mh_figure.py).

def pose_buyer(rob):
    """Standing at the table, both hands held out over it with the silver on his palms, head turned down
    toward the bookkeeper. Two hands, never one raised arm (a raised arm reads as a salute). Parents are
    aimed before their children: aiming the spine afterwards would swing the arms with it."""
    for s, sx in (("l", 1), ("r", -1)):
        mh.aim(rob, f"thigh_{s}", (0.035 * sx, 0.0, -1.0))
        mh.aim(rob, f"calf_{s}", (0.0, 0.02, -1.0))
    mh.aim(rob, "spine_02", (0, -0.08, 1.0))
    mh.aim(rob, "spine_03", (0, -0.16, 1.0))
    for s, sx in (("l", 1), ("r", -1)):
        mh.aim(rob, f"upperarm_{s}", (0.1 * sx, -0.32, -1.0))
        mh.aim(rob, f"lowerarm_{s}", (-0.12 * sx, -1.0, -0.12))
        mh.twist(rob, f"lowerarm_{s}", mh.PALM_UP * sx)
        mh.aim(rob, f"hand_{s}", (-0.08 * sx, -1.0, 0.0))
        mh.curl_fingers(rob, s, 0.25, 0.1)
    mh.aim(rob, "head", (0, -0.42, 1.0))


def pose_bookkeeper(rob):
    """Seated at a writing table: forearms laid on the table top, the right hand holding the pen, the left
    flat on the page, head bowed over the book."""
    for s, sx in (("l", 1), ("r", -1)):
        mh.aim(rob, f"thigh_{s}", (0.1 * sx, -1.0, -0.04))
        mh.aim(rob, f"calf_{s}", (0.02 * sx, -0.12, -1.0))
        mh.aim(rob, f"foot_{s}", (0.0, -1.0, -0.3))
    mh.aim(rob, "spine_02", (0, -0.18, 1))
    mh.aim(rob, "spine_03", (0, -0.28, 1))
    for s, sx in (("l", 1), ("r", -1)):
        mh.aim(rob, f"upperarm_{s}", (0.2 * sx, -0.5, -0.85))
        mh.aim(rob, f"lowerarm_{s}", (-0.45 * sx, -1.0, 0.02))
    mh.aim(rob, "hand_l", (-0.35, -1.0, -0.06))
    mh.curl_fingers(rob, "l", 0.12, 0.05)
    mh.aim(rob, "hand_r", (0.15, -1.0, -0.3))
    mh.curl_fingers(rob, "r", 0.7, 0.45)
    mh.aim(rob, "head", (0, -0.85, 0.62))


def pose_porter(rob):
    """Walking with a chest held in front at the belly, palms up under it, leaning back against its weight."""
    mh.aim(rob, "thigh_l", (0.05, -0.36, -1.0))
    mh.aim(rob, "calf_l", (0.0, -0.04, -1.0))
    mh.aim(rob, "foot_l", (0.0, -1.0, -0.25))
    mh.aim(rob, "thigh_r", (-0.05, 0.28, -1.0))
    mh.aim(rob, "calf_r", (0.0, 0.5, -1.0))
    mh.aim(rob, "foot_r", (0.0, -0.75, -0.75))
    mh.aim(rob, "spine_01", (0, 0.06, 1))
    mh.aim(rob, "spine_03", (0, 0.04, 1))
    for s, sx in (("l", 1), ("r", -1)):
        mh.aim(rob, f"upperarm_{s}", (0.14 * sx, -0.12, -1.0))
        mh.aim(rob, f"lowerarm_{s}", (-0.2 * sx, -1.0, -0.08))
        mh.twist(rob, f"lowerarm_{s}", mh.PALM_UP * sx)
        mh.aim(rob, f"hand_{s}", (-0.15 * sx, -1.0, 0.05))
        mh.curl_fingers(rob, s, 0.35, 0.15)
    mh.aim(rob, "head", (0, -0.25, 1.0))


FIGS = {
    "bookkeeper": dict(targets=[("caucasian-male-old", 0.55), ("universal-male-old-averagemuscle-averageweight", 0.45)],
                       pose=pose_bookkeeper, seated=True, ruff=True, hat="capotain", buttons=True),
    "buyer": dict(targets=[("caucasian-male-young", 0.6), ("universal-male-old-averagemuscle-averageweight", 0.4)],
                  pose=pose_buyer, seated=False, ruff=True, hat="capotain", buttons=True),
    "porter": dict(targets=[("universal-male-young-maxmuscle-averageweight", 0.7), ("african-male-young", 0.3)],
                   pose=pose_porter, seated=False, ruff=False, hat=None, buttons=False),
}


# ---------------------------------------------------------------------------- hats

def capotain(body, rig, material, crown_h=0.16, taper=0.74, brim_out=0.06, sink=0.095, segs=72):
    """The tall-crowned hat worn in the Low Countries around 1600: a straight-sided crown narrowing toward
    a flat top, a band, and a flat brim of a hand's width. A rounded crown or a curled brim makes it read
    as a 1900s bowler; a cylinder with a narrow brim, as a flowerpot. It sits down on the head (sink below
    the crown of the skull) rather than balancing on top. Rides the head bone."""
    vg = {g.name: g.index for g in body.vertex_groups}
    hi = vg["head"]
    me = body.data
    pts = [me.vertices[i].co for i in range(len(me.vertices))
           if any(g.group == hi and g.weight > 0.6 for g in me.vertices[i].groups)]
    top = max(p.z for p in pts)
    bz = top - sink
    ring = [p for p in pts if abs(p.z - bz) < 0.012]
    cx = (max(p.x for p in ring) + min(p.x for p in ring)) / 2
    cy = (max(p.y for p in ring) + min(p.y for p in ring)) / 2
    rx = (max(p.x for p in ring) - min(p.x for p in ring)) / 2 + 0.010
    ry = (max(p.y for p in ring) - min(p.y for p in ring)) / 2 + 0.010
    # profile: brim as offsets beyond the head oval in metres, crown as a fraction of it; heights in metres
    brim = [(brim_out, -0.002), (brim_out * 0.96, 0.003), (brim_out * 0.5, 0.003), (0.006, 0.004)]
    crown = [(1.0, 0.004)] + [(1.0 + (taper - 1.0) * f, crown_h * 0.96 * f) for f in (0.15, 0.4, 0.65, 0.85, 1.0)]
    crown += [(taper * 0.93, crown_h), (taper * 0.6, crown_h + 0.003), (0.0, crown_h + 0.004)]
    verts, faces = [], []
    for i in range(segs):
        a = i / segs * math.tau
        ca, sa = math.cos(a), math.sin(a)
        for d, h in brim:
            verts.append((cx + ca * (rx + d), cy + sa * (ry + d), bz + h))
        for f, h in crown:
            verts.append((cx + ca * rx * f, cy + sa * ry * f, bz + h))
    m = len(brim) + len(crown)
    for i in range(segs):
        i2 = (i + 1) % segs
        for k in range(m - 1):
            faces.append((i * m + k, i * m + k + 1, i2 * m + k + 1, i2 * m + k))
    ob = details._mesh_object("hat", verts, faces, material)
    bm = bmesh.new()   # the crown's centre is one point per segment: merge them, or it renders as a pinhole
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-4)
    bm.to_mesh(ob.data)
    bm.free()
    s = ob.modifiers.new("thick", "SOLIDIFY")
    s.thickness, s.offset, s.use_even_offset = 0.007, 1.0, False
    d = ob.modifiers.new("sub", "SUBSURF")
    d.levels = d.render_levels = 1
    # the hat band: a flat ring round the foot of the crown, following its taper
    bverts, bfaces = [], []
    for i in range(segs):
        a = i / segs * math.tau
        for out, h in ((0.0, 0.004), (0.03, 0.008), (0.03, 0.026), (0.0, 0.03)):
            f = 1.0 + (taper - 1.0) * h / (crown_h * 0.96) + out
            bverts.append((cx + math.cos(a) * rx * f, cy + math.sin(a) * ry * f, bz + h))
    for i in range(segs):
        i2 = (i + 1) % segs
        for k in range(3):
            bfaces.append((i * 4 + k, i * 4 + k + 1, i2 * 4 + k + 1, i2 * 4 + k))
    band = details._mesh_object("hatband", bverts, bfaces, material)
    for o in (ob, band):
        details._rigid(o, rig, "head")
    return [ob, band]


# ---------------------------------------------------------------------------- build

def relax_hands(rig):
    for s, sx in (("l", 1), ("r", -1)):
        for f, base, spread in (("index", 0.21, -0.06), ("middle", 0.27, 0.0), ("ring", 0.36, 0.06),
                                ("pinky", 0.47, 0.12)):
            for k in ("01", "02", "03"):
                pb = rig.pose.bones[f"{f}_{k}_{s}"]
                pb.rotation_mode = "XYZ"
                pb.rotation_euler = (base * (0.6 if k == "01" else 1.0), 0, spread * sx if k == "01" else 0)
        for k, a in (("01", 0.1), ("02", 0.2), ("03", 0.25)):
            pb = rig.pose.bones[f"thumb_{k}_{s}"]
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = (a, 0, 0)


def posed_points(ob):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    used = {i for p in me.polygons for i in p.vertices}
    pts = [ev.matrix_world @ me.vertices[i].co for i in used]
    ev.to_mesh_clear()
    return pts


def store_pose(rig):
    return {pb.name: (tuple(pb.rotation_quaternion), tuple(pb.rotation_euler), tuple(pb.location))
            for pb in rig.pose.bones}


def set_pose(rig, pose=None):
    for pb in rig.pose.bones:
        q, e, loc = pose[pb.name] if pose else ((1, 0, 0, 0), (0, 0, 0), (0, 0, 0))
        pb.rotation_quaternion, pb.rotation_euler, pb.location = q, e, loc


def drop(rig, dz):
    rb = rig.pose.bones["Root"]
    rb.location = rig.data.bones["Root"].matrix_local.to_3x3().inverted() @ Vector((0, 0, dz))


def learn_pose(ob, rig, spec):
    """Pose the rest body (hands relaxed first, then the pose's own finger curls), find how far to lower it
    so its lowest point stands on the floor, and the seat height for a seated pose."""
    relax_hands(rig)
    spec["pose"](rig)
    pts = posed_points(ob)
    if spec["seated"]:
        # seated: the feet stand on the floor
        dz = FLOOR - min(p.z for p in pts)
        seat_top = min(p.z for p in pts if -0.1 < p.y < 0.2 and abs(p.x) < 0.2 and p.z < 0.2) + dz
    else:
        dz = FLOOR - min(p.z for p in pts)
        seat_top = None
    drop(rig, dz)
    final = store_pose(rig)
    marks = {}
    bpy.context.view_layer.update()
    for name, bone, end in (("hand_l", "hand_l", "head"), ("hand_r", "hand_r", "head"),
                            ("palm_l", "middle_01_l", "head"), ("palm_r", "middle_01_r", "head"),
                            ("head", "head", "tail"), ("chest", "spine_03", "tail")):
        pb = rig.pose.bones[bone]
        marks[name] = rig.matrix_world @ (pb.head if end == "head" else pb.tail)
    set_pose(rig)
    return final, seat_top, marks


def build(fig, out, frames=80, samples=32, views=("full", "side"), res=(800, 1000)):
    spec = FIGS[fig]
    t0 = time.time()
    kit.reset("a", res=res, samples=samples)
    clay = kit.mat("clay")
    ob, rig = mh.build(fig, targets=spec["targets"], material=clay)
    cloth.tpose_rest(ob, rig, down=0.45)
    scalp = hair.scalp_verts(ob, rig)
    cob, L = tailor.suit(ob, rig, fig + "_suit", clay, kind="voc")
    strips, rigid = [], []
    nt = cob["n_trousers"]
    me = cob.data
    basis = [d.co.copy() for d in me.shape_keys.key_blocks["Basis"].data]
    jsurf = details.Surface(basis, [list(p.vertices) for p in me.polygons if min(p.vertices) >= nt])
    if spec["buttons"]:
        z = L["neck"] - 0.05
        while z > L["waist"] - 0.01:
            strips.append(details.Strip(f"button{len(strips)}", jsurf, details.disc(jsurf, 0.0, z, 0.008, lift=0.003),
                                        thick=0.0))
            z -= 0.034
    for s_ in "lr":
        hand, d = L["wrist"][s_]
        strips.append(details.Strip(f"cuff_{s_}", jsurf, details.band(jsurf, [basis[i] for i in cob[f"cuff_{s_}"]], -d),
                                    closed=True))
    if spec["ruff"]:
        rigid.append(details.ruff(ob, L, clay, rig))
    if spec["hat"] == "capotain":
        rigid += capotain(ob, rig, clay)
    shoes = details.shoes(ob, L, clay)
    tailor.skin(shoes, ob, rig)
    print(f"[cut] {time.time() - t0:.0f}s", flush=True)

    final, seat_top, marks = learn_pose(ob, rig, spec)
    cloth.key_pose(rig, 1)
    cloth.key_pose(rig, 16)
    set_pose(rig, final)
    cloth.key_pose(rig, 46)
    cloth.collider(ob, friction=0.3)
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, FLOOR))
    plane = bpy.context.active_object
    cloth.collider(plane)
    seat = None
    if seat_top is not None:
        top = seat_top - 0.012
        seat = kit.box("seat", (0.40, 0.30, 0.6), loc=(0, 0.0, top - 0.3), material=kit.mat("clay_dim"), bevel=0.02)
        seat.location.z -= 0.8
        seat.keyframe_insert("location", frame=34)
        seat.location.z += 0.8
        seat.keyframe_insert("location", frame=52)
        cloth.collider(seat, friction=0.3)
    cloth.add_cloth(cob, frames, bending=0.6, mass=0.3, quality=10, tension=25.0, shear=10.0, shrink=-0.03,
                    stiff_group="stiff", bending_max=6.0, shrink_max=-0.03)
    cloth.run(frames)
    body = cloth.bake(ob, fig + "_body", clay)
    suit_b = cloth.bake(cob, fig + "_cloth", clay)
    cap = hair.hair_shell(body, scalp, fig + "_hair", clay, style="smooth")
    objs = [body, suit_b, cap]
    jp, jn = details.posed_of(suit_b)
    for st in strips:
        objs.append(st.build(jp, jn, clay))
    objs.append(cloth.bake(shoes, fig + "_shoes", clay))
    objs += [cloth.bake(o, o.name + "_b", clay) for o in rigid]
    keep = {o.name for o in objs}
    for o in list(bpy.context.scene.objects):
        if o.name not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    th = suit_b.modifiers.new("thick", "SOLIDIFY")
    th.thickness, th.offset = 0.004, -1.0
    sd = suit_b.modifiers.new("sub", "SUBSURF")
    sd.levels = sd.render_levels = 1
    # one parent at the floor point under the figure: shares.py moves and turns the statue by it
    root = kit.link(bpy.data.objects.new(fig, None))
    for o in objs:
        o.location.z -= FLOOR
        o.parent = root
    for name, p in marks.items():
        e = kit.link(bpy.data.objects.new(f"{fig}.{name}", None))
        e.location = p - Vector((0, 0, FLOOR))
        e.parent = root
    if seat_top is not None:
        e = kit.link(bpy.data.objects.new(f"{fig}.seat", None))
        e.location = (0, 0, seat_top - 0.012 - FLOOR)
        e.parent = root
    print(f"[built] {time.time() - t0:.0f}s", flush=True)
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(out, f"{fig}.blend")))

    # look-dev renders of the statue on its own
    kit.island(radius=1.6, depth=0.5, seed=11)
    if seat_top is not None:
        kit.box("stool", (0.36, 0.30, seat_top - 0.012 - FLOOR), loc=(0, 0, (seat_top - 0.012 - FLOOR) / 2),
                material=kit.mat("clay_dim"), bevel=0.01)
    scenes._lights_studio(target=(0, 0, 0.9), key=900, fill=260, rim=450, spread=1.0)
    cams = {"full": ((0.9, -3.4, 1.15), (0.0, 0.0, 0.85), 50), "side": ((-3.3, -1.0, 1.15), (0.0, 0.0, 0.85), 50),
            "back": ((-0.9, 3.4, 1.15), (0.0, 0.0, 0.85), 50), "head": ((0.4, -1.5, 1.6), (0.0, -0.05, 1.45), 60)}
    for v in views:
        loc, tgt, lens = cams[v]
        if seat_top is not None:
            loc, tgt = Vector(loc) - Vector((0, 0, 0.3)), Vector(tgt) - Vector((0, 0, 0.3))
        kit.camera(loc, tgt, lens=lens)
        kit.render(os.path.join(out, f"{fig}_{v}.png"))
    print(f"[done] {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    build(arg("--fig"), arg("--out"), samples=int(arg("--samples", "32")),
          views=arg("--views", "full,side").split(","), frames=int(arg("--frames", "80")))
