"""Download CC0 props from Poly Haven, decimate them to game budgets and pack them into one GLB.

    make props      # = blender -b --factory-startup -P tools/blender/build_props.py -- godot/game/world/models/props.glb

Every object is renamed <kind>_<n>, moved so its origin sits at the bottom centre, and keeps its
Poly Haven PBR textures (re-encoded as JPEG in the GLB).
"""
import os
import subprocess
import sys

import bmesh
import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CACHE = os.path.join(ROOT, "build", "cache", "polyhaven_models")
# asset id -> (kind, triangle budget per object)
ASSETS = {
    "rock_moss_set_01": ("mossrock", 1400),
    "rock_moss_set_02": ("mossrock", 1400),
    "boulder_01": ("boulder", 2600),
    "namaqualand_boulder_02": ("boulder", 2600),
    "rock_09": ("pebble", 320),
    "fern_02": ("fern", 3200),
    "dead_tree_trunk": ("log", 2400),
    "tree_stump_01": ("stump", 1800),
    "dry_branches_medium_01": ("sticks", 1600),
}


def fetch(asset):
    gltf = os.path.join(CACHE, asset, f"{asset}_1k.gltf")
    if not os.path.exists(gltf):
        subprocess.check_call(["python3", os.path.join(ROOT, "tools", "assets", "polyhaven.py"), "model", asset,
                               "--res", "1k", "--out", CACHE])
    for dirpath, _, files in os.walk(os.path.join(CACHE, asset)):
        for f in files:
            if f.endswith(".gltf"):
                return os.path.join(dirpath, f)
    raise FileNotFoundError(asset)


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[0] if argv else os.path.join(ROOT, "godot", "game", "world", "models", "props.glb")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    counters = {}
    keep = []
    for asset, (kind, budget) in ASSETS.items():
        path = fetch(asset)
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
        for obj in new:
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            # Bake parent transforms into the mesh, then decimate.
            bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
            t0 = tris(obj)
            # glTF import splits vertices along seams; weld them so the decimator can collapse edges.
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
            bm.to_mesh(obj.data)
            bm.free()
            if t0 > budget:
                mod = obj.modifiers.new("dec", "DECIMATE")
                mod.ratio = budget / t0
                bpy.ops.object.modifier_apply(modifier=mod.name)
            # Origin at the bottom centre, placed at the world origin.
            ws = [obj.matrix_world @ v.co for v in obj.data.vertices]
            cx = (min(v.x for v in ws) + max(v.x for v in ws)) / 2
            cy = (min(v.y for v in ws) + max(v.y for v in ws)) / 2
            zmin = min(v.z for v in ws)
            offset = Vector((cx, cy, zmin))
            for v, w in zip(obj.data.vertices, ws):
                v.co = w - offset
            obj.location = (0, 0, 0)
            n = counters.get(kind, 0)
            counters[kind] = n + 1
            obj.name = f"{kind}_{n}"
            obj.data.name = obj.name
            print(f"  {asset} -> {obj.name}: {t0} -> {tris(obj)} triangles, size {tuple(round(d, 2) for d in obj.dimensions)}")
            keep.append(obj)
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    # Props are small on screen: 512 px textures keep the download small.
    for img in bpy.data.images:
        if img.size[0] > 512:
            img.scale(512, 512)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=85,
                              export_tangents=True, export_yup=True)
    print(f"wrote {out} ({os.path.getsize(out) / 1e6:.1f} MB)")


main()
