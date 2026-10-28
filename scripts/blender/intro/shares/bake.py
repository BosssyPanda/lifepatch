"""Bake era five (the VOC shares, 1602) for the browser: public/intro/shares/shares.glb.

The page draws the scene unlit: every surface but the silver carries its own light, baked by Cycles
from the scene shares.py renders and passed through the renders' view transform, so the browser shows
what the Blender frames show. The silver stays a real metal (the intro keeps money PBR) and is lit on
the page by the studio environment.

Parts, found by name on the page:
  world      quay, water, table, register, barrels, chests, the coffer and the ship (one mesh, one map)
  people     the bookkeeper, the buyer and the porter, decimated (their light is in their vertex colours)
  hero       the 1606 receipt (its own map; stays lit when the era goes dark)
  money      the silver in the coffer and the piece of eight in front of the receipt (PBR, stays lit)
  coins      the silver on the table and in the buyer's hand (PBR, goes dark with the era)
             both carry their occlusion in vertex colours, and reflect silver_env.hdr: the scene
             itself seen from the top of the coffer, rendered beside the GLB
  cam_main   the camera, placed so the receipt sits on the intro's money spot
  hero_point an empty at the receipt's centre

    .venv-bpy/bin/python scripts/blender/intro/shares/bake.py --figs /tmp/shares/figs --out /tmp/shares/web \
        [--world 4096 --hero 1024 --samples 64 --people_samples 384]

Then compress (textures first, Draco last; see the README in this folder).

The helpers that cut, unwrap, join and bake are the ones digital/bake.py uses (scene 07), copied so the
two threads' files stay separate until the intro is stitched together.
"""
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.dirname(HERE)]

import bpy  # noqa: E402
import bmesh  # noqa: E402  (after bpy: the bpy module only provides it once loaded)
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import kit  # noqa: E402
import props  # noqa: E402
import shares  # noqa: E402


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


FIGS, OUT = arg("--figs"), arg("--out")
SIZES = {"world": int(arg("--world", "4096")), "hero": int(arg("--hero", "1024"))}
SAMPLES = int(arg("--samples", "64"))
PEOPLE_SAMPLES = int(arg("--people_samples", "384"))   # a vertex is one shading point, so more samples
PEOPLE_TRIS = int(arg("--people_tris", "24000"))       # per figure
FIGURES = ("bookkeeper", "buyer", "porter")
# texture per surface relative to its area: the ship is 45 m off and the water is a dark plain, so they
# get a fraction of what the table and the coffer in the foreground get
WEIGHT = {"ship": 0.12, "water": 0.004, "quay": 0.4}
os.makedirs(OUT, exist_ok=True)


def evaluated_mesh(ob, name):
    """ob with its modifiers, curves and texts turned into a static world-space mesh object."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=False, depsgraph=dg)
    me.transform(ob.matrix_world)
    if ob.matrix_world.determinant() < 0:  # a mirrored part: turn its faces back outward
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
    """Merge world-space mesh objects into one new object (materials remapped, UVs kept by name),
    through bmesh: bpy.ops.object.join segfaulted on decimated figures in bpy 5.2.3."""
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


def outward(ob):
    """Turn every face of ob to face out. A render does not care which way a face points, but a vertex
    bake shades each vertex along its normal: the ruffs and the hat bands were built inside out and
    baked black."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()


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
    """Smart-project ob alone into a new "bake" layout, then scale it so its texture density matches its
    area (times weight); the parts are packed together after joining. A part's own UVs stay as "orig",
    the layer it renders with, so its images (the receipt's writing, the register's pages) bake in the
    right place; drop_orig() removes them after the bake. Unwrapping over them wrote the receipt sideways."""
    select_only([ob], ob)
    uvs = ob.data.uv_layers
    for layer in list(uvs)[1:]:
        uvs.remove(layer)
    if uvs:
        uvs[0].name = "orig"
        uvs[0].active_render = True
    bake = uvs.new(name="bake")
    uvs.active = bake
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=1.0)
    bpy.ops.object.mode_set(mode="OBJECT")
    me = ob.data
    uv = np.empty(len(me.loops) * 2, dtype=np.float64)
    me.uv_layers["bake"].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    a3 = sum(p.area for p in me.polygons)
    auv = 0.0
    for p in me.polygons:
        pts = uv[p.loop_start:p.loop_start + p.loop_total]
        x, y = pts[:, 0], pts[:, 1]
        auv += 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
    k = math.sqrt(a3 / max(auv, 1e-12)) * math.sqrt(weight)
    me.uv_layers["bake"].data.foreach_set("uv", (uv * k).ravel())


def bake_layout(ob):
    """After joining: render with "orig" where a part had UVs (parts without get zeros there, which their
    materials never read), bake into "bake"."""
    uvs = ob.data.uv_layers
    uvs.active = uvs["bake"]
    if "orig" in uvs:
        uvs["orig"].active_render = True


def drop_orig(ob):
    uvs = ob.data.uv_layers
    if "orig" in uvs:
        uvs.remove(uvs["orig"])
    uvs["bake"].name = "UVMap"
    uvs.active = uvs["UVMap"]
    uvs["UVMap"].active_render = True


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


def render_probe(at, hide, path, res=(1024, 512), samples=64):
    """What the silver reflects: the scene seen from `at` as an equirectangular HDR (linear light, Z up,
    the panorama's centre looking down +X, as ../ore/studio.py renders the studio). A studio map of
    softboxes in the dark swung every coin's facets from white to black on the page and hatched their
    relief; the scene's own surroundings (the lid, the receipt, the grey quay) are what the frames show."""
    sc = bpy.context.scene
    # all restored after: the maps are saved through the scene's own image settings (a format left at
    # HDR wrote the next bake's PNG as an HDR file)
    keep = (sc.camera, sc.render.resolution_x, sc.render.resolution_y, sc.render.film_transparent,
            sc.view_settings.view_transform, sc.view_settings.look, sc.cycles.samples,
            sc.render.image_settings.file_format)
    cd = bpy.data.cameras.new("probe")
    cd.type = "PANO"
    cd.panorama_type = "EQUIRECTANGULAR"
    cam = kit.link(bpy.data.objects.new("probe", cd))
    cam.location = at
    cam.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
    for o in hide:
        o.hide_render = True
    # the lights themselves must show: the soft card above the coffer is most of what the tops of the
    # coins reflect in the frames, and lights are hidden from camera rays by default
    lights = [o for o in sc.objects if o.type == "LIGHT"]
    seen = [o.visible_camera for o in lights]
    for o in lights:
        o.visible_camera = True
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.cycles.samples = samples
    sc.render.image_settings.file_format = "HDR"
    sc.render.filepath = path
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"[probe] {path} {time.time() - t0:.0f}s", flush=True)
    for o in hide:
        o.hide_render = False
    for o, v in zip(lights, seen):
        o.visible_camera = v
    (sc.camera, sc.render.resolution_x, sc.render.resolution_y, sc.render.film_transparent,
     sc.view_settings.view_transform, sc.view_settings.look, sc.cycles.samples,
     sc.render.image_settings.file_format) = keep
    bpy.data.objects.remove(cam, do_unlink=True)


def bake_occlusion(ob, distance=0.012, samples=64, floor=0.5):
    """Ambient occlusion within `distance` into ob's vertex colours ("Color", linear, floor → 1): the
    page multiplies the silver by it, so the coins down in the heap darken and it reads as one heap
    rather than chips laid on black."""
    me = ob.data
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    raw = me.color_attributes.new("ao", "FLOAT_COLOR", "POINT")
    me.color_attributes.active_color = raw
    select_only([ob], ob)
    sc = bpy.context.scene
    sc.world.light_settings.distance = distance
    sc.cycles.samples = samples
    b = sc.render.bake
    b.target = "VERTEX_COLORS"
    t0 = time.time()
    bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
    b.target = "IMAGE_TEXTURES"
    n = len(me.vertices)
    col = np.empty(n * 4, dtype=np.float32)
    raw.data.foreach_get("color", col)
    ao = col.reshape(n, 4)[:, 0]
    print(f"[bake] {ob.name} occlusion {n} vertices, mean {ao.mean():.2f}, {time.time() - t0:.0f}s", flush=True)
    me.color_attributes.remove(raw)
    out = me.color_attributes.new("Color", "BYTE_COLOR", "POINT")
    me.color_attributes.active_color = out
    me.color_attributes.default_color_name = "Color"
    rgba = np.ones((n, 4), dtype=np.float32)
    rgba[:, :3] = (floor + (1 - floor) * ao)[:, None]
    out.data.foreach_set("color", rgba.ravel())


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


def web_silver(seeds):
    """The coins' web material: silver (metal 1, roughness 0.3 as in the frames) with the relief of
    every design in one normal atlas (props.cob_normal_atlas), saved beside the GLB."""
    atlas = props.cob_normal_atlas(seeds)
    h, w, _ = atlas.shape
    from PIL import Image
    path = os.path.join(OUT, "cob_normals.png")
    Image.fromarray((np.clip(atlas[::-1], 0, 1) * 255 + 0.5).astype(np.uint8)).save(path)
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = "Non-Color"
    m = bpy.data.materials.new("silver")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.93, 0.92, 0.9, 1.0)
    b.inputs["Metallic"].default_value = 1.0
    b.inputs["Roughness"].default_value = 0.3
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.uv_map = "UVMap"
    nt.links.new(tex.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    return m


def main():
    t0 = time.time()
    kit.reset("a", res=(1280, 800), samples=SAMPLES)
    cam, hp = shares.build(FIGS)
    cam.name = cam.data.name = "cam_main"
    bpy.context.scene.camera = cam
    point = kit.link(bpy.data.objects.new("hero_point", None))
    point.location = hp

    # every cob shares one of a few meshes: swap each for its light web copy before anything is baked,
    # so the shadows in the bake are the web coins' own
    seeds = {}
    for o in bpy.data.objects:
        if o.type == "MESH" and "cob_seed" in o:
            seeds.setdefault(o.data, int(o["cob_seed"]))
    order = sorted(set(seeds.values()))
    silver = web_silver(order)
    web = {s: props.cob_web(f"cob{s}", s, i, material=silver).data for i, s in enumerate(order)}
    coin_obs = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.data in seeds]
    for o in coin_obs:
        o.data = web[seeds[o.data]]
    for o in list(bpy.context.scene.objects):
        if o.name.startswith("cob") and o.data in web.values() and o not in coin_obs:
            bpy.data.objects.remove(o, do_unlink=True)   # the web copies' own objects, only their meshes are used
    bpy.context.view_layer.update()

    def root_of(o):
        while o.parent is not None:
            o = o.parent
        return o

    def under(o, name):
        while o is not None:
            if o.name == name:
                return True
            o = o.parent
        return False

    groups = {"world": [], "people": [], "hero": [], "money": [], "coins": []}
    for o in list(bpy.context.scene.objects):
        if o.type not in ("MESH", "CURVE", "FONT") or o.hide_render:
            continue
        if o in coin_obs:
            groups["money" if under(o, "cashbox") else "coins"].append(o)
        elif o.name == "hero_receipt":
            groups["hero"].append(o)
        elif root_of(o).name in FIGURES:
            groups["people"].append(o)
        else:
            groups["world"].append(o)
    print({k: len(v) for k, v in groups.items()}, flush=True)

    # the silver's reflections, from just above the middle of the heap, the coins themselves hidden
    heap = [o.matrix_world.translation for o in groups["money"]]
    top = max(heap, key=lambda v: v.z).z
    mid = sum(heap, Vector()) / len(heap)
    render_probe(Vector((mid.x, mid.y, top + 0.03)), groups["money"] + groups["coins"],
                 os.path.join(OUT, "silver_env.hdr"))

    # static copies; the originals stay in the scene until the copies are ready, then go
    made = {"world": [], "hero": [], "money": [], "coins": []}
    for g in ("world", "hero"):
        for o in groups[g]:
            c = evaluated_mesh(o, o.name + "_s")
            unwrap(c, WEIGHT.get(root_of(o).name.rstrip("0123456789").split("_")[0], 1.0))
            made[g].append(c)
    for g in ("money", "coins"):
        made[g] = [evaluated_mesh(o, o.name + "_s") for o in groups[g]]
    figs = {}
    for o in groups["people"]:
        figs.setdefault(root_of(o).name, []).append(o)
    people = []
    for rname, obs in figs.items():
        parts_ = [evaluated_mesh(o, o.name + "_s") for o in obs]
        for c in parts_:
            outward(c)
        fig = join(parts_, rname + "_s")
        decimate(fig, PEOPLE_TRIS)
        people.append(fig)
        print(f"[people] {rname} {tris(fig)} tris", flush=True)
    made["people"] = people
    # the bake still needs the coins' shadows: keep the coin copies in the scene, drop the originals
    for g in groups.values():
        for o in g:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in list(bpy.context.scene.objects):
        if o.type == "EMPTY" and o.name != "hero_point":
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()

    parts = {}
    for g in ("world", "hero", "people", "money", "coins"):
        parts[g] = join(made[g], g)
        if g in ("world", "hero"):
            bake_layout(parts[g])
            pack(parts[g])
        print(f"[{g}] {tris(parts[g])} tris", flush=True)
    for g in ("world", "hero"):
        for a in list(parts[g].data.color_attributes):
            parts[g].data.color_attributes.remove(a)

    # every bake first, then the web materials: a swapped material would change what the next bake sees
    baked = {g: bake_light(parts[g], SIZES[g], f"{g}_light") for g in ("world", "hero")}
    bake_vertex_light(parts["people"], PEOPLE_SAMPLES)
    for g in ("money", "coins"):
        bake_occlusion(parts[g])
    for g, path in baked.items():
        drop_orig(parts[g])
        to_web(parts[g], path)
    to_web(parts["people"], None)
    for uv in list(parts["people"].data.uv_layers):
        parts["people"].data.uv_layers.remove(uv)
    for g in ("money", "coins"):
        parts[g].data.materials.clear()
        parts[g].data.materials.append(silver)

    keep = set(parts) | {"cam_main", "hero_point"}
    for o in bpy.context.scene.objects:
        o.select_set(o.name in keep)
    path = os.path.join(OUT, "shares.glb")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
        export_materials="EXPORT", export_cameras=True, export_lights=False, export_image_format="AUTO",
        export_texcoords=True, export_normals=True, export_vertex_color="NAME", export_vertex_color_name="Color",
        export_all_vertex_colors=False,
    )
    total = sum(tris(parts[k]) for k in parts)
    print(f"[done] {path} {os.path.getsize(path) // 1024} KB, {total} tris, {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
