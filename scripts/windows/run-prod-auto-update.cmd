@echo off
setlocal

cd /d "%~dp0.."

REM Runs the production server and auto-pulls updates.
REM Requires: git in PATH and an upstream branch configured.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-prod-auto-update.ps1" -Port 7777 -PollSeconds 30
if errorlevel 1 (
  echo.
  echo [dartcounter] Auto-update exited with error.
  pause
  exit /b 1
)
