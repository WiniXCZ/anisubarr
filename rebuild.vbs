Set shell = CreateObject("WScript.Shell")

' Kill existing python and CMD processes
shell.Run "cmd /c taskkill /f /im python.exe /t 2>nul", 0, True
shell.Run "powershell -WindowStyle Hidden -Command ""Get-Process -Name cmd -ErrorAction SilentlyContinue | Stop-Process -Force""", 0, True
WScript.Sleep 2000

' Build frontend with explicit path
shell.CurrentDirectory = "C:\Projekty\anisubarr\frontend"
Dim ret
ret = shell.Run("cmd /c npm run build", 1, True)

If ret <> 0 Then
    MsgBox "Frontend build selhal! Kod: " & ret, 16, "Anisubarr rebuild"
    WScript.Quit 1
End If

' Start uvicorn backend
shell.CurrentDirectory = "C:\Projekty\anisubarr\backend"
shell.Run "cmd /k "".venv\Scripts\activate && uvicorn app.main:app --host 0.0.0.0 --port 8000""", 1, False
