@echo off
chcp 65001 >nul

REM Spust backend v novem okne
start "Anisubarr Backend" cmd /k "cd /d %~dp0backend && .venv\Scripts\activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

REM Pockej, nez backend nabehne
timeout /t 3 /nobreak >nul

REM Spust frontend v novem okne
start "Anisubarr Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

REM Toto okno se samo zavře
exit
