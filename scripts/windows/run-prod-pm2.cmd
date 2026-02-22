@echo off
setlocal

echo.
echo [dartcounter] run-prod-pm2 starting...
echo Working dir: %CD%

if "%PORT%"=="" set PORT=7777
if "%NODE_ENV%"=="" set NODE_ENV=production

where node >nul 2>nul || (echo Node not found in PATH & exit /b 1)
where npm >nul 2>nul || (echo npm not found in PATH & exit /b 1)
for /f "delims=" %%v in ('node -v') do echo Node: %%v

echo Installing deps...
call npm install
if errorlevel 1 (echo npm install failed & goto :fail)

echo Building...
call npm run build:all
if errorlevel 1 (echo build failed & goto :fail)

if not exist dist\server.js (
  echo Missing dist\server.js after build.
  goto :fail
)

where pm2 >nul 2>nul
if errorlevel 1 (
  echo pm2 not found. Install it with: npm i -g pm2
  goto :fail
)

echo Starting (pm2) on port %PORT%...
pm2 start dist/server.js --name dartcounter --update-env
pm2 save

echo.
pm2 status dartcounter

echo Done.
echo URL: http://localhost:%PORT%/
exit /b 0

:fail
echo.
echo [dartcounter] FAILED.
echo If you double-clicked this file, run it from CMD to see errors.
pause
exit /b 1
