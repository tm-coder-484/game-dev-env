# Claude Code cloud environment: copy-paste setup

This sets up a cloud environment so every Claude Code session on this repo
starts with Godot 4.7.2 (plus Web/Linux/Windows export templates), headless
Blender 5.2.2 LTS, glTF tools, a virtual display for screenshots, and your
OpenRouter key.

**Time:** about 5 minutes. After the first session, the toolchain is cached
(the platform snapshots the disk after the setup script runs, for about 7 days).

---

## 1. Open the environment settings

1. Go to **claude.ai/code**.
2. Click the **cloud icon** showing the current environment name, in the row above the message box.
3. Pick **Add cloud environment**, or hover over an existing one and click its **settings icon**.

## 2. Name

```
Game Dev
```

## 3. Network access

The default **Trusted** level blocks Blender's and OpenRouter's servers. Pick one:

- **Full** is the simplest option. It allows any domain.
- **Custom** allows only what you list. Paste the list below into **Allowed domains** and tick
  **Also include default list of common package managers**. That default list covers GitHub, npm and PyPI.

```
openrouter.ai
download.blender.org
mirrors.ocf.berkeley.edu
mirror.clarkson.edu
downloads.godotengine.org
godot-releases.nbg1.your-objectstorage.com
sourceforge.net
*.dl.sourceforge.net
api.polyhaven.com
dl.polyhaven.org
ambientcg.com
```

Why the mirrors: the setup script downloads Godot from GitHub first. The
session's GitHub proxy only reaches repos attached to the session, so
`godotengine/godot` can return 403 there. When that happens the script falls
back to Godot's own mirror (`downloads.godotengine.org`) or SourceForge.

## 4. Environment variables

Paste this into **Environment variables** (`.env` format), then replace the key:

```
OPENROUTER_API_KEY=sk-or-v1-replace-me
OPENROUTER_MODEL=anthropic/claude-sonnet-5
OPENROUTER_NPC_MODEL=deepseek/deepseek-v4.1-flash
OPENROUTER_IMAGE_MODEL=google/gemini-3.1-flash-image
GODOT_VERSION=4.7.2
BLENDER_VERSION=5.2.2
GODOT_TEMPLATE_PLATFORMS=web,linux,windows
```

- Get a key at <https://openrouter.ai/keys>. Put it only in this settings box, never in chat or in a commit.
- **Pro/Max plans: a safer option for the key.** Leave `OPENROUTER_API_KEY` out and add it as an **API credential** instead.
  You can only add one after the environment exists, so edit the environment again and find **API credentials** → **Add credential**:
  - Name: `OpenRouter`
  - Allowed websites: `openrouter.ai`
  - Header: `Authorization`, prefix `Bearer`, value: your key

  The agent proxy then adds the key to requests on their way out, so it never appears in the session.
  The tools here only send their own `Authorization` header when `OPENROUTER_API_KEY` is set, so this works with no changes.
- Anyone who can use the environment can read its variables. On Team/Enterprise plans, use a key with a spending limit.
- The models listed above were available on OpenRouter as of Sept 2026.
  Run `node tools/openrouter/openrouter.mjs models <filter>` to browse the current list and prices.

## 5. Setup script

Paste the **entire contents** of [`setup/install-toolchain.sh`](../setup/install-toolchain.sh) into **Setup script**.

What it does, in about 35 seconds with everything running in parallel:

| Step | Details |
|---|---|
| apt | Xvfb, Mesa (software OpenGL + Vulkan), ffmpeg, runtime libraries |
| Godot 4.7.2 | Editor in `/opt/gamedev`, available as `godot` |
| Export templates | Web, Linux and Windows only. HTTP range requests pull about 400 MB instead of the full 1.3 GB bundle. |
| Blender 5.2.2 LTS | Headless use via `blender -b` |
| gltf-transform | glTF optimizer: Draco, meshopt, WebP |

The script always exits 0, so a flaky mirror can't stop a session from starting.
If it failed, or you skipped this step, the repo's SessionStart hook
([`.claude/hooks/session-start.sh`](../.claude/hooks/session-start.sh)) installs anything missing
when the session starts. It then runs `npm install` for the web template and imports the Godot project.

To change versions later, edit the variables at the top of the pasted script.
Saving a new setup script rebuilds the cache.

## 6. Save and check it

Start a new session in the **Game Dev** environment and ask Claude:

> run `make doctor`

You should see green checks for godot, blender, templates, network and the key.
Then try:

> run `make godot-shot web-shot` and show me the screenshots

---

### What the sandbox can and can't do

- **Can:** import and export Godot projects for Web, Linux and Windows; take rendered screenshots of both games;
  generate, convert and render assets with Blender; call OpenRouter; build and smoke-test the web game in headless Chromium.
- **Slow:** renders use the CPU (llvmpipe/SwiftShader), so Forward+ runs at 1–2 FPS. That's fine for screenshots, not for playtesting.
  Play on your own machine or on the GitHub Pages deploy.
- **Can't:** run the Godot editor GUI, run Unreal Engine (see [UNREAL.md](UNREAL.md)), or use a GPU.
- **Limits:** 4 vCPU, 16 GB RAM, 30 GB disk per session.
