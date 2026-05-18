@echo off
curl -s http://localhost:8000/api/health > health_result.txt 2>&1
type health_result.txt
pause
