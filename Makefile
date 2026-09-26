# Game-dev environment - common commands. `make help` lists them.
# Works on Linux, WSL, macOS and Claude Code cloud sessions.

GODOT   ?= godot
BLENDER ?= blender -b --factory-startup
PROJECT := godot
BUILD   := build
SHOTS   := $(BUILD)/shots
# Headless Linux (cloud/CI) needs a virtual display for anything that renders.
XVFB    := $(if $(or $(DISPLAY),$(filter Darwin,$(shell uname))),,xvfb-run -a -s "-screen 0 1280x720x24")

.DEFAULT_GOAL := help
.PHONY: help setup doctor godot-import godot-editor godot-run godot-shot \
        export-web export-linux export-windows export-all serve-godot-web \
        web-dev web-build web-preview web-shot rock preview convert assets ai-server clean

help: ## list commands
	@grep -hE '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[36mmake %-16s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------- setup ----
setup: ## install Godot + templates, Blender, tools (Linux/WSL), npm deps, import
	bash setup/install-toolchain.sh
	cd web && npm install --no-fund --no-audit
	$(MAKE) godot-import

doctor: ## check tools, templates, network and keys
	@bash scripts/doctor.sh

# ---------------------------------------------------------------- godot ----
godot-import: ## (re)import Godot assets headlessly
	$(GODOT) --headless --path $(PROJECT) --import

godot-editor: ## open the Godot editor (needs a desktop)
	$(GODOT) --path $(PROJECT) -e

godot-run: ## play the Godot game
	$(GODOT) --path $(PROJECT)

godot-shot: ## render a Godot screenshot headlessly -> build/shots/godot.png
	@mkdir -p $(SHOTS)
	$(XVFB) $(GODOT) --path $(PROJECT) --audio-driver Dummy --resolution 1280x720 -- --screenshot=$(abspath $(SHOTS))/godot.png --frames=90

export-web: ## export Godot game for browsers -> build/web
	@mkdir -p $(BUILD)/web
	$(GODOT) --headless --path $(PROJECT) --export-release "Web" ../$(BUILD)/web/index.html

export-linux: ## export Godot game for Linux -> build/linux
	@mkdir -p $(BUILD)/linux
	$(GODOT) --headless --path $(PROJECT) --export-release "Linux" ../$(BUILD)/linux/RealisticStarter.x86_64

export-windows: ## export Godot game for Windows -> build/windows
	@mkdir -p $(BUILD)/windows
	$(GODOT) --headless --path $(PROJECT) --export-release "Windows" ../$(BUILD)/windows/RealisticStarter.exe

export-all: export-web export-linux export-windows ## all three exports

serve-godot-web: ## serve the Godot web export on http://localhost:8060
	python3 -m http.server 8060 -d $(BUILD)/web

# ------------------------------------------------------------------ web ----
web-dev: ## three.js game with hot reload on http://localhost:5173
	cd web && npm run dev

web-build: ## production build -> web/dist
	cd web && npm run build

web-preview: web-build ## serve web/dist on http://localhost:4173
	cd web && npm run preview

web-shot: web-build ## headless-browser smoke test + screenshot -> build/shots/web.png
	@mkdir -p $(SHOTS)
	cd web && node scripts/screenshot.mjs dist $(abspath $(SHOTS))/web.png 15000

# -------------------------------------------------------------- blender ----
SEED ?= 7
rock: ## generate a rock with Blender -> godot/assets/shared/models/rock.glb (SEED=n)
	$(BLENDER) -P tools/blender/generate_rock.py -- $(PROJECT)/assets/shared/models/rock.glb --seed $(SEED)

preview: ## render a model: make preview MODEL=path.glb
	@mkdir -p $(SHOTS)
	$(BLENDER) -P tools/blender/render_preview.py -- $(MODEL) $(SHOTS)/$(notdir $(basename $(MODEL))).png --hdri $(PROJECT)/assets/shared/hdri/sky.hdr

convert: ## convert a model: make convert IN=x.fbx OUT=x.glb [ARGS="--scale 0.01"]
	$(BLENDER) -P tools/blender/convert.py -- $(IN) $(OUT) $(ARGS)

# --------------------------------------------------------------- assets ----
assets: ## re-download the shared CC0 sky + ground textures from Poly Haven
	python3 tools/assets/polyhaven.py hdri kloofendal_38d_partly_cloudy_puresky --res 1k --name sky.hdr --out $(PROJECT)/assets/shared/hdri
	python3 tools/assets/polyhaven.py texture forrest_ground_01 --res 1k --maps diff,nor_gl,rough --out /tmp/ph
	mkdir -p $(PROJECT)/assets/shared/textures/ground && cp /tmp/ph/forrest_ground_01/* $(PROJECT)/assets/shared/textures/ground/

# ------------------------------------------------------------------- ai ----
ai-server: ## run the OpenRouter NPC backend on http://127.0.0.1:8787
	node tools/openrouter/server.mjs

clean: ## delete builds and caches
	rm -rf $(BUILD) web/dist $(PROJECT)/.godot
