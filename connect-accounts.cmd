@echo off
REM Authorise Facebook and Instagram.
REM
REM Opens Facebook in your browser, you approve, and it stores an encrypted token
REM per account. Run this again any time to renew the authorisation — after that,
REM further Pages can be connected from the dashboard with no sign-in.

cd /d "%~dp0source\apps\cli"

echo.
echo   Opening Facebook to authorise...
echo   Approve every permission on the screen that opens.
echo.

node --experimental-strip-types src\connect.ts
pause
