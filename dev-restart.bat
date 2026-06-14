@echo off
chcp 65001 >nul

echo Zastavuji Anisubarr...
taskkill /f /fi "WINDOWTITLE eq Anisubarr Backend" /t 2>nul
taskkill /f /fi "WINDOWTITLE eq Anisubarr Frontend" /t 2>nul
taskkill /f /im python.exe /t 2>nul
taskkill /f /im uvicorn.exe /t 2>nul
taskkill /f /im node.exe /t 2>nul
timeout /t 2 /nobreak >nul

echo Cistim null byty z Python souboru...
python %~dp0strip_nulls.py

echo Spoustim backend...
start "Anisubarr Backend" cmd /k "cd /d %~dp0backend && .venv\Scripts\activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

timeout /t 3 /nobreak >nul

echo Spoustim frontend...
start "Anisubarr Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

REM Toto okno se samo zavre
exit
