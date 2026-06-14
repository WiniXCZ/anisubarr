# Spusti backend a frontend pro Anisubarr
# Pouzit: pravym tlacitkem -> "Spustit v PowerShellu"

Write-Host "Zastavuji stare procesy..."
Get-Process uvicorn -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*anisubarr*" } | Stop-Process -Force
Start-Sleep -Seconds 2

Write-Host "Spoustim backend..."
Start-Process -FilePath "cmd.exe" `
    -ArgumentList '/k "cd /d C:\Projekty\anisubarr\backend && .venv\Scripts\activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"' `
    -WindowStyle Normal `
    -WorkingDirectory "C:\Projekty\anisubarr\backend"

Start-Sleep -Seconds 4

Write-Host "Spoustim frontend (Vite)..."
Start-Process -FilePath "cmd.exe" `
    -ArgumentList '/k "cd /d C:\Projekty\anisubarr\frontend && npm run dev"' `
    -WindowStyle Normal `
    -WorkingDirectory "C:\Projekty\anisubarr\frontend"

Write-Host "Hotovo! Backend: port 8000, Frontend: port 5173"
Start-Sleep -Seconds 3
