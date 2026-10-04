#!/usr/bin/env bash
# Play Tomb of the Token on Linux or macOS:  ./play-tomb.sh
#   Opens tomb/dist/tomb-of-the-token.html, building it first with Node.js if needed.
#   The build is one self-contained HTML file that works offline from anywhere.
set -euo pipefail
cd "$(dirname "$0")"
game=tomb/dist/tomb-of-the-token.html
if [[ ! -f "$game" || "${1:-}" == "--rebuild" ]]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "Node.js (npm) not found. Install Node.js 20+ from https://nodejs.org/ and run this again."
    exit 1
  fi
  echo "Building Tomb of the Token (first run only, about 30 seconds)..."
  (cd tomb && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-fund --no-audit --loglevel=error && npm run build)
fi
path="$(cd "$(dirname "$game")" && pwd)/$(basename "$game")"
echo "Opening $path"
if command -v xdg-open >/dev/null 2>&1; then xdg-open "$path" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then open "$path"
else echo "Open this file in your browser: $path"; fi
