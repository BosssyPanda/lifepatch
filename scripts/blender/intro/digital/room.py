"""Scene 07, money becomes a number: a broker's office in August 1971, lit by its own numbers, with
today's phone on the money stand in front.

The room is a diorama on the intro's floating clay island. Its back wall carries an electric quote board
and a moving ticker band (brokers' offices had both by the late 1960s); rows of desks with a quote unit
and a push-button phone each run back toward it, and traders in 1971 suits (trader.py) sit at them with
their backs to us. The board is the key light. The only modern thing in the frame is the phone on the
pedestal at the money spot (scenes.HERO), showing a balance.

    .venv-bpy/bin/python scripts/blender/intro/digital/room.py --figs /tmp/digital/sim --tex /tmp/digital/tex \
        --out /tmp/digital/look --views main,dim,wide --res 1280x800 --samples 32

Figures come from trader.py's .blend files in --figs; a missing one is left out (and reported). Textures
come from textures.py in --tex.
"""
import json
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
INTRO = os.path.dirname(HERE)
sys.path[:0] = [HERE, INTRO]

import bpy  # noqa: E402  (first: bmesh and mathutils come with it)
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import kit  # noqa: E402
import scenes  # noqa: E402
from kit import mat  # noqa: E402

DESK = dict(w=1.4, d=0.75, h=0.74)
BOARD_Y = 6.0          # the board wall's front face
BOARD = dict(w=6.4, h=2.3, z0=1.3)   # the lamp board, on the wall
TICKER = dict(w=6.8, h=0.34, z0=3.78)
ISLAND_C = (0.0, 2.8)

# rows of desks: (x, y of the desk's near edge, who sits there, mirror the figure)
DESKS = [
    (-2.15, 0.55, None, False), (0.05, 0.55, "phone", False), (2.25, 0.55, None, False),
    (-2.15, 2.15, "lookup", False), (0.05, 2.15, None, False), (2.25, 2.15, "type", False),
    (-2.15, 3.75, "type", True), (0.05, 3.75, "lookup", True), (2.25, 3.75, None, False),
]
READER = (1.15, 2.75, math.radians(-112))  # the standing reader in the aisle (x, y, turn): side-on, reading
LIGHT = {"board": float(os.environ.get("L_BOARD", "600")), "fill": float(os.environ.get("L_FILL", "45")),
         "top": float(os.environ.get("L_TOP", "0")), "e_board": float(os.environ.get("E_BOARD", "3.2")),
         "e_read": float(os.environ.get("E_READ", "1.1"))}


# ---------------------------------------------------------------------------------------------- materials

def image_emission(name, path, strength, tone=None):
    """An emissive surface showing an image (the lamps): emission = image x strength."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(path)
    tex.interpolation = "Linear"
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = strength
    nt.links.new(tex.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    m["emit_image"] = os.path.basename(path)
    return m


def dark(name="panel_dark", tone="#1c1a18", rough=0.6):
    key = ("dark", name)
    if key in kit._STATE["mats"]:
        return kit._STATE["mats"][key]
    m, nt, b = kit._principled(name)
    b.inputs["Base Color"].default_value = kit.rgba(tone)
    b.inputs["Roughness"].default_value = rough
    kit._STATE["mats"][key] = m
    return m


# ---------------------------------------------------------------------------------------------- props

def uv_plane(name, w, h, material, loc, rot=(math.pi / 2, 0, 0)):
    """A flat rectangle with 0-1 UVs (face +Z before rot; the default rot stands it up facing -Y)."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    vs = [bm.verts.new((x * w / 2, y * h / 2, 0)) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    f = bm.faces.new(vs)
    for loop, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = (u, v)
    ob = kit.from_bmesh(name, bm, material, smooth=False)
    return kit.place(ob, loc, rot)


def desk(name, x, y):
    """A 1970s office desk seen from the sitter's side: top, two drawer pedestals, knee space between,
    a modesty panel at the far side. (x, y) is the middle of its near edge; it faces +Y."""
    w, d, h = DESK["w"], DESK["d"], DESK["h"]
    m = mat("wood")
    parts = [kit.box(name + "_top", (w, d, 0.035), loc=(x, y + d / 2, h - 0.0175), material=m, bevel=0.006)]
    for sx in (-1, 1):
        px = x + sx * (w / 2 - 0.21)
        parts.append(kit.box(f"{name}_ped{sx}", (0.40, d - 0.04, h - 0.035), loc=(px, y + d / 2, (h - 0.035) / 2),
                             material=m, bevel=0.006))
        for k in range(3):  # drawer fronts facing the sitter
            dz = 0.10 + k * 0.205
            parts.append(kit.box(f"{name}_drw{sx}{k}", (0.36, 0.012, 0.18), loc=(px, y + 0.014, dz + 0.09),
                                 material=mat("clay_dim"), bevel=0.004))
            parts.append(kit.box(f"{name}_pull{sx}{k}", (0.10, 0.012, 0.014), loc=(px, y + 0.004, dz + 0.15),
                                 material=dark(), bevel=0.003))
    parts.append(kit.box(name + "_modesty", (w - 0.84, 0.02, 0.5), loc=(x, y + d - 0.06, h - 0.035 - 0.25),
                         material=m))
    return parts


def chair(name, x, y, seat_top, rot_z=0.0):
    """A 1970s swivel office chair: five-star base, column, seat, a low back on a spine."""
    ob = []
    m, md = mat("clay_dim"), dark()
    c = Vector((x, y, 0))
    R = Matrix.Rotation(rot_z, 3, "Z")
    for k in range(5):
        a = k / 5 * math.tau + 0.3
        tip = c + R @ Vector((math.cos(a) * 0.30, math.sin(a) * 0.30, 0.05))
        ob.append(kit.curve_tube(f"{name}_leg{k}", [c + Vector((0, 0, 0.09)), tip], 0.018, material=md))
        ob.append(kit.sphere(f"{name}_wheel{k}", 0.028, loc=tip - Vector((0, 0, 0.022)), material=md, subdiv=2))
    ob.append(kit.cyl(name + "_col", 0.025, seat_top - 0.12, loc=c + Vector((0, 0, (seat_top - 0.12) / 2 + 0.06)),
                      material=md, segs=16))
    seat = kit.box(name + "_seat", (0.46, 0.34, 0.07), loc=c + Vector((0, 0, seat_top - 0.035)), rot=(0, 0, rot_z),
                   material=m, bevel=0.025)
    ob.append(seat)
    back_c = c + R @ Vector((0, -0.29, seat_top + 0.30))
    ob.append(kit.box(name + "_back", (0.42, 0.06, 0.26), loc=back_c, rot=(0, 0, rot_z), material=m, bevel=0.025))
    spine = [c + R @ Vector((0, -0.12, seat_top - 0.05)), c + R @ Vector((0, -0.31, seat_top + 0.02)),
             c + R @ Vector((0, -0.31, seat_top + 0.2))]
    ob.append(kit.curve_tube(name + "_spine", spine, 0.016, material=md))
    return ob


READOUTS = 9


def quote_unit(name, x, y, readout_mat, row):
    """A desk quote unit: a keyboard console with a raised readout housing, facing the sitter (-Y)."""
    m, md = mat("clay_dim"), dark()
    parts = [kit.box(name + "_base", (0.34, 0.24, 0.06), loc=(x, y, DESK["h"] + 0.03), material=m, bevel=0.01)]
    # keys on the base's top, a 4 x 8 grid
    for j in range(4):
        for i in range(8):
            parts.append(kit.box(f"{name}_k{j}{i}", (0.026, 0.026, 0.012),
                                 loc=(x - 0.13 + i * 0.037, y - 0.085 + j * 0.034, DESK["h"] + 0.064),
                                 material=mat("clay"), bevel=0.003))
    hy = y + 0.09
    parts.append(kit.box(name + "_hood", (0.34, 0.11, 0.17), loc=(x, hy, DESK["h"] + 0.145), material=m,
                         bevel=0.012))
    win = uv_plane(name + "_window", 0.27, 0.05, readout_mat, (x, hy - 0.0565, DESK["h"] + 0.175))
    # its own row of the readouts image (row 0 at the image's top)
    for loop in win.data.uv_layers[0].data:
        loop.uv.y = (READOUTS - 1 - row + loop.uv.y) / READOUTS
    parts.append(win)
    return parts


def desk_phone(name, x, y, with_handset=True):
    """A 1970s push-button desk phone: a wedge body, a 4 x 3 keypad on its slope, the handset in its
    cradle. Faces -Y (the sitter)."""
    m, mk = mat("clay_dim"), mat("clay")
    bm = bmesh.new()
    prof = [(-0.11, 0.0), (0.11, 0.0), (0.075, 0.11), (-0.085, 0.05)]  # (y, z) side profile, front at -y
    w = 0.21
    left = [bm.verts.new((-w / 2, py, pz)) for py, pz in prof]
    right = [bm.verts.new((w / 2, py, pz)) for py, pz in prof]
    bm.faces.new(left[::-1])
    bm.faces.new(right)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((left[i], left[j], right[j], right[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    body = kit.from_bmesh(name + "_body", bm, m, smooth=False)
    bev = body.modifiers.new("bevel", "BEVEL")
    bev.width, bev.segments = 0.012, 3
    body.location = (x, y, DESK["h"])
    parts = [body]
    slope = math.atan2(0.11 - 0.05, 0.075 - (-0.085))  # the top rises toward the back
    for j in range(4):
        for i in range(3):
            t = 0.10 + j * 0.105
            py, pz = -0.085 + t * 0.16, 0.05 + t * 0.06
            parts.append(kit.box(f"{name}_key{j}{i}", (0.022, 0.018, 0.008),
                                 loc=(x - 0.03 + i * 0.03, y + py, DESK["h"] + pz + 0.006),
                                 rot=(slope, 0, 0), material=mk, bevel=0.002))
    if with_handset:
        top = DESK["h"] + 0.115
        hy = y + 0.05
        pts = [(x - 0.12, hy, top + 0.03), (x - 0.04, hy, top + 0.045), (x + 0.04, hy, top + 0.045),
               (x + 0.12, hy, top + 0.03)]
        parts.append(kit.curve_tube(name + "_hs", pts, 0.016, material=m))
        for sx in (-1, 1):
            parts.append(kit.cyl(f"{name}_cup{sx}", 0.033, 0.03, loc=(x + sx * 0.125, hy, top + 0.012), material=m,
                                 segs=24, r2=0.028, bevel=0.004))
    return parts


def coil_cord(name, a, b, sag=0.25, r=0.011, pitch=0.009, radius=0.0028):
    """A coiled phone cord from a to b, hanging in a curve."""
    a, b = Vector(a), Vector(b)
    n = 60
    path = []
    for i in range(n + 1):
        t = i / n
        p = a.lerp(b, t)
        p.z -= sag * 4 * t * (1 - t)
        path.append(p)
    length = sum((path[i + 1] - path[i]).length for i in range(n))
    turns = int(length / pitch)
    pts = []
    seg = 10
    for k in range(turns * seg + 1):
        s = k / (turns * seg) * n
        i = min(int(s), n - 1)
        f = s - i
        p = path[i].lerp(path[i + 1], f)
        tdir = (path[i + 1] - path[i]).normalized()
        u = tdir.cross(Vector((0, 0, 1)))
        u = u.normalized() if u.length > 1e-4 else Vector((1, 0, 0))
        v = tdir.cross(u).normalized()
        ang = k / seg * math.tau
        pts.append(p + (u * math.cos(ang) + v * math.sin(ang)) * r)
    cu = kit.curve_tube(name, pts, radius, material=dark())
    cu.data.bevel_resolution = 1
    return cu


def papers(name, x, y, rot=0.0, n=3, seed=0):
    rnd = random.Random(seed)
    out = []
    for i in range(n):
        out.append(kit.box(f"{name}{i}", (0.215, 0.28, 0.0015),
                           loc=(x + rnd.uniform(-0.02, 0.02), y + rnd.uniform(-0.02, 0.02), DESK["h"] + 0.001 + i * 0.0016),
                           rot=(0, 0, rot + rnd.uniform(-0.12, 0.12)), material=mat("paper")))
    return out


# ---------------------------------------------------------------------------------------------- figures

def load_figure(figs, pose, loc, rot_z, mirror=False):
    """Append trader.py's baked figure; returns (root empty, info) or (None, None) if not simulated yet."""
    path = os.path.join(figs, f"trader_{pose}.blend")
    if not os.path.exists(path):
        print(f"[room] no figure {path}", flush=True)
        return None, None
    info = json.load(open(os.path.join(figs, f"trader_{pose}.json")))
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects]
    root = kit.link(bpy.data.objects.new(f"fig_{pose}", None))
    for ob in dst.objects:
        if ob is None or ob.type != "MESH":
            continue
        kit.link(ob)
        role = ob.get("prop")
        ob.data.materials.clear()
        ob.data.materials.append(mat("clay_dim") if role and "sheet" not in ob.name else
                                 mat("paper") if role else mat("clay"))
        ob.parent = root
    root.location = loc
    root.rotation_euler = (0, 0, rot_z)
    if mirror:
        root.scale = (-1, 1, 1)
    return root, info


def figure_point(root, p):
    """A point in a figure's own frame (trader.py's) carried into the room."""
    bpy.context.view_layer.update()
    return root.matrix_world @ Vector(p)


# ---------------------------------------------------------------------------------------------- the room

def build(figs, tex, draft=False):
    lk = kit.look()
    kit.island(radius=5.6, depth=0.8, seed=19, wobble=0.1).location = (*ISLAND_C, 0)
    # the back wall and its two lamp displays
    wall_h = 4.45
    kit.box("wall", (7.0, 0.3, wall_h), loc=(0, BOARD_Y + 0.15, wall_h / 2 - 0.05), material=mat("ground"), bevel=0.02)
    bw, bh, bz = BOARD["w"], BOARD["h"], BOARD["z0"]
    kit.box("board_frame", (bw + 0.16, 0.08, bh + 0.16), loc=(0, BOARD_Y - 0.03, bz + bh / 2), material=dark(),
            bevel=0.01)
    board_m = image_emission("board", os.path.join(tex, "board.png"), LIGHT["e_board"])
    uv_plane("board", bw, bh, board_m, (0, BOARD_Y - 0.075, bz + bh / 2))
    tw, th, tz = TICKER["w"], TICKER["h"], TICKER["z0"]
    kit.box("ticker_frame", (tw + 0.12, 0.08, th + 0.12), loc=(0, BOARD_Y - 0.03, tz + th / 2), material=dark(),
            bevel=0.01)
    tick_m = image_emission("ticker", os.path.join(tex, "ticker.png"), LIGHT["e_board"])
    tk = uv_plane("ticker", tw, th, tick_m, (0, BOARD_Y - 0.075, tz + th / 2))
    # the band shows a slice of the long strip: its UVs span the slice's share of the image (the browser
    # slides this window to move the tape)
    share = (tw / th) / (8192 / 256)
    for loop in tk.data.uv_layers[0].data:
        loop.uv.x *= share
    # a soft light standing in for the board's glow on the room (the emissive board alone is noisy)
    li = kit.area_light("board_glow", (0, BOARD_Y - 0.4, bz + bh / 2), (0, 0, 0.9), LIGHT["board"], size=1.0)
    li.data.shape = "RECTANGLE"
    li.data.size, li.data.size_y = bw, bh
    kit.area_light("fill", (-3.5, -4.0, 3.2), (0, 2.0, 0.8), LIGHT["fill"], size=5.0, kind="fill")
    if LIGHT["top"]:
        kit.area_light("top", (0.0, 2.2, 5.5), (0, 2.2, 0), LIGHT["top"], size=6.0, kind="fill")

    # desks, chairs, units, phones, papers, traders
    readout_m = image_emission("readouts", os.path.join(tex, "readouts.png"), LIGHT["e_read"])
    placed = {}
    for n, (x, y, who, mirror) in enumerate(DESKS):
        desk(f"desk{n}", x, y)
        # the caller holds the handset in his left hand (world -X once he faces the board), so his phone
        # stands on the left and its cord hangs in view beside him
        side = -1 if who == "phone" else 1
        quote_unit(f"unit{n}", x - side * 0.25, y + DESK["d"] - 0.2, readout_m, n % READOUTS)
        desk_phone(f"phone{n}", x + side * 0.42, y + DESK["d"] - 0.2, with_handset=who != "phone")
        papers(f"paper{n}_", x + 0.12, y + 0.22, rot=0.1 * (n % 3 - 1), n=2 + n % 2, seed=n)
        seat_top = 0.44
        if who:
            info_path = os.path.join(figs, f"trader_{who}.json")
            if os.path.exists(info_path):
                info = json.load(open(info_path))
                seat_top = info["seat_top"]
                seat_y = y + info["desk_front_y"]  # desk_front_y < 0 in the figure's frame
                root, info = load_figure(figs, who, (x, seat_y, 0.0), math.pi, mirror)
                placed[n] = (root, info)
            else:
                seat_y = y - 0.24
            chair(f"chair{n}", x, seat_y, seat_top - 0.012)
        else:
            chair(f"chair{n}", x + 0.15 * (n % 2), y - 0.42, 0.44, rot_z=0.35 * ((n % 3) - 1))
    # the call: a coiled cord from the handset at the trader's ear down to his desk phone
    for n, (root, info) in placed.items():
        if info["pose"] != "phone":
            continue
        mouth = next((o for o in root.children if "mouth_cup" in o.name), None)
        print("[room] cord from", mouth and mouth.name, [o.name for o in root.children if o.get("prop")], flush=True)
        if mouth is None:
            continue
        bpy.context.view_layer.update()
        a = mouth.matrix_world @ (sum((v.co for v in mouth.data.vertices), Vector()) / len(mouth.data.vertices))
        x, y = DESKS[n][0], DESKS[n][1]
        coil_cord("cord", a + Vector((0, 0, -0.03)), (x - 0.42 + 0.1, y + DESK["d"] - 0.2 - 0.02, DESK["h"] + 0.03),
                  sag=0.18)
    rx, ry, rr = READER
    load_figure(figs, "read", (rx, ry, 0.0), rr)
    return placed


# the end of the pull-back toward the finale: the whole diorama floating in the dark
CAM_WIDE = ((-1.9, -8.6, 3.1), (0.2, 2.6, 1.3), 30)


def camera_main():
    return kit.camera((-0.75, -2.15, 1.42), (0.3, 4.2, 1.62), lens=30)


def hero_phone(cam, tex):
    """Today's phone on the money stand at the money spot, its balance lit."""
    hp = scenes.hero_point(cam)
    tilt = math.radians(46)
    w, h, t = 0.0715, 0.147, 0.008
    rot = scenes.face_cam(cam, tilt)
    M = Matrix.Translation(hp) @ rot.to_matrix().to_4x4()
    # the phone rests on its bottom edge on the stand and leans on a wedge behind it, so nothing floats
    top = (M @ Vector((0, -h / 2, -t / 2))).z
    scenes.stand("hero_stand", cam, hp, top, size=(0.24, 0.26))
    bm = bmesh.new()
    vs = []
    for x in (-w / 2 - 0.004, w / 2 + 0.004):
        f = M @ Vector((x, -h / 2 + 0.004, -t / 2))
        tp = M @ Vector((x, 0.22 * h, -t / 2))
        pp = Vector((tp.x, tp.y, top))
        vs.append([bm.verts.new(f), bm.verts.new(tp), bm.verts.new(pp)])
    (f0, t0, p0), (f1, t1, p1) = vs
    for face in ((f0, t0, p0), (f1, p1, t1), (f0, f1, t1, t0), (t0, t1, p1, p0), (p0, p1, f1, f0)):
        bm.faces.new(face)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    wedge = kit.from_bmesh("hero_wedge", bm, mat("ground"), smooth=False)
    body = kit.box("hero_phone", (w, h, t), loc=hp, rot=rot, material=dark("phone_body", "#2a2724", 0.35), bevel=0.0035)
    scr_m = image_emission("phone_screen", os.path.join(tex, "phone_screen.png"), 1.6)
    scr = uv_plane("hero_screen", w - 0.006, h - 0.006, scr_m, M @ Vector((0, 0, t / 2 + 0.0004)), rot=rot)
    # face +Z of the plane is the screen; uv_plane's default rot was replaced by the phone's
    scenes.mark_hero(body, scr, wedge)
    scenes.hero_light(cam, hp, 6.0)
    return body, scr


def main():
    a = sys.argv

    def arg(name, default=None):
        return a[a.index(name) + 1] if name in a else default

    out = arg("--out")
    figs = arg("--figs")
    tex = arg("--tex")
    res = tuple(int(x) for x in arg("--res", "1280x800").split("x"))
    samples = int(arg("--samples", "32"))
    views = arg("--views", "main").split(",")
    os.makedirs(out, exist_ok=True)
    for v in views:
        kit.reset("a", res=res, samples=samples)
        build(figs, tex)
        if v in ("main", "dim"):
            cam = camera_main()
        elif v == "wide":
            loc, tgt, lens = CAM_WIDE
            cam = kit.camera(loc, tgt, lens=lens)
        elif v == "floor":
            cam = kit.camera((1.6, -0.6, 1.5), (-0.6, 3.2, 1.0), lens=35)
        else:
            raise ValueError(v)
        if v in ("main", "dim"):
            hero_phone(cam, tex)
        if v == "dim":
            kit.dim(0.025)
        kit.render(os.path.join(out, f"digital_{v}.png"))
        print(f"[room] {v} done", flush=True)


if __name__ == "__main__":
    main()
