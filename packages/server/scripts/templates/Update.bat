@echo off
setlocal

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo IMPORTANT: this folder (where Update.bat is) must NOT be the same folder as your
echo existing Endpoint Manager install. If you unzipped the update into your existing
echo install's own folder, stop now - move this update folder somewhere else first
echo (e.g. your Desktop), then run Update.bat again from there.
echo.
set /p TARGETDIR="Path to the EXISTING Endpoint Manager install (the folder with 'app', 'node', Start-Server.bat): "

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" -TargetDir "%TARGETDIR%"

echo.
echo Press any key to close this window.
pause >nul
