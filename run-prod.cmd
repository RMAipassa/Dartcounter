@echo off
setlocal

echo.
echo [dartcounter] run-prod starting...
echo Working dir: %CD%

if "%PORT%"=="" set PORT=7777

set AUTODARTS_MODE=REAL
set AUTODARTS_ALLOW_MOCK_BINDING=false
set AUTODARTS_ALLOW_MOCK_DARTS=false

REM Ensure devDependencies are installed for build
set npm_config_production=false

echo Building...
call npm run build:all
if errorlevel 1 (echo build failed & goto :fail)

echo Starting on port %PORT%...
set NODE_ENV=production
call npm start

exit /b 0

:fail
echo.
echo [dartcounter] FAILED.
pause
exit /b 1
