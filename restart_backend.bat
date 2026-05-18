@echo off
title Restart Anisubarr backend
chcp 65001 >nul
echo === Restart Anisubarr backend (bez rebuild frontendu) ===
echo.

echo [1/2] Zastavuji python...
taskkill /f /im python.exe /t 2>nul
timeout /t 3 /nobreak >nul

echo [2/2] Spoustim uvicorn...
cd /d "C:\Projekty\anisubarr\backend"
start "Anisubarr backend" cmd /k ".venv\Scripts\activate && uvicorn app.main:app --host 0.0.0.0 --port 8000"

echo.
echo Backend spusten na portu 8000.
pause
