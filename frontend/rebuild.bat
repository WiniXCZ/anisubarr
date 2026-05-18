@echo off
cd /d "%~dp0"
echo Building frontend...
npm run build > build_log.txt 2>&1
echo Exit: %ERRORLEVEL% >> build_log.txt
echo Done.
