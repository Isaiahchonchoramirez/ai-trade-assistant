@echo off
REM  Trade Assistant - Windows uninstaller
setlocal
cd /d "%~dp0"

echo.
echo   This removes the Trade Assistant shortcuts and its private environment.
echo   Your watchlist and settings live in your browser and are not touched.
echo.
set /p OK="  Remove Trade Assistant? (y/N) "
if /i not "%OK%"=="y" ( echo   Cancelled. & pause & exit /b 0 )

set "SM=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Trade Assistant.lnk"
if exist "%SM%" del /q "%SM%"
powershell -NoProfile -Command ^
  "$d = [Environment]::GetFolderPath('Desktop') + '\Trade Assistant.lnk';" ^
  "if (Test-Path $d) { Remove-Item $d -Force }" 2>nul

if exist ".venv" ( echo   Removing environment... & rmdir /s /q ".venv" )

echo.
echo   Removed. You can now delete this folder.
echo.
pause
