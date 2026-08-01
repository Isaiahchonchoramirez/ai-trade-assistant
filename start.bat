@echo off
cd /d "%~dp0"
where python >nul 2>&1 && (python run.py & goto :eof)
where py     >nul 2>&1 && (py run.py     & goto :eof)
echo.
echo   Python 3 is not installed.
echo   Get it from https://www.python.org/downloads/ ^(tick "Add Python to PATH"^),
echo   then double-click this file again.
echo.
pause
