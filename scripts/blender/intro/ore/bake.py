"""Bake the hero ore for the browser.

The detailed ore from ore.py (~500k triangles) is far too heavy for a web page, so its detail is
baked onto a light copy:

- `ore`: the light mesh (gold, rock and quartz together) with one set of textures:
  base colour, ORM (R ambient occlusion, G roughness, B metalness) and a tangent-space normal map
  that carries the hammered dimples, the dirt's crumbs and the small pits. Its `_gold` vertex attribute is 1
  on the gold and 0 on rock and quartz; the click ripple bends only the gold.
- `crack_glow`: the crack's floor, its own emissive mesh, so the page can light it up as the
  crack turns towards the camera.
- `ore_pick`: a very light, invisible copy the page hit-tests the cursor against.

    python scripts/blender/intro/ore/bake.py --out DIR [--tris 60000] [--tex 2048]

writes DIR/ore.glb (textures inside, PNG) plus the PNGs, ready for gltf-transform to compress.
Blender's axes become glTF's on export: Blender's -Y (the ore's front, the crack) faces +Z.
"""
import argparse
import math
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import kit  # noqa: E402
import ore  # noqa: E402


MIN_NZ = math.cos(math.radians(75))   # the steepest a baked normal may tilt from the surface


def _bake_mesh(ob):
    """Freeze an object's transform into its mesh."""
    ob.data.transform(ob.matrix_world)
    ob.matrix_world.identity()


def _copy(ob, name):
    c = ob.copy()
    c.data = ob.data.copy()
    c.name = c.data.name = name
    bpy.context.scene.collection.objects.link(c)
    return c


def _apply_decimate(ob, tris, group=None):
    now = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    mod = ob.modifiers.new("lighten", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = min(1.0, tris / max(now, 1))
    mod.use_collapse_triangulate = True
    if group:
        mod.vertex_group = group
        mod.vertex_group_factor = 1.0
        mod.invert_vertex_group = True       # weight 1 = keep detail (the crack)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)
    me.validate()
    return now, sum(len(p.vertices) - 2 for p in me.polygons)


def _round_rim(ob, iterations=12, grow=0.008, lift=0.004):
    """The glow's outline follows the light mesh's triangles, so seen close it is a row of saw
    teeth, and so is the hole it sits in. Round the outline off, spread it a little under the
    crack's walls and lift it a few millimetres, so its smooth edge is the one that shows."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    rim = [v for v in bm.verts if v.is_boundary]
    for _ in range(iterations):
        moved = {}
        for v in rim:
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2:
                moved[v] = v.co * 0.5 + (nb[0].co + nb[1].co) * 0.25
        for v, co in moved.items():
            v.co = co
    bm.normal_update()
    for v in rim:
        inner = [e.other_vert(v).co for e in v.link_edges if not e.is_boundary]
        if inner:
            d = v.co - sum(inner, Vector()) / len(inner)
            d -= v.normal * d.dot(v.normal)
            if d.length > 1e-6:
                v.co += d.normalized() * grow
    for v in bm.verts:
        v.co += v.normal * lift
    bm.to_mesh(ob.data)
    bm.free()


def _median3(a):
    """3x3 median of an HxW or HxWxC array, a band of rows at a time to keep memory down."""
    h = a.shape[0]
    pad = np.pad(a, ((1, 1), (1, 1)) + ((0, 0),) * (a.ndim - 2), mode="edge")
    out = np.empty_like(a)
    for y0 in range(0, h, 256):
        y1 = min(h, y0 + 256)
        stack = np.stack([pad[y0 + dy:y1 + dy, dx:dx + a.shape[1]] for dy in range(3) for dx in range(3)])
        out[y0:y1] = np.median(stack, axis=0)
    return out


def _split_by_material(ob, index, name):
    """Move the faces with material `index` out of `ob` into a new object."""
    out = _copy(ob, name)
    for target, keep in ((ob, lambda f: f.material_index != index), (out, lambda f: f.material_index == index)):
        bm = bmesh.new()
        bm.from_mesh(target.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep(f)], context="FACES")
        bm.to_mesh(target.data)
        bm.free()
    return out


def _select_only(obs, active):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active


def _unwrap(ob, margin):
    """Lay the light mesh flat for its textures in a few big pieces. Unwrapping the crumpled
    surface directly cuts it into thousands of specks (seams everywhere, which shimmer), so a
    smoothed copy with the same triangles is unwrapped instead and its layout copied back."""
    flat = _copy(ob, "unwrap_smooth")
    mod = flat.modifiers.new("smooth", "SMOOTH")
    mod.factor = 1.0
    mod.iterations = 60
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(flat.evaluated_get(dg))
    flat.modifiers.clear()
    old = flat.data
    flat.data = me
    bpy.data.meshes.remove(old)
    _select_only([flat], flat)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=margin, area_weight=1.0)
    bpy.ops.object.mode_set(mode="OBJECT")
    uv = np.empty(len(flat.data.loops) * 2, dtype=np.float32)
    flat.data.uv_layers.active.data.foreach_get("uv", uv)
    layer = ob.data.uv_layers.new(name="UVMap") if not ob.data.uv_layers else ob.data.uv_layers.active
    layer.data.foreach_set("uv", uv)
    islands = len({tuple(np.round(uv.reshape(-1, 2)[i], 3)) for i in range(0, len(uv) // 2, 997)})
    bpy.data.objects.remove(flat)
    return islands


def _gold_attribute(ob, gold_index):
    """`_gold` per vertex: 1 where every face round the vertex is gold, else 0."""
    me = ob.data
    val = np.ones(len(me.vertices), dtype=np.float32)
    for p in me.polygons:
        if p.material_index != gold_index:
            for v in p.vertices:
                val[v] = 0.0
    a = me.attributes.new("_gold", "FLOAT", "POINT")
    a.data.foreach_set("value", val)


# ---- baking ---------------------------------------------------------------------------------


def _emit_from(mat, socket_name, colour=False):
    """Make the material emit what feeds one of its Principled inputs, so EMIT bakes it.
    Returns an undo function."""
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    prev = out.inputs["Surface"].links[0].from_socket if out.inputs["Surface"].links else None
    em = nt.nodes.new("ShaderNodeEmission")
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:                                  # the glow: emits nothing in these bakes
        em.inputs["Color"].default_value = (0, 0, 0, 1)
    else:
        src = bsdf.inputs[socket_name]
        if src.links:
            nt.links.new(src.links[0].from_socket, em.inputs["Color"])
        else:
            v = src.default_value
            em.inputs["Color"].default_value = tuple(v) if colour else (v, v, v, 1)
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])

    def undo():
        nt.nodes.remove(em)
        if prev is not None:
            nt.links.new(prev, out.inputs["Surface"])
    return undo


def _bake(kind, image, lo, his, samples=1, extrusion=0.01, ray=0.03):
    sc = bpy.context.scene
    sc.cycles.samples = samples
    tex = lo.data.materials[0].node_tree.nodes["bake_target"]
    tex.image = image
    lo.data.materials[0].node_tree.nodes.active = tex
    _select_only(his + [lo], lo)
    b = sc.render.bake
    b.use_selected_to_active = True
    b.cage_extrusion = extrusion
    b.max_ray_distance = ray
    b.margin = 8
    b.margin_type = "EXTEND"
    if kind == "NORMAL":
        b.normal_space = "TANGENT"
    bpy.ops.object.bake(type=kind)


def _pixels(image):
    w, h = image.size
    return np.array(image.pixels[:], dtype=np.float32).reshape(h, w, 4)


def _new_image(name, size, data):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=not data)
    img.colorspace_settings.name = "sRGB" if data else "Non-Color"
    return img


def _save(img, path):
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return path


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--tris", type=int, default=60000)
    ap.add_argument("--quartz-tris", type=int, default=12000)
    ap.add_argument("--tex", type=int, default=2048)
    ap.add_argument("--seed", type=int, default=ore.SEED)
    ap.add_argument("--ao-samples", type=int, default=32)
    ap.add_argument("--ao-reach", type=float, default=0.06, help="metres")
    args = ap.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)

    kit.reset("a", res=(64, 64), samples=1)
    sc = bpy.context.scene
    sc.cycles.use_denoising = False
    hi, q_hi = ore.build(args.seed, glow=8.0)
    bpy.context.view_layer.update()   # so matrix_world carries the scale and lift build() just set
    for o in (hi, q_hi):
        _bake_mesh(o)

    # the light copies
    lo = _copy(hi, "ore")
    glow = _split_by_material(lo, 2, "crack_glow")
    # Keep the crack sharp: its walls and rim cost three times as much to simplify. Only the
    # groove itself and a thin rim count, on the front: the band runs straight through the ore, so
    # without the depth limit it takes in the back too, and the decimation, held to its budget,
    # then crushes everything else into a few large facets.
    vg = lo.vertex_groups.new(name="crack")
    s = ore.ORE_HEIGHT / 2.0
    near = []
    for v in lo.data.vertices:
        x, y, z = v.co.x / s, v.co.y / s, v.co.z / s - 0.9
        if y < 0.0 and ore.crack_dist(x, z) < ore.CRACK_W * 1.2:
            near.append((v.index, y))
    front = min(y for _, y in near)
    keep = [i for i, y in near if y < front + ore.CRACK_D + 0.06]
    if len(keep) > len(lo.data.vertices) * 0.05:
        raise SystemExit(f"crack band holds {len(keep)} vertices, too many to protect")
    vg.add(keep, 1.0, "REPLACE")
    before, after = _apply_decimate(lo, args.tris - args.quartz_tris, "crack")
    print(f"[bake] ore {before} -> {after} triangles ({len(keep)} crack vertices kept)", flush=True)
    q_lo = _copy(q_hi, "quartz_lo")
    before, after = _apply_decimate(q_lo, args.quartz_tris)
    print(f"[bake] quartz {before} -> {after} triangles", flush=True)
    before, after = _apply_decimate(glow, 2000)
    _round_rim(glow)
    print(f"[bake] crack glow {before} -> {after} triangles", flush=True)
    q_lo.data.materials.clear()
    q_lo.data.materials.append(lo.data.materials[1])   # rock slot: quartz is not gold
    _select_only([lo, q_lo], lo)
    bpy.ops.object.join()
    _gold_attribute(lo, 0)
    for p in lo.data.polygons:
        p.use_smooth = True

    pick = _copy(lo, "ore_pick")
    before, after = _apply_decimate(pick, 4000)
    pick.data.attributes.remove(pick.data.attributes["_gold"])
    pick.data.materials.clear()
    print(f"[bake] pick proxy {after} triangles", flush=True)

    _unwrap(lo, 0.004)
    lo.data.materials.clear()
    m = bpy.data.materials.new("ore")
    m.use_nodes = True
    t = m.node_tree.nodes.new("ShaderNodeTexImage")
    t.name = "bake_target"
    lo.data.materials.append(m)

    n = args.tex
    his = [hi, q_hi]
    mats = {mm for o in his for mm in o.data.materials}

    normal = _new_image("ore_normal", n, False)
    _bake("NORMAL", normal, lo, his)
    # A few rays (mostly on the steep, granular rock walls) land on a face the light mesh cannot
    # follow and come back tilted past 75 degrees or pointing into the surface, which renders as
    # black specks. Hold every normal within 75 degrees of the surface, keeping its direction.
    px = _pixels(normal)
    v = px[..., :3] * 2.0 - 1.0
    steep = v[..., 2] < MIN_NZ
    v[..., 2] = np.maximum(v[..., 2], MIN_NZ)
    side = np.sqrt(np.maximum(v[..., 0] ** 2 + v[..., 1] ** 2, 1e-12))
    room = np.sqrt(1.0 - v[..., 2] ** 2)
    v[..., 0:2] = np.where(steep[..., None], v[..., 0:2] / side[..., None] * room[..., None], v[..., 0:2])
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    # Single texels whose ray found a stray face (a buried chunk, a pocket wall) point somewhere
    # else entirely and show as black pepper on the gold. Swap any texel more than 25 degrees off
    # its neighbourhood's median for that median.
    med = _median3(v)
    med /= np.maximum(np.linalg.norm(med, axis=-1, keepdims=True), 1e-6)
    stray = (v * med).sum(-1) < math.cos(math.radians(25))
    v[stray] = med[stray]
    px[..., :3] = v * 0.5 + 0.5
    normal.pixels[:] = px.ravel()
    print(f"[bake] normal ({steep.mean() * 100:.2f}% of texels held to 75 degrees, "
          f"{stray.mean() * 100:.2f}% stray texels replaced)", flush=True)

    color = _new_image("ore_color", n, True)
    undo = [_emit_from(mm, "Base Color", colour=True) for mm in mats]
    _bake("EMIT", color, lo, his)
    for u in undo:
        u()
    print("[bake] colour", flush=True)

    rough = _new_image("ore_rough", n, False)
    undo = [_emit_from(mm, "Roughness") for mm in mats]
    _bake("EMIT", rough, lo, his)
    for u in undo:
        u()
    metal = _new_image("ore_metal", n, False)
    undo = [_emit_from(mm, "Metallic") for mm in mats]
    _bake("EMIT", metal, lo, his)
    for u in undo:
        u()
    print("[bake] roughness, metalness", flush=True)

    # Occlusion is traced through the whole scene, so the light copies must not shade the detailed
    # one: the pick proxy and crack glow leave the scene and the light mesh stops casting. AO only
    # reaches a few centimetres, enough to darken the creases and pockets, not whole sides.
    for o in (pick, glow):
        sc.collection.objects.unlink(o)
    flags = ("visible_camera", "visible_diffuse", "visible_glossy", "visible_transmission", "visible_shadow")
    for f in flags:
        setattr(lo, f, False)
    sc.world.light_settings.distance = args.ao_reach
    ao = _new_image("ore_ao", n, False)
    _bake("AO", ao, lo, his, samples=args.ao_samples)
    for f in flags:
        setattr(lo, f, True)
    for o in (pick, glow):
        sc.collection.objects.link(o)
    print("[bake] occlusion", flush=True)

    orm = _new_image("ore_orm", n, False)
    px = np.ones((n, n, 4), dtype=np.float32)
    px[..., 0] = _median3(_pixels(ao)[..., 0])   # 32 samples leave grain; a 3x3 median takes it out
    px[..., 1] = _pixels(rough)[..., 0]
    px[..., 2] = _pixels(metal)[..., 0]
    orm.pixels[:] = px.ravel()

    paths = {}
    for img, name in ((color, "ore_color.png"), (orm, "ore_orm.png"), (normal, "ore_normal.png")):
        paths[name] = _save(img, os.path.join(args.out, name))
    # PNGs written from float buffers keep 8 bits; reload them as the textures the GLB carries
    color, orm, normal = (bpy.data.images.load(paths[k]) for k in ("ore_color.png", "ore_orm.png", "ore_normal.png"))
    orm.colorspace_settings.name = "Non-Color"
    normal.colorspace_settings.name = "Non-Color"

    # the material the browser gets
    nt = m.node_tree
    for node in list(nt.nodes):
        if node.type not in ("OUTPUT_MATERIAL", "BSDF_PRINCIPLED"):
            nt.nodes.remove(node)
    b = next(nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED")
    L = nt.links
    tc = nt.nodes.new("ShaderNodeTexImage")
    tc.image = color
    L.new(tc.outputs["Color"], b.inputs["Base Color"])
    to = nt.nodes.new("ShaderNodeTexImage")
    to.image = orm
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    L.new(to.outputs["Color"], sep.inputs["Color"])
    L.new(sep.outputs["Green"], b.inputs["Roughness"])
    L.new(sep.outputs["Blue"], b.inputs["Metallic"])
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = normal
    nm = nt.nodes.new("ShaderNodeNormalMap")
    L.new(tn.outputs["Color"], nm.inputs["Color"])
    L.new(nm.outputs["Normal"], b.inputs["Normal"])
    # occlusion goes out through the glTF exporter's own settings node
    grp = bpy.data.node_groups.get("glTF Material Output") or bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    if "Occlusion" not in [i.name for i in grp.interface.items_tree]:
        grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    gn = nt.nodes.new("ShaderNodeGroup")
    gn.node_tree = grp
    L.new(sep.outputs["Red"], gn.inputs["Occlusion"])

    gm = bpy.data.materials.new("crack_glow")
    gm.use_nodes = True
    gb = next(nd for nd in gm.node_tree.nodes if nd.type == "BSDF_PRINCIPLED")
    gb.inputs["Base Color"].default_value = (0, 0, 0, 1)
    gb.inputs["Emission Color"].default_value = kit.rgba(kit.LOOKS["a"]["fire"])
    gb.inputs["Emission Strength"].default_value = 1.0
    glow.data.materials.clear()
    glow.data.materials.append(gm)

    for o in list(bpy.context.scene.objects):
        if o not in (lo, glow, pick):
            bpy.data.objects.remove(o)
    # the detailed ore's shading inputs came along in the copies; the page needs only `_gold`
    for o in (lo, glow, pick):
        for a in [a.name for a in o.data.attributes]:
            if a in ("unit_co", "rock", "crack_wall") or a.startswith("relief_"):
                o.data.attributes.remove(o.data.attributes[a])
    # the page finds the three parts by name; the detailed originals held these names until now
    for o, name in ((lo, "ore"), (glow, "crack_glow"), (pick, "ore_pick")):
        o.name = o.data.name = name
    _select_only([lo, glow, pick], lo)
    path = os.path.join(args.out, "ore.glb")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_attributes=True,
        export_image_format="AUTO", export_yup=True, export_apply=True, export_tangents=False,
        export_materials="EXPORT", export_cameras=False, export_lights=False,
    )
    print("[bake]", path, os.path.getsize(path) // 1024, "KB", flush=True)


if __name__ == "__main__":
    main()
