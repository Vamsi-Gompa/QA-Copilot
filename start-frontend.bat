@echo off
echo Starting QA Copilot Frontend on http://localhost:5200
cd /d "%~dp0frontend"
node_modules\.bin\vite.CMD
pause
