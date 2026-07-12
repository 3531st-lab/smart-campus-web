@echo off
chcp 65001 >nul
title 智慧校园网站启动器

cd /d "%~dp0"

echo.
echo ================================
echo   智慧校园网站正在启动...
echo ================================
echo.
echo 项目目录：%CD%
echo 访问地址：http://localhost:5173/
echo.
echo 提示：这个窗口不要关闭，关闭后网站会停止运行。
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:5173/'"

npm run dev

echo.
echo 网站已停止。按任意键退出。
pause >nul
