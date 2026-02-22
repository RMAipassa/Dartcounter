@echo off
setlocal

if "%PORT%"=="" set PORT=7777
if "%NODE_ENV%"=="" set NODE_ENV=production

echo Installing deps...
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

echo Starting (pm2) on port %PORT%...
pm2 start dist/server.js --name dartcounter --update-env
pm2 save

echo Done.
