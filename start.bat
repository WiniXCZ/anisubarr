@echo off
title Anisubarr

echo === Anisubarr – spouštění ===

REM Spusť backend v novém okně
start "Anisubarr Backend" cmd /k "cd /d %~dp0backend && .venv\Scripts\activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

REM Počkej chvíli, než backend naběhne
timeout /t 3 /nobreak >nul

REM Spusť frontend v novém okně
start "Anisubarr Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

REM Zjisti lokální IP adresu (první IPv4 z WiFi nebo Ethernet)
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    set LAN_IP=%%a
    goto :found
)
:found
set LAN_IP=%LAN_IP: =%

echo.
echo ┌─────────────────────────────────────────────┐
echo │              Anisubarr běží                 │
echo ├─────────────────────────────────────────────┤
echo │  Lokálně:   http://localhost:5173           │
echo │  Síť:       http://%LAN_IP%:5173         │
echo └─────────────────────────────────────────────┘
echo.
echo Tablet/telefon: připoj se na http://%LAN_IP%:5173
echo.
pause
