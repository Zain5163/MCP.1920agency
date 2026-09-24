@echo off
REM AdsPilot dashboard, development mode with hot reload.
REM Use start-dashboard.cmd for normal use — this one is slower but reloads on edit.

cd /d "%~dp0source\apps\web"

echo.
echo   Starting AdsPilot dashboard (dev mode)...
echo   Open http://localhost:3000
echo   Press Ctrl+C to stop.
echo.

call "%~dp0source\apps\web\node_modules\.bin\next.cmd" dev -p 3000
pause
