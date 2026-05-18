Set shell = CreateObject("WScript.Shell")

' Kill old python/pythonw instances silently
shell.Run "cmd /c taskkill /f /im python.exe /t 2>nul & taskkill /f /im pythonw.exe /t 2>nul", 0, True
WScript.Sleep 1500

' Launch tray app via pythonw (no console window)
Dim pythonw
pythonw = "C:\Projekty\anisubarr\backend\.venv\Scripts\pythonw.exe"

Dim tray
tray = "C:\Projekty\anisubarr\tray.pyw"

shell.Run """" & pythonw & """ """ & tray & """", 0, False
