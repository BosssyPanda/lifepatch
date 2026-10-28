"""The three statues of the Lydian mint, built at rung 1 of the figure ladder (cloth simulated on each
pose, carved hair, relaxed hands): a striker with a two-handed hammer raised, a seated worker holding the
punch on the anvil, and a weigher holding up a hand balance.

Each figure is simulated once and saved, baked, to DIR/<fig>.blend with its grip points stored on the
object (grip_l, grip_r: palm centres in the figure's own frame), so the scene can put the hammer, the
punch and the balance into the hands without simulating again. The figure stands on z = 0, faces -Y and
+X is its left (MakeHuman's frame, see proofs/README.md).

  MPFB_DATA=... python coins/figures.py --out DIR --fig striker|holder|weigher [--check 1]

About a minute of simulation per figure on four cores; --check 1 renders the figure with stand-in props
at its grips, to see that the hands hold them.
"""
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
INTRO = os.path.dirname(HERE)
sys.path[:0] = [HERE, INTRO, os.path.join(INTRO, "proofs")]

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import cloth  # noqa: E402
import hair  # noqa: E402
import kit  # noqa: E402
import mh_figure as mh  # noqa: E402
import scenes  # noqa: E402


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


FLOOR = -0.818  # MakeHuman's soles in rest units


# ---------------------------------------------------------------------------------------- posing

def _p(rig, bone, end="head"):
    bpy.context.view_layer.update()
    pb = rig.pose.bones[bone]
    return rig.matrix_world @ (pb.head if end == "head" else pb.tail)


def reach(rig, side, wrist, pole, hand_dir, palm=None):
    """Two-bone IK for one arm: put the wrist at `wrist` (world), the elbow bending toward `pole`, the hand
    pointing along `hand_dir`. `palm` turns the hand about its length so its palm faces that way."""
    sh = _p(rig, f"upperarm_{side}")
    l1 = rig.pose.bones[f"upperarm_{side}"].length
    l2 = rig.pose.bones[f"lowerarm_{side}"].length
    t = Vector(wrist)
    d = t - sh
    dist = min(d.length, (l1 + l2) * 0.995)
    d.normalize()
    # elbow: law of cosines in the plane of shoulder, wrist and pole
    a = math.acos(max(-1.0, min(1.0, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist))))
    pv = Vector(pole) - d * Vector(pole).dot(d)
    pv.normalize()
    elbow = sh + d * (l1 * math.cos(a)) + pv * (l1 * math.sin(a))
    mh.aim(rig, f"upperarm_{side}", elbow - sh)
    mh.aim(rig, f"lowerarm_{side}", sh + d * dist - _p(rig, f"lowerarm_{side}"))
    mh.aim(rig, f"hand_{side}", hand_dir, up=palm)


def grip(rig, side, amount=0.88, thumb=0.5):
    """A closed hand round a handle: fingers curled, thumb over them."""
    for f, extra in (("index", 0.0), ("middle", 0.05), ("ring", 0.1), ("pinky", 0.15)):
        for k in ("01", "02", "03"):
            pb = rig.pose.bones[f"{f}_{k}_{side}"]
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = ((amount + extra) * (0.75 if k == "01" else 1.0), 0, 0)
    for k, a in (("01", 0.25), ("02", thumb), ("03", thumb)):
        pb = rig.pose.bones[f"thumb_{k}_{side}"]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (a, 0, 0)


def relax(rig, side):
    """Fingers gently curled, more toward the little finger (as in the ladder)."""
    sx = 1 if side == "l" else -1
    for f, base, spread in (("index", 0.21, -0.06), ("middle", 0.27, 0.0), ("ring", 0.36, 0.06),
                            ("pinky", 0.47, 0.12)):
        for k in ("01", "02", "03"):
            pb = rig.pose.bones[f"{f}_{k}_{side}"]
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = (base * (0.6 if k == "01" else 1.0), 0, spread * sx if k == "01" else 0)
    for k, a in (("01", 0.1), ("02", 0.2), ("03", 0.25)):
        pb = rig.pose.bones[f"thumb_{k}_{side}"]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (a, 0, 0)


def palm_centre(rig, side):
    """World centre of the tunnel a closed hand makes round a handle: the mean of the joints of the curled
    index, middle and ring fingers (a curled finger's joints ring the space it closes round)."""
    bpy.context.view_layer.update()
    pts = []
    for f in ("index", "middle", "ring"):
        js = [_p(rig, f"{f}_01_{side}"), _p(rig, f"{f}_02_{side}"), _p(rig, f"{f}_03_{side}"),
              _p(rig, f"{f}_03_{side}", "tail")]
        pts.append(sum(js, Vector()) / 4)
    return sum(pts, Vector()) / 3


def thumb_axis(rig, side):
    """The axis a handle runs along through this closed hand, signed toward the thumb."""
    bpy.context.view_layer.update()
    m = (rig.matrix_world @ rig.pose.bones[f"hand_{side}"].matrix).to_3x3()
    x = (m @ Vector((1, 0, 0))).normalized()
    th = _p(rig, f"thumb_02_{side}") - _p(rig, f"hand_{side}")
    return x if th.dot(x) > 0 else -x


def hold(rig, side, tool, forearm):
    """Turn the hand so a handle through its fist runs along `tool` (pointing out of the thumb side), with
    the hand pointing as near `forearm` as that allows."""
    bpy.context.view_layer.update()
    pb = rig.pose.bones[f"hand_{side}"]
    m = pb.matrix.copy()
    x0 = (m.to_3x3() @ Vector((1, 0, 0))).normalized()
    th = _p(rig, f"thumb_02_{side}") - _p(rig, f"hand_{side}")
    sign = 1.0 if th.dot(x0) > 0 else -1.0
    x = Vector(tool).normalized() * sign
    y = Vector(forearm) - x * Vector(forearm).dot(x)
    y.normalize()
    z = x.cross(y)
    r = Matrix((x, y, z)).transposed().to_4x4()
    r.translation = m.translation
    pb.matrix = r
    bpy.context.view_layer.update()


# Body frame for the poses below: the body faces -Y, +X is its left, Z up. Heights are in the rig's rest
# units, before the drop to the floor (the soles are at FLOOR = -0.818). Each pose returns its tools:
# {side: tool axis toward the working end}, used to place the hammer, punch, tongs and balance.

def _sit_legs(rig, spread=0.32, knee_up=0.28):
    """Seated on a low stool: knees a little higher than the hips, shins upright."""
    for s, sx in (("l", 1), ("r", -1)):
        mh.aim(rig, f"thigh_{s}", (spread * sx, -1.0, knee_up))
        mh.aim(rig, f"calf_{s}", (0.04 * sx, 0.04, -1.0))
        mh.aim(rig, f"foot_{s}", (0.08 * sx, -1.0, -0.3))


def pose_coiner(rig):
    """Seated low at the anvil, which stands between the knees. The left fist holds the punch upright on
    the blank; the right hand holds the hammer up, about to strike."""
    _sit_legs(rig, 0.38)
    mh.aim(rig, "spine_01", (0.0, -0.12, 1.0))
    mh.aim(rig, "spine_02", (0.0, -0.42, 1.0))
    mh.aim(rig, "spine_03", (-0.03, -0.36, 1.0))
    mh.aim(rig, "neck_01", (0.0, -0.45, 1.0))
    # the head bone runs up through the crown, so its direction is the crown's: tipped forward to look down
    mh.aim(rig, "head", (0.03, -0.55, 1.0))  # looking down at the punch
    pel = _p(rig, "pelvis")
    reach(rig, "l", pel + Vector((0.06, -0.56, 0.08)), pole=(1.0, 0.2, -0.5), hand_dir=(-0.4, -1.0, -0.2))
    grip(rig, "l")
    hold(rig, "l", (0.0, 0.08, 1.0), (-0.45, -1.0, -0.15))
    shr = _p(rig, "upperarm_r")
    reach(rig, "r", shr + Vector((-0.1, -0.12, 0.33)), pole=(-1.0, 0.6, -0.1), hand_dir=(0.0, -0.2, 1.0))
    grip(rig, "r")
    hold(rig, "r", (0.05, -0.45, 1.0), (0.0, 0.5, 1.0))
    return {"l": (0.0, 0.08, 1.0), "r": (0.05, -0.45, 1.0)}


def pose_stoker(rig):
    """Kneeling on the right knee at the hearth, the right hand gripping the crucible with tongs, the left hand
    on the left knee."""
    aim = mh.aim
    aim(rig, "spine_01", (0, -0.05, 1))
    aim(rig, "spine_02", (0, -0.25, 1))
    aim(rig, "spine_03", (0, -0.3, 1))
    aim(rig, "thigh_l", (0.14, -1.0, -0.12))
    aim(rig, "calf_l", (0.0, 0.08, -1.0))
    aim(rig, "foot_l", (0.0, -1.0, -0.35))
    aim(rig, "thigh_r", (-0.1, -0.2, -1.0))
    aim(rig, "calf_r", (0.0, 1.0, -0.05))
    aim(rig, "foot_r", (0.0, 0.25, -1.0))
    aim(rig, "neck_01", (0, -0.35, 1))
    aim(rig, "head", (-0.08, -0.5, 1.0))  # crown tipped forward, looking down into the crucible
    knee = _p(rig, "calf_l")
    # palm down on the kneecap, fingers over its front (local Z of the hand is the back of the hand)
    reach(rig, "l", knee + Vector((0.0, 0.07, 0.06)), pole=(1.0, 0.5, -0.3), hand_dir=(0.05, -1.0, -0.6), palm=(0, 0, -1))
    relax(rig, "l")
    pel = _p(rig, "pelvis")
    tongs = Vector((-0.15, -1.0, -0.35)).normalized()
    reach(rig, "r", pel + Vector((-0.3, -0.5, 0.2)), pole=(-1.0, 0.3, -0.8), hand_dir=(-0.1, -1.0, -0.2))
    grip(rig, "r", amount=0.95)
    hold(rig, "r", tongs, (0.2, -0.6, -0.8))
    return {"r": tuple(tongs)}


HEAD_TURN = float(os.environ.get("HEAD_TURN", "0.6"))


def pose_weigher(rig):
    """Standing, holding a hand balance up by its cord at chin height and looking at the beam; the left hand
    low in front, palm up, with a coin to lay in the pan."""
    for s, sx in (("l", 1), ("r", -1)):
        mh.aim(rig, f"thigh_{s}", (0.06 * sx, -0.03, -1.0))
        mh.aim(rig, f"calf_{s}", (0.03 * sx, 0.04, -1.0))
    mh.aim(rig, "spine_03", (0.0, -0.08, 1.0))
    shr = _p(rig, "upperarm_r")
    reach(rig, "r", shr + Vector((0.06, -0.4, 0.1)), pole=(-1.0, 0.3, -1.0), hand_dir=(0.1, -1.0, 0.6))
    grip(rig, "r", amount=0.9, thumb=0.6)
    hold(rig, "r", (0.0, 0.0, 1.0), (0.15, -1.0, 0.3))
    shl = _p(rig, "upperarm_l")
    reach(rig, "l", shl + Vector((-0.08, -0.35, -0.3)), pole=(1.0, 0.4, -1.0), hand_dir=(-0.3, -1.0, 0.1))
    relax(rig, "l")
    mh.twist(rig, "lowerarm_l", -1.2)
    mh.aim(rig, "neck_01", (0, -0.12, 1.0))
    mh.aim(rig, "head", (0.0, -0.35, 1.0))  # crown tipped a little forward: looking down at the pans
    mh.twist(rig, "head", HEAD_TURN)  # face turned to his right, at the beam
    return {"r": (0.0, 0.0, 1.0)}


FIGS = {
    "coiner": dict(targets=[("caucasian-male-young", 1.0), ("universal-male-young-maxmuscle-averageweight", 0.4)],
                   pose=pose_coiner, hem=0.30, seated=True),
    "stoker": dict(targets=[("caucasian-male-young", 1.0)], pose=pose_stoker, hem=0.45, seated=False),
    "weigher": dict(targets=[("caucasian-male-old", 1.0)], pose=pose_weigher, hem=0.078, seated=False),
}


# ---------------------------------------------------------------------------------------- build

def hands_of(rig, spec):
    """The hands that hold something: the ones whose fingers the pose closed into a grip."""
    return [s for s in "lr" if rig.pose.bones[f"index_02_{s}"].rotation_euler.x > 0.8]


def store_pose(rig):
    return {pb.name: (tuple(pb.rotation_quaternion), tuple(pb.rotation_euler), tuple(pb.location))
            for pb in rig.pose.bones}


def set_pose(rig, pose=None):
    for pb in rig.pose.bones:
        q, e, loc = pose[pb.name] if pose else ((1, 0, 0, 0), (0, 0, 0), (0, 0, 0))
        pb.rotation_quaternion, pb.rotation_euler, pb.location = q, e, loc


def posed_points(ob):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    used = {i for p in me.polygons for i in p.vertices}
    pts = [ev.matrix_world @ me.vertices[i].co for i in used]
    ev.to_mesh_clear()
    return pts


def drop(rig, dz):
    """Lower the skeleton through its Root bone (see proofs/cloth.py on why not the rig object)."""
    rb = rig.pose.bones["Root"]
    rb.location = rig.data.bones["Root"].matrix_local.to_3x3().inverted() @ Vector((0, 0, dz))


def build(fig, frames, bending):
    spec = FIGS[fig]
    clay = kit.mat("clay")
    ob, rig = mh.build(fig, targets=spec["targets"], material=clay)
    cloth.tpose_rest(ob, rig)
    scalp = hair.scalp_verts(ob, rig)
    cob = cloth.make_tunic(ob, rig, fig + "_tunic", clay, hem=spec["hem"])
    # learn the pose: where it puts the soles, the seat and the grips; then back to rest for the sim
    spec["pose"](rig)
    pts = posed_points(ob)
    dz = FLOOR - min(p.z for p in pts)
    seat_top = None
    if spec["seated"]:
        pel = _p(rig, "pelvis")
        seat_top = min(p.z for p in pts if abs(p.x - pel.x) < 0.16 and abs(p.y - pel.y) < 0.14
                       and p.z < pel.z) + dz
    drop(rig, dz)
    bpy.context.view_layer.update()
    grips = {s: (palm_centre(rig, s), thumb_axis(rig, s)) for s in hands_of(rig, spec)}
    seat_xy = _p(rig, "pelvis").xy
    final = store_pose(rig)
    set_pose(rig)
    cloth.key_pose(rig, 1)
    cloth.key_pose(rig, 16)
    set_pose(rig, final)
    cloth.key_pose(rig, 46)
    cloth.collider(ob)
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, FLOOR))
    floor = bpy.context.active_object
    cloth.collider(floor)
    seat = None
    if seat_top is not None:
        pel = _p(rig, "pelvis")
        seat = kit.box("seat", (0.40, 0.34, 0.6), loc=(0, pel.y + 0.05, seat_top - 0.3), material=kit.mat("clay_dim"),
                       bevel=0.02)
        # the seat rises into place once the legs have bent, like sitting down
        seat.location.z -= 0.8
        seat.keyframe_insert("location", frame=34)
        seat.location.z += 0.8
        seat.keyframe_insert("location", frame=52)
        cloth.collider(seat)
    cloth.add_cloth(cob, frames, bending=bending)
    cloth.run(frames)
    body = cloth.bake(ob, fig + "_body", clay)
    tun = cloth.bake(cob, fig + "_cloth", clay)
    th = tun.modifiers.new("thick", "SOLIDIFY")
    th.thickness, th.offset = 0.005, -1.0
    sd = tun.modifiers.new("sub", "SUBSURF")
    sd.levels = sd.render_levels = 1
    pg = cob.vertex_groups["pin"].index
    basis = cob.data.shape_keys.key_blocks["Basis"].data
    ring = [v.index for v in cob.data.vertices if any(g.group == pg for g in v.groups)
            and abs(basis[v.index].co.z - cob["waist_z"]) < 0.02]
    bpts = [tun.data.vertices[i].co.copy() for i in sorted(ring)]
    c = sum(bpts, Vector()) / len(bpts)
    bpts = [p + ((p - c) * Vector((1, 1, 0))).normalized() * 0.008 for p in bpts]
    belt = kit.curve_tube(fig + "_belt", bpts, 0.011, material=clay, closed=True)
    cap = hair.hair_shell(body, scalp, fig + "_hair", clay, style="curls", cell=0.008, amp=0.003)
    parts = [body, tun, belt, cap]
    # everything else goes; the figure is lifted so its soles are on z = 0
    keep = {o.name for o in parts}
    for o in list(bpy.context.scene.objects):
        if o.name not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in parts:
        o.location.z -= FLOOR
    # bake modifiers into plain meshes and join, so the scene appends one object per figure
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    meshes = []
    for o in parts:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), depsgraph=dg)
        me.transform(o.matrix_world)
        no = bpy.data.objects.new(o.name + "_m", me)
        bpy.context.scene.collection.objects.link(no)
        me.materials.clear()
        me.materials.append(clay)
        meshes.append(no)
    for o in parts:
        bpy.data.objects.remove(o, do_unlink=True)
    # the Root drop leaves the soles a little off z = 0; set the body on it exactly (the body, not the
    # cloth: a hem pressed under a kneeling knee can poke through the floor and would lift the figure)
    bme = meshes[0].data
    lift = -min(bme.vertices[i].co.z for p in bme.polygons for i in p.vertices)
    fob = kit.join(meshes, fig)
    for p in fob.data.polygons:
        p.use_smooth = True
    fob.data.transform(Matrix.Translation((0, 0, lift)))
    for s, (g, ax) in grips.items():
        fob[f"grip_{s}"] = list(g - Vector((0, 0, FLOOR - lift)))
        fob[f"axis_{s}"] = list(ax)
    if seat_top is not None:
        fob["seat_top"] = seat_top - FLOOR + lift
        fob["seat_xy"] = list(seat_xy)
    fob["tris"] = mh.tri_count(fob)
    return fob


def pose_only(fig):
    """The body in the pose with no cloth (seconds, not minutes): for getting a pose right."""
    spec = FIGS[fig]
    clay = kit.mat("clay")
    ob, rig = mh.build(fig, targets=spec["targets"], material=clay)
    cloth.tpose_rest(ob, rig)
    spec["pose"](rig)
    pts = posed_points(ob)
    dz = FLOOR - min(p.z for p in pts)
    seat_top = None
    if spec["seated"]:
        pel = _p(rig, "pelvis")
        seat_top = min(p.z for p in pts if abs(p.x - pel.x) < 0.16 and abs(p.y - pel.y) < 0.14
                       and p.z < pel.z) + dz
    drop(rig, dz)
    bpy.context.view_layer.update()
    grips = {s: (palm_centre(rig, s), thumb_axis(rig, s)) for s in hands_of(rig, spec)}
    seat_xy = _p(rig, "pelvis").xy
    fob = cloth.bake(ob, fig, clay)
    for o in (ob, rig):
        bpy.data.objects.remove(o, do_unlink=True)
    fob.location.z -= FLOOR
    lift = -min(fob.data.vertices[i].co.z for p in fob.data.polygons for i in p.vertices) - fob.location.z
    fob.location.z += lift
    for s, (g, ax) in grips.items():
        g = g + Vector((0, 0, lift))
        fob[f"grip_{s}"] = list(g - Vector((0, 0, FLOOR)))
        fob[f"axis_{s}"] = list(ax)
    if seat_top is not None:
        fob["seat_top"] = seat_top - FLOOR + lift
        fob["seat_xy"] = list(seat_xy)
    fob["tris"] = mh.tri_count(fob)
    return fob


def rod(name, a, b, r, material):
    a, b = Vector(a), Vector(b)
    d = b - a
    ob = kit.cyl(name, r, d.length, material=material, segs=16)
    ob.location = (a + b) / 2
    ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    return ob


def check_props(fob):
    """Stand-ins for the tools, at the grips and along the grip axes the figure stored."""
    g = {s: Vector(fob[f"grip_{s}"]) for s in "lr" if f"grip_{s}" in fob}
    ax = {s: Vector(fob[f"axis_{s}"]) for s in g}
    dark, wood = kit.mat("rock"), kit.mat("wood")
    name = fob.name.split(".")[0]
    if name == "coiner":
        rod("punch", g["l"] - ax["l"] * 0.15, g["l"] + ax["l"] * 0.045, 0.012, dark)
        rod("handle", g["r"] - ax["r"] * 0.06, g["r"] + ax["r"] * 0.26, 0.013, wood)
        h = g["r"] + ax["r"] * 0.27
        side = ax["r"].cross(Vector((1, 0, 0))).normalized()
        rod("head", h - side * 0.06, h + side * 0.06, 0.03, dark)
    elif name == "stoker":
        rod("tongs", g["r"] - ax["r"] * 0.08, g["r"] + ax["r"] * 0.55, 0.008, dark)
    elif name == "weigher":
        top = g["r"] + ax["r"] * 0.03
        beam = g["r"] - ax["r"] * 0.13
        rod("cord", top, beam, 0.002, dark)
        rod("beam", beam + Vector((-0.13, 0, 0)), beam + Vector((0.13, 0, 0)), 0.005, dark)
        for sx in (-1, 1):
            e = beam + Vector((0.13 * sx, 0, 0))
            kit.cyl(f"pan{sx}", 0.05, 0.01, loc=e - Vector((0, 0, 0.16)), material=dark)
    if "seat_top" in fob:
        sx, sy = fob["seat_xy"]
        kit.box("stool", (0.36, 0.3, fob["seat_top"]), loc=(sx, sy + 0.04, fob["seat_top"] / 2), material=wood,
                bevel=0.02)


def check_render(fob, path, res, samples):
    """The figure with stand-in tools at its grips, from the front, its right and its left."""
    check_props(fob)
    kit.island(radius=2.0, depth=0.6, seed=11)
    scenes._lights_studio(target=(0, 0, 0.9), key=900, fill=260, rim=450, spread=1.0)
    for vname, loc in (("front", (0.9, -3.4, 1.2)), ("right", (-3.3, -0.6, 1.2)), ("left", (3.0, -1.6, 1.4))):
        kit.camera(loc, (0.0, 0.0, 0.75), lens=50)
        kit.render(path.replace(".png", f"_{vname}.png"))
    for s in "lr":
        if f"grip_{s}" in fob:
            g = Vector(fob[f"grip_{s}"])
            for k, off in enumerate(((-0.25, -0.3, 0.08), (0.3, -0.25, 0.1))):
                kit.camera(g + Vector(off), g, lens=60)
                kit.render(path.replace(".png", f"_hand{s}{k}.png"))


if __name__ == "__main__":
    out = arg("--out")
    figs = arg("--fig", "striker").split(",")
    frames = int(arg("--frames", "75"))
    bending = float(arg("--bending", "0.3"))
    check = int(arg("--check", "0"))
    sim = int(arg("--sim", "1"))
    res = tuple(int(x) for x in arg("--res", "700x900").split("x"))
    samples = int(arg("--samples", "24"))
    os.makedirs(out, exist_ok=True)
    for fig in figs:
        t0 = time.time()
        kit.reset("a", res=res, samples=samples)
        fob = build(fig, frames, bending) if sim else pose_only(fig)
        print(f"[built] {fig} {fob['tris']} tris {time.time() - t0:.0f}s", flush=True)
        if sim:
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, f"{fig}.blend"))
        if check:
            check_render(fob, os.path.join(out, f"check_{fig}{'' if sim else '_pose'}.png"), res, samples)
        print(f"[done] {fig} {time.time() - t0:.0f}s", flush=True)
