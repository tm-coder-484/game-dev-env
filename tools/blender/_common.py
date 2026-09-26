"""Shared helpers for the headless Blender scripts."""
import os

import bpy

IMPORTERS = {
    ".glb": lambda p: bpy.ops.import_scene.gltf(filepath=p),
    ".gltf": lambda p: bpy.ops.import_scene.gltf(filepath=p),
    ".fbx": lambda p: bpy.ops.import_scene.fbx(filepath=p),
    ".obj": lambda p: bpy.ops.wm.obj_import(filepath=p),
    ".stl": lambda p: bpy.ops.wm.stl_import(filepath=p),
    ".ply": lambda p: bpy.ops.wm.ply_import(filepath=p),
    ".usd": lambda p: bpy.ops.wm.usd_import(filepath=p),
    ".usda": lambda p: bpy.ops.wm.usd_import(filepath=p),
    ".usdc": lambda p: bpy.ops.wm.usd_import(filepath=p),
    ".usdz": lambda p: bpy.ops.wm.usd_import(filepath=p),
    ".dae": lambda p: bpy.ops.wm.collada_import(filepath=p),
}


def new_material(name):
    mat = bpy.data.materials.new(name)
    if bpy.app.version < (5, 0, 0):
        mat.use_nodes = True  # always on (and deprecated) from Blender 5.0
    return mat


def import_model(path):
    """Import a model file into the current scene and return the new objects."""
    path = os.path.abspath(path)
    ext = os.path.splitext(path)[1].lower()
    before = set(bpy.data.objects)
    if ext == ".blend":
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            dst.objects = src.objects
        for o in dst.objects:
            if o is not None:
                bpy.context.scene.collection.objects.link(o)
    elif ext in IMPORTERS:
        IMPORTERS[ext](path)
    else:
        raise SystemExit(f"unsupported format {ext}; supported: .blend {' '.join(sorted(IMPORTERS))}")
    return [o for o in bpy.data.objects if o not in before]
