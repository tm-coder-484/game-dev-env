#!/bin/bash
# Checks the game-dev toolchain, network access and API keys; says how to fix
# anything missing. Safe to run any time:  bash scripts/doctor.sh   (or: make doctor)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
[ -f /opt/gamedev/env.sh ] && . /opt/gamedev/env.sh
[ -f "$HOME/.local/share/gamedev/env.sh" ] && . "$HOME/.local/share/gamedev/env.sh"

GODOT_VERSION="${GODOT_VERSION:-4.7.2}"
ok=0; bad=0
pass() { printf '  \033[32m✔\033[0m %-22s %s\n' "$1" "$2"; ok=$((ok + 1)); }
fail() { printf '  \033[31m✘\033[0m %-22s %s\n' "$1" "$2"; bad=$((bad + 1)); }
warn() { printf '  \033[33m!\033[0m %-22s %s\n' "$1" "$2"; }
ver() { "$@" 2>/dev/null | head -1; }

echo "Tools"
command -v godot >/dev/null && pass godot "$(ver godot --version)" || fail godot "run: bash setup/install-toolchain.sh"
command -v blender >/dev/null && pass blender "$(blender -b --factory-startup --version 2>/dev/null | head -1)" \
  || fail blender "run: bash setup/install-toolchain.sh (needs download.blender.org)"
command -v node >/dev/null && pass node "$(node --version)" || fail node "install Node.js 20+"
command -v python3 >/dev/null && pass python3 "$(python3 --version 2>&1)" || fail python3 "install Python 3.10+"
command -v gltf-transform >/dev/null && pass gltf-transform "$(ver gltf-transform --version)" || warn gltf-transform "optional: npm i -g @gltf-transform/cli"
command -v ffmpeg >/dev/null && pass ffmpeg "$(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f1-3)" || warn ffmpeg "optional (video capture)"
if [ "$(uname)" = Linux ]; then
  command -v xvfb-run >/dev/null && pass xvfb-run "virtual display for screenshots" || warn xvfb-run "needed for headless screenshots (apt install xvfb)"
  command -v xdotool >/dev/null && command -v openbox >/dev/null && pass "desktop automation" "xdotool + openbox" \
    || warn "desktop automation" "apt install xdotool openbox x11-utils (or re-run setup/install-toolchain.sh)"
fi

echo "Godot export templates ($GODOT_VERSION)"
case "$(uname)" in
  Darwin) tdir="$HOME/Library/Application Support/Godot/export_templates/$GODOT_VERSION.stable" ;;
  *) tdir="${XDG_DATA_HOME:-$HOME/.local/share}/godot/export_templates/$GODOT_VERSION.stable" ;;
esac
for f in web_nothreads_release.zip linux_release.x86_64 windows_release_x86_64.exe; do
  [ -f "$tdir/$f" ] && pass "$f" "" || fail "$f" "run: python3 setup/fetch_godot_templates.py"
done

echo "Project"
[ -d web/node_modules ] && pass "web/node_modules" "installed" || fail "web/node_modules" "run: (cd web && npm install)"
[ -d tools/node_modules ] && pass "tools/node_modules" "installed" || fail "tools/node_modules" "run: (cd tools && npm install)"
mcp_err=$(node tools/desktop/mcp-launch.mjs --check 2>/dev/null) && pass "desktop MCP server" "packages load" \
  || fail "desktop MCP server" "${mcp_err:-cannot start} - run: (cd tools && npm install)"
[ -d godot/.godot ] && pass "godot import cache" "present" || warn "godot import cache" "run: make godot-import"

echo "Network"
check_host() {
  local code
  code=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' "$2" 2>/dev/null)
  case "$code" in 2*|3*|401|404|405) pass "$1" "reachable" ;; *) fail "$1" "blocked or down (HTTP ${code:-none}) - allow it in your network settings" ;; esac
}
check_host openrouter.ai https://openrouter.ai/api/v1/models
check_host download.blender.org https://download.blender.org/release/
check_host api.polyhaven.com https://api.polyhaven.com/types
check_host registry.npmjs.org https://registry.npmjs.org/three

echo "Keys"
if [ -n "${OPENROUTER_API_KEY:-}" ]; then
  pass OPENROUTER_API_KEY "set (${#OPENROUTER_API_KEY} chars)"
else
  warn OPENROUTER_API_KEY "not set - fine if you added it as a cloud API credential; else see .env.example"
fi

echo
[ "$bad" -eq 0 ] && echo "All good ($ok checks passed)." || echo "$bad problem(s) found - see the hints above."
exit 0
