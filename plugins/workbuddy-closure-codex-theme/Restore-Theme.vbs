Option Explicit
Dim shell, files, entry, command, code
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
entry = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "Theme.ps1")
command = """" & shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe") & """ -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & entry & """ -Mode disable -Silent"
code = shell.Run(command, 0, True)
WScript.Quit code
