@echo off
powershell -Command "try { $r = Invoke-WebRequest http://localhost:8000/api/health -TimeoutSec 3; $r.Content } catch { 'CHYBA: ' + $_.Exception.Message }" > check2_result.txt 2>&1
