@echo off
setlocal

REM Builds + runs Dartcounter production server on port 7777.
REM (Tunnel / domain mapping managed separately by you.)

cd /d "%~dp0.."

if "%PORT%"=="" set PORT=7777

REM Ensure devDependencies are installed for build
set npm_config_production=false

echo.
echo Installing dependencies...
call npm install
if errorlevel 1 exit /b 1

echo.
echo Building...
call npm run build:all
if errorlevel 1 exit /b 1

if not exist "dist\server.js" (
  echo.
  echo Missing dist\server.js (build failed?)
  exit /b 1
)

echo.
echo Starting server on http://localhost:%PORT% ...
echo.
start "" "http://localhost:%PORT%/"

set NODE_ENV=production
node "dist\server.js"
