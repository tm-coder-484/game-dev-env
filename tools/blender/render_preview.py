"""Render a turntable-style preview PNG of any model, headless (Cycles on CPU).

Handy for thumbnails, asset reviews, and for letting an AI agent actually *see*
the asset it just produced.

Usage:
  blender -b --factory-startup -P tools/blender/render_preview.py -- MODEL OUT.png \
      [--hdri sky.hdr] [--size 768] [--samples 32] [--angle 35]

MODEL can be .glb/.gltf/.fbx/.obj/.stl/.ply/.usd(z)/.blend.
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import import_model, new_material  # noqa: E402


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="render_preview.py")
    p.add_argument("model")
    p.add_argument("out")
    p.add_argument("--hdri", help="equirectangular .hdr/.exr for lighting (default: neutral studio)")
    p.add_argument("--size", type=int, default=768)
    p.add_argument("--samples", type=int, default=32)
    p.add_argument("--angle", type=float, default=35.0, help="camera azimuth in degrees")
    return p.parse_args(argv)


def world_bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def main():
    a = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = a.samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = a.size
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"

    objs = import_model(a.model)
    if not any(o.type == "MESH" for o in objs):
        raise SystemExit("no meshes found in " + a.model)
    lo, hi = world_bounds(objs)
    center, radius = (lo + hi) / 2, max((hi - lo).length / 2, 1e-3)

    # Ground plane with a shadow-catching neutral material.
    bpy.ops.mesh.primitive_plane_add(size=radius * 40, location=(center.x, center.y, lo.z))
    ground = bpy.context.active_object
    gm = new_material("Ground")
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.18, 0.18, 0.18, 1)
    gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.8
    ground.data.materials.append(gm)

    world = bpy.data.worlds.new("World")
    if bpy.app.version < (5, 0, 0):
        world.use_nodes = True
    scene.world = world
    nt = world.node_tree
    bg = nt.nodes["Background"]
    if a.hdri:
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(os.path.abspath(a.hdri))
        nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    else:
        bg.inputs["Color"].default_value = (0.55, 0.6, 0.7, 1)
        bg.inputs["Strength"].default_value = 0.6
        sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
        sun.data.energy = 4.0
        sun.data.angle = math.radians(3)
        sun.rotation_euler = (math.radians(50), 0, math.radians(a.angle + 60))
        scene.collection.objects.link(sun)

    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    cam.data.lens = 50
    scene.collection.objects.link(cam)
    scene.camera = cam
    az, el = math.radians(a.angle), math.radians(18)
    dist = radius / math.tan(cam.data.angle / 2) * 1.15
    cam.location = center + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * dist
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()

    scene.render.filepath = os.path.abspath(a.out)
    bpy.ops.render.render(write_still=True)
    print("wrote", scene.render.filepath)


main()
