@echo off
title Anisubarr – produkce
chcp 65001 >nul

echo === Anisubarr – produkční spuštění ===
echo.

REM Zjisti lokální IP adresu
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    set LAN_IP=%%a
    goto :got_ip
)
:got_ip
set LAN_IP=%LAN_IP: =%

REM ── Build frontendu ──────────────────────────────────────────────────
echo [1/2] Sestavuji frontend (npm run build)...
cd /d "%~dp0frontend"
call npm run build
if errorlevel 1 (
    echo CHYBA: build frontendu selhal!
    pause
    exit /b 1
)
echo       Frontend sestaven.
echo.

REM ── Spusť backend (servuje i frontend) ──────────────────────────────
echo [2/2] Spouštím backend na portu 8000...
cd /d "%~dp0backend"
start "Anisubarr" cmd /k ".venv\Scripts\activate && uvicorn app.main:app --host 0.0.0.0 --port 8000"

timeout /t 3 /nobreak >nul

echo.
echo ┌─────────────────────────────────────────────────┐
echo │           Anisubarr běží (prod)                 │
echo ├─────────────────────────────────────────────────┤
echo │  Lokálně:    http://localhost:8000              │
echo │  LAN:        http://%LAN_IP%:8000           │
echo │  Venku:      otevři port 8000 na UniFi          │
echo └─────────────────────────────────────────────────┘
echo.
echo  Na UniFi: Port Forward → External 8000 → Internal %LAN_IP%:8000
echo.
pause
