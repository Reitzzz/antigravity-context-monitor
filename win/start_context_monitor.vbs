' Antigravity 上下文监控伴随启动器 (静默无黑框)
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

strScriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
strRepoDir = objFSO.GetParentFolderName(strScriptDir)
strTarget = strRepoDir & "\src\watch_context_widget.mjs"

If objFSO.FileExists(strTarget) Then
    objShell.Run "node """ & strTarget & """", 0, False
Else
    objShell.Run "node ""C:\Users\26818.Administrator\Tools\watch_context_widget.mjs""", 0, False
End If
