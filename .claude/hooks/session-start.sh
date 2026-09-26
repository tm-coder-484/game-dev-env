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
   || ! command -v xdotool >/dev/null 2>&1 || ! command -v openbox >/dev/null 2>&1 \
   || [ ! -f "$HOME/.local/share/godot/export_templates/${GODOT_VERSION:-4.7.2}.stable/version.txt" ]; then
  log "toolchain incomplete - running setup/install-toolchain.sh"
  bash setup/install-toolchain.sh >&2 || true
fi

# 2. npm packages for the web game and the tools (desktop MCP server, asset
#    pipeline). Fast no-op when up to date; npm install is cache-friendly.
for dir in web tools; do
  if [ -f "$dir/package.json" ]; then
    (cd "$dir" && npm install --no-fund --no-audit --loglevel=error >&2) || log "npm install failed in $dir"
  fi
done

# 3. Godot import cache, so exports/scripts work immediately.
if command -v godot >/dev/null 2>&1 && [ ! -d godot/.godot/imported ]; then
  log "importing Godot project"
  timeout 180 godot --headless --path godot --import >/dev/null 2>&1 || log "godot import failed"
fi

# 4. Behind the cloud's TLS-inspecting proxy: let Chromium/Playwright trust its
#    CA (otherwise external https pages fail with ERR_CERT_AUTHORITY_INVALID).
PROXY_CA=/root/.ccr/agent-proxy-ca.crt
if [ -f "$PROXY_CA" ] && command -v certutil >/dev/null 2>&1; then
  mkdir -p "$HOME/.pki/nssdb"
  [ -f "$HOME/.pki/nssdb/cert9.db" ] || certutil -N -d "sql:$HOME/.pki/nssdb" --empty-password 2>/dev/null
  certutil -L -d "sql:$HOME/.pki/nssdb" 2>/dev/null | grep -qi proxy \
    || certutil -A -d "sql:$HOME/.pki/nssdb" -n agent-proxy -t "C,," -i "$PROXY_CA" 2>/dev/null \
    || log "could not add proxy CA to the browser trust store"
fi

# 5. Handy variables for the rest of the session. NODE_USE_ENV_PROXY makes
#    Node's built-in fetch honour HTTPS_PROXY (it ignores it by default).
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export GODOT_BIN=$(command -v godot || echo godot)"
    echo "export BLENDER_BIN=$(command -v blender || echo blender)"
    [ -n "${HTTPS_PROXY:-}" ] && echo "export NODE_USE_ENV_PROXY=1"
  } >> "$CLAUDE_ENV_FILE"
fi
exit 0
