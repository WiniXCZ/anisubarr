@echo off
chcp 65001 >nul
echo Zastavuji stary backend...
taskkill /F /FI "WINDOWTITLE eq Anisubarr Backend*" /T >nul 2>&1
taskkill /F /IM uvicorn.exe /T >nul 2>&1
timeout /t 2 /nobreak >nul
echo Spoustim backend znovu...
start "Anisubarr Backend" cmd /k "cd /d C:\Projekty\anisubarr\backend && .venv\Scripts\activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
echo Hotovo.
timeout /t 2 /nobreak >nul
exit
