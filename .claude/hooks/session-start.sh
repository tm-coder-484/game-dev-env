#!/bin/bash
# SessionStart hook for Claude Code on the web: makes sure the game-dev
# toolchain and project dependencies exist, even if the environment has no
# setup script (or its downloads were blocked). Everything is idempotent, so
# when the cloud setup script already did the work this takes about a second.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0 # local sessions: run `make setup` yourself instead
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
log() { echo "[session-start] $*" >&2; }

# 1. Toolchain (Godot + templates, Blender, glTF tools, Xvfb/Mesa). ~35 s when missing.
if ! command -v godot >/dev/null 2>&1 || ! command -v blender >/dev/null 2>&1 \
   || [ ! -f "$HOME/.local/share/godot/export_templates/${GODOT_VERSION:-4.7.2}.stable/version.txt" ]; then
  log "toolchain incomplete - running setup/install-toolchain.sh"
  bash setup/install-toolchain.sh >&2 || true
fi

# 2. Web template packages (fast no-op when up to date; npm install is cache-friendly).
if [ -f web/package.json ]; then
  (cd web && npm install --no-fund --no-audit --loglevel=error >&2) || log "npm install failed"
fi

# 3. Godot import cache, so exports/scripts work immediately.
if command -v godot >/dev/null 2>&1 && [ ! -d godot/.godot/imported ]; then
  log "importing Godot project"
  timeout 180 godot --headless --path godot --import >/dev/null 2>&1 || log "godot import failed"
fi

# 4. Handy variables for the rest of the session.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export GODOT_BIN=$(command -v godot || echo godot)"
    echo "export BLENDER_BIN=$(command -v blender || echo blender)"
  } >> "$CLAUDE_ENV_FILE"
fi
exit 0
