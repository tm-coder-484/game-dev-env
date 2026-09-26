# What about Unreal Engine?

Short answer: this repo uses **Godot 4** as its engine because it works everywhere this setup
needs it to. That includes the cloud sandbox, headless CI, browser builds and standalone builds.
Unreal is a great choice for AAA-style visuals on your own PC, and the asset tools here work with it.

## Why Unreal isn't in the cloud setup

| | Godot 4 | Unreal Engine 5 |
|---|---|---|
| Download | ~80 MB, public, no account | Epic account plus EULA. Linux builds come from the launcher or from source, via a GitHub account linked to Epic. |
| Size and build | Single binary | 60–150 GB installed. Source builds need more than 16 GB RAM. The cloud VM has 30 GB disk and 16 GB RAM. |
| Headless export | `godot --headless --export-release` | Possible with RunUAT/BuildCookRun, but needs a full engine install |
| Browser builds | Yes (WebGL 2 export) | No: HTML5 export was removed in UE 4.24. Pixel Streaming is the alternative, but it streams video from a GPU server. |
| License | MIT, free | Free up to $1M revenue, then 5% royalty |

So Unreal can't run inside a Claude Code cloud session. Claude can still write
C++ and Blueprint-adjacent code for your Unreal project, and the Blender and
OpenRouter tools in this repo work with it.

## Setting up Unreal on your own Windows PC

1. Install the Epic Games Launcher. The Windows setup script can do it:
   ```bat
   set INSTALL_EPIC=1
   setup\setup-windows.bat
   ```
   Or directly: `winget install -e --id EpicGames.EpicGamesLauncher`
2. In the launcher, go to **Unreal Engine** → **Library** → **+** and install the latest UE 5.x.
   Tick only the target platforms you need, to save disk space.
3. For C++ projects, install Visual Studio 2022 with the **Game development with C++** workload.
4. Create a project from the **Games → First Person** template. Start with Lumen and Nanite on for realism.

## Using this repo's tools with Unreal

- **Models:** convert to FBX, which Unreal's importer prefers, with the headless Blender converter:
  ```bash
  blender -b --factory-startup -P tools/blender/convert.py -- rock.glb rock.fbx
  ```
  Unreal 5 also imports `.glb` directly (Interchange). Blender works in meters and Unreal in centimeters.
  The FBX export applies unit scaling for you.
- **Textures and HDRIs:** `tools/assets/polyhaven.py` downloads CC0 PBR sets. Use `nor_dx` normal maps for Unreal,
  which uses the DirectX convention:
  ```bash
  python3 tools/assets/polyhaven.py texture rocky_terrain_02 --res 2k --maps diff,nor_dx,rough,ao
  ```
- **AI NPCs:** run `tools/openrouter/server.mjs` and call `POST http://127.0.0.1:8787/chat` from Unreal
  with the built-in HTTP module (`FHttpModule`) or a plugin such as VaRest.
  The JSON contract is the same one the Godot and web NPCs use.

## If you want Unreal-level visuals in Godot

The Godot template already turns on Forward+, SDFGI (real-time GI), SSR, SSAO/SSIL,
volumetric fog, HDRI lighting and physically based materials. To go further:
use 2k–4k Poly Haven textures, add `LightmapGI` for static scenes, and use
`ReflectionProbe`s indoors. Set `rendering/scaling_3d/mode` to FSR 2 for performance headroom.
