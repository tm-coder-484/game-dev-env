@echo off
REM ==========================================================================
REM  Windows setup for game-dev-env: double-click this file, or run it from a
REM  terminal in the repo folder. Uses winget (built into Windows 10/11).
REM
REM  Installs: Git, Node.js LTS, Python 3.12, Godot 4 (+ export templates for
REM  Web/Linux/Windows), Blender, then the web template's npm packages.
REM  Optional: run "set INSTALL_EPIC=1" first to also get the Epic Games
REM  Launcher (for Unreal Engine - see docs\UNREAL.md).
REM ==========================================================================
setlocal
cd /d "%~dp0\.."
set GODOT_VERSION=4.7.2

where winget >nul 2>&1
if errorlevel 1 (
  echo [!] winget not found. Install "App Installer" from the Microsoft Store, then re-run.
  pause
  exit /b 1
)

set WG=winget install --silent --accept-package-agreements --accept-source-agreements -e --id
echo === Installing tools with winget - already-installed ones are skipped ===
%WG% Git.Git
%WG% OpenJS.NodeJS.LTS
%WG% Python.Python.3.12
%WG% GodotEngine.GodotEngine
%WG% BlenderFoundation.Blender
if "%INSTALL_EPIC%"=="1" %WG% EpicGames.EpicGamesLauncher

REM winget updates PATH for *new* terminals; patch this one so we can continue.
set "PATH=%PATH%;%LOCALAPPDATA%\Microsoft\WinGet\Links;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts"

echo.
echo === Godot %GODOT_VERSION% export templates: Web, Linux, Windows ===
set PY=
where py >nul 2>&1
if not errorlevel 1 set PY=py -3
if not defined PY (
  where python >nul 2>&1
  if not errorlevel 1 set PY=python
)
if defined PY (
  %PY% setup\fetch_godot_templates.py --version %GODOT_VERSION% --platforms web,linux,windows
  if errorlevel 1 echo [!] Template download failed - in Godot use Editor ^> Manage Export Templates ^> Download.
) else (
  echo [!] Python not on PATH yet. Open a new terminal and run: py -3 setup\fetch_godot_templates.py
)

echo.
echo === npm install: web game + tools (AI asset pipeline) ===
where npm >nul 2>&1
if errorlevel 1 (
  echo [!] npm not on PATH yet. Open a new terminal and run: cd web ^&^& npm install ^&^& cd ..\tools ^&^& npm install
) else (
  pushd web
  call npm install --no-fund --no-audit
  popd
  pushd tools
  call npm install --no-fund --no-audit
  popd
)

echo.
echo === Done ===
echo  Godot editor : run "godot" or use the Start menu, then open godot\project.godot
echo  Web game     : cd web ^&^& npm run dev    then open http://localhost:5173
echo  AI NPC server: set OPENROUTER_API_KEY=sk-or-...  then  node tools\openrouter\server.mjs
echo  Blender      : blender -b --factory-startup -P tools\blender\generate_rock.py -- rock.glb
echo  AI HUD art   : node tools\openrouter\assets.mjs ui-kit --model gpt-image-2.5-flare
echo.
echo If a command is "not recognized", close this window and open a new terminal.
pause
