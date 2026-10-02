@echo off
rem Double-click this file on Windows to start Deca.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Deca needs a free program called Node.js first.
  echo Opening the download page. Install it ^(click Next a few times^),
  echo then double-click this file again.
  start "" https://nodejs.org/en/download
  echo.
  pause
  exit /b 1
)
node scripts\start.mjs
echo.
echo Deca has stopped.
pause
