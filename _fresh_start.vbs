Dim shell
Set shell = CreateObject("WScript.Shell")

' Zavri vsechny CMD okna a procesy
shell.Run "cmd /c taskkill /f /im cmd.exe /t 2>nul", 0, True
shell.Run "cmd /c taskkill /f /im python.exe /t 2>nul", 0, True
shell.Run "cmd /c taskkill /f /im uvicorn.exe /t 2>nul", 0, True
shell.Run "cmd /c taskkill /f /im node.exe /t 2>nul", 0, True

WScript.Sleep 2000

' Spust backend
shell.CurrentDirectory = "C:\Projekty\anisubarr\backend"
shell.Run "cmd /k "".venv\Scripts\activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000""", 1, False

WScript.Sleep 3000

' Spust frontend
shell.CurrentDirectory = "C:\Projekty\anisubarr\frontend"
shell.Run "cmd /k ""npm run dev""", 1, False
