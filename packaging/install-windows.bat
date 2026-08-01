@echo off
REM  Trade Assistant - Windows installer
REM  Creates Start Menu and Desktop shortcuts, then sets up the environment.
REM
REM  NOTE: written on macOS and not tested on Windows. If something here
REM  misbehaves, start.bat in this folder always works as a fallback.
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo   Trade Assistant - setup
echo   =======================
echo.

REM ---- locate Python -------------------------------------------------------
set "PY="
where python >nul 2>&1 && set "PY=python"
if not defined PY ( where py >nul 2>&1 && set "PY=py" )
if not defined PY (
  echo   Python 3.10 or newer is required.
  echo   Get it from https://www.python.org/downloads/
  echo   Tick "Add Python to PATH" during install, then run this again.
  echo.
  pause
  exit /b 1
)

REM ---- environment ---------------------------------------------------------
if not exist ".venv\Scripts\python.exe" (
  echo   Creating a private environment...
  %PY% -m venv .venv || ( echo   Failed to create environment. & pause & exit /b 1 )
)
echo   Installing components ^(about a minute^)...
".venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
".venv\Scripts\python.exe" -m pip install --quiet -r "Backend\Requirements.txt" || (
  echo   Install failed - check your internet connection.
  pause & exit /b 1
)

REM ---- shortcuts -----------------------------------------------------------
set "TARGET=%~dp0start.bat"
set "ICON=%~dp0packaging\app.ico"
set "SM=%APPDATA%\Microsoft\Windows\Start Menu\Programs"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$w = New-Object -ComObject WScript.Shell;" ^
  "foreach ($p in @('%SM%\Trade Assistant.lnk', \"$([Environment]::GetFolderPath('Desktop'))\Trade Assistant.lnk\")) {" ^
  "  $s = $w.CreateShortcut($p);" ^
  "  $s.TargetPath = '%TARGET%';" ^
  "  $s.WorkingDirectory = '%~dp0';" ^
  "  $s.Description = 'Trade Assistant';" ^
  "  if (Test-Path '%ICON%') { $s.IconLocation = '%ICON%' }" ^
  "  $s.WindowStyle = 7;" ^
  "  $s.Save() }" 2>nul

echo.
echo   Done. Launch it from the Start Menu or the Desktop shortcut.
echo   To remove it later, run uninstall-windows.bat
echo.
pause
