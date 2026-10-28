"""Sculpted hair for the MakeHuman plaster statues: a shell grown off the scalp, thinning to nothing at
the hairline, with a carved surface (curls or combed locks) like hair cut in stone."""
import math
import bpy
import bmesh


# hairline landmarks measured on MakeHuman's young male, relative to the root of his head bone
HEAD_REF = (-0.047, 0.783)


def scalp_verts(ob, rig=None, front=(-0.115, 0.884), back=(0.075, 0.752), ear_lift=0.035):
    """{index: height above the hairline} for rest-pose head vertices near or above a hairline that runs
    from the forehead down to the nape, lifted over the ears. With the rig, the line follows this body's
    head (bodies differ in height)."""
    hg = ob.vertex_groups["head"].index
    (yf, zf), (yb, zb) = front, back
    if rig is not None:
        h = rig.data.bones["head"].head_local
        dy, dz = h.y - HEAD_REF[0], h.z - HEAD_REF[1]
        yf, yb, zf, zb = yf + dy, yb + dy, zf + dz, zb + dz
    out = {}
    for v in ob.data.vertices:
        w = next((g.weight for g in v.groups if g.group == hg), 0.0)
        if w < 0.2:
            continue
        c = v.co
        t = min(max((c.y - yf) / (yb - yf), 0.0), 1.0)
        z_cut = zf + (zb - zf) * t
        # over the ears (sides, middle of the head front to back) the hairline rises
        side = min(max((abs(c.x) - 0.045) / 0.03, 0.0), 1.0)
        mid = math.exp(-((c.y - (-0.035 + (yf + 0.115))) / 0.045) ** 2)
        z_cut += ear_lift * side * mid
        if c.z - z_cut > -0.03:
            out[v.index] = c.z - z_cut
    return out


def hair_shell(body, scalp, name, material, thick=0.014, style="curls", seed=0, cell=0.011, amp=0.006):
    """body: the posed body baked to a static mesh (same vertex order as the rest body)."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    src = bm.verts.layers.int.new("src")
    for v in bm.verts:
        v[src] = v.index
    keep = [f for f in bm.faces if all(v.index in scalp for v in f.verts)]
    drop = [f for f in bm.faces if f not in set(keep)]
    bmesh.ops.delete(bm, geom=drop, context="FACES_ONLY")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    loose_e = [e for e in bm.edges if not e.link_faces]
    bmesh.ops.delete(bm, geom=loose_e, context="EDGES")
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    # thickness from the height above the hairline (a smooth function of position, so the hairline
    # is a clean curve, not the staircase of the base mesh's faces); below the line the shell sinks
    # under the skin and hides its own edge
    fall = {}
    for v in bm.verts:
        h = scalp[v[src]]
        if h < 0:
            off = -0.004
            fall[v] = 0.0
        else:
            t = min(h / 0.02, 1.0)
            t = t * t * (3 - 2 * t)
            off = 0.0025 + (thick - 0.0025) * t
            fall[v] = t
        v.co += v.normal * off
    bm.verts.index_update()
    fall = {v.index: w for v, w in fall.items()}
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = True
    vg = ob.vertex_groups.new(name="fall")
    for i, w in fall.items():
        vg.add([i], w, "REPLACE")
    sd = ob.modifiers.new("sub", "SUBSURF")
    sd.levels = sd.render_levels = 2
    if style is None or style == "smooth":
        pass
    elif style == "curls":
        tex = bpy.data.textures.new(name + "_curls", "VORONOI")
        tex.noise_scale = cell
        tex.distance_metric = "DISTANCE"
        tex.noise_intensity = 1.0
        disp = ob.modifiers.new("curls", "DISPLACE")
        disp.texture = tex
        disp.texture_coords = "GLOBAL"
        disp.direction = "NORMAL"
        disp.strength = -amp
        disp.mid_level = 0.5
        disp.vertex_group = "fall"
    elif style == "locks":
        tex = bpy.data.textures.new(name + "_locks", "WOOD")
        tex.wood_type = "BANDNOISE"
        tex.noise_basis_2 = "SIN"
        tex.noise_scale = cell
        tex.turbulence = 8.0
        disp = ob.modifiers.new("locks", "DISPLACE")
        disp.texture = tex
        disp.texture_coords = "GLOBAL"
        disp.direction = "NORMAL"
        disp.strength = amp
        disp.vertex_group = "fall"
    return ob
