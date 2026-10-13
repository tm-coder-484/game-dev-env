@echo off
REM Strata lamp - regenerate the STEP files, the print templates and (if Blender
REM is installed) the renders. Double-click this file after editing params.py.
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python 3.10 - 3.13 is needed: https://www.python.org/downloads/  ^(tick "Add python.exe to PATH"^)
  pause
  exit /b 1
)

echo Installing / updating build123d and reportlab ...
python -m pip install --quiet --upgrade build123d reportlab
if errorlevel 1 goto :err

echo Building the CAD model ...
python strata_lamp.py
if errorlevel 1 goto :err

echo Drawing the templates ...
python templates.py
if errorlevel 1 goto :err

where blender >nul 2>nul
if errorlevel 1 (
  echo Blender not on PATH - skipping renders.
) else (
  echo Rendering ^(takes a few minutes^) ...
  blender -b --factory-startup -P render.py
)

echo.
echo Done.
echo   Inventor: File ^> Open ^> type "STEP" ^> out\step\strata_lamp_assembly.step
echo   Print:    out\strata_lamp_templates.pdf at 100%% / Actual size
start "" "%~dp0out"
pause
exit /b 0

:err
echo.
echo Something failed - read the messages above.
pause
exit /b 1
