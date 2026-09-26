#!/usr/bin/env python3
"""Install Godot export templates for just the platforms you need.

The official bundle is ~1.3 GB. This reads it over HTTP range requests and
extracts only the files for the platforms you ask for (~400 MB for
web+linux+windows), straight into Godot's templates folder:

  Windows  %APPDATA%\\Godot\\export_templates\\<version>.<flavor>
  macOS    ~/Library/Application Support/Godot/export_templates/<version>.<flavor>
  Linux    ~/.local/share/godot/export_templates/<version>.<flavor>

Usage:
  python setup/fetch_godot_templates.py [--version 4.7.2] [--platforms web,linux,windows]
  platforms: web, linux, windows, macos, android, ios, all

Standard library only. (setup/install-toolchain.sh embeds the same logic so
it can be pasted into a cloud setup script on its own.)
"""
import argparse
import io
import os
import platform
import shutil
import sys
import tempfile
import urllib.request
import zipfile

UA = {"User-Agent": "game-dev-env/1.0"}  # downloads.godotengine.org rejects Python's default UA
PREFIX = {
    "web": ("web_",),
    "linux": ("linux_debug.x86_64", "linux_release.x86_64"),
    "windows": ("windows_debug_x86_64", "windows_release_x86_64"),
    "macos": ("macos.zip",),
    "android": ("android_",),
    "ios": ("ios.zip",),
}


def default_dest(version, flavor):
    system = platform.system()
    if system == "Windows":
        base = os.path.join(os.environ["APPDATA"], "Godot")
    elif system == "Darwin":
        base = os.path.expanduser("~/Library/Application Support/Godot")
    else:
        base = os.path.join(os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share")), "godot")
    return os.path.join(base, "export_templates", f"{version}.{flavor}")


class HttpFile(io.RawIOBase):
    """Seekable file over HTTP Range requests, so zipfile reads only what it needs."""

    def __init__(self, url):
        req = urllib.request.Request(url, headers={"Range": "bytes=0-0", **UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            if r.status != 206:
                raise OSError("server ignored Range header")
            self.url, self.size = r.geturl(), int(r.headers["Content-Range"].split("/")[-1])
        self.pos = 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = {0: off, 1: self.pos + off, 2: self.size + off}[whence]
        return self.pos

    def readinto(self, b):
        if self.pos >= self.size:
            return 0
        end = min(self.pos + len(b), self.size) - 1
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}", **UA})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    data = r.read()
                break
            except OSError:
                if attempt == 3:
                    raise
        b[: len(data)] = data
        self.pos += len(data)
        return len(data)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--version", default=os.environ.get("GODOT_VERSION", "4.7.2"))
    p.add_argument("--flavor", default=os.environ.get("GODOT_FLAVOR", "stable"))
    p.add_argument("--platforms", default=os.environ.get("GODOT_TEMPLATE_PLATFORMS", "web,linux,windows"))
    p.add_argument("--dest", help="override the templates folder")
    a = p.parse_args()

    want = {x.strip().lower() for x in a.platforms.split(",") if x.strip()}
    dest = a.dest or default_dest(a.version, a.flavor)
    tag = f"{a.version}-{a.flavor}"
    asset = f"Godot_v{tag}_export_templates.tpz"
    urls = [
        f"https://github.com/godotengine/godot/releases/download/{tag}/{asset}",
        f"https://downloads.godotengine.org/?version={a.version}&flavor={a.flavor}&slug=export_templates.tpz&platform=templates",
    ]

    def wanted(name):
        base = name.split("/")[-1]
        if not base or base in ("version.txt", "icudt_godot.dat") or "all" in want:
            return bool(base)
        return any(base.startswith(pre) for w in want for pre in PREFIX.get(w, ()))

    def extract(zf):
        os.makedirs(dest, exist_ok=True)
        n = 0
        for info in zf.infolist():
            if info.is_dir() or not wanted(info.filename):
                continue
            out = os.path.join(dest, info.filename.split("/")[-1])
            print(f"  {info.file_size / 1e6:7.1f} MB  {os.path.basename(out)}", flush=True)
            with zf.open(info) as src, open(out + ".part", "wb") as dst:
                shutil.copyfileobj(src, dst, 8 << 20)
            os.replace(out + ".part", out)
            if out.endswith((".x86_64", ".exe")):
                os.chmod(out, 0o755)
            n += 1
        return n

    print(f"Godot {tag} templates ({','.join(sorted(want))}) -> {dest}")
    for url in urls:
        try:
            n = extract(zipfile.ZipFile(io.BufferedReader(HttpFile(url), buffer_size=8 << 20)))
            print(f"done: {n} files")
            return 0
        except Exception as e:  # try next mirror
            print(f"  range fetch failed ({url[:70]}...): {e}")
    for url in urls:  # last resort: download the whole bundle
        try:
            with tempfile.TemporaryFile() as tmp:
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=900) as r:
                    shutil.copyfileobj(r, tmp, 8 << 20)
                tmp.seek(0)
                print(f"done: {extract(zipfile.ZipFile(tmp))} files (full download)")
                return 0
        except Exception as e:
            print(f"  full download failed: {e}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
