Option Explicit
Dim shell, files, root, script, command, code
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
script = files.BuildPath(root, "tools\Start-WorkBuddy-Companion.ps1")
command = """" & shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe") & """ -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & script & """"
code = shell.Run(command, 0, True)
WScript.Quit code
