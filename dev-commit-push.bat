@echo off
chcp 65001 >nul
title Anisubarr – commit a push

echo === Anisubarr: commit a push ===
echo.

cd /d "%~dp0"

REM ── Odstraň stale git lock pokud existuje ──────────────────────────
if exist ".git\index.lock" (
    echo [!] Odstranuji stary .git\index.lock...
    del /f ".git\index.lock"
    echo     OK
)

REM ── Reset všeho staged (čistý základ) ─────────────────────────────
git reset HEAD -- . 2>nul

REM ── Odstraň log/result soubory ze sledování gitem ─────────────────
git rm --cached backend/uvicorn_log.txt check2_result.txt 2>nul

REM ── Stage jen zdrojový kód (ne logy, ne tools) ────────────────────
echo.
echo [1/3] Přidávám zdrojový kód...
git add frontend/src/
git add backend/app/

REM ── Zobraz co bude commitnuto ─────────────────────────────────────
echo.
echo Co bude commitnuto:
git diff --cached --name-only
echo.

REM ── Commit ────────────────────────────────────────────────────────
set /p MSG="Zpráva commitu (nebo Enter pro default): "
if "%MSG%"=="" set MSG=feat: mobile improvements, login fix, Settings connections

echo.
echo [2/3] Commituju...
git commit -m "%MSG%"
if errorlevel 1 (
    echo Neni co commitovat nebo chyba.
    pause
    exit /b 1
)

REM ── Push ──────────────────────────────────────────────────────────
echo.
echo [3/3] Pushuju na GitHub...
git push origin master
if errorlevel 1 (
    echo CHYBA: push selhal. Zkus rucne: git push origin master
    pause
    exit /b 1
)

echo.
echo ✓ Hotovo! Zmeny jsou na GitHubu.
echo.
pause
