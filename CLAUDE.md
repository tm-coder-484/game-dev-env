# CLAUDE.md

Game-dev monorepo: a Godot 4.7 project (desktop and Web), a three.js + Rapier
browser game, headless Blender tools, and OpenRouter AI tools. Both games share
their assets from `godot/assets/shared/`.

## Commands

- `make doctor`: check the toolchain, export templates, network and keys. Run it first if anything fails.
- `make setup`: install everything (idempotent). The SessionStart hook already does this in cloud sessions.
- `make godot-import`: run after adding or changing files under `godot/`.
- `make export-all`: Godot Web, Linux and Windows builds into `build/`.
- `make web-build`: typecheck and build the three.js game into `web/dist`.
- `make godot-shot` and `make web-shot`: render screenshots into `build/shots/`.
- `make rock SEED=n`, `make preview MODEL=x.glb`, `make convert IN=a.fbx OUT=a.glb`: Blender pipeline.
- `node tools/openrouter/openrouter.mjs chat|json|image|texture|models ...`: generate content.
- `make ai-server`: backend for the in-game LLM NPC (needs `OPENROUTER_API_KEY`).

## Verifying changes (do this, don't guess)

- **Godot scripts or scenes:** `godot --headless --path godot --quit-after 30` must print no `SCRIPT ERROR`/`ERROR` lines.
  For visuals, run `make godot-shot` and Read `build/shots/godot.png`.
  Forward+ on the CPU renderer is slow (~40–100 s per shot). For a quick look, add `--rendering-driver opengl3`,
  which gives the Compatibility renderer (what Web uses).
- **Web game:** `make web-shot` builds, serves `dist/`, loads it in headless Chromium, and fails on page errors or 404s.
  Read `build/shots/web.png` afterwards.
- **Godot Web export:** `make export-web`, then `python3 -m http.server 8060 -d build/web &`, then
  `cd web && node scripts/screenshot.mjs http://127.0.0.1:8060/index.html ../build/shots/godot-web.png 45000`.
- **Blender scripts:** run them with `blender -b --factory-startup -P <script> -- <args>`, then `make preview MODEL=<out>`.

## Conventions

- GDScript uses tabs and static typing (`var x: float`, `:=`). Target Godot 4.7 APIs.
  Physics is Jolt. Input actions are defined in `project.godot`.
- The desktop renderer is Forward+. Web automatically uses `gl_compatibility`, so SDFGI, SSR and volumetric fog are desktop-only.
  Keep scenes looking acceptable without them.
- Normal maps use the OpenGL convention (`nor_gl`) for both Godot and three.js.
- Shared assets live in `godot/assets/shared/`. The web game imports them with literal
  `new URL('../../godot/assets/shared/…', import.meta.url)` paths in `web/src/assets.ts`.
- Never put API keys in code, commits or Web builds. Game clients call `tools/openrouter/server.mjs`, which holds the key.
- Don't commit `build/`, `web/dist/`, `godot/.godot/` or `.env`.

## Environment notes (cloud)

- Tools live in `/opt/gamedev` and are linked into `/usr/local/bin`. Templates are in `~/.local/share/godot/export_templates/4.7.2.stable/`.
- Node's `fetch` needs `NODE_USE_ENV_PROXY=1` behind the proxy. `tools/openrouter/lib.mjs` re-runs itself with that set automatically.
- If Chromium can't verify HTTPS for external sites, trust the proxy CA:
  `certutil -A -d sql:$HOME/.pki/nssdb -n proxy -t C,, -i /root/.ccr/agent-proxy-ca.crt` (from `libnss3-tools`).
  Localhost pages don't need this.
