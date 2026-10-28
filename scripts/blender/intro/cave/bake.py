"""Bake the cave for the browser.

The Blender cave (scene.py) is about 1.7 million triangles lit by a fire that takes Cycles minutes
to render, so the page gets a light copy with the light painted in:

- `cave`: the rock (walls, floor, the mound under the gold, the seats, the hearth's stones, the
  logs and the embers) as one mesh with one baked texture.
- `people`: the five statues, their food, the bow and the arrows, as one mesh with one baked texture.
- `flame0` ... `flame6`: the fire's tongues, not baked; the page draws them with its own glow.
- `gold_spot`: an empty where scene one's ore (public/intro/ore/ore.glb) lies as the nugget. The page
  hangs that ore's mesh under it unchanged, so the gold is the same object in both scenes.
- `cam`, and the lights that fall on the gold (`hero_key`, `fire_light`), for the page to light it.

Each texture holds the finished look: Cycles' diffuse light and colour, emission included, passed
through the renders' AgX look, so the page shows it as it is (no lighting, no tone mapping) and only
scales it for the fire's flicker and the dark between scenes. Gloss is left out: the clay and the
rock are matte, and a bake has no viewer for a highlight to face.

    python scripts/blender/intro/cave/bake.py --cache DIR --paint panel.png --out DIR [--tex 4096] [--samples 64]

writes DIR/cave.glb (WebP textures inside) and the textures as PNGs. It takes about XX minutes on
four cores. Blender's -Y (into the cave from the camera) becomes glTF's +Z.
"""
import argparse
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.dirname(HERE)]
import kit  # noqa: E402
import scene  # noqa: E402
import shell  # noqa: E402

# Triangles kept per object, by name prefix (the rest keep theirs). The cave's walls are mostly far
# off or out of the frame; the statues are what the eye goes to.
# The statues keep their own quads: decimated into scattered triangles, they unwrap into thousands
# of specks, every one a seam.
TRIS = {"cave": 90000, "pedestal": 16000, "elder_rock": 6000, "mother_rock": 6000, "eater_rock": 6000,
        "ember": 300, "hearth_stone": 600, "meat_stone": 600}
# The paintings people can click, at their middles in panel units (paintings.panel): u across, v up.
PAINTINGS = {"painting_hands_left": (0.22, 0.5), "painting_hands_right": (0.70, 0.56)}
PEOPLE = ("hunter_", "elder_body", "elder_cloth", "elder_hair", "elder_belt", "mother_body",
          "mother_cloth", "mother_hair", "mother_belt", "child_", "eater_body", "eater_cloth",
          "eater_hair", "eater_belt", "food_", "bow", "arrow")


def _group(ob):
    if ob.get("hero") or ob.name.startswith("flame"):
        return None
    if ob.type not in ("MESH", "CURVE"):
        return None
    return "people" if ob.name.startswith(PEOPLE) else "cave"


def _select_only(obs, active):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active


def _as_mesh(ob):
    """A frozen mesh copy of an object, modifiers and curve bevels applied, transform baked in."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), depsgraph=dg)
    me.transform(ob.matrix_world)
    c = bpy.data.objects.new(ob.name + "_lo", me)
    bpy.context.scene.collection.objects.link(c)
    return c


def _decimate(ob, tris):
    now = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if now <= tris:
        return now
    mod = ob.modifiers.new("lighten", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = tris / now
    mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)
    return sum(len(p.vertices) - 2 for p in me.polygons)


def _image(name, n):
    img = bpy.data.images.new(name, n, n, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Linear Rec.709"
    img.pixels[:] = np.zeros(n * n * 4, np.float32)   # alpha 0: texels the bake never reaches
    return img


def _target(name, n):
    """The light copy's one material: an image node the bake writes into."""
    img = _image(name, n)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    t = nt.nodes.new("ShaderNodeTexImage")
    t.name = "bake_target"
    t.image = img
    nt.nodes.active = t          # wired to the surface only once baked: read while written, it loops
    return m, img


def _light_copy(name, his, n, margin):
    """Join decimated copies of `his` into one mesh, smooth shaded, laid out flat for one texture."""
    los = []
    for o in his:
        lo = _as_mesh(o)
        keep = next((v for k, v in TRIS.items() if k in o.name), None)
        if keep:
            _decimate(lo, keep)
        los.append(lo)
    # each piece unwrapped on its own, then all of them packed into the one texture
    for lo in los:
        _select_only([lo], lo)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=1.0)
        bpy.ops.object.mode_set(mode="OBJECT")
    _select_only(los, los[0])
    bpy.ops.object.join()
    lo = los[0]
    lo.name = lo.data.name = name
    lo.data.materials.clear()
    lo.data.polygons.foreach_set("material_index", np.zeros(len(lo.data.polygons), np.int32))
    for p in lo.data.polygons:
        p.use_smooth = True
    _select_only([lo], lo)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")
    m, img = _target(name, n)
    lo.data.materials.append(m)
    return lo, img


def _bake(lo, his, samples, img, kind="light", reach=0.02):
    """Bake onto `lo` from the originals `his`: "light", the diffuse light and colour, emission
    included; or "albedo", the bare surface colour, which the page's torch multiplies its light by."""
    sc = bpy.context.scene
    sc.cycles.samples = samples if kind == "light" else 1
    lo.data.materials[0].node_tree.nodes["bake_target"].image = img
    _select_only(his + [lo], lo)
    b = sc.render.bake
    b.use_selected_to_active = True
    b.cage_extrusion = reach      # the light copy lies within this of the original
    b.max_ray_distance = reach * 3
    b.margin = 0                 # the margin is grown after the blur, from clean texels only
    b.use_pass_glossy = b.use_pass_transmission = False
    if kind == "light":
        b.use_pass_direct = b.use_pass_indirect = True
        b.use_pass_diffuse = b.use_pass_emit = True
    else:
        b.use_pass_direct = b.use_pass_indirect = False
        b.use_pass_color = True
    flags = ("visible_camera", "visible_diffuse", "visible_glossy", "visible_transmission", "visible_shadow")
    for f in flags:
        setattr(lo, f, False)    # the copy sits on the original: it must not shade it
    bpy.ops.object.bake(type="COMBINED" if kind == "light" else "DIFFUSE")
    for f in flags:
        setattr(lo, f, True)


def _blur(a, w, r):
    """Box-blur an HxWxC array in place-safe passes, weighting by w so empty texels add nothing."""
    def box(x):
        for ax in (0, 1):
            c = np.cumsum(np.pad(x, [(r + 1, r) if i == ax else (0, 0) for i in range(x.ndim)], mode="edge"), axis=ax)
            hi = np.take(c, np.arange(2 * r + 1, c.shape[ax]), axis=ax)
            lo = np.take(c, np.arange(0, c.shape[ax] - 2 * r - 1), axis=ax)
            x = (hi - lo) / (2 * r + 1)
        return x
    num = box(a * w[..., None])
    den = box(w)[..., None]
    return np.where(den > 1e-4, num / np.maximum(den, 1e-4), a)


def _grow(a, w, steps):
    """Push each island's edge colours outward `steps` texels, so mipmaps and filtering at the
    seams pick up the island's own light and not the black between islands."""
    a, w = a.copy(), w.copy()
    for _ in range(steps):
        empty = w < 0.5
        if not empty.any():
            break
        acc = np.zeros_like(a)
        cnt = np.zeros(w.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ws = np.roll(w, (dy, dx), (0, 1))
            acc += np.roll(a, (dy, dx), (0, 1)) * ws[..., None]
            cnt += ws
        fill = empty & (cnt > 0)
        a[fill] = acc[fill] / cnt[fill][..., None]
        w = np.where(fill, 1.0, w)
    return a


def _finish(img, path, grain, look=True):
    """Take the bake's grain out, grow the margins, and save it: through the scene's AgX look (the
    light), or as plain sRGB (the albedo)."""
    n = img.size[0]
    px = np.array(img.pixels[:], dtype=np.float32).reshape(n, n, 4)
    rgb, cover = px[..., :3], (px[..., 3] > 0.5).astype(np.float32)
    if grain:
        rgb = _blur(rgb, cover, grain)
    rgb = _grow(rgb, cover, 16)
    px[..., :3], px[..., 3] = rgb, 1.0
    img.pixels[:] = px.ravel()
    sc = bpy.context.scene
    st = sc.render.image_settings
    st.file_format, st.color_mode, st.color_depth = "PNG", "RGB", "8"
    vs = sc.view_settings
    was = vs.view_transform, vs.look
    if not look:
        vs.view_transform, vs.look = "Standard", "None"
    img.save_render(path, scene=sc)       # applies the view transform and look, as the renders do
    vs.view_transform, vs.look = was
    shown = bpy.data.images.load(path)
    shown.name = img.name + "_shown"
    return shown


def _gold_spot():
    """Where the gold stands: an empty at the foot of the Blender nugget, turned as it is turned.
    The page sets scene one's ore (ore.glb) on it at NUGGET_HEIGHT, measured from the ore itself,
    so the ore can be reworked without this file."""
    ore = bpy.data.objects["ore"]
    lo = min((ore.matrix_world @ v.co).z for v in ore.data.vertices)
    spot = bpy.data.objects.new("gold_spot", None)
    bpy.context.scene.collection.objects.link(spot)
    spot.location = (ore.location.x, ore.location.y, lo)
    spot.rotation_euler = (0.0, 0.0, ore.rotation_euler.z)
    return spot


def _paintings():
    """An empty on the wall at the middle of each group of paintings the page lets people click,
    found by casting from the projector that laid the painting on the wall (shell.paint_uv)."""
    sc = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for name, (u, v) in PAINTINGS.items():
        on_plane = Vector((shell.PANEL_CENTRE[0] - shell.PANEL_SIZE[0] / 2 + u * shell.PANEL_SIZE[0],
                           shell.PANEL_CENTRE[1],
                           shell.PANEL_CENTRE[2] - shell.PANEL_SIZE[1] / 2 + v * shell.PANEL_SIZE[1]))
        start = Vector(shell.PROJECTOR)
        hit, at, _n, _i, ob, _m = sc.ray_cast(dg, start, (on_plane - start).normalized())
        if not hit or not ob.name.startswith("cave"):
            raise RuntimeError(f"painting {name}: the cast from the projector hit {ob.name if hit else 'nothing'}, not the wall")
        e = bpy.data.objects.new(name, None)
        sc.collection.objects.link(e)
        e.location = at
        out.append(e)
    return out


def _pick(los, tris):
    """A light, invisible copy of everything the torch can fall on, for the page to cast the
    cursor against. Built from the light copies' triangles directly (joining copies of them with
    the join operator crashed Blender 5.2)."""
    vs, fs, n = [], [], 0
    for lo in los:
        me = lo.data
        me.calc_loop_triangles()
        v = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get("co", v)
        t = np.empty(len(me.loop_triangles) * 3, np.int32)
        me.loop_triangles.foreach_get("vertices", t)
        vs.append(v.reshape(-1, 3))
        fs.append(t.reshape(-1, 3) + n)
        n += len(me.vertices)
    me = bpy.data.meshes.new("cave_pick")
    me.from_pydata(np.concatenate(vs).tolist(), [], np.concatenate(fs).tolist())
    pick = bpy.data.objects.new("cave_pick", me)
    bpy.context.scene.collection.objects.link(pick)
    _decimate(pick, tris)
    return pick


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--paint", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tex", type=int, default=4096)
    ap.add_argument("--samples", type=int, default=64)
    ap.add_argument("--grain", type=int, default=1, help="blur radius in texels against the bake's noise")
    ap.add_argument("--only", default="cave,people")
    ap.add_argument("--flames-in-bake", action="store_true", help="let the flames' glow light the bake (slow)")
    args = ap.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)
    t0 = time.time()

    sc = kit.reset("a", res=(1280, 800), samples=args.samples)   # the camera's export reads the frame's shape
    sc.cycles.use_denoising = False
    sc.cycles.use_adaptive_sampling = False
    scene.build(args.cache, paint=args.paint, view="low")
    bpy.context.view_layer.update()

    # the bake reads meshes only: curves (belts, bow, arrows) become meshes first
    for o in [o for o in sc.objects if o.type == "CURVE"]:
        m = _as_mesh(o)
        name = o.name
        bpy.data.objects.remove(o, do_unlink=True)
        m.name = name
    if not args.flames_in_bake:
        # The flames are a glowing volume: every ray to the fire's light crosses it, which made
        # the bake many times slower than a render. Their own light is small next to the fire's
        # lights, which stay.
        for o in [o for o in sc.objects if o.name.startswith("flame")]:
            o.hide_render = True
    groups = {}
    for o in list(sc.objects):
        g = _group(o)
        if g:
            groups.setdefault(g, []).append(o)
            o.name = o.name + "_src"   # frees the plain names for the light copies
    keep = []
    for name in args.only.split(","):
        his = groups[name]
        lo, img = _light_copy(name, his, args.tex, 0.003 if name == "cave" else 0.002)
        tris = sum(len(p.vertices) - 2 for p in lo.data.polygons)
        print(f"[bake] {name}: {len(his)} objects -> {tris} triangles ({time.time() - t0:.0f} s)", flush=True)
        reach = 0.02 if name == "cave" else 0.004   # the people are not simplified: their copy is exact
        _bake(lo, his, args.samples, img, reach=reach)
        print(f"[bake] {name} light baked ({time.time() - t0:.0f} s)", flush=True)
        shown = _finish(img, os.path.join(args.out, name + ".png"), args.grain)
        if name == "cave":
            # the torch needs the bare colour of the rock and its paintings; the people are clay
            alb = _image(name + "_albedo", args.tex // 2)
            _bake(lo, his, 1, alb, kind="albedo", reach=reach)
            alb_shown = _finish(alb, os.path.join(args.out, name + "_albedo.png"), 0, look=False)
            print(f"[bake] {name} albedo baked ({time.time() - t0:.0f} s)", flush=True)
        nt = lo.data.materials[0].node_tree
        tex = nt.nodes["bake_target"]
        tex.image = shown
        nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
        if name == "cave":
            # carried as the emissive texture: glTF has no other slot for a second colour
            em = nt.nodes.new("ShaderNodeTexImage")
            em.image = alb_shown
            nt.links.new(em.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Emission Color"])
            nt.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 1.0
        keep.append(lo)

    for o in [o for o in sc.objects if o.name.startswith("flame")]:
        o.hide_render = False
    pick = _pick(keep, 12000)
    spot = _gold_spot()
    marks = _paintings()
    flames = [o for o in sc.objects if o.name.startswith("flame") and o.type == "MESH"]
    lights = [bpy.data.objects[n] for n in ("hero_key", "fire_light")]
    cam = sc.camera
    for o in flames + lights:        # out from under the fire's empty, which is not exported
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    _select_only(keep + flames + [pick, spot, cam] + lights + marks, keep[0])
    path = os.path.join(args.out, "cave.glb")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_image_format="WEBP", export_image_quality=92,
        export_yup=True, export_apply=True, export_materials="EXPORT", export_cameras=True,
        export_lights=True, export_extras=False, export_animations=False)
    print(f"[bake] wrote {path} ({os.path.getsize(path) / 1e6:.1f} MB, {time.time() - t0:.0f} s)", flush=True)


if __name__ == "__main__":
    main()
