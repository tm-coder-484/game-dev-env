"""Generate Hollowvale's creatures as skinned GLBs: a wolf and a Hollow (a gaunt, burnt husk).

    make creatures   # = blender -b --factory-startup -P tools/blender/generate_creatures.py -- godot/game/enemies/models

Each creature is a skeleton of named bones; the body is grown around it with a Skin modifier, smoothed
with subdivision, decimated to a game budget and bound to the armature with automatic weights. No
animations are exported: Godot animates the bones procedurally (game/enemies/*.gd), so gaits follow
the actual speed. Blender +Y is the creature's forward (Godot -Z after export).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

# name: (head, tail, parent, head radius, tail radius)
WOLF = {
    "hips": ((0, -0.42, 0.72), (0, -0.05, 0.74), None, 0.17, 0.18),
    "spine": ((0, -0.05, 0.74), (0, 0.32, 0.8), "hips", 0.18, 0.23),
    "brisket": ((0, 0.24, 0.76), (0, 0.3, 0.56), "spine", 0.2, 0.13),
    "neck": ((0, 0.32, 0.8), (0, 0.6, 0.94), "spine", 0.22, 0.14),
    "head": ((0, 0.6, 0.94), (0, 0.76, 0.96), "neck", 0.14, 0.12),
    "snout": ((0, 0.76, 0.96), (0, 1.0, 0.87), "head", 0.09, 0.04),
    "ear_l": ((0.065, 0.66, 1.02), (0.08, 0.64, 1.17), "head", 0.04, 0.006),
    "ear_r": ((-0.065, 0.66, 1.02), (-0.08, 0.64, 1.17), "head", 0.04, 0.006),
    "tail1": ((0, -0.44, 0.72), (0, -0.7, 0.66), "hips", 0.08, 0.1),
    "tail2": ((0, -0.7, 0.66), (0, -0.95, 0.52), "tail1", 0.1, 0.085),
    "tail3": ((0, -0.95, 0.52), (0, -1.15, 0.36), "tail2", 0.085, 0.025),
}
for side, x in (("l", 1), ("r", -1)):
    WOLF[f"shoulder_{side}"] = ((0, 0.32, 0.8), (0.13 * x, 0.32, 0.62), "spine", 0.17, 0.1)
    WOLF[f"fl_upper_{side}"] = ((0.13 * x, 0.32, 0.62), (0.14 * x, 0.36, 0.36), f"shoulder_{side}", 0.1, 0.055)
    WOLF[f"fl_lower_{side}"] = ((0.14 * x, 0.36, 0.36), (0.14 * x, 0.38, 0.08), f"fl_upper_{side}", 0.045, 0.035)
    WOLF[f"fl_foot_{side}"] = ((0.14 * x, 0.38, 0.08), (0.14 * x, 0.47, 0.02), f"fl_lower_{side}", 0.04, 0.03)
    WOLF[f"hip_{side}"] = ((0, -0.42, 0.72), (0.14 * x, -0.4, 0.64), "hips", 0.17, 0.12)
    WOLF[f"hl_upper_{side}"] = ((0.14 * x, -0.4, 0.64), (0.15 * x, -0.28, 0.38), f"hip_{side}", 0.12, 0.065)
    WOLF[f"hl_lower_{side}"] = ((0.15 * x, -0.28, 0.38), (0.15 * x, -0.45, 0.16), f"hl_upper_{side}", 0.05, 0.035)
    WOLF[f"hl_foot_{side}"] = ((0.15 * x, -0.45, 0.16), (0.15 * x, -0.4, 0.02), f"hl_lower_{side}", 0.035, 0.03)

HOLLOW = {
    "pelvis": ((0, 0.0, 0.98), (0, 0.04, 1.24), None, 0.13, 0.1),
    "spine": ((0, 0.04, 1.24), (0, 0.1, 1.5), "pelvis", 0.1, 0.13),
    "chest": ((0, 0.1, 1.5), (0, 0.2, 1.72), "spine", 0.15, 0.13),
    "neck": ((0, 0.2, 1.72), (0, 0.3, 1.86), "chest", 0.06, 0.055),
    "head": ((0, 0.3, 1.86), (0, 0.38, 2.1), "neck", 0.1, 0.07),
    "jaw": ((0, 0.34, 1.9), (0, 0.44, 1.84), "head", 0.06, 0.03),
}
for side, x in (("l", 1), ("r", -1)):
    HOLLOW[f"upperarm_{side}"] = ((0.2 * x, 0.16, 1.68), (0.3 * x, 0.2, 1.26), "chest", 0.055, 0.042)
    HOLLOW[f"forearm_{side}"] = ((0.3 * x, 0.2, 1.26), (0.32 * x, 0.27, 0.86), f"upperarm_{side}", 0.04, 0.032)
    HOLLOW[f"hand_{side}"] = ((0.32 * x, 0.27, 0.86), (0.33 * x, 0.36, 0.58), f"forearm_{side}", 0.034, 0.008)
    HOLLOW[f"thigh_{side}"] = ((0.11 * x, 0.0, 0.98), (0.13 * x, 0.08, 0.54), "pelvis", 0.075, 0.05)
    HOLLOW[f"shin_{side}"] = ((0.13 * x, 0.08, 0.54), (0.13 * x, -0.02, 0.1), f"thigh_{side}", 0.048, 0.035)
    HOLLOW[f"foot_{side}"] = ((0.13 * x, -0.02, 0.1), (0.13 * x, 0.16, 0.02), f"shin_{side}", 0.04, 0.02)


def build(name, bones, budget, material_color):
    # --- skin graph: one vertex per distinct joint, one edge per bone ---
    points, radii, edges = [], [], []

    def point(p, r):
        v = Vector(p)
        for i, q in enumerate(points):
            if (q - v).length < 1e-4:
                radii[i] = max(radii[i], r)
                return i
        points.append(v)
        radii.append(r)
        return len(points) - 1

    for bname, (h, t, parent, rh, rt) in bones.items():
        # Subdivide long bones so the skin can taper smoothly along them.
        n = max(1, int((Vector(t) - Vector(h)).length / 0.12))
        before = len(points)
        prev = point(h, rh)
        if prev == before and before > 0:
            # A chain starting off its parent (legs, ears, tail): tie it to the nearest joint.
            near = min(range(before), key=lambda j: (points[j] - points[prev]).length)
            edges.append((near, prev))
        for k in range(1, n + 1):
            f = k / n
            cur = point(Vector(h).lerp(Vector(t), f), rh + (rt - rh) * f)
            edges.append((prev, cur))
            prev = cur
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(p) for p in points], edges, [])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    skin = obj.modifiers.new("skin", "SKIN")
    skin.branch_smoothing = 0.6
    for i, sv in enumerate(mesh.skin_vertices[0].data):
        sv.radius = (radii[i], radii[i])
    mesh.skin_vertices[0].data[0].use_root = True
    sub = obj.modifiers.new("sub", "SUBSURF")
    sub.levels = 2
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier="skin")
    bpy.ops.object.modifier_apply(modifier="sub")
    tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
    if tris > budget:
        dec = obj.modifiers.new("dec", "DECIMATE")
        dec.ratio = budget / tris
        bpy.ops.object.modifier_apply(modifier="dec")
    bpy.ops.object.shade_smooth()
    # UVs, so fur strands and ember cracks stick to the body as it moves.
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")
    mat = bpy.data.materials.new(name + "_skin")
    mat.diffuse_color = material_color
    mesh.materials.append(mat)

    # --- armature with the same bones ---
    arm_data = bpy.data.armatures.new(name + "_rig")
    arm = bpy.data.objects.new(name + "_rig", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for bname, (h, t, parent, _, _) in bones.items():
        eb = arm_data.edit_bones.new(bname)
        eb.head = h
        eb.tail = t
        eb.align_roll(Vector((0, 0, 1)) if abs((Vector(t) - Vector(h)).normalized().z) < 0.7 else Vector((0, 1, 0)))
    for bname, (h, t, parent, _, _) in bones.items():
        if parent:
            eb = arm_data.edit_bones[bname]
            eb.parent = arm_data.edit_bones[parent]
            eb.use_connect = (Vector(arm_data.edit_bones[parent].tail) - Vector(h)).length < 1e-4
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
    print(f"  {name}: {len(bones)} bones, {tris} triangles")
    return obj, arm


def export(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_skins=True,
                              export_animations=False, export_materials="PLACEHOLDER", export_yup=True)
    print(f"wrote {path}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[0] if argv else "godot/game/enemies/models"
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    wolf = build("wolf", WOLF, 5000, (0.3, 0.28, 0.26, 1))
    export(wolf, os.path.join(out, "wolf.glb"))
    for o in wolf:
        bpy.data.objects.remove(o, do_unlink=True)
    hollow = build("hollow", HOLLOW, 5000, (0.1, 0.08, 0.07, 1))
    export(hollow, os.path.join(out, "hollow.glb"))


main()
