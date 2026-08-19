@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js를 찾을 수 없습니다. index.html을 직접 더블클릭해 실행하세요.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:4173"
node server.mjs
pause
