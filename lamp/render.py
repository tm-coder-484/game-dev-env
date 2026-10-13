"""Render the Strata lamp with Blender (Cycles).

    blender -b --factory-startup -P render.py -- [shot ...] [--quick]

Shots: glow, studio, base, exploded, side (default: all). Reads out/stl/*.stl
written by strata_lamp.py and writes out/renders/<shot>.png.
"""
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
STL = os.path.join(HERE, "out", "stl")
OUT = os.path.join(HERE, "out", "renders")
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
QUICK = "--quick" in ARGS
SHOTS = [a for a in ARGS if not a.startswith("--")] or ["glow", "studio", "base", "exploded", "side"]
S = 0.001  # mm -> m

WALNUT = ((0.032, 0.016, 0.008), (0.115, 0.06, 0.03), 95.0)
PINE = ((0.42, 0.20, 0.06), (0.74, 0.47, 0.20), 60.0)
LED_TEAL = (0.05, 1.0, 0.72)
LED_WARM = (1.0, 0.78, 0.52)


# --------------------------------------------------------------- materials --
def principled(name, color, rough=0.5, metal=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Coat Weight"].default_value = coat
    return m


def wood(name, dark, light, scale, seed):
    rnd = random.Random(seed)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    n, ln = nt.nodes, nt.links
    b = n["Principled BSDF"]
    tc = n.new("ShaderNodeTexCoord")
    mp = n.new("ShaderNodeMapping")
    # pith runs along x, well outside the board -> flat-sawn grain on the faces
    mp.inputs["Location"].default_value = (rnd.uniform(-1, 1), rnd.uniform(0.15, 0.4), rnd.uniform(-0.2, 0.2))
    mp.inputs["Rotation"].default_value = (0, rnd.uniform(-0.12, 0.12), rnd.uniform(-0.08, 0.08))
    noise = n.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 18.0
    noise.inputs["Detail"].default_value = 6.0
    wave = n.new("ShaderNodeTexWave")
    wave.wave_type = "RINGS"
    wave.rings_direction = "X"
    wave.inputs["Scale"].default_value = scale
    wave.inputs["Distortion"].default_value = 5.0
    wave.inputs["Detail"].default_value = 3.0
    ramp = n.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.25
    ramp.color_ramp.elements[0].color = (*light, 1)
    ramp.color_ramp.elements[1].position = 0.95
    ramp.color_ramp.elements[1].color = (*dark, 1)
    fine = n.new("ShaderNodeTexNoise")  # pores / fine streaks along the grain
    fine.inputs["Scale"].default_value = 900.0
    fmp = n.new("ShaderNodeMapping")
    fmp.inputs["Scale"].default_value = (0.04, 1, 1)
    mix = n.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 0.25
    ln.new(tc.outputs["Object"], mp.inputs["Vector"])
    ln.new(mp.outputs["Vector"], noise.inputs["Vector"])
    ln.new(mp.outputs["Vector"], wave.inputs["Vector"])
    ln.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    ln.new(tc.outputs["Object"], fmp.inputs["Vector"])
    ln.new(fmp.outputs["Vector"], fine.inputs["Vector"])
    ln.new(ramp.outputs["Color"], mix.inputs[6])
    ln.new(fine.outputs["Color"], mix.inputs[7])
    ln.new(mix.outputs[2], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.42
    b.inputs["Coat Weight"].default_value = 0.12
    b.inputs["Coat Roughness"].default_value = 0.3
    bump = n.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.04
    ln.new(fine.outputs["Fac"], bump.inputs["Height"])
    ln.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def emissive(name, color, strength):
    m = principled(name, (0.9, 0.92, 0.95), rough=0.35)
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Emission Color"].default_value = (*color, 1)
    b.inputs["Emission Strength"].default_value = strength
    return m


# ------------------------------------------------------------------ scene --
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 24 if QUICK else 160
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 8
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    sc.render.film_transparent = False
    w = bpy.data.worlds.new("World")
    sc.world = w
    w.use_nodes = True
    return sc


def load(name, mat, offset=(0, 0, 0)):
    path = os.path.join(STL, f"{name}.stl")
    bpy.ops.wm.stl_import(filepath=path, global_scale=S)
    ob = bpy.context.selected_objects[0]
    ob.name = name
    ob.data.transform(Matrix.Scale(S, 4))  # the importer puts global_scale on the object
    ob.scale = (1, 1, 1)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bm.to_mesh(ob.data)
    bm.free()
    for poly in ob.data.polygons:
        poly.use_smooth = True
    ob.data.set_sharp_from_angle(angle=math.radians(35))
    ob.data.materials.append(mat)
    ob.location = Vector(offset) * S
    return ob


def build(led_color, led_strength, explode=0.0, arm=True):
    with open(os.path.join(HERE, "out", "report.json")) as f:
        rep = json.load(f)
    species = [l["species"] for l in rep["layers"]]
    obs = {}
    for i, sp in enumerate(species):
        mat = wood(f"{sp}{i}", *(WALNUT if sp == "walnut" else PINE), seed=i * 7 + 3)
        obs[f"L{i + 1}"] = load(f"L{i + 1}_{sp}", mat, (0, 0, i * explode))
    alu = principled("aluminium", (0.86, 0.87, 0.88), rough=0.28, metal=1.0)
    plastic = principled("remote", (0.92, 0.92, 0.9), rough=0.35)
    rubber = principled("keys", (0.3, 0.3, 0.32), rough=0.5)
    zoff = (0, 0, 0)
    if arm:
        load("channel", alu)
        load("diffuser", emissive("led", led_color, led_strength))
    for fn in sorted(os.listdir(STL)) if not explode else []:
        if fn.startswith("remote_key_"):
            col = {"red": (0.8, 0.05, 0.04), "power": (0.8, 0.05, 0.04), "green": (0.05, 0.6, 0.12),
                   "blue": (0.04, 0.12, 0.8), "yellow": (0.95, 0.75, 0.05), "cyan": (0.05, 0.7, 0.8),
                   "purple": (0.5, 0.08, 0.7)}[fn[11:-4]]
            load(fn[:-4], principled(fn, col, rough=0.4), zoff)
    if not explode:
        load("remote_body", plastic, zoff)
        load("remote_keys", rubber, zoff)
    if explode:
        load("controller", principled("ctl", (0.03, 0.03, 0.035), rough=0.4), (0, 0, -explode * 0.6))
    else:
        load("feet", principled("cork", (0.45, 0.32, 0.2), rough=0.8))
    return obs, rep


def room(floor_col=(0.42, 0.40, 0.37), wall_col=(0.55, 0.56, 0.58)):
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, -0.003))
    bpy.context.object.data.materials.append(principled("desk", floor_col, rough=0.55))
    for loc, rot in (((0.42, 0, 1.5), (0, math.radians(-90), 0)), ((0, 0.32, 1.5), (math.radians(90), 0, 0))):
        bpy.ops.mesh.primitive_plane_add(size=3, location=loc, rotation=rot)
        bpy.context.object.data.materials.append(principled("wall", wall_col, rough=0.8))


def light(kind, loc, energy, size=0.5, color=(1, 1, 1), target=(0.05, 0.05, 0.15)):
    d = bpy.data.lights.new(kind, kind)
    d.energy = energy
    d.color = color
    if kind == "AREA":
        d.size = size
    ob = bpy.data.objects.new(kind, d)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return ob


def world(color, strength):
    bg = bpy.context.scene.world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*color, 1)
    bg.inputs["Strength"].default_value = strength


def camera(loc, target, lens=50, ortho=None):
    d = bpy.data.cameras.new("cam")
    d.lens = lens
    d.clip_start = 0.01
    if ortho:
        d.type = "ORTHO"
        d.ortho_scale = ortho
    ob = bpy.data.objects.new("cam", d)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = ob
    return ob


def render(name, res):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 50 if QUICK else 100
    os.makedirs(OUT, exist_ok=True)
    sc.render.filepath = os.path.join(OUT, f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print("wrote", sc.render.filepath)


# ------------------------------------------------------------------ shots --
def shot_glow():
    reset()
    build(LED_TEAL, 45.0)
    room(floor_col=(0.30, 0.27, 0.24), wall_col=(0.45, 0.46, 0.48))
    world((0.02, 0.025, 0.03), 0.05)
    light("AREA", (-0.6, -0.5, 0.5), 1.5, size=1.2, color=(0.8, 0.9, 1.0))
    camera((-0.55, -0.70, 0.36), (0.035, 0.03, 0.26), lens=50)
    render("glow", (1200, 1500))


def shot_studio():
    reset()
    build(LED_WARM, 60.0)
    room(floor_col=(0.5, 0.47, 0.43), wall_col=(0.68, 0.66, 0.63))
    world((0.9, 0.92, 0.95), 0.2)
    light("AREA", (-0.7, -0.9, 1.0), 32.0, size=1.6)
    light("AREA", (0.2, -1.0, 0.25), 8.0, size=1.0)
    camera((-0.55, -0.70, 0.38), (0.035, 0.03, 0.26), lens=50)
    render("studio", (1200, 1500))


def shot_base():
    reset()
    build(LED_WARM, 40.0)
    room(floor_col=(0.45, 0.42, 0.38), wall_col=(0.62, 0.6, 0.57))
    world((0.85, 0.88, 0.92), 0.2)
    light("AREA", (-0.5, -0.6, 0.6), 18.0, size=1.0, target=(0.09, 0.046, 0.03))
    light("AREA", (0.4, -0.6, 0.3), 4.0, size=0.8, target=(0.09, 0.046, 0.03))
    camera((-0.17, -0.26, 0.17), (0.085, 0.046, 0.04), lens=50)
    render("base", (1600, 1100))


def shot_exploded():
    reset()
    build(LED_WARM, 0.0, explode=34.0, arm=False)
    room(floor_col=(0.8, 0.8, 0.8), wall_col=(0.88, 0.88, 0.88))
    world((0.95, 0.95, 0.97), 0.25)
    light("AREA", (-0.4, -0.5, 0.7), 16.0, size=1.2, target=(0.09, 0.046, 0.08))
    light("AREA", (0.5, -0.3, 0.4), 4.0, size=1.0, target=(0.09, 0.046, 0.08))
    camera((-0.21, -0.33, 0.37), (0.09, 0.046, 0.09), lens=50)
    render("exploded", (1600, 1300))


def shot_side():
    reset()
    build(LED_WARM, 40.0)
    room(floor_col=(0.3, 0.31, 0.33), wall_col=(0.36, 0.37, 0.39))
    world((0.95, 0.95, 0.97), 0.3)
    light("AREA", (0.0, -1.0, 0.6), 30.0, size=1.6, target=(0.04, 0.046, 0.27))
    camera((0.042, -2.0, 0.27), (0.042, 0.046, 0.27), ortho=0.62)
    render("side", (1000, 1100))


if __name__ == "__main__":
    for s in SHOTS:
        globals()[f"shot_{s}"]()
