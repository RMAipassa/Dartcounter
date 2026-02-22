@echo off
setlocal

echo [dartcounter] Auto-update loop started (30s)
echo Press Ctrl+C to stop.

:loop
call "%~dp0update.cmd"
timeout /t 30 /nobreak >nul
goto loop
