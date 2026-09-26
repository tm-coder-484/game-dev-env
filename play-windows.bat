@echo off
REM ==========================================================================
REM  Play Hollowvale on Windows: double-click this file.
REM   1. Runs build\windows\Hollowvale.exe if you have it (from CI or `make export-windows`).
REM   2. Otherwise runs the game from source with Godot 4.7, installing Godot with winget
REM      if needed, and preparing the assets on the first run (takes a minute).
REM ==========================================================================
setlocal
cd /d "%~dp0"

if exist "build\windows\Hollowvale.exe" (
  start "" "build\windows\Hollowvale.exe"
  exit /b 0
)

set "PATH=%PATH%;%LOCALAPPDATA%\Microsoft\WinGet\Links"
set GODOT=
for %%G in (godot.exe godot_console.exe) do if not defined GODOT (
  where %%G >nul 2>&1 && set GODOT=%%G
)
if not defined GODOT (
  echo Godot 4.7 was not found. Installing it with winget...
  where winget >nul 2>&1
  if errorlevel 1 goto :nogodot
  winget install --silent --accept-package-agreements --accept-source-agreements -e --id GodotEngine.GodotEngine
  for %%G in (godot.exe godot_console.exe) do if not defined GODOT (
    where %%G >nul 2>&1 && set GODOT=%%G
  )
)
if not defined GODOT goto :nogodot

if not exist "godot\.godot\imported" (
  echo Preparing the game's assets - first run only, about a minute...
  "%GODOT%" --headless --path godot --import
)
echo Starting Hollowvale...
start "" "%GODOT%" --path godot
exit /b 0

:nogodot
echo.
echo [!] Couldn't find or install Godot 4.7.
echo     Get it from https://godotengine.org/download/windows/ (Godot 4.7, standard version),
echo     or download the ready-made Windows build (hollowvale-windows) from this repo's Actions tab.
echo     Then run this file again, or: godot --path godot
pause
exit /b 1
