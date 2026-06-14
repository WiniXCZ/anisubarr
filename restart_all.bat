@echo off
chcp 65001 >nul
echo Zastavuji vsechny procesy...

taskkill /F /IM uvicorn.exe /T >nul 2>&1
taskkill /F /IM python.exe /T >nul 2>&1

:: Zavri CMD okna s Anisubarr
for /f "tokens=2" %%i in ('tasklist /FI "WINDOWTITLE eq Anisubarr*" /FO LIST ^| find "PID:"') do taskkill /F /PID %%i >nul 2>&1

:: Zabit node/vite procesy (Vite dev server)
taskkill /F /FI "WINDOWTITLE eq *vite*" /T >nul 2>&1
wmic process where "name='node.exe' and commandline like '%anisubarr%'" delete >nul 2>&1

timeout /t 3 /nobreak >nul

echo Spoustim backend...
start "Anisubarr Backend" cmd /k "cd /d C:\Projekty\anisubarr\backend && .venv\Scripts\activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

timeout /t 4 /nobreak >nul

echo Spoustim frontend (Vite dev)...
start "Anisubarr Frontend" cmd /k "cd /d C:\Projekty\anisubarr\frontend && npm run dev"

echo Hotovo!
timeout /t 2 /nobreak >nul
exit
