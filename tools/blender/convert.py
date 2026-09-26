"""Convert any model to a game-ready .glb (or .gltf / .fbx / .obj), headless.

Usage:
  blender -b --factory-startup -P tools/blender/convert.py -- IN OUT.glb \
      [--decimate 0.5] [--scale 0.01] [--draco] [--apply-transforms]

  IN   .blend .fbx .obj .gltf .glb .stl .ply .usd(a/c/z) .dae
  OUT  .glb (recommended for Godot and Three.js), .gltf, .fbx or .obj

Examples:
  # Sketchfab/marketplace FBX in centimetres -> metres, halve the poly count
  blender -b --factory-startup -P tools/blender/convert.py -- chair.fbx chair.glb --scale 0.01 --decimate 0.5
  # Web delivery with Draco mesh compression (Three.js needs DRACOLoader)
  blender -b --factory-startup -P tools/blender/convert.py -- rock.blend rock.glb --draco
"""
import argparse
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import import_model  # noqa: E402


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="convert.py")
    p.add_argument("inp")
    p.add_argument("out")
    p.add_argument("--decimate", type=float, default=1.0, help="keep this fraction of faces (0-1)")
    p.add_argument("--scale", type=float, default=1.0, help="uniform scale, e.g. 0.01 for cm -> m")
    p.add_argument("--draco", action="store_true", help="Draco-compress meshes (glTF only)")
    p.add_argument("--apply-transforms", action="store_true", help="bake object transforms into meshes")
    return p.parse_args(argv)


def main():
    a = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs = import_model(a.inp)
    meshes = [o for o in objs if o.type == "MESH"]
    print(f"imported {len(objs)} objects ({len(meshes)} meshes)")

    for o in objs:
        if o.parent is None and a.scale != 1.0:
            o.scale = [s * a.scale for s in o.scale]
    if a.decimate < 1.0:
        for o in meshes:
            m = o.modifiers.new("Decimate", "DECIMATE")
            m.ratio = a.decimate
    if a.apply_transforms or a.decimate < 1.0 or a.scale != 1.0:
        bpy.ops.object.select_all(action="DESELECT")
        for o in meshes:
            o.select_set(True)
        if meshes:
            bpy.context.view_layer.objects.active = meshes[0]
            for o in meshes:
                for m in list(o.modifiers):
                    with bpy.context.temp_override(object=o, active_object=o):
                        bpy.ops.object.modifier_apply(modifier=m.name)
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    out = os.path.abspath(a.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    ext = os.path.splitext(out)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.export_scene.gltf(filepath=out, export_format="GLB" if ext == ".glb" else "GLTF_SEPARATE",
                                  export_apply=True, export_draco_mesh_compression_enable=a.draco)
    elif ext == ".fbx":
        bpy.ops.export_scene.fbx(filepath=out, apply_scale_options="FBX_SCALE_UNITS", path_mode="COPY",
                                 embed_textures=True)
    elif ext == ".obj":
        bpy.ops.wm.obj_export(filepath=out)
    else:
        raise SystemExit("output must be .glb, .gltf, .fbx or .obj")
    tris = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
    print(f"wrote {out} ({os.path.getsize(out) / 1e6:.2f} MB, ~{tris} tris)")


main()
