@echo off
echo Starting QA Copilot Backend on http://localhost:8001
cd /d "%~dp0backend"
python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
pause
