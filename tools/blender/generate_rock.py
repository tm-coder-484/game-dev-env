"""Procedurally generate a photoreal-ish rock, bake its PBR textures, export GLB.

Demonstrates the full headless-Blender asset pipeline: build geometry with
modifiers -> shade with procedural nodes -> bake to image textures (glTF can't
carry procedural nodes) -> export a game-ready .glb for Godot and Three.js.

Usage:
  blender -b --factory-startup -P tools/blender/generate_rock.py -- OUT.glb [--seed 7] [--res 1024] [--samples 16]

Each seed gives a different rock. Runs on CPU (Cycles), ~20-40 s at 1024 px.
"""
import argparse
import os
import sys

import bpy


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="generate_rock.py")
    p.add_argument("out", help="output .glb path")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--res", type=int, default=1024, help="baked texture size")
    p.add_argument("--samples", type=int, default=16, help="Cycles bake samples")
    p.add_argument("--size", type=float, default=1.2, help="approx. radius in metres")
    return p.parse_args(argv)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    return scene


def build_mesh(seed, size):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=6, radius=size)
    rock = bpy.context.active_object
    rock.name = "Rock"
    rock.scale = (1.0, 0.8 + (seed % 5) * 0.05, 0.62)  # squashed boulder

    # Large-scale lumps, then finer cracks, via legacy displacement textures.
    for name, kind, scale, strength in (("Lumps", "VORONOI", 0.9, 0.45),
                                        ("Facets", "VORONOI", 0.35, 0.12),
                                        ("Detail", "CLOUDS", 0.12, 0.05)):
        tex = bpy.data.textures.new(f"{name}Tex", type=kind)
        tex.noise_scale = scale
        if kind == "VORONOI":
            tex.distance_metric = "DISTANCE"
        mod = rock.modifiers.new(name, "DISPLACE")
        mod.texture = tex
        mod.strength = strength
        mod.texture_coords = "OBJECT"
        # Offset the texture per seed so each rock differs.
        empty = bpy.data.objects.new(f"{name}Offset", None)
        bpy.context.collection.objects.link(empty)
        empty.location = (seed * 1.37, seed * 2.11, seed * 0.73)
        mod.texture_coords_object = empty

    dec = rock.modifiers.new("Decimate", "DECIMATE")
    dec.ratio = 0.25  # ~5k tris: fine for a hero prop; engines can auto-LOD further
    for m in list(rock.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    for o in [o for o in bpy.data.objects if o.type == "EMPTY"]:
        bpy.data.objects.remove(o)

    bpy.ops.object.shade_smooth()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    # Sit the rock on the ground plane (min Z = 0).
    min_z = min(v.co.z for v in rock.data.vertices)
    for v in rock.data.vertices:
        v.co.z -= min_z

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    return rock


def procedural_material(seed):
    mat = bpy.data.materials.new("RockProcedural")
    if bpy.app.version < (5, 0, 0):
        mat.use_nodes = True  # always on (and deprecated) from Blender 5.0
    nt = mat.node_tree
    n, links = nt.nodes, nt.links
    bsdf = n["Principled BSDF"]

    coord = n.new("ShaderNodeTexCoord")
    mapping = n.new("ShaderNodeMapping")
    mapping.inputs["Location"].default_value = (seed * 3.1, seed * 1.7, 0)
    links.new(coord.outputs["Object"], mapping.inputs["Vector"])

    noise = n.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.0
    noise.inputs["Detail"].default_value = 12.0
    noise.inputs["Roughness"].default_value = 0.62
    links.new(mapping.outputs["Vector"], noise.inputs["Vector"])

    vor = n.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 7.0
    links.new(mapping.outputs["Vector"], vor.inputs["Vector"])

    # Base colour: grey-brown stone with darker crevices and lichen speckle.
    ramp = n.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.elements[0].position, cr.elements[0].color = 0.38, (0.035, 0.032, 0.03, 1)
    cr.elements[1].position, cr.elements[1].color = 0.68, (0.30, 0.28, 0.25, 1)
    mid = cr.elements.new(0.52)
    mid.color = (0.14, 0.13, 0.11, 1)
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])

    lichen = n.new("ShaderNodeMix")
    lichen.data_type = "RGBA"
    lichen.blend_type = "MIX"
    lichen.inputs["B"].default_value = (0.16, 0.20, 0.06, 1)
    lichen_mask = n.new("ShaderNodeMath")
    lichen_mask.operation = "GREATER_THAN"
    lichen_mask.inputs[1].default_value = 0.64
    links.new(noise.outputs["Fac"], lichen_mask.inputs[0])
    links.new(lichen_mask.outputs[0], lichen.inputs["Factor"])
    links.new(ramp.outputs["Color"], lichen.inputs["A"])
    links.new(lichen.outputs["Result"], bsdf.inputs["Base Color"])

    rough = n.new("ShaderNodeMapRange")
    rough.inputs["To Min"].default_value = 0.55
    rough.inputs["To Max"].default_value = 0.95
    links.new(noise.outputs["Fac"], rough.inputs["Value"])
    links.new(rough.outputs["Result"], bsdf.inputs["Roughness"])

    bump = n.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.0
    bump.inputs["Distance"].default_value = 0.02
    height = n.new("ShaderNodeMath")
    height.operation = "ADD"
    links.new(noise.outputs["Fac"], height.inputs[0])
    links.new(vor.outputs["Distance"], height.inputs[1])
    links.new(height.outputs[0], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def bake(obj, mat, res, samples):
    """Bake colour / roughness / normal into images, rewire material to use them."""
    scene = bpy.context.scene
    scene.cycles.samples = samples
    scene.render.bake.margin = 8
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    images = {}
    for kind, bake_type, colorspace in (("color", "DIFFUSE", "sRGB"),
                                        ("roughness", "ROUGHNESS", "Non-Color"),
                                        ("normal", "NORMAL", "Non-Color")):
        img = bpy.data.images.new(f"rock_{kind}", res, res, alpha=False, float_buffer=False)
        img.colorspace_settings.name = colorspace
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        nt.nodes.active = node  # bake target = active image node
        kwargs = {"type": bake_type}
        if bake_type == "DIFFUSE":
            kwargs["pass_filter"] = {"COLOR"}  # albedo only, no lighting baked in
        bpy.ops.object.bake(**kwargs)
        images[kind] = (img, node)
        print(f"  baked {kind}")

    links = nt.links
    links.new(images["color"][1].outputs["Color"], bsdf.inputs["Base Color"])
    links.new(images["roughness"][1].outputs["Color"], bsdf.inputs["Roughness"])
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    links.new(images["normal"][1].outputs["Color"], nmap.inputs["Color"])
    links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    # Pack so the glTF exporter embeds them in the .glb.
    for img, _ in images.values():
        img.pack()


def main():
    args = parse_args()
    reset_scene()
    rock = build_mesh(args.seed, args.size)
    mat = procedural_material(args.seed)
    rock.data.materials.append(mat)
    bpy.context.view_layer.objects.active = rock
    rock.select_set(True)
    bake(rock, mat, args.res, args.samples)

    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True,
                              export_image_format="JPEG", export_apply=True)
    tris = sum(len(p.vertices) - 2 for p in rock.data.polygons)
    print(f"wrote {out} ({os.path.getsize(out) / 1e6:.2f} MB, {tris} tris)")


main()
