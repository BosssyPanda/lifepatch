"""Scene three of the intro, built for real: Lydia's first coins, c. 610-560 BCE.

A small mint on a clay island: a coiner seated at a low anvil, the hammer up over the punch; a stoker on
one knee at a raised hearth, gripping the crucible in the coals with tongs; a weigher holding up a hand balance over a bench of blanks and
struck coins. The hero money is one lion-head electrum trite on its dark stand at the intro's money spot
(scenes.HERO), lit by its own spot, which stays on when the era goes dark.

Figures come from figures.py (simulated once, saved to FIG_DIR); the coin from coin.py; the props from
props.py. Camera is the overview's (frame coins_a) unless --cam says otherwise.

  python coins/scene.py --figs FIG_DIR --out DIR [--relief relief.png] [--looks a] [--cams wide,close]
                        [--dim 0.025] [--res 1280x800] [--samples 32]
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
INTRO = os.path.dirname(HERE)
sys.path[:0] = [HERE, INTRO]

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import coin as coinmod  # noqa: E402
import kit  # noqa: E402
import props  # noqa: E402
import scenes  # noqa: E402

mat = kit.mat


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def load_figure(fig_dir, name, loc, rot_z):
    """Append a baked statue from FIG_DIR/<name>.blend and stand it at loc turned by rot_z. Returns the
    object and a function mapping the figure's own frame to the world (for its grips)."""
    path = os.path.join(fig_dir, f"{name}.blend")
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n == name]
    ob = dst.objects[0]
    kit.link(ob)
    ob.data.materials.clear()
    ob.data.materials.append(mat("clay"))
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    bpy.context.view_layer.update()
    mw = ob.matrix_world.copy()

    def to_world(p, is_dir=False):
        return (mw.to_3x3() @ Vector(p)) if is_dir else (mw @ Vector(p))
    return ob, to_world


def facing_rot(direction):
    """rot_z that turns a MakeHuman statue (which faces -Y) to face `direction` (x, y)."""
    return math.atan2(direction[0], -direction[1])


def build(fig_dir, relief=None):
    kit.island(radius=5.0, depth=0.7, seed=13)
    props.brick_wall("wallB", (0, 3.4, 1.3), (5.5, 0.4, 2.6))
    props.brick_wall("wallR", (2.6, 1.9, 1.3), (0.4, 3.2, 2.6), rot_z=-0.2)

    # --- the coiner, seated at the anvil, his right side (the hammer arm) toward the camera
    co_loc = Vector((-0.05, 1.75, 0.0))
    co_rot = facing_rot((0.82, -0.57))
    coiner, cw = load_figure(fig_dir, "coiner", co_loc, co_rot)
    sx, sy = coiner["seat_xy"]
    props.stool("stool", cw((sx, sy + 0.03, 0)), coiner["seat_top"], rot_z=co_rot)
    gl, al = cw(coiner["grip_l"]), cw(coiner["axis_l"], True)
    gr, ar = cw(coiner["grip_r"]), cw(coiner["axis_r"], True)
    tip = gl - al.normalized() * 0.15
    props.anvil("anvil", tip)
    props.punch("punch", gl, al)
    props.hammer("hammer", gr, ar)

    # --- the stoker, on one knee at an open hearth, gripping the crucible in the coals with his tongs,
    # side on to the camera with his tongs hand toward it
    fur, mouth = props.hearth("hearth", (-1.15, 2.3, 0.0))
    stoker, _sw = load_figure(fig_dir, "stoker", (0, 0, 0), 0.0)
    g0, a0 = Vector(stoker["grip_r"]), Vector(stoker["axis_r"])
    # turn him about Z so his tongs point at the mouth, then slide him so the jaws reach just inside it
    target = mouth
    # he kneels behind and left of the hearth, facing the camera's right, so his back leg runs away into
    # depth instead of out sideways (side on, it read as a leap)
    approach = Vector((-0.75, 0.66, 0)).normalized()
    # the tongs run along his grip axis; set him back from the crucible by as much as that slope needs
    an = a0.normalized()
    elev = math.asin(max(0.05, -an.z))
    dz = g0.z - target.z
    span = max(0.3, dz / math.tan(elev))
    g_world = target + approach * span
    g_world.z = g0.z
    want = target - g_world
    turn = math.atan2(want.y, want.x) - math.atan2(an.y, an.x)
    rot = Matrix.Rotation(turn, 3, "Z")
    stoker.rotation_euler = (0, 0, turn)
    stoker.location = g_world - rot @ g0
    stoker.location.z = 0.0
    bpy.context.view_layer.update()
    mw = stoker.matrix_world
    g, a = mw @ g0, mw.to_3x3() @ a0
    props.tongs("tongs", g, a, length=(target - g).length + 0.03)

    # --- the weigher, holding up a hand balance over the bench
    we_loc = Vector((1.35, 2.45, 0.0))
    we_rot = facing_rot((-0.62, -0.78))
    weigher, ww = load_figure(fig_dir, "weigher", we_loc, we_rot)
    gb = ww(weigher["grip_r"])
    props.hand_balance("balance", gb, facing=we_rot + 0.3, tilt=math.radians(4))
    bench, top = props.bench("bench", (1.05, 1.75, 0.0), size=(1.0, 0.46, 0.7), rot_z=math.radians(-28))
    tz = top.translation.z
    cloth = kit.box("cloth", (0.46, 0.3, 0.006), material=mat("paper"), bevel=0.002)
    cloth.matrix_world = top @ Matrix.Translation((0.18, 0.0, 0.003))
    bpy.context.view_layer.update()
    props.plinth_coins("struck", cloth.matrix_world.translation + Vector((0, 0, 0.006)), 3, 5, 0.075, 0.042,
                       rot_z=math.radians(-28), seed=3)
    bw = props.bowl("bowl", top @ Vector((-0.27, 0.02, 0.0)), r=0.12, h=0.06)
    props.blanks("blank", bw.location + Vector((0, 0, 0.012)), 9, 0.07, 0.034, seed=4)

    _lights()
    return dict(anvil=tip, punch=gl, hammer=gr, hearth=target, balance=gb, bench=top.translation.copy(),
                stoker=Vector(stoker.location), weigher=Vector(weigher.location))


def _lights():
    scenes._lights_studio(target=(0, 1.6, 0.8), key=850, fill=240, rim=420)


def hero(cam, relief=None):
    hp = scenes.hero_point(cam)
    scenes.stand("ledge", cam, hp, hp.z - 0.035)
    c = coinmod.Coin(relief=relief)
    ob = coinmod.coin_mesh("hero", c, size=0.1, voxel=0.05)
    # lean it back toward the lens and seat its lowest point on the stand
    ob.rotation_euler = scenes.face_cam(cam, math.radians(55))
    ob.location = hp
    bpy.context.view_layer.update()
    lo = min((ob.matrix_world @ v.co).z for v in ob.data.vertices)
    ob.location.z += (hp.z - 0.035) - lo - 0.0005
    scenes.mark_hero(ob)
    scenes.hero_light(cam, hp, 12.0)
    return ob


CAMS = {
    # the overview's camera (frame coins_a): the money spot lower left, the mint behind
    "wide": dict(loc=(-0.5, -2.5, 1.05), target=(0.15, 1.6, 0.72), lens=34),
}


def detail_cam(name, pts):
    """Close views for checking the build (not frames of the intro): the strike, the bench and balance,
    the hearth."""
    if name == "strike":
        t = (pts["punch"] + pts["anvil"]) / 2
        return kit.camera(t + Vector((-0.35, -0.75, 0.3)), t, lens=50)
    if name == "fist":
        t = pts["punch"]
        return kit.camera(t + Vector((-0.12, -0.3, 0.1)), t, lens=60)
    if name == "bench":
        t = (pts["balance"] + pts["bench"]) / 2 + Vector((0, 0, -0.05))
        return kit.camera(t + Vector((-0.6, -1.3, 0.2)), t, lens=50)
    if name == "hearth":
        t = pts["hearth"] + Vector((-0.25, 0, 0.1))
        return kit.camera(t + Vector((0.2, -1.6, 0.35)), t, lens=45)
    raise KeyError(name)


if __name__ == "__main__":
    out = arg("--out")
    fig_dir = arg("--figs")
    os.makedirs(out, exist_ok=True)
    looks = arg("--looks", "a").split(",")
    cams = arg("--cams", "wide").split(",")
    res = tuple(int(x) for x in arg("--res", "1280x800").split("x"))
    samples = int(arg("--samples", "32"))
    dim = float(arg("--dim", "0"))
    rel = arg("--relief")
    relief = coinmod.load_relief(rel) if rel else None
    tag = arg("--tag", "")
    for lk in looks:
        for cn in cams:
            kit.reset(lk, res=res, samples=samples)
            pts = build(fig_dir, relief)
            if cn in CAMS:
                spec = CAMS[cn]
                cam = kit.camera(spec["loc"], spec["target"], lens=spec["lens"])
                hero(cam, relief)
            else:
                wide = CAMS["wide"]
                hero(kit.camera(wide["loc"], wide["target"], lens=wide["lens"]), relief)
                detail_cam(cn, pts)
            if dim:
                kit.dim(dim)
            name = f"coins_{lk}_{cn}{'_dim' if dim else ''}{tag}.png"
            kit.render(os.path.join(out, name))
            print("[render]", name, flush=True)
