Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

Dim logFile
logFile = "C:\Projekty\anisubarr\_build_frontend.log"

shell.Run "cmd /c cd /d C:\Projekty\anisubarr\frontend && npm run build > """ & logFile & """ 2>&1", 0, True

MsgBox "Frontend build hotov! Zkontroluj " & logFile & " pro detaily.", 64, "Anisubarr Build"
