Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
repo = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
target = repo & "\src\watch_context_widget.mjs"
If fso.FileExists(target) Then
    shell.Run "node """ & target & """", 0, False
End If
