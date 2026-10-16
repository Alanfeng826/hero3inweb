@echo off
chcp 65001 >nul
title 英雄无敌III 网页版 - 本地服务（关闭本窗口即停止）
cd /d "%~dp0"

set "NODE=C:\Users\fenga\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
if not exist "%NODE%" set "NODE=node"

"%NODE%" serve.js 8099 --open

echo.
echo 服务已停止。
pause >nul
