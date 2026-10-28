"""The digital scene's traders: plaster statues in 1971 suits, each simulated in its own pose.

Built on the tailored-clothes proof (proofs/tailored.py, `--fig trader`): the same MakeHuman body, suit cut,
details and cloth settings, with this scene's poses and props. Hands are placed by a two-bone reach (IK) on
targets measured from the floor, so a seated trader's hands land on his desk at DESK_Z, and his chair seat
sits where the cloth simulation's seat sat.

    .venv-bpy/bin/python scripts/blender/intro/digital/trader.py --pose phone --out /tmp/digital/fig

Poses: type (both hands on the desk keyboard), phone (handset at the left ear, right hand writing), lookup
(hands on the desk, head raised to the board), read (standing, a sheet held in both hands). Each run saves
`trader_<pose>.blend` with the baked figure (static meshes, floor at z = 0, facing -Y, seat centred on the
origin) plus its props, and renders check views. About 6 minutes of simulation seated, 3 standing.
"""
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
INTRO = os.path.dirname(HERE)
sys.path[:0] = [HERE, INTRO, os.path.join(INTRO, "proofs")]

import bpy  # noqa: E402  (first: bmesh and mathutils come with it)
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import cloth  # noqa: E402
import details  # noqa: E402
import hair  # noqa: E402
import kit  # noqa: E402
import mh_figure as mh  # noqa: E402
import scenes  # noqa: E402
import tailor  # noqa: E402


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


out = arg("--out")
pose_name = arg("--pose", "phone")
res = tuple(int(x) for x in arg("--res", "800x1000").split("x"))
samples = int(arg("--samples", "32"))
frames = int(arg("--frames", "80"))
sim = int(arg("--sim", "1"))
views = arg("--views", "back,back34,side,front").split(",")
FLOOR = -0.818          # the rest body's soles; everything is lifted by -FLOOR at the end
DESK_Z = 0.74           # desk top above the floor (a 1970s office desk: 29-30 in)
KEY_Z = DESK_Z + 0.045  # wrists over a keyboard on the desk

BODIES = {
    "type": [("african-male-young", 1.0)],
    "phone": [("caucasian-male-young", 1.0)],
    "lookup": [("caucasian-male-young", 0.5), ("universal-male-old-averagemuscle-averageweight", 0.5)],
    "read": [("asian-male-old", 0.6), ("caucasian-male-young", 0.4)],
}
SEATED = pose_name != "read"
os.makedirs(out, exist_ok=True)


# ---------------------------------------------------------------------------------------------- reach (IK)

def _head(rig, bone):
    bpy.context.view_layer.update()
    return rig.matrix_world @ rig.pose.bones[bone].head


def reach(rig, side, target, pole, iters=4):
    """Put the wrist (hand bone head) of arm `side` on target, the elbow bent toward pole.

    Shoulder, elbow and wrist come from the posed bones, so the chain's real lengths are used; a few passes
    correct the small offset between a bone's tail and its child's head."""
    target, pole = Vector(target), Vector(pole).normalized()
    goal = target.copy()
    for _ in range(iters):
        s = _head(rig, f"upperarm_{side}")
        e = _head(rig, f"lowerarm_{side}")
        w = _head(rig, f"hand_{side}")
        a, b = (e - s).length, (w - e).length
        d = goal - s
        dist = min(d.length, (a + b) * 0.999)
        dn = d.normalized()
        x = (a * a - b * b + dist * dist) / (2 * dist)
        h = math.sqrt(max(a * a - x * x, 0.0))
        perp = pole - dn * pole.dot(dn)
        perp = perp.normalized() if perp.length > 1e-6 else Vector((0, 0, -1))
        elbow = s + dn * x + perp * h
        mh.aim(rig, f"upperarm_{side}", elbow - s)
        e2 = _head(rig, f"lowerarm_{side}")
        mh.aim(rig, f"lowerarm_{side}", s + dn * dist - e2)
        err = target - _head(rig, f"hand_{side}")
        if err.length < 0.004:
            break
        goal += err
    return _head(rig, f"hand_{side}")


def fingers(rig, side, curl, spread=0.0, thumb=0.25):
    for f, sp in (("index", -1), ("middle", 0), ("ring", 1), ("pinky", 2)):
        for k in ("01", "02", "03"):
            pb = rig.pose.bones[f"{f}_{k}_{side}"]
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = (curl * (0.6 if k == "01" else 1.0), 0,
                                 spread * sp * (1 if side == "l" else -1) if k == "01" else 0)
    for k, a in (("01", 0.1), ("02", thumb), ("03", thumb)):
        pb = rig.pose.bones[f"thumb_{k}_{side}"]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (a, 0, 0)


# ---------------------------------------------------------------------------------------------- poses
# Body frame: faces -Y, +X is its left, Z up. Targets are in the final frame lifted by FLOOR (z = 0 floor).

def legs_seated(rig):
    for s, sx in (("l", 1), ("r", -1)):
        mh.aim(rig, f"thigh_{s}", (0.13 * sx, -1.0, -0.04))
        mh.aim(rig, f"calf_{s}", (0.02 * sx, 0.12, -1.0))
        mh.aim(rig, f"foot_{s}", (0.03 * sx, -1.0, -0.3))


def lift(z):
    return z + FLOOR


def pose_upper(rig):
    """Torso, head and arms, once the legs are posed and the body is lowered onto its seat."""
    pelvis = _head(rig, "spine_01")
    fwd = Vector((0, -1, 0))
    if pose_name == "type":
        mh.aim(rig, "spine_02", (0, -0.10, 1))
        mh.aim(rig, "spine_03", (0, -0.14, 1))
        mh.aim(rig, "neck_01", (0, -0.15, 1))
        mh.aim(rig, "head", (0, -0.42, 1))
        for s, sx in (("l", 1), ("r", -1)):
            t = Vector((sx * 0.105, pelvis.y - 0.43, lift(KEY_Z)))
            reach(rig, s, t, (sx * 0.55, 0.45, -1.0))
            mh.aim(rig, f"hand_{s}", (-0.12 * sx, -1.0, -0.22))
            mh.twist(rig, f"lowerarm_{s}", 0.0)
            fingers(rig, s, 0.45, 0.04)
    elif pose_name == "lookup":
        mh.aim(rig, "spine_02", (0, 0.02, 1))
        mh.aim(rig, "spine_03", (0, 0.06, 1))
        mh.aim(rig, "neck_01", (0, 0.05, 1))
        mh.aim(rig, "head", (0, 0.42, 1))
        for s, sx in (("l", 1), ("r", -1)):
            t = Vector((sx * 0.20, pelvis.y - 0.40, lift(DESK_Z + 0.03)))
            reach(rig, s, t, (sx * 0.8, 0.5, -1.0))
            mh.aim(rig, f"hand_{s}", (-0.35 * sx, -1.0, -0.12))
            fingers(rig, s, 0.3, 0.05)
    elif pose_name == "phone":
        mh.aim(rig, "spine_02", (0, -0.08, 1))
        mh.aim(rig, "spine_03", (0.02, -0.12, 1))
        mh.aim(rig, "neck_01", (0.05, -0.06, 1))
        mh.aim(rig, "head", (0.13, -0.10, 1))
        # writing hand on the desk
        reach(rig, "r", (-0.07, pelvis.y - 0.45, lift(DESK_Z + 0.035)), (-0.7, 0.4, -1.0))
        mh.aim(rig, "hand_r", (0.25, -1.0, -0.25))
        fingers(rig, "r", 0.55, 0.0, thumb=0.45)
        # the handset hand: wrist under the ear, elbow down and forward (a raised elbow reads as a salute)
        # the hand grips the handset's middle from outside: wrist below the grip, palm toward the cheek
        ear, mouth = handset_ends(rig)
        up_ax = (ear - mouth).normalized()
        out = handset_out(rig, ear, mouth)
        # the hand crosses the handset (fingers round its back edge), so both cups stay in view
        grip = mouth.lerp(ear, 0.5) + out * 0.055
        hand_dir = (Vector((0, 0, 1)) + (ear - mouth).normalized() * 0.35 + out * 0.2).normalized()
        reach(rig, "l", grip - hand_dir * 0.06, (0.6, -0.55, -1.0))
        mh.aim(rig, "hand_l", hand_dir)
        mh.twist(rig, "lowerarm_l", HAND_TWIST)
        fingers(rig, "l", 0.9, 0.0, thumb=0.5)
        if os.environ.get("DEBUG"):
            for nm, p in (("ear", ear), ("mouth", mouth), ("grip", grip), ("out", out), ("sh", _head(rig, "upperarm_l")),
                          ("elbow", _head(rig, "lowerarm_l")), ("wrist", _head(rig, "hand_l")),
                          ("headbone", _head(rig, "head"))):
                print("[dbg]", nm, tuple(round(c, 3) for c in p), flush=True)
    elif pose_name == "read":
        mh.aim(rig, "spine_03", (0, -0.06, 1))
        mh.aim(rig, "neck_01", (0, -0.2, 1))
        mh.aim(rig, "head", (0, -0.5, 0.85))
        chest = _head(rig, "spine_03")
        for s, sx in (("l", 1), ("r", -1)):
            t = Vector((sx * 0.13, chest.y - 0.27, chest.z + 0.02))
            reach(rig, s, t, (sx * 1.0, 0.4, -0.7))
            mh.aim(rig, f"hand_{s}", (-0.15 * sx, -1.0, 0.35))
            mh.twist(rig, f"lowerarm_{s}", -1.1 * sx)
            fingers(rig, s, 0.55, 0.0, thumb=0.15)


def head_point(rig, local):
    """A point given in the head's own frame (x: the body's left, y: forward, which is -Y for an unturned
    body, z: up), from the head bone's head (top of the neck) raised to ear height."""
    bpy.context.view_layer.update()
    pb = rig.pose.bones["head"]
    m = rig.matrix_world @ pb.matrix
    up = (m.to_3x3() @ Vector((0, 1, 0))).normalized()
    base = m.translation + up * 0.075
    x = Vector((1, 0, 0))
    fwd = up.cross(x).normalized() * -1 if up.cross(x).y > 0 else up.cross(x).normalized()
    side = fwd.cross(up).normalized() * -1
    return base + side * local[0] + fwd * local[1] + up * local[2]


# ---------------------------------------------------------------------------------------------- props

HAND_TWIST = float(os.environ.get("HAND_TWIST", "0.0"))


def handset_ends(rig):
    return head_point(rig, (0.095, 0.01, 0.0)), head_point(rig, (0.045, 0.115, -0.085))


def handset_out(rig, ear, mouth):
    return ((ear + mouth) / 2 - head_point(rig, (0, 0.04, -0.04))).normalized()


def handset(rig, material):
    """A 1970s desk-phone handset: a curved bar, an ear cup at the ear and a mouth cup at the chin."""
    ear, mouth = handset_ends(rig)
    out = handset_out(rig, ear, mouth)
    pts = []
    for i in range(13):
        t = i / 12
        p = ear.lerp(mouth, t) + out * (0.028 * math.sin(math.pi * t) + 0.012)
        pts.append(p)
    bar = kit.curve_tube("handset_bar", pts, 0.015, material=material)
    bar.data.bevel_resolution = 4
    axis = (mouth - ear).normalized()
    cups = []
    for name, p, r in (("ear_cup", ear, 0.034), ("mouth_cup", mouth, 0.032)):
        n = (p - head_point(rig, (0, 0.03, -0.03))).normalized()
        n = (n - axis * n.dot(axis)).normalized()
        c = kit.cyl(name, r, 0.022, loc=p + n * 0.016 + out * 0.004, material=material, segs=28, r2=r * 0.82,
                    bevel=0.004)
        c.rotation_euler = n.to_track_quat("Z", "Y").to_euler()
        cups.append(c)
    return [bar] + cups


def held_sheet(rig, material):
    """A teleprinter sheet held in both hands, tilted up toward the reader's face."""
    hl, hr = (_head(rig, f"hand_{s}") for s in "lr")
    bpy.context.view_layer.update()
    tips = [rig.matrix_world @ rig.pose.bones[f"middle_01_{s}"].head for s in "lr"]
    c = (tips[0] + tips[1]) / 2 + Vector((0, -0.01, 0.06))
    w = (tips[0] - tips[1]).length + 0.03
    eye = head_point(rig, (0, 0.08, 0.02))
    n = (eye - c).normalized()
    x = (tips[0] - tips[1]).normalized()
    up = n.cross(x).normalized()
    if up.z < 0:
        up = -up
    bm = bmesh.new()
    cols, rows = 10, 12
    W, H = w, 0.30
    vs = []
    for j in range(rows + 1):
        row = []
        for i in range(cols + 1):
            u, v = i / cols - 0.5, j / rows - 0.25
            bow = 0.018 * (1 - (2 * u) ** 2)  # held at the edges: the middle bows away from the face
            row.append(bm.verts.new(c + x * (u * W) + up * (v * H) - n * bow))
        vs.append(row)
    for j in range(rows):
        for i in range(cols):
            bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
    ob = kit.from_bmesh("sheet", bm, material)
    so = ob.modifiers.new("thick", "SOLIDIFY")
    so.thickness = 0.0015
    return [ob]


# ---------------------------------------------------------------------------------------------- build

t0 = time.time()
kit.reset("a", res=res, samples=samples)
clay = kit.mat("clay")
ob, rig = mh.build("trader_" + pose_name, targets=BODIES[pose_name], material=clay)
cloth.tpose_rest(ob, rig, down=0.45)
scalp = hair.scalp_verts(ob, rig)
cob, L = tailor.suit(ob, rig, "suit", clay, kind="suit")
sob = tailor.shirt(ob, L, clay)
tailor.skin(sob, ob, rig)
nt = cob["n_trousers"]
me = cob.data
basis = [d.co.copy() for d in me.shape_keys.key_blocks["Basis"].data]
jsurf = details.Surface(basis, [list(p.vertices) for p in me.polygons if min(p.vertices) >= nt])
ssurf = details.surface_of(sob)
strips = []
for n, g in enumerate(details.lapels(jsurf, L)):
    strips.append(details.Strip(f"lapel{n}", jsurf, g))
strips.append(details.Strip("collar", jsurf, details.collar(jsurf, L, [basis[i] for i in cob["neck_idx"]])))
bz = L["button"]
for sx in (1, -1):
    strips.append(details.Strip(f"pocket{sx}", jsurf, details.patch(jsurf, sx * 0.115, bz - 0.105, 0.15, 0.05, lift=0.003)))
strips.append(details.Strip("breast", jsurf, details.patch(jsurf, 0.125, 0.40, 0.085, 0.022, lift=0.002, tilt=0.12)))
strips.append(details.Strip("button", jsurf, details.disc(jsurf, 0.0, bz, 0.011), closed=False, thick=0.0))
shirt_top = max(v.co.z for v in sob.data.vertices if abs(v.co.x) < 0.02 and v.co.y < L["cy"])
strips.append(details.Strip("tie", ssurf, details.tie(ssurf, L, shirt_top - 0.008, bz - 0.03)))
for n, g in enumerate(details.collar_points(ssurf, L, shirt_top)):
    strips.append(details.Strip(f"point{n}", ssurf, g))
shoes = details.shoes(ob, L, clay)
tailor.skin(shoes, ob, rig)
print(f"[cut] {time.time() - t0:.0f}s", flush=True)


def posed_points(o):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    m = ev.to_mesh()
    used = {i for p in m.polygons for i in p.vertices}
    pts = [ev.matrix_world @ m.vertices[i].co for i in used]
    ev.to_mesh_clear()
    return pts


def store_pose(r):
    return {pb.name: (tuple(pb.rotation_quaternion), tuple(pb.rotation_euler), tuple(pb.location))
            for pb in r.pose.bones}


def set_pose(r, p=None):
    for pb in r.pose.bones:
        q, e, loc = p[pb.name] if p else ((1, 0, 0, 0), (0, 0, 0), (0, 0, 0))
        pb.rotation_quaternion, pb.rotation_euler, pb.location = q, e, loc


def drop(r, dz):
    rb = r.pose.bones["Root"]
    rb.location = r.data.bones["Root"].matrix_local.to_3x3().inverted() @ Vector((0, 0, dz))


# legs first, so the body can be lowered onto its seat (or feet) before the hands reach for the desk
seat_top = None
if SEATED:
    legs_seated(rig)
pts = posed_points(ob)
dz = FLOOR - min(p.z for p in pts)
drop(rig, dz)
if SEATED:
    pts = posed_points(ob)
    seat_top = min(p.z for p in pts if -0.1 < p.y < 0.2 and abs(p.x) < 0.2 and p.z < FLOOR + 0.7)
pose_upper(rig)
final = store_pose(rig)
pelvis_y = _head(rig, "spine_01").y
hands = {s: _head(rig, f"hand_{s}") for s in "lr"}
set_pose(rig)
bpy.context.view_layer.update()
print(f"[pose] seat {None if seat_top is None else round(seat_top - FLOOR, 3)} "
      f"hands {[tuple(round(c, 3) for c in (h.x, h.y, h.z - FLOOR)) for h in hands.values()]}", flush=True)

objs, seat, desk = [], None, None
if not sim:
    set_pose(rig, final)
    bpy.context.view_layer.update()
    objs = [cloth.bake(o, o.name + "_b", clay) for o in (ob, cob, sob, shoes)]
else:
    cloth.key_pose(rig, 1)
    cloth.key_pose(rig, 16)
    set_pose(rig, final)
    cloth.key_pose(rig, 46)
    cloth.collider(ob, friction=0.3)
    cloth.collider(sob, outer=0.002, friction=0.3)
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, FLOOR))
    cloth.collider(bpy.context.active_object)
    if seat_top is not None:
        top = seat_top - 0.012
        seat = kit.box("seat", (0.44, 0.30, 0.6), loc=(0, 0.0, top - 0.3), material=kit.mat("clay_dim"), bevel=0.02)
        seat.location.z -= 0.8
        seat.keyframe_insert("location", frame=34)
        seat.location.z += 0.8
        seat.keyframe_insert("location", frame=52)
        cloth.collider(seat, friction=0.3)
        # the desk top stands where it will be from the first frame: the arms come down onto it from the
        # T-pose and the legs swing in under it. (Sliding it up from below caught the trouser legs and
        # dragged them up to the hip.)
        hy = min(h.y for h in hands.values())
        front = hy + 0.20
        desk = kit.box("desk_top", (1.4, 0.75, 0.04), loc=(0, front - 0.375, lift(DESK_Z) - 0.02),
                       material=kit.mat("clay_dim"))
        cloth.collider(desk, friction=0.6)
    cloth.add_cloth(cob, frames, bending=1.0, mass=0.3, quality=10, tension=25.0, shear=10.0, shrink=-0.05,
                    stiff_group="stiff", bending_max=6.0, shrink_max=-0.03)
    cloth.run(frames)
    objs = [cloth.bake(o, n, clay) for o, n in ((ob, "body"), (cob, "suit"), (sob, "shirt"))]

body = objs[0]
cap = hair.hair_shell(body, scalp, "hair", clay, style="smooth")
objs.append(cap)
jp, jn = details.posed_of(objs[1])
sp, sn = details.posed_of(objs[2])
for st in strips:
    objs.append(st.build(sp, sn, clay) if st.surf is ssurf else st.build(jp, jn, clay))
if sim:
    objs.append(cloth.bake(shoes, "shoes", clay))

# props, built on the final pose
set_pose(rig, final)
bpy.context.view_layer.update()
props = []
if pose_name == "phone":
    props = handset(rig, kit.mat("clay_dim"))
elif pose_name == "read":
    props = held_sheet(rig, kit.mat("paper"))
props = [cloth.bake(p, p.name, None) for p in props] if props else []

keep = {o.name for o in objs + props}
for o in list(bpy.context.scene.objects):
    if o.name not in keep:
        bpy.data.objects.remove(o, do_unlink=True)
suit_ob = next(o for o in objs if o.name.startswith("suit"))
th = suit_ob.modifiers.new("thick", "SOLIDIFY")
th.thickness, th.offset = 0.004, -1.0
sd = suit_ob.modifiers.new("sub", "SUBSURF")
sd.levels = sd.render_levels = 1
# floor to z = 0, the seat (or the feet) centred on the origin
for o in objs + props:
    o.location.z -= FLOOR
info = {
    "pose": pose_name,
    "body": BODIES[pose_name],
    "seat_top": None if seat_top is None else seat_top - FLOOR,
    "desk_z": DESK_Z,
    "pelvis_y": pelvis_y,
    "hands": {s: [h.x, h.y, h.z - FLOOR] for s, h in hands.items()},
    "desk_front_y": min(h.y for h in hands.values()) + 0.20 if SEATED else None,
    "seconds": round(time.time() - t0),
}
for o in objs:
    o["figure"] = pose_name
for o in props:
    o["prop"] = pose_name
bpy.context.scene["trader"] = json.dumps(info)
if os.environ.get("DEBUG"):
    for o in bpy.context.scene.objects:
        print("[dbg-ob]", o.name, o.type, [round(c, 3) for c in o.location], len(o.data.vertices) if o.type == "MESH" else "")
print(f"[built] {time.time() - t0:.0f}s {json.dumps(info)}", flush=True)
if sim:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(out, f"trader_{pose_name}.blend")))
with open(os.path.join(out, f"trader_{pose_name}.json"), "w") as f:
    json.dump(info, f, indent=1)

# check views: a stand-in chair and desk where the simulation had them, studio light
check = []
if SEATED:
    check.append(kit.box("chk_seat", (0.44, 0.30, info["seat_top"] - 0.012), loc=(0, 0, (info["seat_top"] - 0.012) / 2),
                         material=kit.mat("clay_dim"), bevel=0.02))
    fy = info["desk_front_y"]
    check.append(kit.box("chk_desk", (1.4, 0.75, 0.04), loc=(0, fy - 0.375, DESK_Z - 0.02), material=kit.mat("wood"), bevel=0.01))
kit.island(radius=2.0, depth=0.6, seed=11)
scenes._lights_studio(target=(0, 0, 0.9), key=900, fill=260, rim=450, spread=1.0)
CAMS = {"front": ((0.9, -3.4, 1.3), (0.0, 0.0, 0.85), 50), "side": ((-3.3, -0.6, 1.2), (0.0, -0.2, 0.85), 50),
        "back": ((-0.4, 3.4, 1.3), (0.0, 0.0, 0.9), 50), "back34": ((-2.0, 2.6, 1.4), (0.0, -0.1, 0.9), 50),
        "head": ((-0.9, 1.4, 1.45), (0.0, -0.1, 1.1), 50), "phone_l": ((1.1, -0.9, 1.35), (0.05, -0.08, 1.12), 50),
        "phone_bl": ((0.9, 1.1, 1.4), (0.05, -0.05, 1.12), 50)}
tag = "sim" if sim else "rest"
for vname in views:
    loc, tgt, lens = CAMS[vname]
    kit.camera(loc, tgt, lens=lens)
    kit.render(os.path.join(out, f"trader_{pose_name}_{tag}_{vname}.png"))
print(f"[done] {time.time() - t0:.0f}s", flush=True)
