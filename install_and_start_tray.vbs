Set shell = CreateObject("WScript.Shell")

Dim pip
pip = "C:\Projekty\anisubarr\backend\.venv\Scripts\pip.exe"

Dim pythonw
pythonw = "C:\Projekty\anisubarr\backend\.venv\Scripts\pythonw.exe"

Dim tray
tray = "C:\Projekty\anisubarr\tray.pyw"

' Install pystray and Pillow silently (wait for completion)
Dim ret
ret = shell.Run("""" & pip & """ install pystray pillow --quiet", 0, True)

If ret <> 0 Then
    MsgBox "Instalace pystray/pillow selhala (kod " & ret & ")." & vbCrLf & _
           "Zkus rucne: " & pip & " install pystray pillow", 16, "Anisubarr"
    WScript.Quit 1
End If

' Kill old backend instances
shell.Run "cmd /c taskkill /f /im python.exe /t 2>nul & taskkill /f /im pythonw.exe /t 2>nul", 0, True
WScript.Sleep 1500

' Start tray app (no window)
shell.Run """" & pythonw & """ """ & tray & """", 0, False

MsgBox "Anisubarr bezi v traji. Klikni na ikonu 'A' v systémovém traji.", 64, "Anisubarr"
