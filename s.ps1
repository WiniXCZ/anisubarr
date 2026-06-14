Get-Process uvicorn -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
Start-Process -FilePath "C:\Windows\System32\cmd.exe" -ArgumentList @('/k', 'cd /d C:\Projekty\anisubarr\backend && .venv\Scripts\activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000') -WindowStyle Normal
Start-Sleep -Seconds 4  
Start-Process -FilePath "C:\Windows\System32\cmd.exe" -ArgumentList @('/k', 'cd /d C:\Projekty\anisubarr\frontend && npm run dev') -WindowStyle Normal
