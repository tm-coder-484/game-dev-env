#!/bin/bash
# macOS setup for game-dev-env (Apple Silicon or Intel). Needs Homebrew: https://brew.sh
#   bash setup/setup-macos.sh
set -euo pipefail
cd "$(dirname "$0")/.."
GODOT_VERSION="${GODOT_VERSION:-4.7.2}"

command -v brew >/dev/null || { echo "Install Homebrew first: https://brew.sh"; exit 1; }
brew install node python@3.12 ffmpeg
brew install --cask godot blender   # universal builds; run 'godot' / 'blender' from /Applications

# CLI shims so the Makefile and scripts can call `godot` and `blender`.
mkdir -p "$HOME/.local/bin"
ln -sf /Applications/Godot.app/Contents/MacOS/Godot "$HOME/.local/bin/godot"
ln -sf /Applications/Blender.app/Contents/MacOS/Blender "$HOME/.local/bin/blender"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo 'Add to your shell profile: export PATH="$HOME/.local/bin:$PATH"' ;; esac

python3 setup/fetch_godot_templates.py --version "$GODOT_VERSION" --platforms web,macos,windows,linux
(cd web && npm install --no-fund --no-audit)
echo "Done. Try: make godot-editor   or   make web-dev"
