' =====================================================================
' LIMRA Restaurant POS -- Silent Background Printer Bridge Launcher
' Launches start-printer-bridge.bat with window hidden (Zero Console Popup)
' =====================================================================

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

strScriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
strBatPath = fso.BuildPath(strScriptDir, "start-printer-bridge.bat")

If fso.FileExists(strBatPath) Then
    ' Run completely invisible: window style 0, do not wait for return
    WshShell.Run """" & strBatPath & """", 0, False
Else
    ' Fallback to direct node execution
    strRootDir = fso.GetParentFolderName(strScriptDir)
    strServerPath = fso.BuildPath(strRootDir, "backend\server.js")
    WshShell.CurrentDirectory = strRootDir
    WshShell.Run "node """ & strServerPath & """", 0, False
End If

Set WshShell = Nothing
Set fso = Nothing
