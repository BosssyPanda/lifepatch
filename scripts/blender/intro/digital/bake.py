"""Bake scene 07 (the 1971 broker's office) for the browser: public/intro/digital/digital.glb.

The page draws the room unlit: every surface carries its own light, baked by Cycles from the same
scene room.py renders, and already passed through the renders' view transform (AgX, medium high
contrast). So the browser shows what the Blender frames show, with no lights to compute, and the
camera can move a little without anything changing (the bake is diffuse light only, which does not
depend on where you look from).

Parts, found by name on the page:
  room        desks, chairs, quote units, desk phones, papers, the wall, the island (one mesh, one map)
  people      the traders, decimated, with their props (one mesh; its light is in its vertex colours)
  hero        the money stand, the wedge and the phone's body (stays lit when the room goes dark)
  board, ticker, readouts, hero_screen   the glowing numbers, drawn from their own images
  cam_main, cam_wide                     the plateau camera and the pulled-back one

    .venv-bpy/bin/python scripts/blender/intro/digital/bake.py --figs /tmp/digital/sim --tex /tmp/digital/tex \
        --out /tmp/digital/web [--room 4096 --samples 96 --people_samples 512]

Then compress (textures first, Draco last; see the README in this folder).
"""
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.dirname(HERE)]

import bpy  # noqa: E402
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import kit  # noqa: E402
import room  # noqa: E402


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


FIGS, TEX, OUT = arg("--figs"), arg("--tex"), arg("--out")
SIZES = {"room": int(arg("--room", "4096")), "hero": int(arg("--hero", "512"))}
SAMPLES = int(arg("--samples", "96"))
# The traders are baked into their vertices, not a map: a decimated cloth figure smart-projects into
# thousands of islands a few texels wide, which bled into each other and mottled the figures on the page
# (seen in the browser, 2026-10-28). A vertex is one shading point, so it takes more samples.
PEOPLE_SAMPLES = int(arg("--people_samples", "512"))
PEOPLE_TRIS = int(arg("--people_tris", "24000"))   # per figure
FRONT_TRIS = int(arg("--front_tris", "40000"))      # the caller in the front row, seen closest
# how much texture each kind of surface gets, relative to its area (the floor and the wall are big and
# dark, the desk tops are where the light pools)
WEIGHT = {"island": 0.35, "wall": 0.5, "board_frame": 0.6, "ticker_frame": 0.6}
os.makedirs(OUT, exist_ok=True)


def evaluated_mesh(ob, name):
    """ob with its modifiers, curves and texts turned into a static world-space mesh object."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=False, depsgraph=dg)
    me.transform(ob.matrix_world)
    if ob.matrix_world.determinant() < 0:  # a mirrored figure: turn its faces back outward
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
    new = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(new)
    return new


def select_only(obs, active):
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        if o is not None:
            o.select_set(False)
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active


def join(obs, name):
    """Merge world-space mesh objects into one new object (materials remapped, UVs kept by name).
    bpy.ops.object.join segfaulted on the decimated figures in bpy 5.2.3, so this goes through bmesh."""
    mats, bm = [], bmesh.new()
    for o in obs:
        tmp = o.data.copy()
        remap = []
        for m in tmp.materials:
            if m not in mats:
                mats.append(m)
            remap.append(mats.index(m))
        if remap:
            idx = np.empty(len(tmp.polygons), dtype=np.int32)
            tmp.polygons.foreach_get("material_index", idx)
            tmp.polygons.foreach_set("material_index", np.array(remap, dtype=np.int32)[np.clip(idx, 0, len(remap) - 1)])
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.validate()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for o in obs:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()
    return ob


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def decimate(ob, target):
    n = tris(ob)
    if n <= target:
        return
    mod = ob.modifiers.new("dec", "DECIMATE")
    mod.ratio = target / n
    select_only([ob], ob)
    bpy.ops.object.modifier_apply(modifier="dec")


def unwrap(ob, weight=1.0, margin=0.004):
    """Smart-project ob alone, then scale its layout so its texture density matches its area (times
    weight); the parts are packed together after joining."""
    select_only([ob], ob)
    if not ob.data.uv_layers:
        ob.data.uv_layers.new(name="UVMap")
    for layer in list(ob.data.uv_layers)[1:]:
        ob.data.uv_layers.remove(layer)
    ob.data.uv_layers[0].name = "UVMap"
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=1.0)
    bpy.ops.object.mode_set(mode="OBJECT")
    me = ob.data
    uv = np.empty(len(me.loops) * 2, dtype=np.float64)
    me.uv_layers[0].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    a3 = sum(p.area for p in me.polygons)
    auv = 0.0
    for p in me.polygons:
        pts = uv[p.loop_start:p.loop_start + p.loop_total]
        x, y = pts[:, 0], pts[:, 1]
        auv += 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
    k = math.sqrt(a3 / max(auv, 1e-12)) * math.sqrt(weight)
    me.uv_layers[0].data.foreach_set("uv", (uv * k).ravel())


def pack(ob, margin=0.0015):
    select_only([ob], ob)
    ts = bpy.context.scene.tool_settings
    ts.use_uv_select_sync = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, scale=True, margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")


def bake_light(ob, size, name):
    """Diffuse light times colour (direct + indirect) into a float image, saved through the view
    transform as an sRGB PNG."""
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    nodes = []
    for m in ob.data.materials:
        tex = m.node_tree.nodes.get("bake_target") or m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.name = "bake_target"
        tex.image = img
        m.node_tree.nodes.active = tex
        nodes.append(tex)
    select_only([ob], ob)
    sc = bpy.context.scene
    sc.cycles.samples = SAMPLES
    b = sc.render.bake
    b.use_selected_to_active = False
    b.margin = 6
    b.margin_type = "EXTEND"
    b.use_pass_direct = b.use_pass_indirect = b.use_pass_color = True
    b.use_pass_diffuse, b.use_pass_glossy, b.use_pass_transmission, b.use_pass_emit = True, False, False, False
    t0 = time.time()
    bpy.ops.object.bake(type="COMBINED", pass_filter={"DIRECT", "INDIRECT", "COLOR", "DIFFUSE"})
    print(f"[bake] {name} {size}px {time.time() - t0:.0f}s", flush=True)
    path = os.path.join(OUT, f"{name}.png")
    img.save_render(path, scene=sc)  # through AgX, as the frames are
    for tex in nodes:
        tex.image = None
    return path


def bake_vertex_light(ob, samples, smooth=2):
    """The same light as bake_light, into ob's vertices: baked into a float colour attribute, smoothed
    over each vertex's neighbours (`smooth` passes, half weight) to settle the sampling noise, passed
    through the view transform by way of a float image, and stored as an sRGB byte colour."""
    me = ob.data
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    raw = me.color_attributes.new("bake", "FLOAT_COLOR", "POINT")
    me.color_attributes.active_color = raw
    select_only([ob], ob)
    sc = bpy.context.scene
    sc.cycles.samples = samples
    b = sc.render.bake
    b.target = "VERTEX_COLORS"
    b.use_selected_to_active = False
    b.use_pass_direct = b.use_pass_indirect = b.use_pass_color = True
    t0 = time.time()
    bpy.ops.object.bake(type="COMBINED", pass_filter={"DIRECT", "INDIRECT", "COLOR", "DIFFUSE"}, target="VERTEX_COLORS")
    b.target = "IMAGE_TEXTURES"
    n = len(me.vertices)
    print(f"[bake] {ob.name} {n} vertices {samples} samples {time.time() - t0:.0f}s", flush=True)
    col = np.empty(n * 4, dtype=np.float32)
    raw.data.foreach_get("color", col)
    col = col.reshape(n, 4)[:, :3].astype(np.float64)
    ev = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", ev)
    a, c = ev[0::2], ev[1::2]
    deg = np.bincount(a, minlength=n) + np.bincount(c, minlength=n)
    for _ in range(smooth):
        acc = np.zeros_like(col)
        np.add.at(acc, a, col[c])
        np.add.at(acc, c, col[a])
        nb = acc / np.maximum(deg, 1)[:, None]
        col = np.where(deg[:, None] > 0, 0.5 * col + 0.5 * nb, col)
    # through the view transform: as a float image, saved by save_render like the maps, read back
    w = 1024
    h = (n + w - 1) // w
    img = bpy.data.images.new(ob.name + "_vcol", w, h, alpha=False, float_buffer=True)
    px = np.zeros((w * h, 4), dtype=np.float32)
    px[:n, :3] = col
    px[:, 3] = 1.0
    img.pixels.foreach_set(px.ravel())
    path = os.path.join(OUT, f"{ob.name}_vcol.png")
    img.save_render(path, scene=sc)
    bpy.data.images.remove(img)
    from PIL import Image
    srgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)[::-1].reshape(-1, 3)[:n] / 255.0
    me.color_attributes.remove(raw)
    out = me.color_attributes.new("Color", "BYTE_COLOR", "POINT")
    me.color_attributes.active_color = out
    me.color_attributes.default_color_name = "Color"
    rgba = np.ones((n, 4), dtype=np.float32)
    rgba[:, :3] = srgb
    out.data.foreach_set("color_srgb", rgba.ravel())
    return path


def to_web(ob, image_path):
    """Swap ob's materials for one that only carries its baked map (the page draws it unlit)."""
    m = bpy.data.materials.new(ob.name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    if image_path:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(image_path)
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    else:  # the light is in the vertex colours
        col = nt.nodes.new("ShaderNodeVertexColor")
        col.layer_name = "Color"
        nt.links.new(col.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    ob.data.materials.clear()
    ob.data.materials.append(m)


def main():
    t0 = time.time()
    kit.reset("a", res=(1280, 800), samples=SAMPLES)
    room.build(FIGS, TEX)
    cam = room.camera_main()
    cam.name = cam.data.name = "cam_main"
    room.hero_phone(cam, TEX)
    wide = kit.camera(*room.CAM_WIDE)
    wide.name = wide.data.name = "cam_wide"
    bpy.context.scene.camera = cam
    bpy.context.view_layer.update()

    def root_of(o):
        while o.parent is not None:
            o = o.parent
        return o

    groups = {"room": [], "people": [], "hero": [], "emit": []}
    for o in list(bpy.context.scene.objects):
        if o.type not in ("MESH", "CURVE", "FONT"):
            continue
        mats = [m for m in getattr(o.data, "materials", []) if m]
        if any(m.get("emit_image") for m in mats):
            groups["emit"].append(o)
        elif o.get("hero") or o.name.startswith("hero_"):
            groups["hero"].append(o)
        elif root_of(o).name.startswith("fig_"):
            groups["people"].append(o)
        else:
            groups["room"].append(o)
    print({k: len(v) for k, v in groups.items()}, flush=True)

    # static copies; the originals stay in the scene until the copies are ready, then go
    made = {"room": [], "people": [], "hero": []}
    for g in ("room", "hero"):
        for o in groups[g]:
            c = evaluated_mesh(o, o.name + "_s")
            unwrap(c, WEIGHT.get(o.name.split(".")[0], 1.0) * (4.0 if g == "hero" else 1.0))
            made[g].append(c)
    figs = {}
    for o in groups["people"]:
        figs.setdefault(root_of(o).name, []).append(o)
    for rname, obs in figs.items():
        cs = [evaluated_mesh(o, o.name + "_s") for o in obs]
        fig = join(cs, rname + "_s")
        front = rname == "fig_phone"
        decimate(fig, FRONT_TRIS if front else PEOPLE_TRIS)
        made["people"].append(fig)
        print(f"[people] {rname} {tris(fig)} tris", flush=True)
    # emissive parts keep their own UVs and images
    emit = {}
    for o in groups["emit"]:
        img = next(m["emit_image"] for m in o.data.materials if m and m.get("emit_image"))
        emit.setdefault(img, []).append(evaluated_mesh(o, o.name + "_s"))
    for o in groups["room"] + groups["hero"] + groups["people"] + groups["emit"]:
        bpy.data.objects.remove(o, do_unlink=True)
    for o in list(bpy.context.scene.objects):
        if o.type == "EMPTY":
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()

    parts = {}
    for g in ("room", "people", "hero"):
        parts[g] = join(made[g], g)
        if g != "people":
            pack(parts[g])
        print(f"[{g}] {tris(parts[g])} tris", flush=True)
    for g in ("room", "hero"):
        for a in list(parts[g].data.color_attributes):
            parts[g].data.color_attributes.remove(a)
    names = {"board.png": "board", "ticker.png": "ticker", "readouts.png": "readouts", "phone_screen.png": "hero_screen"}
    for img, obs in emit.items():
        parts[names[img]] = join(obs, names[img])

    # every bake first, then the web materials: a swapped material would change what the next bake sees
    baked = {g: bake_light(parts[g], SIZES[g], f"{g}_light") for g in ("room", "hero")}
    bake_vertex_light(parts["people"], PEOPLE_SAMPLES)
    for g, path in baked.items():
        to_web(parts[g], path)
    to_web(parts["people"], None)
    for uv in list(parts["people"].data.uv_layers):
        parts["people"].data.uv_layers.remove(uv)

    for o in bpy.context.scene.objects:
        o.select_set(o.name in parts or o.name in ("cam_main", "cam_wide"))
    path = os.path.join(OUT, "digital.glb")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
        export_materials="EXPORT", export_cameras=True, export_lights=False, export_image_format="AUTO",
        export_texcoords=True, export_normals=False, export_vertex_color="NAME", export_vertex_color_name="Color", export_all_vertex_colors=False,
    )
    total = sum(tris(parts[k]) for k in parts)
    print(f"[done] {path} {os.path.getsize(path) // 1024} KB, {total} tris, {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
