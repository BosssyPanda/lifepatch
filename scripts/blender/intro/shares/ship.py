"""A Dutch merchant ship of about 1600 built from code, at full size: the ship the shares paid for.

Not a model of a named ship. It has what makes a ship of that age read at a glance: a full, round hull
with tumblehome (narrower at the rail than at the waterline), heavy wales sweeping up to a high flat
stern with cabin windows and lanterns, a beakhead under the bowsprit, gunports in the waist, three masts
with tops, square sails on fore and main, a lateen yard on the mizzen, and shrouds with ratlines.

Frame: bow toward +X, port side toward +Y, waterline at z = 0, metres. ship() returns the root empty.
The hull is one surface S(u, z): u runs 0 (stern) to 1 (bow), z from the keel to the rail. Each vertex
carries `girth` (distance round the section from the keel), which the hull shader turns into planking.
"""
import math

import bpy
import bmesh  # after bpy: the bpy module only provides it once loaded
from mathutils import Vector

import kit
from kit import mat

L = 30.0          # length of the hull body, sternpost to stem at the waterline
HB = 4.1          # half the greatest breadth
KEEL = -3.4       # keel depth below the waterline
ZB = 0.5          # height of greatest breadth
X0 = -L / 2


def smooth(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def sheer(u):
    """The smooth sheer line of the waist (what the wales follow): low amidships, rising to both ends."""
    return 2.4 + 1.9 * (1 - u) ** 2.2 + 1.5 * smooth(0.55, 1.0, u) ** 1.4


def rail(u):
    """The top of the side: the sheer plus the stepped bulwarks of quarterdeck and poop aft and the
    forecastle forward."""
    return (sheer(u) + 1.05 + 1.25 * (1 - smooth(0.30, 0.34, u)) + 1.1 * (1 - smooth(0.13, 0.17, u))
            + 0.9 * smooth(0.80, 0.84, u))


def deck(u):
    return sheer(u) - 0.05


def keel(u):
    return KEEL + 3.0 * smooth(0.86, 1.0, u) ** 1.6


def plan(u):
    """Half-breadth at the height of greatest breadth, as a fraction of HB: a flat transom aft, a full
    body, a bluff round bow."""
    if u < 0.42:
        return 0.6 + 0.4 * math.sin(math.pi / 2 * u / 0.42) ** 0.7
    if u < 0.62:
        return 1.0
    return max(math.cos(math.pi / 2 * (u - 0.62) / 0.38), 0.0) ** 0.5


TUCK = 0.6  # height where the flat transom starts; below it the stern narrows to the sternpost


def half(u, z):
    """Half-breadth of the hull at (u, z)."""
    p = 1.6 + 1.2 * math.sin(math.pi * min(max(u, 0.0), 1.0)) ** 0.8   # full sections amidships, finer ends
    k = keel(u)
    if z < ZB:
        t = min(max((ZB - z) / (ZB - k), 0.0), 1.0)
        sec = (1 - t ** p) ** (1 / p)
    else:
        sec = 1 - 0.19 * ((z - ZB) / 7.0) ** 1.3
    hb = HB * plan(u) * sec
    if u < 0.2:
        # the run: under the transom the hull draws in to the sternpost
        run = smooth(KEEL, TUCK, z) ** 0.7
        hb *= 1 - (1 - run) * (1 - u / 0.2) ** 1.5
    return max(hb, 0.0)


def xpos(u, z):
    """x of station u at height z: the stem rakes forward and curves, the transom leans aft above the tuck."""
    x = X0 + u * L
    if u > 0.85:
        lift = (z - keel(u)) / (rail(1.0) - keel(u))
        x += (u - 0.85) / 0.15 * 2.2 * max(lift, 0.0) ** 1.6
    if u < 0.02:
        x -= 1.4 * smooth(TUCK, rail(0.0), z) * (1 - u / 0.02)
    return x


def _surface(name, NU=140, NZ=44):
    """Both sides of the hull and the flat transom as one mesh."""
    bm = bmesh.new()
    gl = bm.verts.layers.float.new("girth")
    grid = {}
    for side in (1, -1):
        for i in range(NU + 1):
            u = i / NU
            k, r = keel(u), rail(u)
            prev, g = None, 0.0
            for j in range(NZ + 1):
                t = j / NZ
                z = k + (r - k) * (t ** 1.15)
                p = Vector((xpos(u, z), side * half(u, z), z))
                if prev is not None:
                    g += (p - prev).length
                prev = p
                v = bm.verts.new(p)
                v[gl] = g
                grid[side, i, j] = v
        for i in range(NU):
            for j in range(NZ):
                q = (grid[side, i, j], grid[side, i + 1, j], grid[side, i + 1, j + 1], grid[side, i, j + 1])
                bm.faces.new(q if side > 0 else q[::-1])
    # transom: rows across the stern between the two sides' first stations, with an arched top
    K = 16
    rows = []
    for j in range(NZ + 1):
        a, b = grid[-1, 0, j], grid[1, 0, j]
        rows.append([a] + [bm.verts.new(a.co.lerp(b.co, c / K)) for c in range(1, K)] + [b])
    for j in range(NZ):
        for c in range(K):
            bm.faces.new((rows[j][c], rows[j][c + 1], rows[j + 1][c + 1], rows[j + 1][c]))
    top = rows[-1]
    for c, v in enumerate(top[1:-1], 1):
        y = (c / K - 0.5) * 2
        v.co.z += 0.7 * (1 - y * y)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.005)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = kit.from_bmesh(name, bm, _hull_mat())
    sol = ob.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.18
    sol.offset = -1.0
    sol.use_even_offset = False
    return ob


def _hull_mat():
    """Ship's wood in the look's wood tone, with planking: a seam every 26 cm of girth (lines that follow
    the hull's shape, not world heights) and a little unevenness from plank to plank."""
    m = mat("wood").copy()
    m.name = "ship_hull"
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "girth"
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "DIVIDE"
    mul.inputs[1].default_value = 0.26
    nt.links.new(at.outputs["Fac"], mul.inputs[0])
    fr = nt.nodes.new("ShaderNodeMath")
    fr.operation = "FRACT"
    nt.links.new(mul.outputs[0], fr.inputs[0])
    # seam: a narrow dip where the fraction wraps
    sm = nt.nodes.new("ShaderNodeMapRange")
    sm.inputs["From Min"].default_value = 0.0
    sm.inputs["From Max"].default_value = 0.08
    nt.links.new(fr.outputs[0], sm.inputs["Value"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.6
    bump.inputs["Distance"].default_value = 0.01
    nt.links.new(sm.outputs["Result"], bump.inputs["Height"])
    old = [lk for lk in nt.links if lk.to_socket == b.inputs["Normal"]]
    for lk in old:
        nt.links.remove(lk)
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def _sweep(name, pts, normals, w, h, material, closed=False):
    """A rectangular timber swept along pts; normals point outward from the hull (the timber's depth)."""
    bm = bmesh.new()
    rings = []
    for k, (p, n) in enumerate(zip(pts, normals)):
        t = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        up = n.cross(t).normalized()
        if up.z < 0:
            up = -up
        corners = [(-0.1, -h / 2), (w, -h / 2), (w, h / 2), (-0.1, h / 2)]
        rings.append([bm.verts.new(p + n * a + up * b) for a, b in corners])
    for a, b in zip(rings, rings[1:]):
        for c in range(4):
            bm.faces.new((a[c], a[(c + 1) % 4], b[(c + 1) % 4], b[c]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = kit.from_bmesh(name, bm, material, smooth=False)
    bv = ob.modifiers.new("bevel", "BEVEL")
    bv.width, bv.segments, bv.limit_method = 0.025, 2, "ANGLE"
    return ob


def _side_point(u, z, side, out=0.0):
    """Point on the hull side at (u, z) and its outward normal (horizontal approximation)."""
    du = 0.004
    p = Vector((xpos(u, z), side * half(u, z), z))
    p2 = Vector((xpos(u + du, z), side * half(u + du, z), z))
    t = (p2 - p).normalized()
    n = Vector((0, 0, 1)).cross(t) * side
    if n.y * side < 0:
        n = -n
    return p + n * out, n.normalized()


def wales(parts, material):
    """Three heavy wales and a rubbing strake, following the smooth sheer from the transom to the stem."""
    for k, (drop, w, h) in enumerate(((0.35, 0.16, 0.28), (1.35, 0.2, 0.32), (2.35, 0.2, 0.32), (3.25, 0.16, 0.26))):
        for side in (1, -1):
            pts, ns = [], []
            u = 0.004
            while u < 0.985:
                z = sheer(u) - drop
                if z < keel(u) + 0.5:
                    break
                p, n = _side_point(u, z, side)
                pts.append(p)
                ns.append(n)
                u += 0.01
            if len(pts) > 2:
                parts.append(_sweep(f"wale{k}{side}", pts, ns, w, h, material))


def gunports(parts, dark, frame_mat):
    """Closed ports in the waist: a dark square lid with a raised frame, square to the side."""
    for side in (1, -1):
        for k in range(7):
            u = 0.36 + k * 0.065
            z = deck(u) + 0.55
            p, n = _side_point(u, z, side, out=0.05)
            yaw = math.atan2(n.y, n.x)
            rot = (0, 0, yaw)
            parts.append(kit.box(f"port{side}{k}", (0.06, 0.62, 0.56), loc=p, rot=rot, material=dark))
            parts.append(kit.box(f"portf{side}{k}", (0.05, 0.76, 0.7), loc=p - n * 0.02, rot=rot, material=frame_mat))
    # stern chase ports and the great cabin windows on the transom
    return parts


def stern(parts, wood, dark, glass):
    """Windows of the great cabin and the cabin above on the transom, a carved panel between them, a rail
    and three lanterns on the taffrail."""
    r = rail(0.0)
    for row, (z, n, w, h) in enumerate(((r - 2.6, 5, 0.55, 0.75), (r - 1.1, 4, 0.5, 0.6))):
        hb = half(0.0, z) * 0.78
        for c in range(n):
            y = -hb + (c + 0.5) * 2 * hb / n
            x = xpos(0.0, z) - 0.06
            parts.append(kit.box(f"win{row}{c}", (0.06, w, h), loc=(x, y, z), material=glass))
            parts.append(kit.box(f"winf{row}{c}", (0.05, w + 0.14, h + 0.14), loc=(x + 0.02, y, z), material=wood))
    # the carved panel (a raised oval shield) between the window rows
    zc = r - 1.85
    sh = kit.sphere("stern_shield", 0.55, loc=(xpos(0.0, zc) - 0.05, 0, zc), scale=(0.18, 1.1, 0.75), material=wood)
    parts.append(sh)
    # lanterns on brackets at the top of the transom
    for k, y in enumerate((-1.6, 0.0, 1.6)):
        top = r + (0.7 if y == 0 else 0.45)
        x = xpos(0.0, r) - 0.25
        s = 1.25 if y == 0 else 1.0
        parts.append(kit.cyl(f"lantern_post{k}", 0.05, 0.6, loc=(x, y, top + 0.2), material=wood, segs=8))
        parts.append(kit.cyl(f"lantern{k}", 0.24 * s, 0.55 * s, loc=(x, y, top + 0.75 * s), material=glass, segs=6,
                             r2=0.32 * s))
        parts.append(kit.cyl(f"lantern_roof{k}", 0.34 * s, 0.32 * s, loc=(x, y, top + 1.18 * s), material=wood, segs=6,
                             r2=0.04))
    # quarter galleries: small projecting window boxes on each quarter
    for side in (1, -1):
        z = r - 2.3
        p, n = _side_point(0.06, z, side, out=0.35)
        yaw = math.atan2(n.y, n.x)
        parts.append(kit.box(f"gallery{side}", (0.7, 1.9, 1.5), loc=p, rot=(0, 0, yaw - side * math.pi / 2 + side * math.pi / 2),
                             material=wood, bevel=0.06))
        for c in range(3):
            q = p + n * 0.36 + Vector((-0.55 + c * 0.55, 0, 0.1))
            parts.append(kit.box(f"gallery_win{side}{c}", (0.4, 0.04, 0.6), loc=q, rot=(0, 0, yaw - math.pi / 2), material=glass))
        parts.append(kit.cyl(f"gallery_roof{side}", 0.55, 0.5, loc=p + Vector((0, 0, 0.95)), material=wood, segs=12, r2=0.1))


def beakhead(parts, wood):
    """The beak projecting forward under the bowsprit, with a lion figurehead at its tip."""
    zb = sheer(1.0) - 0.4
    x0 = xpos(1.0, zb)
    pts = [Vector((x0 - 0.3, 0, zb - 0.5)), Vector((x0 + 1.6, 0, zb - 0.1)), Vector((x0 + 3.2, 0, zb + 0.5))]
    for k, (a, b) in enumerate(zip(pts, pts[1:])):
        d = b - a
        mid = (a + b) / 2
        rot = Vector((1, 0, 0)).rotation_difference(d.normalized()).to_euler()
        parts.append(kit.box(f"beak{k}", (d.length + 0.3, 0.7 - 0.2 * k, 0.9 - 0.25 * k), loc=mid, rot=rot, material=wood,
                             bevel=0.08))
    # beakhead bulkhead and the rails running up from the beak to the bow
    for side in (1, -1):
        parts.append(kit.curve_tube(f"beak_rail{side}", [pts[2] + Vector((0, 0, 0.2)), pts[1] + Vector((0, side * 0.8, 0.6)),
                                                          Vector((x0 - 0.6, side * 1.3, zb + 1.2))], 0.07, material=wood))
    lion = kit.lumpy("figurehead", 0.45, loc=pts[2] + Vector((0.3, 0, 0.55)), scale=(1.3, 0.75, 1.0), material=wood,
                     amp=0.22, freq=1.4, subdiv=4, seed=11)
    parts.append(lion)
    parts.append(kit.sphere("figurehead_head", 0.33, loc=pts[2] + Vector((0.75, 0, 1.0)), scale=(1.0, 0.9, 1.05), material=wood))


def decks(parts, wood):
    """Deck planes at each level (the waist, quarterdeck, poop, forecastle), so nothing looks hollow from
    above."""
    for name, u0, u1, lift in (("waist", 0.3, 0.84, 0.0), ("quarter", 0.13, 0.32, 1.25), ("poop", 0.0, 0.16, 2.35),
                               ("fore", 0.8, 0.97, 0.9)):
        bm = bmesh.new()
        prev = None
        n = 24
        for i in range(n + 1):
            u = u0 + (u1 - u0) * i / n
            z = deck(u) + lift
            hb = half(u, z) - 0.15
            row = [bm.verts.new((xpos(u, z), y * hb, z)) for y in (-1, 1)]
            if prev:
                bm.faces.new((prev[0], prev[1], row[1], row[0]))
            prev = row
        ob = kit.from_bmesh(f"deck_{name}", bm, wood, smooth=False)
        ob.modifiers.new("thick", "SOLIDIFY").thickness = 0.12
        parts.append(ob)


# ---------------------------------------------------------------------------- masts and rigging

# (name, u, lower mast height above deck, top height, course yard length, topsail yard length)
MASTS = (("fore", 0.83, 15.0, 9.5, 14.0, 9.5), ("main", 0.52, 17.0, 11.0, 16.5, 11.0), ("mizzen", 0.17, 11.0, 6.0, 0.0, 6.5))


def _mast_base(u):
    return Vector((xpos(u, deck(u)), 0, deck(u)))


def sail_sheet(name, w_top, w_foot, h, bulge, material, furl=0.0):
    """A square sail hanging from its yard (top edge at z = 0), bellied forward (+X) between its edges.
    furl > 0 gathers it up toward the yard (sails half-hauled up while the ship lies at the quay)."""
    bm = bmesh.new()
    nx, ny = 16, 12
    vs = {}
    hh = h * (1 - furl)
    for j in range(ny + 1):
        for i in range(nx + 1):
            s, t = i / nx, j / ny
            w = w_top + (w_foot - w_top) * t
            y = (s - 0.5) * w
            z = -t * hh
            belly = bulge * math.sin(math.pi * s) * math.sin(math.pi * min(t * 1.05, 1.0)) ** 0.8
            # bunt: the middle of the foot sags lower than the clews
            z -= 0.06 * h * math.sin(math.pi * s) * t
            if furl:
                z += 0.08 * h * math.sin(math.pi * s * 6) * t * furl
            vs[i, j] = bm.verts.new((belly, y, z))
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((vs[i, j], vs[i + 1, j], vs[i + 1, j + 1], vs[i, j + 1]))
    ob = kit.from_bmesh(name, bm, material)
    ob.modifiers.new("thick", "SOLIDIFY").thickness = 0.03
    return ob


def furled(name, length, r, material):
    """A sail furled on its yard: a fat, slightly lumpy roll the length of the yard."""
    bm = bmesh.new()
    n, segs = 30, 12
    rings = []
    for i in range(n + 1):
        t = i / n
        y = (t - 0.5) * length * 0.92
        rr = r * (0.55 + 0.45 * math.sin(math.pi * t) ** 0.6) * (1 + 0.12 * math.sin(t * 37.0))
        rings.append([bm.verts.new((rr * math.cos(a / segs * math.tau) + 0.05, y, -rr * 0.9 + rr * math.sin(a / segs * math.tau)))
                      for a in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for k in range(segs):
            bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
    return kit.from_bmesh(name, bm, material)


def _rope(name, pts, r, material):
    return kit.curve_tube(name, pts, r, material=material)


def shrouds(parts, rope, top_z, x, n, half_w, chan_z, chan_y, spread, prefix, rat_step=0.42):
    """Shrouds from just under a masthead down to the channels on each side, with ratlines across them."""
    for side in (1, -1):
        feet = [Vector((x - spread / 2 + spread * k / (n - 1), side * chan_y, chan_z)) for k in range(n)]
        head = Vector((x, side * half_w, top_z))
        for k, f in enumerate(feet):
            parts.append(_rope(f"{prefix}shroud{side}{k}", [f, head], 0.028, rope))
            # deadeye at the foot
            parts.append(kit.cyl(f"{prefix}deadeye{side}{k}", 0.11, 0.07, loc=f + Vector((0, 0, 0.12)),
                                 rot=(math.pi / 2, 0, 0), material=rope, segs=10))
        # ratlines: horizontal lines across the shrouds, rising to just under the top
        z = chan_z + 0.6
        k = 0
        while z < top_z - 0.8:
            pts = []
            for f in feet:
                t = (z - f.z) / (head.z - f.z)
                pts.append(f.lerp(head, t))
            parts.append(_rope(f"{prefix}ratline{side}{k}", pts, 0.012, rope))
            z += rat_step
            k += 1


def masts(parts, wood, rope, canvas, sails="set"):
    heads = {}
    for name, u, low, top, course, topsail in MASTS:
        b = _mast_base(u)
        x = b.x
        r0 = 0.42 if name == "main" else (0.38 if name == "fore" else 0.26)
        parts.append(kit.cyl(f"{name}_mast", r0, low + 1.5, loc=(x, 0, b.z + (low + 1.5) / 2 - 1.5), r2=r0 * 0.8,
                             material=wood, segs=16))
        tz = b.z + low
        # the top: a round platform on its trestles at the lower masthead
        tr = 1.5 if name == "main" else (1.3 if name == "fore" else 0.9)
        parts.append(kit.cyl(f"{name}_top", tr, 0.25, loc=(x, 0, tz - 0.6), material=wood, segs=24, r2=tr * 0.92))
        parts.append(kit.cyl(f"{name}_toprim", tr * 1.02, 0.3, loc=(x, 0, tz - 0.32), material=wood, segs=24,
                             r2=tr * 1.02))
        parts.append(kit.cyl(f"{name}_topmast", r0 * 0.55, top + 2.5, loc=(x + 0.05, 0, tz + (top + 2.5) / 2 - 2.5),
                             r2=r0 * 0.3, material=wood, segs=12))
        parts.append(kit.box(f"{name}_cap", (0.9, 0.6, 0.35), loc=(x, 0, tz + 0.1), material=wood, bevel=0.05))
        heads[name] = (x, b.z, tz, tz + top)
        hb = half(u, sheer(u)) + 0.35
        chan_z = sheer(u) - 0.35
        shrouds(parts, rope, tz - 0.9, x, 6 if name != "mizzen" else 4, 0.45, chan_z, hb, 3.4 if name != "mizzen" else 2.0,
                name)
        # topmast shrouds from the topmast head to the rim of the top
        for side in (1, -1):
            for k in range(3):
                f = Vector((x - 0.6 + 0.6 * k, side * tr * 0.95, tz - 0.4))
                parts.append(_rope(f"{name}_tshroud{side}{k}", [f, Vector((x, side * 0.15, tz + top - 1.0))], 0.02, rope))
        if name == "mizzen":
            # the lateen yard slung across the mizzen: its peak rises aft, its lower end comes down forward;
            # in port the sail is furled along it
            ly = 12.5
            c = Vector((x, 0, tz - 2.8))
            d = Vector((-math.cos(math.radians(38)), 0, math.sin(math.radians(38))))
            a, bb = c - d * ly * 0.38, c + d * ly * 0.62
            parts.append(_rope("mizzen_lateen", [a, bb], 0.13, wood))
            if sails != "none":
                parts.append(kit.curve_tube("mizzen_furl", [a.lerp(bb, 0.05) + Vector((0, 0, -0.25)),
                                                            a.lerp(bb, 0.5) + Vector((0, 0, -0.42)),
                                                            a.lerp(bb, 0.95) + Vector((0, 0, -0.22))], 0.22, material=canvas))
            # topsail on the mizzen topmast
            yz = tz + top * 0.75
            parts.append(kit.cyl("mizzen_tyard", 0.09, topsail, loc=(x + 0.3, 0, yz), rot=(math.pi / 2, 0, 0), material=wood, segs=8))
            if sails == "set":
                s = sail_sheet("mizzen_tsail", topsail * 0.88, topsail * 0.98, top * 0.62, 0.7, canvas)
                s.location = (x + 0.45, 0, yz - 0.1)
                parts.append(s)
            continue
        # course and topsail yards with their sails
        for k, (yz, yl, h) in enumerate(((tz - 3.4, course, low * 0.52), (tz + top * 0.72, topsail, top * 0.66))):
            parts.append(kit.cyl(f"{name}_yard{k}", 0.16 if k == 0 else 0.12, yl, loc=(x + 0.35, 0, yz),
                                 rot=(math.pi / 2, 0, 0), r2=None, material=wood, segs=10))
            if sails == "set":
                s = sail_sheet(f"{name}_sail{k}", yl * 0.9, yl * (1.02 if k == 0 else 1.12), h, 1.3 if k == 0 else 1.0, canvas)
                s.location = (x + 0.55, 0, yz - 0.12)
                parts.append(s)
            elif sails == "furled":
                f = furled(f"{name}_furl{k}", yl, 0.42 if k == 0 else 0.32, canvas)
                f.location = (x + 0.35, 0, yz)
                parts.append(f)
            # lifts from the masthead to the yardarms, braces leading aft
            for side in (1, -1):
                arm = Vector((x + 0.35, side * yl / 2 * 0.97, yz))
                parts.append(_rope(f"{name}_lift{k}{side}", [arm, Vector((x, 0, (tz if k == 0 else tz + top) - 0.3))], 0.018, rope))
    # stays: from each masthead forward and down
    fx, fz0, ftz, ftt = heads["fore"]
    mx, mz0, mtz, mtt = heads["main"]
    zx, zz0, ztz, ztt = heads["mizzen"]
    bow = Vector((xpos(1.0, rail(1.0)) + 0.2, 0, rail(1.0) - 0.4))
    sprit_dir = Vector((math.cos(math.radians(32)), 0, math.sin(math.radians(32))))
    sprit_len = 12.0
    sprit_end = bow + sprit_dir * sprit_len
    parts.append(kit.cyl("bowsprit", 0.32, sprit_len + 3.0, loc=bow + sprit_dir * (sprit_len - 3.0) / 2,
                         rot=(0, math.pi / 2 - math.radians(32), 0), material=wood, segs=12, r2=0.18))
    sy = bow + sprit_dir * (sprit_len * 0.62)
    parts.append(kit.cyl("sprit_yard", 0.1, 9.0, loc=sy + Vector((0, 0, -0.5)), rot=(math.pi / 2, 0, 0), material=wood, segs=8))
    if sails == "set":
        s = sail_sheet("spritsail", 8.0, 8.6, 3.4, 0.6, canvas)
        s.location = sy + Vector((0.2, 0, -0.6))
        parts.append(s)
    elif sails == "furled":
        f = furled("sprit_furl", 9.0, 0.3, canvas)
        f.location = sy + Vector((0, 0, -0.5))
        parts.append(f)
    for name, a, b in (("forestay", Vector((fx, 0, ftz - 0.6)), bow + sprit_dir * 2.5),
                       ("foretopstay", Vector((fx + 0.05, 0, ftt - 0.6)), sprit_end - sprit_dir * 0.5),
                       ("mainstay", Vector((mx, 0, mtz - 0.6)), Vector((fx + 0.4, 0, fz0 + 1.2))),
                       ("maintopstay", Vector((mx + 0.05, 0, mtt - 0.6)), Vector((fx, 0, ftz + 0.2))),
                       ("mizzenstay", Vector((zx, 0, ztz - 0.6)), Vector((mx - 0.4, 0, mz0 + 2.0)))):
        parts.append(_rope(name, [a, b], 0.05 if "top" not in name else 0.035, rope))
    # backstays from the topmast heads down to the sides aft of the shrouds
    for name, (x, z0, tz, tt), du in (("fore", heads["fore"], -0.08), ("main", heads["main"], -0.1)):
        u = (x - X0) / L + du
        for side in (1, -1):
            f = Vector((xpos(u, sheer(u)), side * (half(u, sheer(u)) + 0.3), sheer(u) - 0.2))
            parts.append(_rope(f"{name}_backstay{side}", [f, Vector((x, side * 0.12, tt - 0.8))], 0.025, rope))
    # ensign on its staff over the taffrail and a long pennant from the main topmast head
    stx = xpos(0.0, rail(0.0)) - 0.5
    parts.append(kit.cyl("ensign_staff", 0.06, 4.0, loc=(stx, 0, rail(0.0) + 2.4), rot=(0, -0.25, 0), material=wood, segs=8))
    tones = [mat("clay_dim", "#a59f94"), canvas, mat("clay_dim", "#5d5850")]
    parts.append(_flag("ensign", Vector((stx - 0.55, 0, rail(0.0) + 4.0)), 3.2, 2.1, canvas, bands=tones))
    parts.append(_flag("pennant", Vector((mx + 0.05, 0, mtt + 0.3)), 9.0, 0.7, canvas, taper=0.92, wave=0.5, bands=tones))
    return heads


def _flag(name, top, length, h, material, taper=0.2, wave=0.35, bands=None):
    """A flag hanging from top and streaming aft (-X), in shallow waves. bands: materials for horizontal
    stripes from the top (the Dutch prince's flag, orange-white-blue, becomes three clay tones; a plain
    white flag would read as surrender)."""
    bm = bmesh.new()
    nx, ny = 24, 6
    vs = {}
    for i in range(nx + 1):
        s = i / nx
        hh = h * (1 - taper * s)
        for j in range(ny + 1):
            t = j / ny
            x = -s * length
            y = wave * math.sin(s * 7.0 + t * 0.6) * s ** 0.7
            z = -t * hh - 0.18 * length * s ** 2
            vs[i, j] = bm.verts.new(top + Vector((x, y, z)))
    for i in range(nx):
        for j in range(ny):
            f = bm.faces.new((vs[i, j], vs[i + 1, j], vs[i + 1, j + 1], vs[i, j + 1]))
            if bands:
                f.material_index = min(j * len(bands) // ny, len(bands) - 1)
    ob = kit.from_bmesh(name, bm, None)
    for m in (bands or [material]):
        ob.data.materials.append(m)
    ob.modifiers.new("thick", "SOLIDIFY").thickness = 0.02
    return ob


def ship(name="ship", loc=(0, 0, 0), rot_z=0.0, sails="set"):
    lk = kit.look()
    wood = mat("wood")
    dark = mat("clay_dim", lk["ground"])
    glass = mat("clay_dim", lk["print"])
    rope = mat("clay_dim", "#57534c")
    canvas = mat("paper")
    root = kit.link(bpy.data.objects.new(name, None))
    parts = [_surface(name + "_hull")]
    wales(parts, wood)
    gunports(parts, dark, wood)
    stern(parts, wood, dark, glass)
    beakhead(parts, wood)
    decks(parts, wood)
    # channels: planks standing out from the side where the shrouds come down
    for mname, u, *_ in MASTS:
        for side in (1, -1):
            p, n = _side_point(u, sheer(u) - 0.35, side, out=0.25)
            parts.append(kit.box(f"channel_{mname}{side}", (3.8 if mname != "mizzen" else 2.4, 0.5, 0.12), loc=p,
                                 material=wood))
    masts(parts, wood, rope, canvas, sails=sails)
    for ob in parts:
        ob.parent = root
    root.location = loc
    root.rotation_euler = (0, 0, rot_z)
    return root
