@echo off
REM Drains any due scheduled posts immediately, instead of waiting for the
REM 5-minute scheduled task.
cd /d "%~dp0source\apps\worker"
node --experimental-strip-types src\worker.ts --once
pause
