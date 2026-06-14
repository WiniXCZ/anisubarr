@echo off
echo Restarting Anisubarr...
cd /d C:\Projekty\anisubarr
taskkill /f /im python.exe 2>nul
taskkill /f /im uvicorn.exe 2>nul
timeout /t 2 /nobreak >nul
call restart.bat
