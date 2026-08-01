@echo off
rem Manual/foreground start - useful for troubleshooting. Normal operation runs via the
rem "LicenseServer" Scheduled Task registered by setup.ps1, which starts on boot and
rem restarts automatically on failure with no visible console window.
setlocal
cd /d "%~dp0app"
"%~dp0node\node.exe" dist\index.js
pause
