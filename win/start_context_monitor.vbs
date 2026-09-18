Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
repo = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
target = repo & "\src\watch_context_widget.mjs"
nodeExe = shell.ExpandEnvironmentStrings("%NODE_EXE%")
If nodeExe = "%NODE_EXE%" Or Trim(nodeExe) = "" Then nodeExe = "node"
If fso.FileExists(target) Then
    shell.Run """" & nodeExe & """ """ & target & """", 0, False
End If
