#!/usr/bin/env python3
"""Download CC0 assets from Poly Haven (https://polyhaven.com) - no API key needed.

HDRIs give you realistic image-based lighting, the PBR texture sets give you
photoscanned surfaces, and the models come as glTF ready for Godot or Three.js.
Everything on Poly Haven is CC0: free for commercial use, no attribution needed.

Examples:
  python3 tools/assets/polyhaven.py search forest --type textures
  python3 tools/assets/polyhaven.py hdri kloofendal_38d_partly_cloudy_puresky --res 2k --out godot/assets/shared/hdri
  python3 tools/assets/polyhaven.py texture aerial_grass_rock --res 1k --out godot/assets/shared/textures
  python3 tools/assets/polyhaven.py model rock_moss_set_01 --res 1k --out godot/assets/shared/models

Standard library only; honours HTTPS_PROXY.
"""
import argparse
import json
import os
import sys
import urllib.request

API = "https://api.polyhaven.com"
HEADERS = {"User-Agent": "game-dev-env/1.0 (+https://github.com/tm-coder-484/game-dev-env)"}
# Poly Haven map name -> short suffix used for the saved file.
TEXTURE_MAPS = {"Diffuse": "diff", "nor_gl": "nor_gl", "Rough": "rough", "AO": "ao",
                "arm": "arm", "Displacement": "disp", "nor_dx": "nor_dx"}


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as r:
        return json.load(r)


def download(url, path):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    if os.path.exists(path):
        print(f"  exists  {path}")
        return path
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=300) as r, \
            open(path + ".part", "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    os.replace(path + ".part", path)
    print(f"  saved   {path} ({os.path.getsize(path) / 1e6:.1f} MB)")
    return path


def pick(files, res):
    if res in files:
        return files[res]
    raise SystemExit(f"resolution {res!r} not available; choose from {sorted(files)}")


def cmd_search(a):
    assets = get_json(f"{API}/assets?t={a.type}")
    q = a.query.lower()
    hits = [(k, v) for k, v in assets.items()
            if q in k or q in v.get("name", "").lower()
            or any(q in t.lower() for t in v.get("tags", []) + v.get("categories", []))]
    hits.sort(key=lambda kv: -kv[1].get("download_count", 0))
    for k, v in hits[: a.limit]:
        print(f"{k:45s} {v.get('name', '')}")
    print(f"({len(hits)} matches)", file=sys.stderr)


def cmd_hdri(a):
    f = pick(get_json(f"{API}/files/{a.id}")["hdri"], a.res)[a.format]
    download(f["url"], os.path.join(a.out, a.name or f"{a.id}_{a.res}.{a.format}"))


def cmd_texture(a):
    files = get_json(f"{API}/files/{a.id}")
    folder = os.path.join(a.out, a.id)
    for key in a.maps.split(","):
        key = {"diff": "Diffuse", "rough": "Rough", "ao": "AO", "disp": "Displacement"}.get(key, key)
        if key not in files:
            print(f"  skip    {key} (not in this set)")
            continue
        f = pick(files[key], a.res)[a.format]
        download(f["url"], os.path.join(folder, f"{TEXTURE_MAPS.get(key, key)}.{a.format}"))


def cmd_model(a):
    g = pick(get_json(f"{API}/files/{a.id}")["gltf"], a.res)["gltf"]
    folder = os.path.join(a.out, a.id)
    download(g["url"], os.path.join(folder, f"{a.id}.gltf"))
    for rel, inc in g.get("include", {}).items():
        download(inc["url"], os.path.join(folder, rel))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("search", help="find asset ids")
    s.add_argument("query")
    s.add_argument("--type", default="all", choices=["all", "hdris", "textures", "models"])
    s.add_argument("--limit", type=int, default=25)
    s.set_defaults(fn=cmd_search)

    h = sub.add_parser("hdri", help="download an HDRI sky (.hdr/.exr)")
    h.add_argument("id")
    h.add_argument("--res", default="2k", help="1k, 2k, 4k, 8k ...")
    h.add_argument("--format", default="hdr", choices=["hdr", "exr"])
    h.add_argument("--name", help="output file name (default <id>_<res>.<format>)")
    h.add_argument("--out", default="assets/hdri")
    h.set_defaults(fn=cmd_hdri)

    t = sub.add_parser("texture", help="download a PBR texture set")
    t.add_argument("id")
    t.add_argument("--res", default="2k")
    t.add_argument("--format", default="jpg", choices=["jpg", "png", "exr"])
    t.add_argument("--maps", default="diff,nor_gl,rough,ao",
                   help="comma list: diff,nor_gl,nor_dx,rough,ao,arm,disp (Godot + Three.js want nor_gl)")
    t.add_argument("--out", default="assets/textures")
    t.set_defaults(fn=cmd_texture)

    m = sub.add_parser("model", help="download a glTF model with its textures")
    m.add_argument("id")
    m.add_argument("--res", default="1k")
    m.add_argument("--out", default="assets/models")
    m.set_defaults(fn=cmd_model)

    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
