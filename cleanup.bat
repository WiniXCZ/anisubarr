@echo off
chcp 65001 >nul
title Anisubarr – čistění rootu projektu
echo === Anisubarr cleanup ===
echo Mazu zbytecne soubory z rootu projektu...
echo.

cd /d "%~dp0"

REM ── Tray aplikace (nepoužívá se) ──────────────────────────────────
del /f /q tray.pyw 2>nul               && echo SMAZANO: tray.pyw
del /f /q install_and_start_tray.vbs 2>nul && echo SMAZANO: install_and_start_tray.vbs
del /f /q install_tray_deps.bat 2>nul  && echo SMAZANO: install_tray_deps.bat
del /f /q start_tray.vbs 2>nul         && echo SMAZANO: start_tray.vbs

REM ── Health check soubory ──────────────────────────────────────────
del /f /q check2.bat 2>nul             && echo SMAZANO: check2.bat
del /f /q check2_result.txt 2>nul      && echo SMAZANO: check2_result.txt
del /f /q check_health.bat 2>nul       && echo SMAZANO: check_health.bat
del /f /q health_result.txt 2>nul      && echo SMAZANO: health_result.txt

REM ── Duplicitní restart / start skripty ───────────────────────────
del /f /q restart.bat 2>nul            && echo SMAZANO: restart.bat
del /f /q restart_all.bat 2>nul        && echo SMAZANO: restart_all.bat
del /f /q restart_backend.bat 2>nul    && echo SMAZANO: restart_backend.bat
del /f /q restart_backend.vbs 2>nul    && echo SMAZANO: restart_backend.vbs
del /f /q restart_silent.vbs 2>nul     && echo SMAZANO: restart_silent.vbs
del /f /q _restart_now.bat 2>nul       && echo SMAZANO: _restart_now.bat
del /f /q start.bat 2>nul             && echo SMAZANO: start.bat
del /f /q start-prod.bat 2>nul         && echo SMAZANO: start-prod.bat
del /f /q start_servers.ps1 2>nul      && echo SMAZANO: start_servers.ps1
del /f /q s.ps1 2>nul                 && echo SMAZANO: s.ps1

REM ── VBS wrappery (nahrazeny dev-restart.bat) ─────────────────────
del /f /q rebuild.vbs 2>nul            && echo SMAZANO: rebuild.vbs
del /f /q _fresh_start.vbs 2>nul       && echo SMAZANO: _fresh_start.vbs
del /f /q _build_frontend.vbs 2>nul    && echo SMAZANO: _build_frontend.vbs
del /f /q dev-restart.vbs 2>nul        && echo SMAZANO: dev-restart.vbs

REM ── SMB utility (nesouvisí s projektem) ──────────────────────────
del /f /q remap_smb.bat 2>nul          && echo SMAZANO: remap_smb.bat
del /f /q test_write.bat 2>nul         && echo SMAZANO: test_write.bat

REM ── Log soubory ──────────────────────────────────────────────────
del /f /q backend.log 2>nul            && echo SMAZANO: backend.log

REM ── Sebe sama ────────────────────────────────────────────────────
echo.
echo Hotovo! Smazano vyse uvedene soubory.
echo.
echo Ponechane skripty v rootu:
echo   dev-restart.bat       - spusteni vyvojoveho serveru
echo   dev-commit-push.bat   - git commit a push
echo   install_alass.bat     - instalace alass subtitle syncu
echo   deploy.sh             - deploy na Unraid server
echo   set_settings.py       - jednorizovy DB utility skript
echo.
(goto) 2>nul & del "%~f0"
