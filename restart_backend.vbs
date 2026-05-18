Set shell = CreateObject("WScript.Shell")
' Kill existing python/pythonw instances
shell.Run "cmd /c taskkill /f /im python.exe /t 2>nul & taskkill /f /im pythonw.exe /t 2>nul", 0, True
WScript.Sleep 2000

' Restart tray (which starts backend)
Dim pythonw
pythonw = "C:\Projekty\anisubarr\backend\.venv\Scripts\pythonw.exe"
Dim tray
tray = "C:\Projekty\anisubarr\tray.pyw"
shell.Run """" & pythonw & """ """ & tray & """", 0, False
