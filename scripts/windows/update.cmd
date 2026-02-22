@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM Prevent concurrent runs
set LOCKDIR=.update-lock
mkdir "%LOCKDIR%" >nul 2>nul
if errorlevel 1 (
  echo Update already running; skipping.
  exit /b 0
)

call :main
set EXITCODE=%ERRORLEVEL%

rmdir "%LOCKDIR%" >nul 2>nul
exit /b %EXITCODE%

:main
echo.
echo [dartcounter] Checking for updates...

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set BRANCH=%%b
if "%BRANCH%"=="" (
  echo Not a git repo or git not available.
  exit /b 1
)

git fetch --prune >nul 2>nul

for /f "delims=" %%i in ('git rev-parse HEAD') do set LOCAL=%%i

REM Try upstream first
set REMOTE=
for /f "delims=" %%i in ('git rev-parse @{u} 2^>nul') do set REMOTE=%%i

if "%REMOTE%"=="" (
  REM Fallback to origin/main or origin/master
  for /f "delims=" %%i in ('git rev-parse origin/main 2^>nul') do set REMOTE=%%i
  if "%REMOTE%"=="" for /f "delims=" %%i in ('git rev-parse origin/master 2^>nul') do set REMOTE=%%i
)

if "%REMOTE%"=="" (
  echo Could not determine remote HEAD (set upstream branch).
  exit /b 1
)

if "%LOCAL%"=="%REMOTE%" (
  echo No changes.
  exit /b 0
)

echo Pulling latest changes...
git pull --ff-only
if errorlevel 1 (
  echo git pull failed.
  exit /b 1
)

echo Installing deps...
set npm_config_production=false
call npm install
if errorlevel 1 exit /b 1

echo Building...
call npm run build:all
if errorlevel 1 exit /b 1

where pm2 >nul 2>nul
if errorlevel 1 (
  echo pm2 not found. Install it with: npm i -g pm2
  exit /b 1
)

echo Restarting app...
pm2 restart dartcounter --update-env
if errorlevel 1 (
  echo pm2 restart failed (is the process started?).
  exit /b 1
)

echo Update applied.
exit /b 0
