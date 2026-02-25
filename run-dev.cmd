@echo off
setlocal

set AUTODARTS_MODE=REAL
set AUTODARTS_ALLOW_MOCK_BINDING=true
set AUTODARTS_ALLOW_MOCK_DARTS=true
set ENABLE_NEXT=false

echo Starting Dartcounter (dev)...
npm run dev:all
