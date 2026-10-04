@echo off
REM ==========================================================================
REM  Play Tomb of the Token on Windows: double-click this file.
REM   1. Opens tomb\dist\tomb-of-the-token.html in your browser if it is built.
REM   2. Otherwise builds it with Node.js first (installing Node.js LTS with
REM      winget if needed). The build is one self-contained HTML file: copy it
REM      anywhere (or to your phone) and open it, no server needed.
REM ==========================================================================
setlocal
cd /d "%~dp0"
set "GAME=tomb\dist\tomb-of-the-token.html"
if exist "%GAME%" goto :open

set "PATH=%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Microsoft\WinGet\Links"
where npm >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Installing Node.js LTS with winget...
  where winget >nul 2>&1
  if errorlevel 1 goto :nonode
  winget install --silent --accept-package-agreements --accept-source-agreements -e --id OpenJS.NodeJS.LTS
)
where npm >nul 2>&1
if errorlevel 1 goto :nonode

echo Building Tomb of the Token - first run only, about 30 seconds...
set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
pushd tomb
call npm install --no-fund --no-audit --loglevel=error
if errorlevel 1 goto :failed
call npm run build
if errorlevel 1 goto :failed
popd

:open
echo Opening Tomb of the Token...
start "" "%GAME%"
exit /b 0

:nonode
echo.
echo [!] Couldn't find or install Node.js.
echo     Install the LTS version from https://nodejs.org/ and run this file again,
echo     or download the ready-made "tomb-of-the-token" file from this repo's Actions tab.
pause
exit /b 1

:failed
popd
echo.
echo [!] The build failed. Scroll up for the error, or download the ready-made
echo     "tomb-of-the-token" file from this repo's Actions tab.
pause
exit /b 1
