@echo off
REM AdsPilot dashboard launcher.
REM
REM Calls the .cmd wrapper rather than .ps1, so PowerShell's execution policy
REM cannot block it. Double-click this file, or run it from any terminal.

cd /d "%~dp0source\apps\web"

echo.
echo   Starting the dashboard...
echo   Open http://localhost:3000 once it says Ready.
echo   Press Ctrl+C to stop.
echo.

call "%~dp0source\apps\web\node_modules\.bin\next.cmd" start -p 3000
pause
