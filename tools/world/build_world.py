"""Generate the Hollowvale island: an eroded 2 km heightmap plus everything the game derives from it.

Runs with any Python that has numpy. Blender ships numpy, so the Makefile runs it through Blender:
    make world                      # = blender -b --factory-startup -P tools/world/build_world.py -- [--seed N]
    python3 tools/world/build_world.py --seed 7   # if your python has numpy

Writes godot/game/world/data/:
    height.f32   float32 little-endian metres, RES x RES, row 0 = north (z = -SIZE/2), column 0 = west
    normal.png   world-space normals, RGB = (n.x, n.z, n.y) * 0.5 + 0.5
    masks.png    R = water flow (streams), G = sediment, B = forest density, A = macro variation
    map.png      the in-game map (hillshaded, 1024 px)
    world.json   size, resolution, height range, sea/lake levels, spawn point
"""
import argparse
import json
import math
import os
import struct
import sys
import time
import zlib

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "godot", "game", "world", "data")

SIZE = 2048.0          # metres, edge length of the square world
RES = 1025             # height samples per edge (2 m spacing)
CELL = SIZE / (RES - 1)
SEA = 0.0
SNOW_LINE = 215.0
TREE_LINE = 190.0


# ----------------------------------------------------------------- noise ----
class Perlin:
    def __init__(self, seed):
        rng = np.random.default_rng(seed)
        p = rng.permutation(256)
        self.perm = np.concatenate([p, p]).astype(np.int64)
        ang = rng.uniform(0, 2 * np.pi, 256)
        self.gx = np.cos(ang)
        self.gy = np.sin(ang)

    def __call__(self, x, y):
        xi = np.floor(x).astype(np.int64)
        yi = np.floor(y).astype(np.int64)
        xf = x - xi
        yf = y - yi
        xi &= 255
        yi &= 255
        p = self.perm

        def grad(ix, iy, fx, fy):
            h = p[p[ix] + iy]
            return self.gx[h] * fx + self.gy[h] * fy

        u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
        v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
        n00 = grad(xi, yi, xf, yf)
        n10 = grad(xi + 1, yi, xf - 1, yf)
        n01 = grad(xi, yi + 1, xf, yf - 1)
        n11 = grad(xi + 1, yi + 1, xf - 1, yf - 1)
        a = n00 + u * (n10 - n00)
        b = n01 + u * (n11 - n01)
        return (a + v * (b - a)) * 1.41  # roughly [-1, 1]


def fbm(noise, x, y, octaves, lac=2.0, gain=0.5):
    total = np.zeros_like(x)
    amp, freq, norm = 1.0, 1.0, 0.0
    for i in range(octaves):
        total += amp * noise(x * freq + i * 17.3, y * freq - i * 9.1)
        norm += amp
        amp *= gain
        freq *= lac
    return total / norm


def ridged(noise, x, y, octaves, lac=2.0, gain=0.5):
    """Ridged multifractal: sharp crests, each octave weighted by the one before."""
    total = np.zeros_like(x)
    weight = np.ones_like(x)
    amp, freq, norm = 1.0, 1.0, 0.0
    for i in range(octaves):
        n = 1.0 - np.abs(noise(x * freq + i * 31.7, y * freq + i * 11.3))
        n = n * n * weight
        weight = np.clip(n * 1.6, 0, 1)
        total += n * amp
        norm += amp
        amp *= gain
        freq *= lac
    return total / norm


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ----------------------------------------------------------------- shape ----
def base_heights(seed):
    n1, n2, n3, n4 = (Perlin(seed * 7 + k) for k in range(4))
    t = np.linspace(-1.0, 1.0, RES)
    u, v = np.meshgrid(t, t)  # u = east (x), v = south (z)

    # Island outline: warped radial falloff, slightly elongated east-west.
    wu = u + 0.34 * fbm(n1, u * 1.4, v * 1.4, 5) + 0.06 * fbm(n2, u * 6, v * 6, 3)
    wv = v + 0.34 * fbm(n1, u * 1.4 + 5.2, v * 1.4 - 3.7, 5) + 0.06 * fbm(n2, u * 6 + 3.3, v * 6, 3)
    r = np.sqrt((wu / 1.05) ** 2 + (wv / 0.95) ** 2)
    land = smoothstep(0.93, 0.62, r)

    # Rolling lowlands and hills.
    low = 10 + 22 * (fbm(n2, u * 2.2, v * 2.2, 5) * 0.5 + 0.5)
    hills = 38 * np.clip(fbm(n3, u * 4.5, v * 4.5, 6) + 0.1, 0, None)

    # Mountains: a big northern range plus an eastern spur, ridged and domain warped.
    mw = 0.18 * fbm(n4, u * 2.5, v * 2.5, 3)
    north = smoothstep(0.05, -0.55, v + mw + 0.12 * np.sin(u * 3.1))
    east = smoothstep(0.42, 0.0, np.sqrt(((u - 0.52) / 0.9) ** 2 + ((v - 0.05) / 1.6) ** 2) + mw)
    mmask = np.clip(north + 0.55 * east, 0, 1) * smoothstep(0.86, 0.55, r)
    mountains = 390 * ridged(n4, u * 3.0 + mw, v * 3.0 - mw, 7) ** 1.35

    h = low + hills * (0.4 + 0.6 * smoothstep(0.1, 0.6, land)) + mountains * mmask
    h = land * h + (1 - land) * -38.0 + (land * (1 - land)) * 6 * fbm(n2, u * 9, v * 9, 3)
    return h, u, v


# --------------------------------------------------------------- erosion ----
def erode(h, drops, seed, radius=3, max_life=40, batch=50000):
    """Vectorised droplet hydraulic erosion (after Hans Theobald Beyer / Sebastian Lague).
    Works in-place on `h` (metres). Returns (flow, sediment) accumulation maps."""
    H, W = h.shape
    scale = 160.0  # metres per erosion height unit (tuned for 2 m cells)
    hf = (h / scale).ravel().copy()
    flow = np.zeros(H * W)
    dep = np.zeros(H * W)
    rng = np.random.default_rng(seed)
    inertia, cap_f, min_cap = 0.05, 4.0, 0.01
    ero_speed, dep_speed, evap, grav = 0.3, 0.3, 0.012, 4.0

    offs, wts = [], []
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            d = math.sqrt(dx * dx + dy * dy)
            if d <= radius:
                offs.append(dy * W + dx)
                wts.append(radius - d)
    offs = np.array(offs, dtype=np.int64)
    wts = np.array(wts) / np.sum(wts)
    lo, hi = radius + 1, W - radius - 2

    for b in range(0, drops, batch):
        n = min(batch, drops - b)
        px = rng.uniform(lo, hi, n)
        py = rng.uniform(lo, hi, n)
        dx = np.zeros(n)
        dy = np.zeros(n)
        speed = np.ones(n)
        water = np.ones(n)
        sed = np.zeros(n)
        for _ in range(max_life):
            ix = px.astype(np.int64)
            iy = py.astype(np.int64)
            fx = px - ix
            fy = py - iy
            i00 = iy * W + ix
            h00, h10, h01, h11 = hf[i00], hf[i00 + 1], hf[i00 + W], hf[i00 + W + 1]
            gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy
            gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx
            hcur = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy
            dx = dx * inertia - gx * (1 - inertia)
            dy = dy * inertia - gy * (1 - inertia)
            ln = np.sqrt(dx * dx + dy * dy)
            ok = ln > 1e-12
            ln[~ok] = 1
            dx /= ln
            dy /= ln
            npx = px + dx
            npy = py + dy
            ok &= (npx >= lo) & (npx < hi) & (npy >= lo) & (npy < hi)
            if not ok.any():
                break
            # Drop dead droplets.
            sel = np.nonzero(ok)[0]
            px, py, npx, npy, dx, dy = px[sel], py[sel], npx[sel], npy[sel], dx[sel], dy[sel]
            speed, water, sed, hcur = speed[sel], water[sel], sed[sel], hcur[sel]
            fx, fy, i00 = fx[sel], fy[sel], i00[sel]

            nix = npx.astype(np.int64)
            niy = npy.astype(np.int64)
            nfx = npx - nix
            nfy = npy - niy
            j = niy * W + nix
            hnew = (hf[j] * (1 - nfx) * (1 - nfy) + hf[j + 1] * nfx * (1 - nfy)
                    + hf[j + W] * (1 - nfx) * nfy + hf[j + W + 1] * nfx * nfy)
            dh = hnew - hcur
            cap = np.maximum(-dh * speed * water * cap_f, min_cap)
            depositing = (sed > cap) | (dh > 0)
            dep_amt = np.where(dh > 0, np.minimum(dh, sed), (sed - cap) * dep_speed)
            dep_amt = np.where(depositing, dep_amt, 0.0)
            ero_amt = np.where(depositing, 0.0, np.minimum((cap - sed) * ero_speed, -dh))
            sed = sed - dep_amt + ero_amt

            m = len(hf)
            corners = np.concatenate([i00, i00 + 1, i00 + W, i00 + W + 1])
            cw = np.concatenate([dep_amt * (1 - fx) * (1 - fy), dep_amt * fx * (1 - fy),
                                 dep_amt * (1 - fx) * fy, dep_amt * fx * fy])
            d = np.bincount(corners, cw, minlength=m)
            hf += d
            dep += d
            bi = (i00[:, None] + offs[None, :]).ravel()
            bw = (ero_amt[:, None] * wts[None, :]).ravel()
            hf -= np.bincount(bi, bw, minlength=m)
            flow += np.bincount(i00, water, minlength=m)

            speed = np.sqrt(np.maximum(0.0, speed * speed - dh * grav))
            water *= 1 - evap
            px, py = npx, npy
        sys.stdout.write(f"\r  erosion {min(b + batch, drops) * 100 // drops:3d}%")
        sys.stdout.flush()
    print()
    h[:] = (hf * scale).reshape(H, W)
    return flow.reshape(H, W), dep.reshape(H, W) * scale


def thermal(h, talus, iters=20, rate=0.25):
    """Moves material down slopes steeper than `talus` metres per cell."""
    for _ in range(iters):
        for sy, sx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
            nb = np.roll(np.roll(h, sy, 0), sx, 1)
            d = h - nb
            move = np.where(d > talus, (d - talus) * rate * 0.5, 0.0)
            h -= move
            h += np.roll(np.roll(move, -sy, 0), -sx, 1)


def blur(a, passes=1):
    for _ in range(passes):
        a = (a + np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 5.0
    return a


# ------------------------------------------------------------ features ----
def world_to_px(x, z):
    return (x + SIZE / 2) / CELL, (z + SIZE / 2) / CELL


def sample(h, x, z):
    c, r = world_to_px(x, z)
    c0, r0 = int(c), int(r)
    fc, fr = c - c0, r - r0
    return (h[r0, c0] * (1 - fc) * (1 - fr) + h[r0, c0 + 1] * fc * (1 - fr)
            + h[r0 + 1, c0] * (1 - fc) * fr + h[r0 + 1, c0 + 1] * fc * fr)


def carve_lake(h, cx, cz, radius, seed):
    """A freshwater lake held in a bowl, so its flat water plane never leaks."""
    t = np.linspace(-SIZE / 2, SIZE / 2, RES)
    X, Z = np.meshgrid(t, t)
    n = Perlin(seed * 13 + 5)
    ang = np.arctan2(Z - cz, X - cx)
    wob = 1.0 + 0.22 * n(np.cos(ang) * 1.3 + 3.0, np.sin(ang) * 1.3 - 2.0) + 0.1 * np.sin(ang * 3 + 1.0)
    d = np.sqrt((X - cx) ** 2 + ((Z - cz) * 1.35) ** 2) / (radius * wob)
    ring = (d > 1.05) & (d < 1.6)
    level = float(np.percentile(h[ring], 25)) - 1.5
    inside = d < 1.0
    depth = 9.0
    bowl = level - 0.6 - depth * (1 - np.clip(d, 0, 1) ** 2) ** 0.8
    h[inside] = np.minimum(h[inside], bowl[inside])
    # Shore: blend down to just above the water, and seal every gap in the rim.
    shore = (d >= 1.0) & (d < 1.8)
    target = level + 0.4 + (d - 1.0) * 6.0
    w = smoothstep(1.8, 1.0, d)
    lowered = h * (1 - w) + np.minimum(h, target) * w
    h[shore] = np.maximum(lowered[shore], level + 0.35)
    return level, d


def fill_inland_below_sea(h):
    """Raise any below-sea-level pocket that isn't connected to the ocean (the sea plane is global)."""
    below = h < SEA + 0.3
    conn = np.zeros_like(below)
    conn[0, :] = below[0, :]
    conn[-1, :] = below[-1, :]
    conn[:, 0] = below[:, 0]
    conn[:, -1] = below[:, -1]
    while True:
        grown = conn.copy()
        grown[1:, :] |= conn[:-1, :]
        grown[:-1, :] |= conn[1:, :]
        grown[:, 1:] |= conn[:, :-1]
        grown[:, :-1] |= conn[:, 1:]
        grown &= below
        if (grown == conn).all():
            break
        conn = grown
    pockets = below & ~conn
    h[pockets] = SEA + 0.6
    return int(pockets.sum())


def normals(h):
    gz, gx = np.gradient(h, CELL)
    n = np.stack([-gx, np.ones_like(h), -gz], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n


def find_spawn(h, slope):
    """South coast, just inland from the beach, on gentle ground."""
    best = None
    for x in np.linspace(-300, 300, 25):
        for z in np.linspace(900, 100, 160):
            c, r = world_to_px(x, z)
            ci, ri = int(c), int(r)
            if h[ri, ci] > 6.0:
                if slope[ri, ci] < 0.25 and h[ri, ci] < 30:
                    score = abs(x) * 0.3 + (h[ri, ci] - 8) ** 2 * 0.2
                    if best is None or score < best[0]:
                        best = (score, float(x), float(z))
                break
    return (best[1], best[2]) if best else (0.0, 600.0)


# ------------------------------------------------------------------ PNG ----
def write_png(path, arr):
    """Minimal PNG writer for uint8 (H, W, C) or (H, W) arrays; no dependencies."""
    arr = np.ascontiguousarray(arr)
    if arr.ndim == 2:
        arr = arr[:, :, None]
    hgt, wid, ch = arr.shape
    ctype = {1: 0, 3: 2, 4: 6}[ch]
    raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(hgt))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", wid, hgt, 8, ctype, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


def to8(a):
    return (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)


# ------------------------------------------------------------------ map ----
def render_map(h, n, forest, lake_d, lake_level, size=1024):
    step = (RES - 1) / size
    idx = (np.arange(size) * step).astype(int)
    hh = h[np.ix_(idx, idx)]
    nn = n[np.ix_(idx, idx)]
    ff = forest[np.ix_(idx, idx)]
    ld = lake_d[np.ix_(idx, idx)]
    slope = 1 - nn[..., 1]

    def c(hexs):
        return np.array([int(hexs[i:i + 2], 16) / 255 for i in (0, 2, 4)])

    col = np.zeros(hh.shape + (3,))
    grass = c("7f8f4e")
    col[:] = grass
    col = np.where((hh < 4)[..., None], c("cdbb8e"), col)
    col = col * (1 - ff[..., None] * 0.75) + c("3f5a2e") * ff[..., None] * 0.75
    rock = smoothstep(0.25, 0.45, slope)[..., None]
    col = col * (1 - rock) + c("8a8479") * rock
    snow = smoothstep(SNOW_LINE - 15, SNOW_LINE + 20, hh)[..., None] * (1 - rock * 0.6)
    col = col * (1 - snow) + c("eef1f4") * snow
    # Hillshade from the north-west.
    L = np.array([-0.6, 0.6, -0.55])
    L /= np.linalg.norm(L)
    shade = np.clip((nn * L).sum(-1), 0, 1)
    col *= (0.45 + 0.75 * shade)[..., None]
    # Contours every 25 m.
    cont = np.abs(((hh + 1000) % 25) - 12.5) > 12.0
    col = np.where((cont & (hh > 2))[..., None], col * 0.82, col)
    # Water.
    depth = np.clip(-hh / 40, 0, 1)[..., None]
    sea = (c("5e8fa8") * (1 - depth) + c("24465e") * depth)
    col = np.where((hh < SEA)[..., None], sea, col)
    col = np.where(((ld < 1.0) & (hh < lake_level))[..., None], c("4d8aa3"), col)
    # Paper vignette.
    t = np.linspace(-1, 1, size)
    U, V = np.meshgrid(t, t)
    vig = 1 - 0.25 * np.clip(np.sqrt(U * U + V * V) - 0.7, 0, 1)
    col *= vig[..., None]
    return to8(col)


# ----------------------------------------------------------------- main ----
def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--drops", type=int, default=700000)
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    t0 = time.time()

    print(f"heights (seed {a.seed}) ...")
    h, u, v = base_heights(a.seed)
    print("hydraulic erosion ...")
    flow, sed = erode(h, a.drops, a.seed)
    thermal(h, talus=2.6, iters=12)
    # Gentle beaches: flatten the band around sea level.
    h -= 0.55 * h * np.exp(-((h - 1.0) / 5.0) ** 2)

    lake_c = (170.0, 190.0)
    lake_level, lake_d = carve_lake(h, lake_c[0], lake_c[1], 115.0, a.seed)
    pockets = fill_inland_below_sea(h)
    print(f"lake level {lake_level:.1f} m, filled {pockets} inland sea cells")

    n = normals(h)
    slope = 1 - n[..., 1]
    spawn = find_spawn(h, slope)
    sx, sz = spawn
    print(f"spawn {spawn}, h={sample(h, sx, sz):.1f}")

    # Masks.
    fl = np.log1p(flow) / np.log1p(np.percentile(flow, 99.7))
    fl = blur(np.clip(fl, 0, 1), 2)
    fl = np.clip((fl - 0.35) / 0.65, 0, 1)
    sd = blur(np.clip(sed / (np.percentile(sed, 99.5) + 1e-6), 0, 1), 2)
    nf = Perlin(a.seed * 3 + 1)
    forest = smoothstep(-0.12, 0.3, fbm(nf, u * 7, v * 7, 5) + 0.18 * fbm(nf, u * 30, v * 30, 2))
    forest *= smoothstep(TREE_LINE + 10, TREE_LINE - 30, h) * smoothstep(0.5, 0.25, slope)
    forest *= smoothstep(3.5, 9.0, h) * smoothstep(1.1, 1.5, lake_d)
    t = np.linspace(-SIZE / 2, SIZE / 2, RES)
    X, Z = np.meshgrid(t, t)
    forest *= smoothstep(35, 90, np.sqrt((X - sx) ** 2 + (Z - sz) ** 2))  # clearing at the camp
    nv = Perlin(a.seed * 5 + 3)
    macro = fbm(nv, u * 14, v * 14, 4) * 0.5 + 0.5

    hmin, hmax = float(h.min()), float(h.max())
    h.astype("<f4").tofile(os.path.join(a.out, "height.f32"))
    write_png(os.path.join(a.out, "normal.png"), to8(np.stack([n[..., 0], n[..., 2], n[..., 1]], -1) * 0.5 + 0.5))
    write_png(os.path.join(a.out, "masks.png"), to8(np.stack([fl, sd, forest, macro], -1)))
    write_png(os.path.join(a.out, "map.png"), render_map(h, n, forest, lake_d, lake_level))
    meta = {
        "seed": a.seed, "size": SIZE, "resolution": RES, "height_min": hmin, "height_max": hmax,
        "sea_level": SEA, "snow_line": SNOW_LINE, "tree_line": TREE_LINE,
        "lake": {"x": lake_c[0], "z": lake_c[1], "level": round(lake_level, 3), "radius": 115.0 * 1.25},
        "spawn": {"x": round(sx, 2), "z": round(sz, 2)},
    }
    with open(os.path.join(a.out, "world.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(f"heights {hmin:.1f} .. {hmax:.1f} m; wrote {a.out} in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    main(args)
