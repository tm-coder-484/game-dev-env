"""Generate Hollowvale's trees and bushes: game-ready meshes in one GLB.

    make trees      # = blender -b --factory-startup -P tools/blender/generate_trees.py -- godot/game/world/models/trees.glb

Objects: spruce_0..2, pine_0..1, birch_0..1, dead_0..1, bramble_0..1 (all standing on the origin, metres).
Material slots: 0 "bark" (tileable bark UVs), 1 "leaves" (UVs into godot/game/world/textures/trees/
branch_atlas.webp: 4 cells left to right = spruce, birch, bramble, pine; generated with
`node tools/openrouter/assets.mjs foliage ...`). Godot replaces both with its own wind shaders.
Vertex colour: R = wind weight (0 rigid .. 1 tip), G = per-branch sway phase, B = canopy light
(0 deep inside .. 1 outer shell), A = 1 living / 0 dead wood.
"""
import math
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

CELLS = 4
SPRUCE, BIRCH, BRAMBLE, PINE = 0, 1, 2, 3
UP = Vector((0, 0, 1))


class Builder:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.col = self.bm.verts.layers.float_color.new("Col")
        self.normals = {}  # vert -> custom normal

    def _vert(self, co, color, normal):
        v = self.bm.verts.new(co)
        v[self.col] = color
        self.normals[v] = normal.normalized()
        return v

    def _face(self, verts, uvs, mat):
        f = self.bm.faces.new(verts)
        f.material_index = mat
        for loop, uv in zip(f.loops, uvs):
            loop[self.uv].uv = uv
        return f

    def tube(self, pts, radii, sides, weights, phase=0.0, alive=1.0, bark_scale=1.2, cap=True):
        """A tapered bark tube through `pts` (with a UV seam column)."""
        rings = []
        length = 0.0
        prev_n = None
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            if prev_n is None:
                ref = Vector((1, 0, 0)) if abs(t.dot(Vector((1, 0, 0)))) < 0.9 else Vector((0, 1, 0))
                n = t.cross(ref).normalized()
            else:
                n = (prev_n - t * prev_n.dot(t)).normalized()  # parallel transport
            prev_n = n
            b = t.cross(n)
            if i > 0:
                length += (p - pts[i - 1]).length
            ring = []
            for s in range(sides + 1):
                a = s / sides * math.tau
                d = n * math.cos(a) + b * math.sin(a)
                v = self._vert(p + d * radii[i], (weights[i], phase, 1.0, alive), d)
                circ = 2 * math.pi * max(radii[i], 0.05)
                ring.append((v, (s / sides * max(1.0, round(circ / bark_scale * 2)) / 2, length / bark_scale)))
            rings.append(ring)
        for i in range(len(rings) - 1):
            for s in range(sides):
                a, b_, c, d = rings[i][s], rings[i][s + 1], rings[i + 1][s + 1], rings[i + 1][s]
                self._face([a[0], b_[0], c[0], d[0]], [a[1], b_[1], c[1], d[1]], 0)
        if cap and radii[-1] > 0.004:
            tip = self._vert(pts[-1] + (pts[-1] - pts[-2]).normalized() * radii[-1], (weights[-1], phase, 1.0, alive),
                             pts[-1] - pts[-2])
            for s in range(sides):
                a, b_ = rings[-1][s], rings[-1][s + 1]
                self._face([a[0], b_[0], tip], [a[1], b_[1], (a[1][0], a[1][1] + 0.1)], 0)

    def card(self, base, direction, side, length, width, cell, w0, w1, phase, light, droop=0.0, segs=3,
             center=None, taper=1.0):
        """A leaf/branch card: a quad strip from `base` along `direction`, `side` spans its width.
        UV v runs 0 (base, bottom of the atlas cell) to 1 (tip). Normals point away from `center`."""
        direction = direction.normalized()
        side = side.normalized()
        u0 = (cell + 0.004) / CELLS
        u1 = (cell + 0.996) / CELLS
        rows = []
        for i in range(segs + 1):
            t = i / segs
            p = base + direction * (length * t) - UP * (droop * length * t * t)
            w = width * (taper + (1 - taper) * t) * 0.5
            wgt = w0 + (w1 - w0) * t
            c = center if center is not None else base - direction
            out_n = (p - c).normalized() + UP * 0.6
            left = self._vert(p - side * w, (wgt, phase, light, 1.0), out_n)
            right = self._vert(p + side * w, (wgt, phase, light, 1.0), out_n)
            rows.append((left, right, t))
        for i in range(segs):
            l0, r0, t0 = rows[i]
            l1, r1, t1 = rows[i + 1]
            self._face([l0, r0, r1, l1], [(u0, t0), (u1, t0), (u1, t1), (u0, t1)], 1)

    def finish(self, collection):
        mesh = bpy.data.meshes.new(self.name)
        order = list(self.bm.verts)
        normals = [self.normals[v] for v in order]
        self.bm.to_mesh(mesh)
        self.bm.free()
        mesh.normals_split_custom_set_from_vertices(normals)
        mesh.color_attributes.active_color_name = "Col"
        mesh.materials.append(bark_mat())
        mesh.materials.append(leaves_mat())
        obj = bpy.data.objects.new(self.name, mesh)
        collection.objects.link(obj)
        tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
        print(f"  {self.name}: {tris} triangles")
        return obj


def bark_mat():
    return bpy.data.materials.get("bark") or bpy.data.materials.new("bark")


def leaves_mat():
    return bpy.data.materials.get("leaves") or bpy.data.materials.new("leaves")


def rot(v, axis, angle):
    return Matrix.Rotation(angle, 3, axis) @ v


def horiz(a):
    return Vector((math.cos(a), math.sin(a), 0.0))


def trunk_points(height, bend, rnd, step=1.0, start=-0.4):
    n = max(3, int((height - start) / step))
    lean = horiz(rnd.uniform(0, math.tau)) * bend
    wob = rnd.uniform(0, math.tau)
    pts = []
    for i in range(n + 1):
        z = start + (height - start) * i / n
        t = max(z, 0.0) / height
        off = lean * (t * t) + horiz(wob + t * 2.0) * (0.08 * math.sin(t * 6.0) * bend * 3)
        pts.append(Vector((off.x, off.y, z)))
    return pts


def trunk_at(pts, z):
    for i in range(len(pts) - 1):
        if pts[i].z <= z <= pts[i + 1].z:
            f = (z - pts[i].z) / max(pts[i + 1].z - pts[i].z, 1e-6)
            return pts[i].lerp(pts[i + 1], f)
    return pts[-1].copy()


# ---------------------------------------------------------------- species ----
def spruce(name, seed, col, dead=False):
    rnd = random.Random(seed)
    b = Builder(name)
    H = rnd.uniform(14.0, 21.0) * (0.85 if dead else 1.0)
    r0 = 0.012 * H + 0.1
    pts = trunk_points(H, rnd.uniform(0.05, 0.25), rnd)
    radii = [r0 * max(0.0, 1.0 - max(p.z, 0) / H) ** 0.85 * (1 + 0.45 * math.exp(-max(p.z, 0) * 2.5)) + 0.015 for p in pts]
    alive = 0.0 if dead else 1.0
    b.tube(pts, radii, 10, [0.25 * (max(p.z, 0) / H) ** 2 for p in pts], alive=alive)
    z0 = H * rnd.uniform(0.1, 0.16) if not dead else H * 0.25
    max_r = H * 0.2
    z = z0
    while z < H - 0.5:
        t = (z - z0) / (H - z0)
        crown = max_r * (1 - t) ** 0.9 + 0.2
        count = rnd.randint(5, 7) if not dead else rnd.randint(2, 4)
        a0 = rnd.uniform(0, math.tau)
        c = trunk_at(pts, z)
        for k in range(count):
            a = a0 + k * math.tau / count + rnd.uniform(-0.3, 0.3)
            d = horiz(a)
            pitch = math.radians(-(6 + 26 * (1 - t))) + rnd.uniform(-0.08, 0.08)
            dirv = (d * math.cos(pitch) + UP * math.sin(pitch)).normalized()
            L = crown * rnd.uniform(0.85, 1.1)
            wbase = 0.08 + 0.2 * t
            phase = rnd.random()
            if dead:
                L *= rnd.uniform(0.3, 0.8)
                bp = [c + dirv * (L * s / 3) - UP * (0.15 * L * (s / 3) ** 2) for s in range(4)]
                b.tube(bp, [0.045 * (1 - s / 3.5) + 0.006 for s in range(4)], 4,
                       [wbase + 0.4 * s / 3 for s in range(4)], phase, alive=0.0, cap=False)
                continue
            side = d.cross(UP).normalized()
            light = 0.45 + 0.55 * min(1.0, t * 0.6 + 0.4)
            for roll in (-0.55, 0.55):
                sv = rot(side, dirv, roll)
                b.card(c + dirv * 0.05, dirv, sv, L, L * 0.7, SPRUCE, wbase, wbase + 0.75, phase, light,
                       droop=0.18 * (1 - t) + 0.05, center=Vector((c.x, c.y, c.z + 1.0)), taper=0.55)
        z += rnd.uniform(0.33, 0.45) if not dead else rnd.uniform(0.6, 1.0)
    if not dead:
        top = trunk_at(pts, H - 1.1)
        for k in range(3):
            side = horiz(k * math.pi / 3 + 0.4)
            b.card(top, UP, side, 1.6, 0.9, SPRUCE, 0.3, 0.6, rnd.random(), 1.0, segs=2, center=top - UP)
    return b.finish(col)


def pine(name, seed, col):
    rnd = random.Random(seed)
    b = Builder(name)
    H = rnd.uniform(15.0, 22.0)
    r0 = 0.011 * H + 0.14
    pts = trunk_points(H, rnd.uniform(0.3, 0.6), rnd)
    radii = [r0 * max(0.0, 1.0 - max(p.z, 0) / H) ** 0.7 * (1 + 0.35 * math.exp(-max(p.z, 0) * 2.5)) + 0.03 for p in pts]
    b.tube(pts, radii, 10, [0.2 * (max(p.z, 0) / H) ** 2 for p in pts])
    crown0 = H * rnd.uniform(0.52, 0.62)
    n = rnd.randint(11, 15)
    for k in range(n):
        t = k / (n - 1)
        z = crown0 + (H - 0.8 - crown0) * t
        c = trunk_at(pts, z)
        a = rnd.uniform(0, math.tau)
        up = math.radians(rnd.uniform(15, 45) + 25 * t)
        dirv = (horiz(a) * math.cos(up) + UP * math.sin(up)).normalized()
        L = (1.2 + 2.8 * math.sin(math.pi * (0.25 + 0.75 * (1 - t)))) * rnd.uniform(0.8, 1.15)
        phase = rnd.random()
        bp = [c + dirv * (L * s / 4) + UP * (0.25 * L * (s / 4) ** 2) for s in range(5)]
        b.tube(bp, [0.075 * (1 - s / 4.6) + 0.01 for s in range(5)], 5, [0.15 + 0.3 * s / 4 for s in range(5)], phase)
        # Tufts: clusters of pine cards around the outer part of each branch.
        for s in (2, 3, 4):
            p = bp[s]
            for m in range(3 if s < 4 else 4):
                out = (dirv + Vector((rnd.uniform(-0.7, 0.7), rnd.uniform(-0.7, 0.7), rnd.uniform(0.1, 0.9)))).normalized()
                side = out.cross(Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))).normalized()
                size = rnd.uniform(0.8, 1.25)
                b.card(p - out * 0.15, out, side, size, size * 0.8, PINE, 0.35 + 0.1 * s, 0.9, phase,
                       0.55 + 0.1 * s, droop=0.1, segs=2, center=Vector((c.x, c.y, (crown0 + H) * 0.5)))
    return b.finish(col)


def birch(name, seed, col):
    rnd = random.Random(seed)
    b = Builder(name)
    H = rnd.uniform(10.0, 14.5)
    r0 = 0.012 * H + 0.07
    pts = trunk_points(H, rnd.uniform(0.3, 0.8), rnd, step=0.8)
    radii = [r0 * max(0.0, 1.0 - max(p.z, 0) / H) ** 0.9 * (1 + 0.3 * math.exp(-max(p.z, 0) * 3)) + 0.02 for p in pts]
    b.tube(pts, radii, 9, [0.25 * (max(p.z, 0) / H) ** 1.5 for p in pts], bark_scale=1.6)
    z0 = H * rnd.uniform(0.28, 0.38)
    max_r = H * 0.24
    center_z = (z0 + H) * 0.55
    n = rnd.randint(18, 24)
    for k in range(n):
        t = k / (n - 1)
        z = z0 + (H - 0.6 - z0) * t
        c = trunk_at(pts, z)
        a = k * 2.4 + rnd.uniform(-0.3, 0.3)  # golden-angle spiral
        up = math.radians(rnd.uniform(35, 55) + 20 * t)
        dirv = (horiz(a) * math.cos(up) + UP * math.sin(up)).normalized()
        L = max_r * math.sin(math.pi * (0.15 + 0.85 * (1 - t))) ** 0.8 * rnd.uniform(0.85, 1.15) + 0.4
        phase = rnd.random()
        bp = [c + dirv * (L * s / 4) - UP * (0.15 * L * (s / 4) ** 2) for s in range(5)]
        b.tube(bp, [0.05 * (1 - s / 4.5) + 0.006 for s in range(5)], 5, [0.2 + 0.35 * s / 4 for s in range(5)], phase,
               bark_scale=1.6)
        centre = Vector((c.x, c.y, center_z))
        for s in (1, 2, 3, 4):
            p = bp[s]
            for m in range(2 if s < 4 else 3):
                out = (dirv * 0.6 + horiz(rnd.uniform(0, math.tau)) * 0.8 + UP * rnd.uniform(-0.5, 0.3)).normalized()
                side = out.cross(UP).normalized()
                side = rot(side, out, rnd.uniform(-0.9, 0.9))
                size = rnd.uniform(0.9, 1.4)
                light = min(1.0, 0.35 + 0.65 * ((p - centre).length / (max_r + 0.5)))
                b.card(p, out, side, size, size * 0.75, BIRCH, 0.35 + 0.12 * s, 1.0, rnd.random(), light,
                       droop=0.35, segs=2, center=centre)
    return b.finish(col)


def bramble(name, seed, col):
    rnd = random.Random(seed)
    b = Builder(name)
    R = rnd.uniform(0.8, 1.1)
    centre = Vector((0, 0, 0.35))
    for k in range(rnd.randint(28, 34)):
        a = rnd.uniform(0, math.tau)
        base = horiz(a) * rnd.uniform(0.0, 0.35 * R) + Vector((0, 0, -0.05))
        elev = math.radians(rnd.uniform(15, 75))
        out = (horiz(a + rnd.uniform(-0.4, 0.4)) * math.cos(elev) + UP * math.sin(elev)).normalized()
        side = rot(out.cross(UP).normalized(), out, rnd.uniform(-0.8, 0.8))
        size = rnd.uniform(0.7, 1.05) * R
        b.card(base, out, side, size, size * 0.8, BRAMBLE, 0.1, 0.55, rnd.random(),
               0.55 + 0.45 * math.sin(elev), droop=0.3, segs=2, center=centre)
    return b.finish(col)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[0] if argv else "godot/game/world/models/trees.glb"
    bpy.ops.wm.read_factory_settings(use_empty=True)
    col = bpy.context.scene.collection
    for i, s in enumerate((11, 23, 37)):
        spruce(f"spruce_{i}", s, col)
    for i, s in enumerate((41, 53)):
        pine(f"pine_{i}", s, col)
    for i, s in enumerate((61, 71)):
        birch(f"birch_{i}", s, col)
    for i, s in enumerate((83, 97)):
        spruce(f"dead_{i}", s, col, dead=True)
    for i, s in enumerate((101, 113)):
        bramble(f"bramble_{i}", s, col)
    import os
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_normals=True, export_tangents=True,
                              export_vertex_color="ACTIVE", export_materials="PLACEHOLDER", export_yup=True)
    print(f"wrote {out}")


main()
