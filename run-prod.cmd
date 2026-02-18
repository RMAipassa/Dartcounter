@echo off
setlocal

if "%PORT%"=="" set PORT=7777
if "%NODE_ENV%"=="" set NODE_ENV=production

echo Building...
call npm run build:all
if errorlevel 1 exit /b 1

echo Starting on port %PORT%...
call npm start
