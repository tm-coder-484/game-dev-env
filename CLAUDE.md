# CLAUDE.md

Game-dev monorepo: a Godot 4.7 project (desktop and Web), a three.js + Rapier
browser game, headless Blender tools, and OpenRouter AI tools. Both games share
their assets from `godot/assets/shared/`.

The Godot project's main scene is **Hollowvale** (`godot/game/world/world.tscn`), an open-world survival
game: generated island terrain, instanced grass/trees/props, day/night, wolves and night-time Hollows,
crafting and a Minecraft-style survival HUD. Game code lives in `godot/game/` (world, player, enemies, ui,
systems, debug); the old starter sandbox is `scenes/main.tscn`.

## Commands

- `make doctor`: check the toolchain, export templates, network and keys. Run it first if anything fails.
- `make selftest`: headless Hollowvale gameplay test (gather, craft, chop, mine, combat, survival, save). Must print 17/17.
- `make world`, `make terrain-textures`, `make trees`, `make props`, `make creatures`, `make sfx`, `make icons`: regenerate
  Hollowvale's assets (Blender's numpy runs the generators; icons cost OpenRouter credits).
- `make setup`: install everything (idempotent). The SessionStart hook already does this in cloud sessions.
- `make godot-import`: run after adding or changing files under `godot/`.
- `make export-all`: Godot Web, Linux and Windows builds into `build/`.
- `make web-build`: typecheck and build the three.js game into `web/dist`.
- `make godot-shot` and `make web-shot`: render screenshots into `build/shots/`.
- `make rock SEED=n`, `make preview MODEL=x.glb`, `make convert IN=a.fbx OUT=a.glb`: Blender pipeline.
- `node tools/openrouter/openrouter.mjs chat|json|models ...`: generate text content.
- `node tools/openrouter/assets.mjs models|concept|hud|ui-kit|icon|sprite|texture|sky|edit ...`: game art with any
  OpenRouter image model (`--model <id or fragment>`). Use `--dry-run` to check a request without spending money.
  `ui-kit` writes `godot/assets/ui/**`, which both games' HUDs load. `--placeholder` restores the vector art.
- `make ai-server`: backend for the in-game LLM NPC (needs `OPENROUTER_API_KEY`).
- `node tools/desktop/desk.mjs ...` or the `desktop_*` MCP tools: computer use for native apps on a virtual display
  (`launch`, `shot`, `click`, `look`, `key --hold`, `type`, `windows`, `logs`, `record`, `kill`). Screenshots go to `build/shots/desktop/`.

## Verifying changes (do this, don't guess)

- **Godot scripts or scenes:** `godot --headless --path godot --quit-after 30` must print no `SCRIPT ERROR`/`ERROR` lines
  (add `-- --play` to also start a game). Gameplay changes: `make selftest`.
- **Hollowvale screenshots:** `godot --path godot -- --play --preview --frames=12 --screenshot=/abs/out.png`
  (`--preview` = cheap shadows/AA for the CPU renderer, ~10 s; without it ~3-10 min). Free camera:
  `--cam=x,z,height,yaw,pitch`; also `--time=H`, `--spawn=wolf:2,hollow:1`, `--freeze`, `--give=bow,arrow:10`,
  `--stats=hp,hunger,thirst,warmth`, `--ui=craft|map`. Run under `xvfb-run -a`.
  For visuals, run `make godot-shot` and Read `build/shots/godot.png`.
  Forward+ on the CPU renderer is slow (~40–100 s per shot). For a quick look, add `--rendering-driver opengl3`,
  which gives the Compatibility renderer (what Web uses).
- **Web game:** `make web-shot` builds, serves `dist/`, loads it in headless Chromium, and fails on page errors or 404s.
  Read `build/shots/web.png` afterwards.
- **Godot Web export:** `make export-web`, then `python3 -m http.server 8060 -d build/web &`, then
  `cd web && node scripts/screenshot.mjs http://127.0.0.1:8060/index.html ../build/shots/godot-web.png 45000`.
- **Blender scripts:** run them with `blender -b --factory-startup -P <script> -- <args>`, then `make preview MODEL=<out>`.
- **Gameplay and input in the native build:** `make export-linux`, then drive it with the desktop tools.
  Launch with `--rendering-driver opengl3 --audio-driver Dummy` (~3–5 FPS on the CPU; Vulkan/Forward+ is ~1 FPS).
  Click the window before sending mouse-look, hold keys with `hold_seconds`, and check `desktop_logs` for script errors.
  `make desktop-selftest` checks the whole chain.
- **Editor or Blender GUI work:** `desktop_launch "godot --path godot -e --rendering-driver opengl3"` or
  `desktop_launch "blender --factory-startup"`. Opening the editor rewrites `project.godot` and `.import` files
  into canonical form. Commit those changes rather than fighting them.

## Conventions

- GDScript uses tabs and static typing (`var x: float`, `:=`). Target Godot 4.7 APIs.
  Physics is Jolt. Input actions are defined in `project.godot`.
- The desktop renderer is Forward+. Web automatically uses `gl_compatibility`, so SDFGI, SSR and volumetric fog are desktop-only.
  Keep scenes looking acceptable without them.
- Normal maps use the OpenGL convention (`nor_gl`) for both Godot and three.js.
- Shared assets live in `godot/assets/shared/`. The web game imports them with literal
  `new URL('../../godot/assets/shared/…', import.meta.url)` paths in `web/src/assets.ts`.
- Never put API keys in code, commits or Web builds. Game clients call `tools/openrouter/server.mjs`, which holds the key.
- HUD art slots and sizes are defined once in `tools/openrouter/presets/hud-kit.json`.
  Godot (`scenes/hud.tscn`) and web (`web/src/hud.ts`) assume those sizes: bars 512×64 frame with a 488×40 fill at (12,12), slots 128², icons 128².
- Don't commit `build/`, `web/dist/`, `godot/.godot/` or `.env`.
- Hollowvale: static `main` singletons (`Terrain.main`, `Foliage.main`, `Props.main`, `DayNight.main`) and the
  `Game` autoload connect systems. Bodies created through `PhysicsServer3D` must set their collision layer/mask
  explicitly (Jolt). The terrain heightfield splits quads along the (1,0)-(0,1) diagonal; keep
  `terrain_common.gdshaderinc` and `Terrain.height_at` in step with it.

## Environment notes (cloud)

- Tools live in `/opt/gamedev` and are linked into `/usr/local/bin`. Templates are in `~/.local/share/godot/export_templates/4.7.2.stable/`.
- The SessionStart hook sets `NODE_USE_ENV_PROXY=1` (Node's `fetch` ignores the proxy otherwise) and adds the proxy CA
  to Chromium's trust store (Playwright can then open external https sites). If either is missing, re-run
  `.claude/hooks/session-start.sh` with `CLAUDE_CODE_REMOTE=true`.
