"""The cave's people: MakeHuman plaster statues in knee-length hide tunics, simulated into their poses
(rung 1 of the figure ladder, chosen by Cindy on 2026-10-27; see ../proofs/README.md).

The scene is a hunter sharing out meat. He kneels and holds a portion out to an elder, who reaches for
it; a mother sits with her portion and turns to her child, who is already eating; a young man sits and
eats. Nobody hands anything back.

Each figure is built in its own process and saved, so the scene can be laid out and re-rendered without
simulating cloth again:

  MPFB_DATA=/path/to/mpfb2/src/mpfb/data .venv-bpy/bin/python figures.py --fig hunter --out CACHE

writes CACHE/hunter.blend (objects hunter_body, hunter_cloth, hunter_belt, hunter_hair, and a seat for
seated figures) and CACHE/hunter.json (the hands' positions, for the food). The figure stands with its
soles at z = 0, facing -Y, centred on the origin. About a minute of simulation per figure on 4 cores.
"""
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(os.path.dirname(HERE), "proofs"), os.path.dirname(HERE)]

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import cloth  # noqa: E402
import hair  # noqa: E402
import kit  # noqa: E402
import mh_figure as mh  # noqa: E402

FLOOR = -0.818  # MakeHuman's soles in rest units
PALM_UP = -1.4


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


# ------------------------------------------------------------------------------------------- poses
# A fresh body faces -Y, +X is its left, Z is up (mh_figure.py).


def _legs_kneel(rig):
    """Right knee and shin on the ground, left foot planted."""
    mh.aim(rig, "thigh_l", (0.12, -1.0, -0.15))
    mh.aim(rig, "calf_l", (0.0, 0.08, -1.0))
    mh.aim(rig, "foot_l", (0.0, -1.0, -0.35))
    mh.aim(rig, "thigh_r", (-0.08, -0.15, -1.0))
    mh.aim(rig, "calf_r", (0.0, 1.0, -0.02))
    mh.aim(rig, "foot_r", (0.0, 0.25, -1.0))


def _legs_sit(rig, spread=0.12, feet=-0.1):
    """Seated on a rock, thighs level, shins down, feet a little forward."""
    for s, sx in (("l", 1), ("r", -1)):
        mh.aim(rig, f"thigh_{s}", (spread * sx, -1.0, -0.05))
        mh.aim(rig, f"calf_{s}", (0.03 * sx, feet, -1.0))
        mh.aim(rig, f"foot_{s}", (0.0, -1.0, -0.3))


def _arms_offer(rig, reach=0.45, drop=0.85, lift=0.35, inward=0.12):
    """Both hands held out together, elbows bent, palms up: giving or receiving with two hands."""
    for s, sx in (("l", 1), ("r", -1)):
        mh.aim(rig, f"upperarm_{s}", (0.14 * sx, -reach, -drop))
        mh.aim(rig, f"lowerarm_{s}", (-inward * sx, -1.0, lift))
        mh.twist(rig, f"lowerarm_{s}", PALM_UP * sx)
        mh.aim(rig, f"hand_{s}", (-0.05 * sx, -1.0, lift * 0.3))


def _arms_hold(rig, height=0.25, inward=0.35):
    """Both hands together in front of the belly, holding something between them."""
    for s, sx in (("l", 1), ("r", -1)):
        mh.aim(rig, f"upperarm_{s}", (0.12 * sx, -0.25, -1.0))
        mh.aim(rig, f"lowerarm_{s}", (-inward * sx, -1.0, height))
        mh.twist(rig, f"lowerarm_{s}", -0.7 * sx)
        mh.aim(rig, f"hand_{s}", (-0.3 * sx, -1.0, 0.0))


def _arms_eat(rig):
    """Both hands up at the mouth, holding food to it."""
    for s, sx in (("l", 1), ("r", -1)):
        mh.aim(rig, f"upperarm_{s}", (0.3 * sx, -0.45, -1.0))
        mh.aim(rig, f"lowerarm_{s}", (-0.38 * sx, -0.55, 1.0))
        mh.twist(rig, f"lowerarm_{s}", -0.9 * sx)
        mh.aim(rig, f"hand_{s}", (-0.45 * sx, -0.6, 0.6))


def _look(rig, tilt=(0.0, -0.15), face=(0.0, -1.0, 0.0)):
    """Head: its bone points up the skull, its local Z out of the face. tilt leans the skull
    (x, y per unit up); face turns the face toward a direction."""
    mh.aim(rig, "head", (tilt[0], tilt[1], 1.0), up=face)


def pose_hunter(rig):
    _legs_kneel(rig)
    mh.aim(rig, "spine_01", (0, -0.02, 1))
    mh.aim(rig, "spine_03", (0, -0.12, 1))
    _arms_offer(rig, reach=0.5, drop=0.8, lift=0.3)
    mh.aim(rig, "neck_01", (0, -0.25, 1))
    _look(rig, (0.0, -0.2), (0.0, -1.0, -0.2))


def pose_elder(rig):
    _legs_sit(rig)
    mh.aim(rig, "spine_02", (0, -0.12, 1))
    mh.aim(rig, "spine_03", (0, -0.2, 1))
    _arms_offer(rig, reach=0.55, drop=0.8, lift=0.3)
    mh.aim(rig, "neck_01", (0, -0.2, 1))
    _look(rig, (0.0, -0.1), (0.0, -1.0, 0.1))


def pose_mother(rig):
    _legs_sit(rig, spread=0.08)
    mh.aim(rig, "spine_02", (0, -0.1, 1))
    mh.aim(rig, "spine_03", (-0.04, -0.15, 1))
    _arms_hold(rig)
    mh.aim(rig, "neck_01", (-0.12, -0.25, 1))
    _look(rig, (-0.1, -0.25), (-0.8, -0.6, -0.25))  # turned to her right, down to the child


def pose_child(rig):
    mh.aim(rig, "spine_03", (0, -0.08, 1))
    _arms_eat(rig)
    _look(rig, (0.0, -0.1), (0.0, -1.0, -0.1))


def pose_eater(rig):
    _legs_sit(rig, spread=0.18, feet=-0.25)
    mh.aim(rig, "spine_02", (0, -0.25, 1))
    mh.aim(rig, "spine_03", (0, -0.3, 1))
    _arms_eat(rig)
    _look(rig, (0.0, -0.3), (0.0, -1.0, -0.2))


FIGS = {
    "hunter": dict(targets=[("african-male-young", 1.0), ("universal-male-young-maxmuscle-averageweight", 0.4)],
                   pose=pose_hunter, seated=False),
    "elder": dict(targets=[("asian-male-old", 1.0)], pose=pose_elder, seated=True),
    "mother": dict(targets=[("african-female-young", 1.0)], pose=pose_mother, seated=True),
    "child": dict(targets=[("caucasian-female-child", 1.0)], pose=pose_child, seated=False),
    "eater": dict(targets=[("caucasian-male-young", 1.0)], pose=pose_eater, seated=True),
}


# ------------------------------------------------------------------------------------------- build


def relax_hands(rig, grip=0.0):
    """Fingers gently curled (more toward the little finger), closer with grip > 0."""
    for s, sx in (("l", 1), ("r", -1)):
        for f, base, spread in (("index", 0.21, -0.06), ("middle", 0.27, 0.0), ("ring", 0.36, 0.06),
                                ("pinky", 0.47, 0.12)):
            for k in ("01", "02", "03"):
                pb = rig.pose.bones[f"{f}_{k}_{s}"]
                pb.rotation_mode = "XYZ"
                b = base + grip
                pb.rotation_euler = (b * (0.6 if k == "01" else 1.0), 0, spread * sx if k == "01" else 0)
        for k, a in (("01", 0.1), ("02", 0.2), ("03", 0.25)):
            pb = rig.pose.bones[f"thumb_{k}_{s}"]
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = (a + grip * 0.5, 0, 0)


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
    """Lower the skeleton through its Root bone (see cloth.py: never move the rig object)."""
    rb = rig.pose.bones["Root"]
    rb.location = rig.data.bones["Root"].matrix_local.to_3x3().inverted() @ Vector((0, 0, dz))


def pose_only(name):
    """The body in its pose with no clothes, standing on z = 0: for checking poses quickly."""
    spec = FIGS[name]
    ob, rig = mh.build(name, targets=spec["targets"], material=kit.mat("clay"))
    spec["pose"](rig)
    relax_hands(rig)
    mh.ground(ob, rig, 0.0)


def build(name, out, frames=75, bending=0.3):
    spec = FIGS[name]
    clay = kit.mat("clay")
    ob, rig = mh.build(name, targets=spec["targets"], material=clay)
    cloth.tpose_rest(ob, rig)
    scalp = hair.scalp_verts(ob, rig)
    # knee length: the hem a quarter of the way up the body from the soles
    zs = [v.co.z for v in ob.data.vertices]
    height = max(zs) - min(zs)
    cob = cloth.make_tunic(ob, rig, name + "_tunic", clay, hem=0.27 * height)

    # pose once to learn the drop to the floor and the seat, then back to rest
    spec["pose"](rig)
    relax_hands(rig)
    pts = posed_points(ob)
    dz = FLOOR - min(p.z for p in pts)
    seat_top = None
    if spec["seated"]:
        seat_top = min(p.z for p in pts if -0.1 < p.y < 0.25 and abs(p.x) < 0.2 and p.z < 0.2) + dz
    drop(rig, dz)
    final = store_pose(rig)
    set_pose(rig)

    cloth.key_pose(rig, 1)
    cloth.key_pose(rig, 16)
    set_pose(rig, final)
    cloth.key_pose(rig, 46)
    cloth.collider(ob)
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, FLOOR))
    cloth.collider(bpy.context.active_object)
    seat = None
    if seat_top is not None:
        seat = kit.box("seat", (0.46, 0.36, 0.6), loc=(0, 0.06, seat_top - 0.3), material=kit.mat("clay_dim"),
                       bevel=0.02)
        # the seat rises into place once the legs have bent, like sitting down
        seat.location.z -= 0.8
        seat.keyframe_insert("location", frame=34)
        seat.location.z += 0.8
        seat.keyframe_insert("location", frame=52)
        cloth.collider(seat)
    cloth.add_cloth(cob, frames, bending=bending)
    cloth.run(frames)

    body = cloth.bake(ob, name + "_body", clay)
    tun = cloth.bake(cob, name + "_cloth", clay)
    # cord belt over the pinned waist ring
    pg = cob.vertex_groups["pin"].index
    basis = cob.data.shape_keys.key_blocks["Basis"].data
    ring = [v.index for v in cob.data.vertices if any(g.group == pg for g in v.groups)
            and abs(basis[v.index].co.z - cob["waist_z"]) < 0.02]
    bp = [tun.data.vertices[i].co.copy() for i in sorted(ring)]
    c = sum(bp, Vector()) / len(bp)
    bp = [p + ((p - c) * Vector((1, 1, 0))).normalized() * 0.008 for p in bp]
    belt = kit.curve_tube(name + "_belt", bp, 0.011, material=clay, closed=True)
    cap = hair.hair_shell(body, scalp, name + "_hair", clay, style="curls", cell=0.008, amp=0.003)

    # hands (palm centres) and head, in the figure's frame with the soles at z = 0
    bpy.context.view_layer.update()
    marks = {}
    for s in "lr":
        pb = rig.pose.bones[f"middle_01_{s}"]
        marks[f"hand_{s}"] = list(rig.matrix_world @ pb.head - Vector((0, 0, FLOOR)))
    marks["head"] = list(rig.matrix_world @ rig.pose.bones["head"].tail - Vector((0, 0, FLOOR)))

    keep = [body, tun, belt, cap] + ([seat] if seat else [])
    for o in list(bpy.context.scene.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in keep:
        o.location.z -= FLOOR
    if seat:
        seat.animation_data_clear()
        seat.modifiers.clear()
        seat.name = name + "_seat"
        marks["seat"] = {"top": seat_top - FLOOR, "size": [0.46, 0.36], "y": 0.06}
    th = tun.modifiers.new("thick", "SOLIDIFY")
    th.thickness, th.offset = 0.005, -1.0
    marks["height"] = height
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, name + ".json"), "w") as f:
        json.dump(marks, f, indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, name + ".blend"))


if __name__ == "__main__":
    fig = arg("--fig")
    out = arg("--out")
    t0 = time.time()
    kit.reset("a", res=(700, 900), samples=int(arg("--samples", "24")))
    if "--pose-only" in sys.argv:
        pose_only(fig)
    else:
        build(fig, out)
    print(f"[built] {fig} {time.time() - t0:.0f}s", flush=True)
    if "--preview" in sys.argv:
        import scenes
        kit.island(radius=2.0, depth=0.6, seed=11)
        scenes._lights_studio(target=(0, 0, 0.8), key=900, fill=260, rim=450, spread=1.0)
        for vname, loc in (("front", (0.5, -3.6, 1.0)), ("side", (-3.4, -0.6, 1.0))):
            kit.camera(loc, (0, 0, 0.72), lens=50)
            kit.render(os.path.join(out, f"{fig}_{vname}.png"))
    print(f"[done] {fig} {time.time() - t0:.0f}s", flush=True)
