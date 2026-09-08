@echo off
setlocal

set AUTODARTS_MODE=REAL
set AUTODARTS_ALLOW_MOCK_BINDING=true
set AUTODARTS_ALLOW_MOCK_DARTS=true
set ENABLE_NEXT=false

echo Ensuring darts-caller...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\windows\setup-darts-caller.ps1"
if errorlevel 1 goto :fail

echo Starting darts-caller if enabled...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\windows\start-darts-caller.ps1"
if errorlevel 1 goto :fail

echo Starting Dartcounter (dev)...
npm run dev:all

exit /b 0

:fail
echo.
echo [dartcounter] FAILED.
pause
exit /b 1
