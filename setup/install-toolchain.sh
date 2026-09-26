#!/bin/bash
# =============================================================================
#  Game-dev toolchain installer
#  Godot 4 (+ export templates for Web / Linux / Windows), headless Blender,
#  glTF tooling, and the system libraries needed to run/render headless.
#
#  Works in three places:
#    1. Claude Code cloud environment -> paste this WHOLE file into the
#       environment's "Setup script" field (see docs/CLOUD_ENVIRONMENT.md).
#    2. Linux / WSL as root or with sudo  -> sudo bash setup/install-toolchain.sh
#    3. Linux / WSL without root          -> bash setup/install-toolchain.sh
#       (installs into ~/.local, skips apt)
#
#  Idempotent: re-running skips anything already installed.
#  Always exits 0 so a flaky mirror can never block a cloud session from
#  starting; run scripts/doctor.sh afterwards to see what's missing.
#
#  Override versions with env vars, e.g.
#    GODOT_VERSION=4.7.2 BLENDER_VERSION=5.2.2 bash setup/install-toolchain.sh
# =============================================================================
set -uo pipefail

GODOT_VERSION="${GODOT_VERSION:-4.7.2}"
GODOT_FLAVOR="${GODOT_FLAVOR:-stable}"
# Comma list of: web, linux, windows, macos, android, ios, all
GODOT_TEMPLATE_PLATFORMS="${GODOT_TEMPLATE_PLATFORMS:-web,linux,windows}"
BLENDER_VERSION="${BLENDER_VERSION:-5.2.2}"
INSTALL_BLENDER="${INSTALL_BLENDER:-1}"
INSTALL_GLTF_TOOLS="${INSTALL_GLTF_TOOLS:-1}"
INSTALL_APT_PACKAGES="${INSTALL_APT_PACKAGES:-1}"

if [ "$(id -u)" = "0" ]; then
  GAMEDEV_HOME="${GAMEDEV_HOME:-/opt/gamedev}"
  BIN_DIR="${BIN_DIR:-/usr/local/bin}"
  SUDO=""
else
  GAMEDEV_HOME="${GAMEDEV_HOME:-$HOME/.local/share/gamedev}"
  BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
  SUDO="$(command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null && echo sudo || true)"
fi
GODOT_DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/godot"
TEMPLATE_DIR="$GODOT_DATA_DIR/export_templates/${GODOT_VERSION}.${GODOT_FLAVOR}"
LOG_DIR="$GAMEDEV_HOME/logs"
mkdir -p "$GAMEDEV_HOME" "$BIN_DIR" "$LOG_DIR"

START=$(date +%s)
log() { printf '[gamedev %3ss] %s\n' "$(( $(date +%s) - START ))" "$*"; }

# Download with retries, trying each mirror in order. Usage: fetch OUT URL...
fetch() {
  local out="$1"; shift
  local url
  for url in "$@"; do
    if curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 -sS -o "$out.part" "$url"; then
      mv -f "$out.part" "$out"; return 0
    fi
    log "  mirror failed: $url"
  done
  rm -f "$out.part"; return 1
}

GODOT_TAG="${GODOT_VERSION}-${GODOT_FLAVOR}"
godot_urls() { # $1 = asset file name, $2 = downloads.godotengine.org slug/platform query
  echo "https://github.com/godotengine/godot/releases/download/${GODOT_TAG}/$1"
  echo "https://downloads.godotengine.org/?version=${GODOT_VERSION}&flavor=${GODOT_FLAVOR}&$2"
  echo "https://sourceforge.net/projects/godot-engine.mirror/files/${GODOT_TAG}/$1/download"
}

# --------------------------------------------------------------------------- #
install_apt() {
  [ "$INSTALL_APT_PACKAGES" = "1" ] || return 0
  if ! command -v apt-get >/dev/null 2>&1; then log "apt-get not found; skipping system packages"; return 0; fi
  if [ "$(id -u)" != "0" ] && [ -z "$SUDO" ]; then
    log "not root and no passwordless sudo; skipping apt. Run once with sudo for Xvfb/Mesa/ffmpeg."
    return 0
  fi
  if command -v xvfb-run >/dev/null 2>&1 && command -v ffmpeg >/dev/null 2>&1 \
     && dpkg -s mesa-vulkan-drivers libgl1-mesa-dri >/dev/null 2>&1; then
    log "apt: system packages already installed"; return 0
  fi
  log "apt: installing Xvfb, Mesa (software GL/Vulkan), audio stubs, ffmpeg..."
  export DEBIAN_FRONTEND=noninteractive
  $SUDO apt-get update -qq >/dev/null 2>&1 || true
  # Runtime libs for Godot + Blender, a virtual display for screenshots/renders,
  # llvmpipe/lavapipe so both engines can render without a GPU, and ffmpeg for
  # turning Godot --write-movie captures / Blender frames into video.
  $SUDO apt-get install -y -qq --no-install-recommends \
    xvfb xauth unzip xz-utils zip ca-certificates \
    libgl1 libegl1 libglu1-mesa libgl1-mesa-dri libglx-mesa0 mesa-vulkan-drivers libvulkan1 \
    libx11-6 libxcursor1 libxinerama1 libxrandr2 libxi6 libxext6 libxfixes3 libxrender1 \
    libxxf86vm1 libxkbcommon0 libsm6 libice6 libfontconfig1 libdbus-1-3 \
    libasound2t64 libpulse0 ffmpeg >"$LOG_DIR/apt.log" 2>&1 \
    && log "apt: done" || log "apt: FAILED (see $LOG_DIR/apt.log)"
}

# --------------------------------------------------------------------------- #
install_godot() {
  local dir="$GAMEDEV_HOME/godot/${GODOT_TAG}"
  local exe="$dir/Godot_v${GODOT_TAG}_linux.x86_64"
  if [ -x "$exe" ]; then log "godot ${GODOT_TAG}: already installed"; else
    log "godot ${GODOT_TAG}: downloading editor..."
    mkdir -p "$dir"
    local urls
    mapfile -t urls < <(godot_urls "Godot_v${GODOT_TAG}_linux.x86_64.zip" "slug=linux.x86_64.zip&platform=linux.64")
    if fetch "$dir/godot.zip" "${urls[@]}"; then
      unzip -qo "$dir/godot.zip" -d "$dir" && rm -f "$dir/godot.zip" && chmod +x "$exe"
      log "godot ${GODOT_TAG}: installed"
    else
      log "godot: FAILED to download (all mirrors)"; return 1
    fi
  fi
  ln -sf "$exe" "$BIN_DIR/godot"
  ln -sf "$exe" "$BIN_DIR/godot4"
}

# Pulls only the templates you need out of the 1.3 GB .tpz using HTTP range
# requests (~400 MB for web+linux+windows). Falls back to the full download.
# (Same logic as setup/fetch_godot_templates.py, inlined so this file can be
# pasted into a cloud environment's setup script on its own.)
install_godot_templates() {
  if [ -f "$TEMPLATE_DIR/version.txt" ] && [ -f "$TEMPLATE_DIR/.platforms" ] \
     && [ "$(cat "$TEMPLATE_DIR/.platforms")" = "$GODOT_TEMPLATE_PLATFORMS" ]; then
    log "godot templates (${GODOT_TEMPLATE_PLATFORMS}): already installed"; return 0
  fi
  log "godot templates: fetching ${GODOT_TEMPLATE_PLATFORMS}..."
  mkdir -p "$TEMPLATE_DIR"
  local urls
  mapfile -t urls < <(godot_urls "Godot_v${GODOT_TAG}_export_templates.tpz" "slug=export_templates.tpz&platform=templates")
  python3 - "$TEMPLATE_DIR" "$GODOT_TEMPLATE_PLATFORMS" "${urls[@]}" <<'PY'
import io, os, shutil, sys, tempfile, urllib.request, zipfile

dest, platforms, urls = sys.argv[1], sys.argv[2], sys.argv[3:]
UA = {"User-Agent": "game-dev-env/1.0"}  # downloads.godotengine.org rejects Python's default UA
want = {p.strip().lower() for p in platforms.split(",") if p.strip()}
PREFIX = {
    "web": ("web_",), "linux": ("linux_debug.x86_64", "linux_release.x86_64"),
    "windows": ("windows_debug_x86_64", "windows_release_x86_64"),
    "macos": ("macos.zip",), "android": ("android_",), "ios": ("ios.zip",),
}

def wanted(name):
    base = name.split("/")[-1]
    if not base or base in ("version.txt", "icudt_godot.dat") or "all" in want:
        return bool(base)
    return any(base.startswith(p) for w in want for p in PREFIX.get(w, ()))

class HttpFile(io.RawIOBase):
    """Seekable file over HTTP Range requests, so zipfile reads only what it needs."""
    def __init__(self, url):
        req = urllib.request.Request(url, headers={"Range": "bytes=0-0", **UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            if r.status != 206:
                raise OSError("server ignored Range header")
            self.url, self.size = r.geturl(), int(r.headers["Content-Range"].split("/")[-1])
        self.pos = 0
    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos
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
        b[:len(data)] = data
        self.pos += len(data)
        return len(data)

def extract(zf):
    n = 0
    for info in zf.infolist():
        if info.is_dir() or not wanted(info.filename):
            continue
        out = os.path.join(dest, info.filename.split("/")[-1])
        with zf.open(info) as src, open(out + ".part", "wb") as dst:
            shutil.copyfileobj(src, dst, 8 << 20)
        os.replace(out + ".part", out)
        if out.endswith((".x86_64", ".exe")):
            os.chmod(out, 0o755)
        n += 1
    return n

for url in urls:
    try:
        n = extract(zipfile.ZipFile(io.BufferedReader(HttpFile(url), buffer_size=8 << 20)))
        print(f"  extracted {n} template files via range requests")
        sys.exit(0)
    except Exception as e:  # try next mirror / strategy
        print(f"  range fetch failed ({url[:60]}...): {e}")
for url in urls:  # last resort: full download
    try:
        with tempfile.TemporaryFile() as tmp:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r:
                shutil.copyfileobj(r, tmp, 8 << 20)
            tmp.seek(0)
            print(f"  extracted {extract(zipfile.ZipFile(tmp))} template files from full download")
            sys.exit(0)
    except Exception as e:
        print(f"  full download failed: {e}")
sys.exit(1)
PY
  if [ $? -eq 0 ]; then
    echo "$GODOT_TEMPLATE_PLATFORMS" > "$TEMPLATE_DIR/.platforms"
    log "godot templates: installed -> $TEMPLATE_DIR"
  else
    log "godot templates: FAILED"; return 1
  fi
}

# --------------------------------------------------------------------------- #
install_blender() {
  [ "$INSTALL_BLENDER" = "1" ] || return 0
  local series="${BLENDER_VERSION%.*}"
  local name="blender-${BLENDER_VERSION}-linux-x64"
  local dir="$GAMEDEV_HOME/blender"
  if [ -x "$dir/$name/blender" ]; then log "blender ${BLENDER_VERSION}: already installed"; else
    log "blender ${BLENDER_VERSION}: downloading (~380 MB)..."
    mkdir -p "$dir"
    if fetch "$dir/$name.tar.xz" \
        "https://download.blender.org/release/Blender${series}/${name}.tar.xz" \
        "https://mirrors.ocf.berkeley.edu/blender/release/Blender${series}/${name}.tar.xz" \
        "https://mirror.clarkson.edu/blender/release/Blender${series}/${name}.tar.xz"; then
      log "blender: extracting..."
      tar -xJf "$dir/$name.tar.xz" -C "$dir" && rm -f "$dir/$name.tar.xz"
      log "blender ${BLENDER_VERSION}: installed"
    else
      log "blender: FAILED to download (is download.blender.org allowed by your network policy?)"; return 1
    fi
  fi
  ln -sf "$dir/$name/blender" "$BIN_DIR/blender"
}

# --------------------------------------------------------------------------- #
install_gltf_tools() {
  [ "$INSTALL_GLTF_TOOLS" = "1" ] || return 0
  command -v npm >/dev/null 2>&1 || { log "npm not found; skipping gltf-transform"; return 0; }
  if command -v gltf-transform >/dev/null 2>&1; then log "gltf-transform: already installed"; return 0; fi
  log "gltf-transform: installing (glTF optimiser: draco/meshopt/webp)..."
  local prefix_args=()
  [ "$(id -u)" = "0" ] || prefix_args=(--prefix "$HOME/.local")
  npm install -g "${prefix_args[@]}" --no-fund --no-audit @gltf-transform/cli >"$LOG_DIR/npm.log" 2>&1 \
    && log "gltf-transform: installed" || log "gltf-transform: FAILED (see $LOG_DIR/npm.log)"
}

# --------------------------------------------------------------------------- #
log "installing into $GAMEDEV_HOME (binaries -> $BIN_DIR)"
install_apt & P_APT=$!
install_godot & P_GODOT=$!
install_godot_templates & P_TPL=$!
install_blender & P_BLENDER=$!
install_gltf_tools & P_GLTF=$!
wait $P_APT $P_GODOT $P_TPL $P_BLENDER $P_GLTF

cat > "$GAMEDEV_HOME/env.sh" <<EOF
# Source this for the game-dev toolchain paths (the setup script writes it).
export GAMEDEV_HOME="$GAMEDEV_HOME"
export GODOT_VERSION="$GODOT_VERSION"
export GODOT_BIN="$BIN_DIR/godot"
export BLENDER_BIN="$BIN_DIR/blender"
case ":\$PATH:" in *":$BIN_DIR:"*) ;; *) export PATH="$BIN_DIR:\$PATH" ;; esac
EOF

log "summary:"
for t in godot blender gltf-transform xvfb-run ffmpeg; do
  if command -v "$t" >/dev/null 2>&1 || [ -x "$BIN_DIR/$t" ]; then printf '   ok       %s\n' "$t"; else printf '   MISSING  %s\n' "$t"; fi
done
[ -f "$TEMPLATE_DIR/version.txt" ] && printf '   ok       godot export templates (%s)\n' "$GODOT_TEMPLATE_PLATFORMS" \
  || printf '   MISSING  godot export templates\n'
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) log "add $BIN_DIR to PATH:  source $GAMEDEV_HOME/env.sh" ;; esac
log "finished"
exit 0
