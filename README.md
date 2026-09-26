# game-dev-env

A ready-to-run setup for making realistic 3D games that ship **standalone**
(Windows/Linux/macOS) and **in the browser**. It includes AI-assisted content
through **OpenRouter** and a headless **Blender** asset pipeline. It works in
Claude Code cloud sessions, on Windows, Linux/WSL and macOS, and in GitHub Actions.

| Godot 4.7, desktop (Forward+) | Godot 4.7, browser (WebGL 2) | three.js + Rapier, browser |
|---|---|---|
| ![Godot desktop](docs/images/godot-desktop.jpg) | ![Godot web](docs/images/godot-web.jpg) | ![three.js](docs/images/three-web.jpg) |

These were rendered headlessly in the cloud sandbox on a CPU renderer, which is why the FPS counters are low.

## What's inside

| Part | What you get |
|---|---|
| **`godot/`**: Godot 4.7 project | First-person controller (keyboard, mouse, gamepad). HDRI sky and image-based lighting, SDFGI, SSR, SSAO/SSIL, volumetric fog. Jolt physics props, a PBR material showcase, rocks made in Blender, and an **NPC whose dialogue is written live by an LLM**. Export presets for **Web, Linux and Windows**. |
| **`web/`**: three.js + Rapier + Vite + TypeScript | The same scene in plain web tech: HDRI lighting, soft shadows, GTAO, bloom and SMAA, physics with a character controller, and the same AI NPC. Deploys anywhere static. |
| **`tools/blender/`** | Headless Blender scripts that **generate** a rock and bake its PBR textures to GLB, **convert** any format to GLB/FBX/OBJ (with decimate, rescale, Draco), and **render** previews. |
| **`tools/openrouter/`** | A CLI for dialogue, quests, JSON item tables, concept art and seamless textures, plus a small **AI NPC server** that keeps your key out of game builds. |
| **`tools/assets/polyhaven.py`** | Search and download CC0 HDRIs, PBR textures and models from Poly Haven. |
| **`setup/`** | The toolchain installer (also the cloud setup script), a Windows `.bat`, a macOS script, and an export-template fetcher. |
| **`.github/workflows/`** | CI that builds all targets as downloadable artifacts, plus a one-click **GitHub Pages** deploy of both browser games. |

## Getting started

### Option A: Claude Code cloud (claude.ai/code)

Follow **[docs/CLOUD_ENVIRONMENT.md](docs/CLOUD_ENVIRONMENT.md)**. It has every value ready to paste:
network allowlist, environment variables (OpenRouter key, versions) and the setup script.
Then start a session and ask Claude to "run `make doctor`".

This repo's SessionStart hook also installs anything missing, so sessions work
before you configure the environment, as long as the network allows the downloads.

### Option B: Windows

Double-click **`setup\setup-windows.bat`**. It uses winget to install Git, Node.js, Python, Godot 4.7.2 and Blender,
then fetches the Godot export templates and the web template's packages.

```bat
:: play the three.js game
cd web && npm run dev
:: open the Godot project: start Godot and import godot\project.godot
```

### Option C: Linux / WSL

```bash
sudo bash setup/install-toolchain.sh   # Godot + templates, Blender, Xvfb/Mesa/ffmpeg (~35 s)
make setup                             # npm install + Godot import
make doctor
```

Without `sudo`, the installer puts everything in `~/.local` and skips the system packages.

### Option D: macOS

```bash
bash setup/setup-macos.sh              # Homebrew: Godot, Blender, Node, Python + templates
```

## Everyday commands

Run `make help` for the full list.

```bash
make godot-editor        # open the Godot editor
make godot-run           # play the Godot version
make export-all          # build/web, build/linux, build/windows  (standalone + browser)
make serve-godot-web     # play the Godot Web export at http://localhost:8060
make web-dev             # three.js game with hot reload at http://localhost:5173
make web-build           # production build in web/dist
make godot-shot web-shot # headless screenshots in build/shots/ (great for CI and AI agents)
make rock SEED=42        # new procedural rock in Blender
make preview MODEL=godot/assets/shared/models/rock.glb
make convert IN=chair.fbx OUT=godot/assets/chair.glb ARGS="--scale 0.01 --decimate 0.5"
make ai-server           # start the LLM NPC backend
make doctor              # check what's installed and reachable
```

Controls in both games: **WASD** to move, **mouse** to look (click to capture), **Space** to jump,
**Shift** to sprint, **F** for the flashlight, **E** to talk to Mara, **Esc** to release the mouse.
Gamepads work in the Godot version.

## AI with OpenRouter

One key gives you Claude, GPT, Gemini, DeepSeek and image models. Get one at <https://openrouter.ai/keys>
and set `OPENROUTER_API_KEY` (see [.env.example](.env.example)).

```bash
node tools/openrouter/openrouter.mjs chat "Write 5 idle barks for a paranoid lighthouse keeper"
node tools/openrouter/openrouter.mjs json "12 survival crafting recipes with inputs, outputs, craft_time" --out data/recipes.json
node tools/openrouter/openrouter.mjs image "rain-soaked neon alley, concept art" --aspect 16:9 --out concept/alley.png
node tools/openrouter/openrouter.mjs texture "weathered red brick wall" --out godot/assets/brick.png
node tools/openrouter/openrouter.mjs models gemini          # browse models and prices
```

**In-game LLM NPC:** run `make ai-server`, then walk up to Mara (the green figure) and press **E**, in either game.
Games talk to `http://127.0.0.1:8787/chat`. The server adds the key, caps tokens and only allows approved models.
Never put the key inside a game build: anyone can extract it, especially from Web builds.
When you deploy, host `server.mjs` somewhere, set `AI_CORS_ORIGIN`, and point the NPC at it.
In Godot that's the `server_url` export on the Mara node; on the web it's `?ai=https://…/chat`.

## Asset pipeline

```
Poly Haven (CC0 HDRIs, textures, models) ─┐
OpenRouter (concept art, textures) ───────┼──> Blender (headless): generate / convert / bake / preview
Your own .blend / .fbx / .obj ────────────┘          │
                                                     ▼  .glb
                               godot/assets/shared/ ──> Godot (auto-imports)
                                                   └──> three.js (Vite bundles it)
```

- `python3 tools/assets/polyhaven.py search rock --type models` finds assets, then `model rock_moss_set_01 --res 2k` downloads one.
- `gltf-transform optimize in.glb out.glb --texture-compress webp` shrinks web downloads.
- Everything in `godot/assets/shared/` is CC0 ([credits](godot/assets/shared/CREDITS.md)).

## Shipping

- **Standalone:** `make export-linux` / `make export-windows` produce a single-file executable with the game data embedded.
  For macOS, add the `macos` templates (`GODOT_TEMPLATE_PLATFORMS=web,linux,windows,macos`) and a macOS preset in the editor.
- **Browser:** the Godot Web export is single-threaded, so it needs no special COOP/COEP headers.
  It works on itch.io (zip `build/web`) and GitHub Pages as-is. The three.js build (`web/dist`) is plain static files.
- **GitHub Pages:** in the repo, go to Settings → Pages → Source: **GitHub Actions**.
  Then go to Actions → **deploy to pages** → Run workflow, and both games go live at `https://<you>.github.io/<repo>/`.
- **CI:** every push to `main` builds all targets. Download them from the run's **Artifacts** section.

## Why Godot, and not Unreal?

Godot runs headless in the cloud sandbox and in CI, exports to the browser, and is an 80 MB download.
Unreal needs an Epic account, 60+ GB and a GPU, and it has no browser export.
See **[docs/UNREAL.md](docs/UNREAL.md)** for setting up Unreal on your own PC and using these tools with it.

## Layout

```
.claude/            SessionStart hook + settings for Claude Code
.github/workflows/  build.yml (CI artifacts), pages.yml (deploy browser builds)
docs/               cloud setup guide, Unreal notes, screenshots
godot/              Godot 4.7 project (scenes/, scripts/, assets/shared/)
setup/              install-toolchain.sh, setup-windows.bat, setup-macos.sh, fetch_godot_templates.py
scripts/doctor.sh   environment checker
tools/              blender/, openrouter/, assets/
web/                three.js + Rapier + Vite game
```

## Troubleshooting

- **Something's missing:** run `make doctor`. It says what's missing and how to fix it.
- **A download failed in the cloud:** the network policy is probably blocking the host. See step 3 in
  [CLOUD_ENVIRONMENT.md](docs/CLOUD_ENVIRONMENT.md).
- **Godot says export templates are missing:** run `python3 setup/fetch_godot_templates.py`
  (add `--platforms web,linux,windows,macos` to include macOS), or in the editor use
  Editor → Manage Export Templates → Download.
- **Web build shows a black screen locally:** open it through a server (`make serve-godot-web` / `make web-preview`),
  not with `file://`.
- **The NPC says "AI offline":** start `make ai-server` with `OPENROUTER_API_KEY` set.
