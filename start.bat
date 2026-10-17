@echo off
REM QueueSense one-click start (Windows). First run installs everything; later runs just start the server.
cd /d "%~dp0backend"
if not exist .venv (
  echo Creating Python environment...
  python -m venv .venv
  .venv\Scripts\python -m pip install -q -r requirements.txt
)
if not exist "..\frontend\dist\index.html" (
  echo Building the frontend...
  pushd ..\frontend
  call npm install
  call npm run build
  popd
)
echo Starting QueueSense on http://localhost:8000  (Ctrl+C to stop)
.venv\Scripts\python main.py
