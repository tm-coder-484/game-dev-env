"""Pack the terrain's Poly Haven PBR sets into two texture arrays for godot/game/world/terrain.gdshader.

    make terrain-textures   # = blender -b --factory-startup -P tools/world/pack_textures.py

Downloads (CC0, cached in build/cache/polyhaven) and writes godot/game/world/textures/:
    terrain_albedo.webp   RGB = albedo, A = height (for height-blended transitions)
    terrain_normal.webp   RG = normal (OpenGL), B = roughness, A = ambient occlusion
Layers are stacked vertically in LAYERS order; Godot imports each file as a Texture2DArray.
"""
import os
import subprocess
import sys

import bpy
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CACHE = os.path.join(ROOT, "build", "cache", "polyhaven")
OUT = os.path.join(ROOT, "godot", "game", "world", "textures")
SIZE = 1024
# Order matters: terrain.gdshader indexes layers by position.
LAYERS = [
    "leafy_grass",          # 0 grass meadow
    "forest_leaves_02",     # 1 forest floor
    "aerial_rocks_02",      # 2 cliff rock (triplanar)
    "coast_sand_01",        # 3 beach sand
    "rocky_trail",          # 4 gravel / scree
    "snow_02",              # 5 snow
    "brown_mud_leaves_01",  # 6 mud (stream beds)
]
MAPS = ["diff", "nor_gl", "arm", "disp"]


def fetch(name):
    d = os.path.join(CACHE, name)
    if not all(os.path.exists(os.path.join(d, m + ".jpg")) or os.path.exists(os.path.join(d, m + ".png"))
               for m in MAPS):
        subprocess.check_call(["python3",
                               os.path.join(ROOT, "tools", "assets", "polyhaven.py"), "texture", name,
                               "--res", "1k", "--maps", ",".join(MAPS), "--out", CACHE])
    return d


def load(path):
    for ext in (".jpg", ".png"):
        if os.path.exists(path + ext):
            img = bpy.data.images.load(path + ext)
            img.colorspace_settings.name = "Non-Color"  # raw values, no transforms
            if img.size[0] != SIZE:
                img.scale(SIZE, SIZE)
            px = np.empty(SIZE * SIZE * 4, dtype=np.float32)
            img.pixels.foreach_get(px)
            bpy.data.images.remove(img)
            return px.reshape(SIZE, SIZE, 4)[::-1]  # Blender rows are bottom-up
    raise FileNotFoundError(path)


def save_webp(path, arr, quality):
    h, w, _ = arr.shape
    img = bpy.data.images.new("pack", w, h, alpha=True, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    img.alpha_mode = "STRAIGHT"
    img.pixels.foreach_set(np.ascontiguousarray(arr[::-1], dtype=np.float32).ravel())
    scene = bpy.context.scene
    s = scene.render.image_settings
    s.file_format = "WEBP"
    s.color_mode = "RGBA"
    s.quality = quality
    scene.view_settings.view_transform = "Standard"
    img.save_render(path, scene=scene)
    bpy.data.images.remove(img)
    print(f"  wrote {os.path.relpath(path, ROOT)} ({os.path.getsize(path) / 1e6:.1f} MB)")


def main():
    os.makedirs(OUT, exist_ok=True)
    albedo, normal = [], []
    for name in LAYERS:
        d = fetch(name)
        diff = load(os.path.join(d, "diff"))[..., :3]
        nor = load(os.path.join(d, "nor_gl"))[..., :3]
        arm = load(os.path.join(d, "arm"))[..., :3]
        disp = load(os.path.join(d, "disp"))[..., 0]
        disp = (disp - disp.min()) / max(1e-6, float(disp.max() - disp.min()))
        if name.startswith("snow"):
            # Remove the dark twigs from the snow photo: pull dark pixels toward the snow's median colour.
            lum = diff.mean(-1, keepdims=True)
            base = np.median(diff.reshape(-1, 3), 0)
            t = np.clip((0.62 - lum) / 0.3, 0, 1)
            diff = diff * (1 - t) + base * t
            nor = nor * (1 - t) + np.array([0.5, 0.5, 1.0]) * t
        albedo.append(np.concatenate([diff, disp[..., None]], -1))
        normal.append(np.stack([nor[..., 0], nor[..., 1], arm[..., 1], arm[..., 0]], -1))
        print(f"  packed {name}")
    save_webp(os.path.join(OUT, "terrain_albedo.webp"), np.concatenate(albedo, 0), 88)
    save_webp(os.path.join(OUT, "terrain_normal.webp"), np.concatenate(normal, 0), 90)


main()
