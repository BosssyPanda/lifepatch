"""The silver scene's four statues, built one at a time and saved for scene.py to place.

Each figure is a CC0 MakeHuman body in a belted tunic simulated as cloth on its pose, with carved
curly hair (rung 1 of the figure ladder in ../proofs). A figure stays still, so its cloth is simulated
once and baked.

    python scripts/blender/intro/silver/figure.py --fig merchant --out DIR [--preview 1] [--res 640x800]

Writes DIR/<fig>.blend (the baked meshes, standing on z = 0, facing -Y, its left on +X) and DIR/<fig>.json
(hand landmarks for what the figure holds, and the seat height for a seated figure). --preview 1 skips
the cloth and only renders the posed body, for checking a pose and its hands in seconds.
"""
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
INTRO = os.path.dirname(HERE)
sys.path[:0] = [os.path.join(INTRO, "proofs"), INTRO]

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import cloth  # noqa: E402
import hair  # noqa: E402
import kit  # noqa: E402
import mh_figure as mh  # noqa: E402

FLOOR = -0.818  # MakeHuman's soles in rest units


# ---------------------------------------------------------------------------------------- hands

def relax_hands(rig, sides="lr"):
    """Fingers gently curled, more toward the little finger, and closed up (from the ladder)."""
    for s in sides:
        sx = 1 if s == "l" else -1
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


def fist(rig, s, curl=1.25, thumb=(0.35, 0.55, 0.5)):
    """A closed grip round a cord or a stylus: every finger curled in, the thumb folded over them."""
    sx = 1 if s == "l" else -1
    for f, extra in (("index", -0.05), ("middle", 0.0), ("ring", 0.05), ("pinky", 0.1)):
        for k in ("01", "02", "03"):
            pb = rig.pose.bones[f"{f}_{k}_{s}"]
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = ((curl + extra) * (0.8 if k == "01" else 1.0), 0, 0)
    for k, a in zip(("01", "02", "03"), thumb):
        pb = rig.pose.bones[f"thumb_{k}_{s}"]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (a, 0, -0.3 * sx if k == "01" else 0)


def pen_grip(rig, s):
    """Index and thumb pinched, the other fingers tucked: how a stylus is held."""
    for f, c in (("index", 0.55), ("middle", 0.95), ("ring", 1.2), ("pinky", 1.3)):
        for k in ("01", "02", "03"):
            pb = rig.pose.bones[f"{f}_{k}_{s}"]
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = (c * (0.7 if k == "01" else 1.0), 0, 0)
    for k, a in (("01", 0.3), ("02", 0.35), ("03", 0.3)):
        pb = rig.pose.bones[f"thumb_{k}_{s}"]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (a, 0, 0)


# ---------------------------------------------------------------------------------------- reach

def _head(rig, bone):
    bpy.context.view_layer.update()
    return rig.matrix_world @ rig.pose.bones[bone].head


def _two_bone(rig, s, wrist, pole):
    """Aim upper arm and forearm so the wrist lands on `wrist`, the elbow bending toward `pole`."""
    sh = _head(rig, f"upperarm_{s}")
    l1 = (rig.data.bones[f"lowerarm_{s}"].head_local - rig.data.bones[f"upperarm_{s}"].head_local).length
    l2 = (rig.data.bones[f"hand_{s}"].head_local - rig.data.bones[f"lowerarm_{s}"].head_local).length
    t = Vector(wrist) - sh
    d = min(max(t.length, abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3)
    u = t.normalized()
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(l1 * l1 - a * a, 0.0))
    p = Vector(pole) - u * Vector(pole).dot(u)
    p.normalize()
    elbow = sh + u * a + p * h
    mh.aim(rig, f"upperarm_{s}", elbow - sh)
    mh.aim(rig, f"lowerarm_{s}", sh + u * d - _head(rig, f"lowerarm_{s}"))


def _palm_normal(rig, s):
    m = rig.matrix_world
    b = rig.pose.bones
    bpy.context.view_layer.update()
    k = [m @ b[f"{f}_01_{s}"].head for f in ("index", "middle", "ring", "pinky")]
    across = k[0] - k[3]
    along = sum(k, Vector()) / 4 - m @ b[f"hand_{s}"].head
    return (across.cross(along) if s == "r" else along.cross(across)).normalized()


def reach(rig, s, target, pole, hand_dir, point="grip", palm=None, iters=5):
    """Put a point of the hand (grip | palm | pinch | index_tip) on target: two-bone IK for the wrist,
    the forearm turned so the palm faces `palm`, the hand aimed along hand_dir, then the wrist target
    corrected by the miss. The arm starts from rest on every pass, so turns never pile up."""
    wrist = Vector(target)
    miss = Vector()
    for _ in range(iters):
        for bn in (f"upperarm_{s}", f"lowerarm_{s}", f"hand_{s}"):
            pb = rig.pose.bones[bn]
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = (1, 0, 0, 0)
        _two_bone(rig, s, wrist, pole)
        if palm is not None:
            # with the hand straight along the forearm, turn the forearm until the palm faces `palm`
            mh.aim(rig, f"hand_{s}", _head(rig, f"hand_{s}") - _head(rig, f"lowerarm_{s}"))
            axis = (_head(rig, f"hand_{s}") - _head(rig, f"lowerarm_{s}")).normalized()
            have = _palm_normal(rig, s)
            want = Vector(palm)
            have -= axis * have.dot(axis)
            want -= axis * want.dot(axis)
            if have.length > 1e-4 and want.length > 1e-4:
                ang = have.angle(want)
                if have.cross(want).dot(axis) < 0:
                    ang = -ang
                pb = rig.pose.bones[f"lowerarm_{s}"]
                # the bone's own Y runs along the forearm: turn about it
                ydir = (pb.matrix.to_3x3() @ Vector((0, 1, 0))).normalized()
                mh.twist(rig, f"lowerarm_{s}", ang if ydir.dot(axis) > 0 else -ang)
        mh.aim(rig, f"hand_{s}", hand_dir)
        miss = Vector(target) - Vector(_hand_point(rig, s, point))
        wrist += miss
        if miss.length < 0.002:
            break
    print(f"[reach] {s} miss {miss.length * 1000:.1f} mm, palm {tuple(round(x, 2) for x in _palm_normal(rig, s))}",
          flush=True)
    return miss.length


def _hand_point(rig, s, point):
    m = rig.matrix_world
    b = rig.pose.bones
    bpy.context.view_layer.update()
    wrist = m @ b[f"hand_{s}"].head
    knuckles = [m @ b[f"{f}_01_{s}"].head for f in ("index", "middle", "ring", "pinky")]
    if point == "palm":
        return (wrist + sum(knuckles, Vector()) / 4) / 2
    if point == "index_tip":
        return m @ b[f"index_03_{s}"].tail
    if point == "pinch":
        return (m @ b[f"index_03_{s}"].tail + m @ b[f"thumb_03_{s}"].tail) / 2
    return (knuckles[1] + m @ b[f"middle_03_{s}"].tail + m @ b[f"thumb_03_{s}"].tail) / 3


# ---------------------------------------------------------------------------------------- poses
# Directions and targets are in the body's own frame: it faces -Y, +X is its left, Z is up, the soles at
# FLOOR. No raised arm is straight (a straight raised arm reads as a salute).

# where the merchant's right fist holds the balance cord, relative to his right shoulder joint, and the
# balance hanging from it (scene.py builds the balance from the same numbers)
GRIP = Vector((0.13, -0.36, -0.03))
CORD, HALF, DROP = 0.10, 0.17, 0.17   # fist to beam, beam centre to each end, beam to pan rim


def pose_weigh(rig):
    """Ashur-idi holds the balance up by its cord in his right fist, elbow bent and down, and drops a
    piece of silver into the left pan; his head is bowed toward the beam."""
    mh.aim(rig, "spine_03", (0, -0.06, 1))
    mh.aim(rig, "neck_01", (-0.03, -0.18, 1))
    mh.aim(rig, "head", (-0.1, -0.35, 1.0))
    sh = _head(rig, "upperarm_r")
    fist(rig, "r")
    grip = sh + GRIP
    reach(rig, "r", grip, pole=(-0.5, 0.4, -1.0), hand_dir=(0.1, -0.45, 1.0), palm=(0.9, 0.0, 0.2))
    pinch = grip + Vector((2 * HALF, 0.0, -CORD - DROP + 0.05))
    pen_grip(rig, "l")
    reach(rig, "l", pinch, pole=(0.6, 0.3, -1.0), hand_dir=(-0.2, -0.75, -0.55), point="pinch",
          palm=(0.0, 0.3, -1.0))


def pose_receive(rig):
    """The first borrower: both hands cupped together in front of the belt, palms up, to take the
    silver."""
    for s, sx in (("l", 1), ("r", -1)):
        sh = _head(rig, f"upperarm_{s}")
        tgt = Vector((0.05 * sx, sh.y - 0.42, sh.z - 0.24))
        reach(rig, s, tgt, pole=(0.7 * sx, 0.6, -1.0), hand_dir=(-0.3 * sx, -0.9, 0.1), point="palm",
              palm=(-0.35 * sx, -0.1, 1.0))
        for f, c in (("index", 0.35), ("middle", 0.4), ("ring", 0.45), ("pinky", 0.5)):
            for k in ("01", "02", "03"):
                pb = rig.pose.bones[f"{f}_{k}_{s}"]
                pb.rotation_mode = "XYZ"
                pb.rotation_euler = (c * (0.6 if k == "01" else 1.0), 0, 0)
    mh.aim(rig, "head", (0, -0.4, 1.0))


def pose_wait(rig):
    """The second borrower: hands clasped in front at the belt, watching the beam."""
    for s, sx in (("l", 1), ("r", -1)):
        mh.aim(rig, f"upperarm_{s}", (0.14 * sx, -0.22, -1.0))
        mh.aim(rig, f"lowerarm_{s}", (-0.55 * sx, -0.8, 0.05))
        mh.aim(rig, f"hand_{s}", (-0.85 * sx, -0.5, -0.15))
    relax_hands(rig)
    mh.aim(rig, "head", (0.08, -0.2, 1.0))


# the scribe's tablet on his left palm, relative to the top of his left thigh near the knee; the stylus
# tip touches its face
TABLET = Vector((-0.07, -0.13, 0.13))


def pose_write(rig):
    """The scribe on a stool: a small tablet on his left palm, a reed stylus in his right hand pressing
    into it, head bowed over the clay."""
    for s, sx in (("l", 1), ("r", -1)):
        mh.aim(rig, f"thigh_{s}", (0.12 * sx, -1.0, -0.05))
        mh.aim(rig, f"calf_{s}", (0.03 * sx, -0.1, -1.0))
        mh.aim(rig, f"foot_{s}", (0.0, -1.0, -0.3))
    mh.aim(rig, "spine_02", (0, -0.25, 1))
    mh.aim(rig, "spine_03", (0, -0.35, 1))
    mh.aim(rig, "neck_01", (0, -0.6, 1))
    mh.aim(rig, "head", (0, -0.9, 0.55))
    knee = _head(rig, "calf_l")
    palm = knee + TABLET
    relax_hands(rig, "l")
    reach(rig, "l", palm, pole=(0.8, 0.3, -1.0), hand_dir=(-0.45, -0.9, 0.08), point="palm",
          palm=(0.0, 0.0, 1.0))
    pen_grip(rig, "r")
    pinch = palm + Vector((-0.035, 0.01, 0.075))
    reach(rig, "r", pinch, pole=(-0.8, 0.2, -1.0), hand_dir=(0.45, -0.45, -0.75), point="pinch",
          palm=(0.6, 0.2, -0.6))


FIGS = {
    "merchant": dict(targets=[("caucasian-male-young", 1.0), ("universal-male-old-averagemuscle-averageweight", 0.5)],
                     pose=pose_weigh, seated=False, hem=0.078),
    "borrower1": dict(targets=[("african-male-young", 1.0)], pose=pose_receive, seated=False, hem=0.078),
    "borrower2": dict(targets=[("caucasian-male-young", 1.0)], pose=pose_wait, seated=False, hem=0.078),
    "scribe": dict(targets=[("asian-male-old", 1.0)], pose=pose_write, seated=True, hem=0.078),
}


# ---------------------------------------------------------------------------------------- build

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
    """Lower the skeleton through the Root bone (never the rig object; see ../proofs/cloth.py)."""
    rb = rig.pose.bones["Root"]
    rb.location = rig.data.bones["Root"].matrix_local.to_3x3().inverted() @ Vector((0, 0, dz))


def landmarks(rig):
    """World points of both hands (z measured from the floor), for placing what the figure holds."""
    bpy.context.view_layer.update()
    m = rig.matrix_world
    b = rig.pose.bones
    out = {}
    up = Vector((0, 0, -FLOOR))
    for s in "lr":
        for k in ("palm", "grip", "pinch", "index_tip"):
            out[f"{k}_{s}"] = list(Vector(_hand_point(rig, s, k)) + up)
        out[f"wrist_{s}"] = list(m @ b[f"hand_{s}"].head + up)
        out[f"thumb_{s}"] = list(m @ b[f"thumb_03_{s}"].tail + up)
        knuckles = [m @ b[f"{f}_01_{s}"].head for f in ("index", "middle", "ring", "pinky")]
        wrist = m @ b[f"hand_{s}"].head
        across = knuckles[0] - knuckles[3]
        along = sum(knuckles, Vector()) / 4 - wrist
        n = across.cross(along) if s == "r" else along.cross(across)
        out[f"palm_n_{s}"] = list(n.normalized())     # out of the palm
        out[f"along_{s}"] = list(along.normalized())  # wrist toward the knuckles
        out[f"across_{s}"] = list(across.normalized())
    out["head"] = list(m @ b["head"].tail + up)
    out["shoulder_r"] = list(m @ b["upperarm_r"].head + up)
    return out


def learn_pose(ob, rig, spec):
    spec["pose"](rig)
    pts = posed_points(ob)
    dz = FLOOR - min(p.z for p in pts)
    seat_top = None
    if spec["seated"]:
        seat_top = min(p.z for p in pts if -0.1 < p.y < 0.2 and abs(p.x) < 0.2 and p.z < 0.2) + dz
    drop(rig, dz)
    final = store_pose(rig)
    marks = landmarks(rig)
    set_pose(rig)
    return final, seat_top, marks


def belt_for(cob, garment, material, name):
    """A cord belt over the tunic's pinned waist ring (garment: the baked tunic, same vertex order)."""
    pg = cob.vertex_groups["pin"].index
    basis = cob.data.shape_keys.key_blocks["Basis"].data
    ring = [v.index for v in cob.data.vertices if any(g.group == pg for g in v.groups)
            and abs(basis[v.index].co.z - cob["waist_z"]) < 0.02]
    pts = [garment.data.vertices[i].co.copy() for i in sorted(ring)]
    c = sum(pts, Vector()) / len(pts)
    pts = [p + ((p - c) * Vector((1, 1, 0))).normalized() * 0.008 for p in pts]
    return kit.curve_tube(name, pts, 0.011, material=material, closed=True)


def build(fig, frames=75, bending=0.3):
    spec = FIGS[fig]
    clay = kit.mat("clay")
    ob, rig = mh.build(fig, targets=spec["targets"], material=clay)
    cloth.tpose_rest(ob, rig)
    scalp = hair.scalp_verts(ob, rig)
    cob = cloth.make_tunic(ob, rig, fig + "_tunic", clay, hem=spec["hem"])
    final, seat_top, marks = learn_pose(ob, rig, spec)
    cloth.key_pose(rig, 1)
    cloth.key_pose(rig, 16)
    set_pose(rig, final)
    cloth.key_pose(rig, 46)
    cloth.collider(ob)
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, FLOOR))
    floor = bpy.context.active_object
    cloth.collider(floor)
    helpers = [floor]
    if seat_top is not None:
        seat = kit.box("seat", (0.42, 0.34, 0.6), loc=(0, 0.06, seat_top - 0.3 - 0.8), bevel=0.02)
        seat.keyframe_insert("location", frame=34)
        seat.location.z += 0.8
        seat.keyframe_insert("location", frame=52)
        cloth.collider(seat)
        helpers.append(seat)
    cloth.add_cloth(cob, frames, bending=bending)
    cloth.run(frames)
    body = cloth.bake(ob, fig + "_body", clay)
    tun = cloth.bake(cob, fig + "_cloth", clay)
    belt = belt_for(cob, tun, clay, fig + "_belt")
    cap = hair.hair_shell(body, scalp, fig + "_hair", clay, style="curls", cell=0.008, amp=0.003)
    for o in (ob, rig, cob) + tuple(helpers):
        bpy.data.objects.remove(o, do_unlink=True)
    th = tun.modifiers.new("thick", "SOLIDIFY")
    th.thickness, th.offset = 0.005, -1.0
    sd = tun.modifiers.new("sub", "SUBSURF")
    sd.levels = sd.render_levels = 1
    objs = [body, tun, belt, cap]
    for o in objs:
        o.location.z -= FLOOR
    if seat_top is not None:
        marks["seat_top"] = seat_top - FLOOR
    return objs, marks


def preview(fig):
    """The posed body alone (no cloth, no hair), to check a pose and its hands."""
    spec = FIGS[fig]
    clay = kit.mat("clay")
    ob, rig = mh.build(fig, targets=spec["targets"], material=clay)
    spec["pose"](rig)
    pts = posed_points(ob)
    drop(rig, FLOOR - min(p.z for p in pts))
    bpy.context.view_layer.update()
    marks = landmarks(rig)
    rig.location.z -= FLOOR
    bpy.context.view_layer.update()
    return [ob], marks


def main():
    def arg(name, default=None):
        return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default

    fig = arg("--fig", "merchant")
    out = arg("--out")
    pv = int(arg("--preview", "0"))
    res = tuple(int(x) for x in arg("--res", "640x800").split("x"))
    samples = int(arg("--samples", "16"))
    views = arg("--views", "front,side,hands").split(",")
    os.makedirs(out, exist_ok=True)
    t0 = time.time()
    kit.reset("a", res=res, samples=samples)
    objs, marks = preview(fig) if pv else build(fig)
    print(f"[built] {fig} {time.time() - t0:.0f}s", flush=True)
    with open(os.path.join(out, f"{fig}{'_pv' if pv else ''}.json"), "w") as f:
        json.dump(marks, f, indent=1)
    if not pv:
        bpy.data.libraries.write(os.path.join(out, f"{fig}.blend"), set(objs), fake_user=True, compress=True)

    # check renders: whole figure from the front and the side, then a close-up of each hand
    from scenes import _lights_studio
    kit.island(radius=2.0, depth=0.6, seed=11)
    _lights_studio(target=(0, 0, 0.9), key=900, fill=260, rim=450)
    hz = (marks["head"][2])
    cams = {"front": ((0.9, -3.4, 1.15), (0.0, 0.0, hz * 0.52), 50),
            "side": ((-3.3, -1.0, 1.15), (0.0, 0.0, hz * 0.52), 50)}
    for v in views:
        if v == "hands":
            for s in "lr":
                p = Vector(marks[f"palm_{s}"])
                kit.camera(p + Vector((0.25 if s == "l" else -0.25, -0.75, 0.18)), p, lens=60)
                kit.render(os.path.join(out, f"{fig}{'_pv' if pv else ''}_hand_{s}.png"))
            continue
        loc, tgt, lens = cams[v]
        kit.camera(loc, tgt, lens=lens)
        kit.render(os.path.join(out, f"{fig}{'_pv' if pv else ''}_{v}.png"))
    print(f"[done] {fig} {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
