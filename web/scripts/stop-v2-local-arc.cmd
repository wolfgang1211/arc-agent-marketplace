@echo off
setlocal
cd /d "%~dp0.."
node scripts\v2-local-arc-control.mjs stop
exit /b %errorlevel%
