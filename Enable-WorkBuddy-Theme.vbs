Option Explicit
Dim shell, files, entry, command, code
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
entry = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "plugins\workbuddy-closure-codex-theme\Enable-Theme.vbs")
command = """" & shell.ExpandEnvironmentStrings("%SystemRoot%\System32\wscript.exe") & """ //Nologo """ & entry & """"
code = shell.Run(command, 0, True)
WScript.Quit code
