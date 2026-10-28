"""Era five of the intro, c. 1602: the first company shares.

One action carries the scene: on a quay, a buyer hands silver across a writing table to a bookkeeper of
the Dutch East India Company (VOC), who enters him in the company's register. The VOC issued no share
certificates; it kept its shareholders in its books (Westfries Archief, "The world's oldest share").
Behind them lies a full-size merchant ship, the voyage the money pays for. The era's money sits at the
intro's fixed money spot: a strongbox of Spanish pieces of eight with, propped against its open lid, the
oldest known VOC share document, which is the receipt for the last instalment (9 September 1606) on a
share Pieter Harmensz bought in 1602 (Westfries Archief).

    MPFB_DATA=... .venv-bpy/bin/python scripts/blender/intro/shares/shares.py --figs /tmp/shares/figs \
        --out /tmp/shares/r [--views main,dim,close,wide] [--res 1280x800] [--samples 32] [--sails set]

The statues come from figures.py (run it once per figure first; each takes about 7 minutes).
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
INTRO = os.path.dirname(HERE)
sys.path[:0] = [HERE, INTRO]

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import kit  # noqa: E402
import props  # noqa: E402
import scenes  # noqa: E402
import ship as shipmod  # noqa: E402
from kit import mat  # noqa: E402

WATER_Z = -1.6       # the water lies this far below the quay
TABLE_TOP = 0.722    # under the bookkeeper's forearms (figures.py measures his wrists at 0.756)
SHIP_YAW = float(os.environ.get("SHIP_YAW", "44"))  # stern quarter toward the quay, so the sails show their faces


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def load_figure(path, name, loc, face):
    """Append a statue saved by figures.py, stand it at loc facing the horizontal direction face."""
    with bpy.data.libraries.load(path) as (src, dst):
        dst.objects = list(src.objects)
    root = None
    for ob in dst.objects:
        if ob is None:
            continue
        bpy.context.scene.collection.objects.link(ob)
        if ob.name == name:
            root = ob
    f = Vector(face).normalized()
    root.location = loc
    root.rotation_euler = (0, 0, math.atan2(f.x, -f.y))
    bpy.context.view_layer.update()
    return root


def mark(name):
    return bpy.data.objects[name].matrix_world.translation.copy()


def water():
    lk = kit.look()
    wm = bpy.data.materials.new("water")
    wm.use_nodes = True
    b = wm.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = kit.rgba("#1c1a18" if lk["key_name"] == "a" else "#2c4558")
    b.inputs["Roughness"].default_value = 0.08
    kit._bump(wm.node_tree, b, scale=1.5, strength=0.25, distance=0.05)
    return kit.box("water", (160, 120, 0.05), loc=(0, 50, WATER_Z), material=wm)


def build(figs, sails="set"):
    # The camera's direction is chosen first; its position follows from where the money has to sit in
    # the frame (scenes.HERO), so the money spot matches every other era.
    cam = kit.camera((0, 0, 0), (2.75, 10.55, 1.46), lens=30)
    fwd, right, yaw = scenes._cam_axes(cam)
    rot = Matrix.Rotation(yaw, 4, "Z")

    # ---- the money: a strongbox of silver standing on a barrel head, lid open, the 1606 receipt
    # propped against the lid
    props.barrel("stand_barrel", (0, 0, 0), r=0.27, h=0.72)
    chest_at = Vector((0, 0, 0.72))
    lid_open = math.radians(108)
    cw, cd, ch = 0.44, 0.30, 0.21
    # lighter wood and darker iron than the cargo chests, so the lid reads as a frame round the receipt
    # against the dark hull behind it
    box = props.chest("cashbox", size=(cw, cd, ch), lid_open=lid_open, material=mat("clay_dim", "#6b655b"),
                      iron=mat("clay_dim", "#2c2926"))
    box.location = chest_at
    box.rotation_euler = (0, 0, yaw)
    # the receipt leans on the inside of the lid: its plane through the hinge, tilted back with the lid
    tilt = lid_open - math.pi / 2                      # how far the lid leans back past vertical
    lean = Vector((0, math.sin(tilt), math.cos(tilt)))  # up along the lid, in the box's frame
    rh, rw = 0.205, 0.155
    foot = Vector((0, cd / 2 - 0.012 - 0.03 * math.sin(tilt), ch + 0.006))
    rc_local = foot + lean * (rh / 2 + 0.004) + Vector((0, -0.012, 0))
    hp = chest_at + rot @ rc_local
    receipt = props.sheet("hero_receipt", (rw, rh), props.paper_image("receipt_img", 1100, 1450, "receipt", seed=6),
                          folds=(1 / 3, 2 / 3), curl=0.012, seed=6)
    receipt.rotation_euler = (Matrix.Rotation(yaw, 3, "Z") @ Matrix.Rotation(math.pi / 2 - tilt - 0.05, 3, "X")).to_euler()
    receipt.location = hp
    # now the camera, placed so the receipt lands on the money spot
    bpy.context.view_layer.update()
    cam.location = hp - (scenes.hero_point(cam) - cam.location)
    bpy.context.view_layer.update()
    c0 = Vector((cam.location.x, cam.location.y, 0))
    inner = Vector(box["inner"])
    # filled to the rim and mounded a little in the middle, so the front slope of coins tilts toward the
    # lens and catches the light from above (a heap spilling over the sides read as pirate treasure)
    heap, protos = props.coin_heap("silver_heap", (0, 0, 0), (inner.x - 0.012, inner.y - 0.012), 0.0, n=150, seed=4,
                                   mound=0.05, max_tilt=0.4)
    heap.parent = box
    heap.location = (0, -0.005, ch - 0.03)
    # a flatter layer under it, so the gaps between the top coins show more silver and not the empty box
    under_layer, _ = props.coin_heap("silver_under", (0, 0, 0), (inner.x - 0.008, inner.y - 0.008), 0.0, n=110, seed=9,
                                     mound=0.0, max_tilt=0.25, protos=protos)
    under_layer.parent = box
    under_layer.location = (0, -0.005, ch - 0.042)
    # one piece of eight in front of the receipt, leaning back on the heap, cross toward the lens
    hero_cob = props.cob("piece_of_eight", seed=24)
    hero_cob.parent = box
    t35 = math.radians(35)
    hx, hy = 0.07, -0.085
    under = [c.location.z for c in heap.children if (c.location.x - hx) ** 2 + (c.location.y + 0.005 - hy) ** 2 < 0.025 ** 2]
    hero_cob.location = (hx, hy, heap.location.z + max(under, default=0.0) + 0.002 + 0.019 * math.sin(t35))
    hero_cob.rotation_euler = (t35, 0, 0.25)
    scenes.mark_hero(heap, under_layer, receipt, hero_cob)
    scenes.hero_light(cam, hp, 12.0)
    # a soft card above the money so the silver has something bright to reflect (stays on in the dark)
    card = kit.area_light("hero_card", hp + Vector((0, 0, 0.55)) - fwd * 0.35, hp, 6.0, size=0.5)
    card.data.spread = math.radians(40)   # a narrow cone: it stays on in the dark frame, so it may only reach the money
    card["hero"] = True

    # ---- the table, three and a half metres out, a little right of centre, running slightly away
    a = (right * math.cos(math.radians(16)) + fwd * math.sin(math.radians(16))).normalized()   # along the table
    n = Vector((-a.y, a.x, 0))                                                               # toward its far side
    tw, td = 2.0, 0.84
    tc = c0 + fwd * 3.7 + right * 0.55
    table = props.table("table", size=(tw, td), top_z=TABLE_TOP)
    table.location = tc
    table.rotation_euler = (0, 0, math.atan2(a.y, a.x))

    # ---- the bookkeeper on the far side, the buyer facing him across the table
    load_figure(os.path.join(figs, "bookkeeper.blend"), "bookkeeper", tc - a * 0.2 + n * (td / 2 + 0.26), -n)
    by_loc = tc + a * 0.55 - n * (td / 2 + 0.2)
    load_figure(os.path.join(figs, "buyer.blend"), "buyer", by_loc, (n - a * 0.35))
    seat = mark("bookkeeper.seat")
    props.stool("stool", seat.z).location = (seat.x, seat.y, 0)

    # ---- on the table: the register open in front of the bookkeeper, ink, pen, counted silver
    hl, hr = mark("bookkeeper.hand_l"), mark("bookkeeper.hand_r")
    mid = (hl + hr) / 2
    reg = props.register("register", props.paper_image("ledger_l", 900, 1200, "ledger", seed=2),
                         props.paper_image("ledger_r", 900, 1200, "ledger", seed=3))
    rpos = mid - n * 0.08
    reg.location = (rpos.x, rpos.y, TABLE_TOP)
    reg.rotation_euler = (0, 0, math.atan2(-n.x, n.y) + math.pi)
    props.inkwell("inkwell", (hr.x - a.x * 0.32 - n.x * 0.05, hr.y - a.y * 0.32 - n.y * 0.05, TABLE_TOP))
    pr = mark("bookkeeper.palm_r")
    up_back = (n * 0.55 - a * 0.25 + Vector((0, 0, 0.85))).normalized()
    props.quill("quill", Vector((pr.x, pr.y, TABLE_TOP + 0.004)) - n * 0.05, up_back)
    # the buyer's silver counted out in stacks on the table, just under his hands
    bl, br_ = mark("buyer.palm_l"), mark("buyer.palm_r")
    under = (bl + br_) / 2
    for k, (sa, sn, cnt) in enumerate(((-0.07, 0.07, 7), (0.05, 0.05, 5), (-0.01, 0.15, 9), (0.11, 0.13, 4))):
        p = Vector((under.x, under.y, 0)) + a * sa + n * sn
        for c in range(cnt):
            ob = bpy.data.objects.new(f"stack{k}_{c}", protos[c % len(protos)].data)
            kit.link(ob)
            ob.location = (p.x + 0.002 * math.sin(c * 2.1), p.y + 0.002 * math.cos(c * 1.7), TABLE_TOP + 0.0013 + c * 0.0026)
            ob.rotation_euler = (0.03 * math.sin(c), 0.03 * math.cos(c), c * 0.9)
    # silver on the buyer's palms: a short stack in the hollow of each hand
    for side, cnt in (("l", 3), ("r", 4)):
        pp = mark(f"buyer.hand_{side}").lerp(mark(f"buyer.palm_{side}"), 0.6) + Vector((0, 0, 0.022))
        for c in range(cnt):
            ob = bpy.data.objects.new(f"palm_{side}{c}", protos[(c + 2) % len(protos)].data)
            kit.link(ob)
            ob.location = (pp.x, pp.y, pp.z + c * 0.0026)
            ob.rotation_euler = (0.12, -0.18 if side == "r" else 0.18, c)
    # the proof's hat crown closed in a fan of duplicate points, which rendered as a pinhole: merge them
    import bmesh
    for ob in bpy.context.scene.objects:
        if ob.type == "MESH" and ob.name.startswith("hat"):
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-4)
            bm.to_mesh(ob.data)
            bm.free()

    # ---- the porter, walking right along the quay with a chest of silver for the ship
    po_loc = c0 + fwd * 8.0 + right * 4.0
    load_figure(os.path.join(figs, "porter.blend"), "porter", po_loc, (1.0, 0.25, 0))
    pl, prr = mark("porter.palm_l"), mark("porter.palm_r")
    pm = (pl + prr) / 2
    carried = props.chest("carried", size=(0.42, 0.28, 0.24), material=mat("clay_dim", "#3a3632"))
    carried.location = (pm.x, pm.y, pm.z + 0.012)
    d = (prr - pl)
    carried.rotation_euler = (0, 0, math.atan2(d.y, d.x))
    # cargo waiting at the quay edge, where the porter is heading
    edge = c0.y + 7.8
    for k, (f_, r_, z, rz) in enumerate(((6.9, 3.9, 0.0, 0.2), (6.6, 4.5, 0.0, -0.3), (6.8, 4.15, 0.28, 0.1))):
        p = c0 + fwd * f_ + right * r_
        c = props.chest(f"cargo{k}", size=(0.5, 0.34, 0.28), material=mat("clay_dim", "#3a3632"))
        c.location = (p.x, p.y, z)
        c.rotation_euler = (0, 0, yaw + rz)
    for k, (f_, r_) in enumerate(((7.2, 5.1), (6.8, 5.6))):
        p = c0 + fwd * f_ + right * r_
        props.barrel(f"barrel{k}", (p.x, p.y, 0))

    # ---- the quay and the water; the ship across the harbour
    props.quay("quay", c0.x - 9.0, c0.x + 12.0, c0.y - 4.0, edge, WATER_Z)
    for k, x in enumerate((-3.2, 0.8, 4.8, 8.8)):
        props.post(f"post{k}", (c0.x + x, edge - 0.35, 0))
    props.rope_coil("coil", (c0.x + 1.3, edge - 0.75, 0))
    water()
    ship_at = c0 + Vector((float(os.environ.get("SHIP_X", "8")), float(os.environ.get("SHIP_Y", "44")), WATER_Z))
    shipmod.ship("ship", loc=ship_at, rot_z=math.radians(SHIP_YAW), sails=sails)

    # ---- light: a key from the right, a low fill, a rim from behind the people, and the ship lit
    # more softly so it sits behind them
    t = tc + Vector((0, 0, 1.0))
    kit.area_light("key", t + Vector((3.6, -3.0, 4.2)), t, 900, size=3)
    kit.area_light("fill", t + Vector((-5.0, -3.5, 2.0)), t, 260, size=5, kind="fill")
    kit.area_light("rim", t + Vector((-1.0, 4.5, 3.2)), t, 520, size=2.5)
    kit.area_light("ship_key", ship_at + Vector((22, -21, 30)), ship_at + Vector((0, 0, 6)), 16000, size=14)
    kit.area_light("ship_rim", ship_at + Vector((-18, 27, 20)), ship_at + Vector((0, 0, 8)), 12000, size=12)
    kit.area_light("porter_key", po_loc + Vector((2.5, -3.0, 3.2)), po_loc + Vector((0, 0, 1.0)), 380, size=2.5)
    return cam, hp


def main():
    out = arg("--out")
    os.makedirs(out, exist_ok=True)
    res = tuple(int(x) for x in arg("--res", "1280x800").split("x"))
    samples = int(arg("--samples", "32"))
    views = arg("--views", "main").split(",")
    kit.reset("a", res=res, samples=samples)
    cam, hp = build(arg("--figs"), sails=arg("--sails", "set"))
    tag = arg("--tag", "")
    for v in views:
        if v == "main":
            bpy.context.scene.camera = cam
            kit.render(os.path.join(out, f"shares_main{tag}.png"))
        elif v == "close":
            kit.camera(hp + Vector((-0.15, -0.38, 0.12)), hp, lens=50)
            kit.render(os.path.join(out, f"shares_close{tag}.png"))
        elif v == "wide":
            kit.camera(hp + Vector((-7.0, -9.0, 5.2)), hp + Vector((1.5, 6.0, 0.6)), lens=28)
            kit.render(os.path.join(out, f"shares_wide{tag}.png"))
        elif v == "table":
            reg = bpy.data.objects["register"].matrix_world.translation
            kit.camera(reg + Vector((-0.9, -1.6, 0.9)), reg + Vector((0.3, 0, 0.2)), lens=40)
            kit.render(os.path.join(out, f"shares_table{tag}.png"))
        elif v == "dim":
            bpy.context.scene.camera = cam
            kit.dim(0.025)
            kit.render(os.path.join(out, f"shares_dim{tag}.png"))


if __name__ == "__main__":
    main()
