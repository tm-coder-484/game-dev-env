#!/usr/bin/env bash
# Play Hollowvale on Linux or macOS:  ./play.sh
#   1. Runs build/linux/Hollowvale.x86_64 if you have it (from CI or `make export-linux`).
#   2. Otherwise runs the game from source with Godot 4.7 (installed by setup/ scripts or your
#      package manager), preparing the assets on the first run.
set -euo pipefail
cd "$(dirname "$0")"

if [[ "$(uname)" == "Linux" && -x build/linux/Hollowvale.x86_64 ]]; then
  exec build/linux/Hollowvale.x86_64 "$@"
fi

GODOT=""
for g in godot godot4 /Applications/Godot.app/Contents/MacOS/Godot; do
  if command -v "$g" >/dev/null 2>&1 || [[ -x "$g" ]]; then GODOT="$g"; break; fi
done
if [[ -z "$GODOT" ]]; then
  echo "Godot 4.7 not found. Install it with: sudo bash setup/install-toolchain.sh (Linux)"
  echo "or: bash setup/setup-macos.sh (macOS), or from https://godotengine.org/download"
  exit 1
fi
if [[ ! -d godot/.godot/imported ]]; then
  echo "Preparing the game's assets (first run only, about a minute)..."
  "$GODOT" --headless --path godot --import >/dev/null
fi
exec "$GODOT" --path godot "$@"
