@echo off
cd /d "%~dp0"
echo === npm run build === > build_log.txt
npm run build >> build_log.txt 2>&1
echo === DONE (exit code: %ERRORLEVEL%) >> build_log.txt
echo Build dokoncen. Viz build_log.txt
pause
