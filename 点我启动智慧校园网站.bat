@echo off
chcp 65001 >nul
title Smart Campus Launcher

cd /d "%~dp0"

echo.
echo ================================
echo   Smart Campus Website Launcher
echo ================================
echo.
echo Project: %CD%
echo URL: http://localhost:5173/
echo.
echo Do not close this window after the site starts.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js first.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please reinstall Node.js.
  pause
  exit /b 1
)

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing 'http://localhost:5173/' -TimeoutSec 2; if ($r.StatusCode -eq 200) { Start-Process 'http://localhost:5173/'; exit 10 } } catch { exit 0 }"
if "%ERRORLEVEL%"=="10" (
  echo Website is already running. Browser has been opened.
  pause
  exit /b 0
)

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:5173/'"

npm run dev

echo.
echo Website stopped. Press any key to exit.
pause >nul
