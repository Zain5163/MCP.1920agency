@echo off
REM Shows config, database, media storage and connected accounts.
cd /d "%~dp0source\apps\cli"
node --experimental-strip-types src\status.ts
pause
