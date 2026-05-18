@echo off
title Instalace alass pro Anisubarr
chcp 65001 >nul
echo === Instalace alass ===
echo.

set TOOLS_DIR=%~dp0tools
set ALASS_ZIP=%TEMP%\alass-windows64.zip
set ALASS_EXE=%TOOLS_DIR%\alass.exe
set ENV_FILE=%~dp0backend\.env

echo [1/4] Vytvarim slozku tools...
if not exist "%TOOLS_DIR%" mkdir "%TOOLS_DIR%"

echo [2/4] Stahuji alass-windows64.zip...
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/kaegi/alass/releases/download/v2.0.0/alass-windows64.zip' -OutFile '%ALASS_ZIP%' -UseBasicParsing"
if errorlevel 1 (
    echo CHYBA: Stazeni selhalo!
    pause
    exit /b 1
)
echo       Stazeno.

echo [3/4] Extrahuji alass.exe...
powershell -Command "Expand-Archive -Path '%ALASS_ZIP%' -DestinationPath '%TOOLS_DIR%' -Force"
if errorlevel 1 (
    echo CHYBA: Extrakce selhala!
    pause
    exit /b 1
)

REM Najdi exe v podslozce (pokud je v podslozce)
if not exist "%ALASS_EXE%" (
    for /r "%TOOLS_DIR%" %%f in (alass*.exe) do (
        copy "%%f" "%ALASS_EXE%" >nul
        goto :found_exe
    )
    echo CHYBA: alass.exe nenalezen v zipu!
    pause
    exit /b 1
)
:found_exe
echo       alass.exe extrahovano: %ALASS_EXE%

echo [4/4] Pridavam ALASS_PATH do .env...
REM Odstran existujici ALASS_PATH radek pokud existuje
powershell -Command "(Get-Content '%ENV_FILE%') | Where-Object {$_ -notmatch '^ALASS_PATH='} | Set-Content '%ENV_FILE%'"
REM Pridej novy radek
echo ALASS_PATH=%ALASS_EXE%>> "%ENV_FILE%"
echo       .env aktualizovan.

echo.
echo ================================================================
echo  alass uspesne nainstalovan!
echo  Cesta: %ALASS_EXE%
echo.
echo  Nyni restartuj backend (spust rebuild.vbs nebo restart.bat)
echo ================================================================
echo.
del "%ALASS_ZIP%" >nul 2>&1
pause
