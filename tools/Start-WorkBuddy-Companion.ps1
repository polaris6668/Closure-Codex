$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$electron = Join-Path $root 'work/companion-runtime/electron/electron.exe'
$launcher = Join-Path $root 'outputs/closure-companion/workbuddy-launch.cjs'
$previous = $env:ELECTRON_RUN_AS_NODE
$launcherProcess = $null
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $launcherInfo = [Diagnostics.ProcessStartInfo]::new()
    $launcherInfo.FileName = $electron
    $launcherInfo.Arguments = '"' + $launcher + '"'
    $launcherInfo.UseShellExecute = $false
    $launcherInfo.CreateNoWindow = $true
    $launcherInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $launcherInfo.RedirectStandardOutput = $true
    $launcherInfo.RedirectStandardError = $true
    $launcherInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $launcherInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
    $launcherProcess = [Diagnostics.Process]::new()
    $launcherProcess.StartInfo = $launcherInfo
    [void]$launcherProcess.Start()
    $readStdout = $launcherProcess.StandardOutput.ReadToEndAsync()
    $readStderr = $launcherProcess.StandardError.ReadToEndAsync()
    $launcherProcess.WaitForExit()
    $result = $readStdout.GetAwaiter().GetResult() + $readStderr.GetAwaiter().GetResult()
    if ($launcherProcess.ExitCode -ne 0) { throw $result.Trim() }
    & (Join-Path $root 'outputs/closure-autostart/Watch-Codex.ps1') -Refresh
} catch {
    Add-Type -AssemblyName PresentationFramework
    [void][System.Windows.MessageBox]::Show($_.Exception.Message, 'WorkBuddy 桌宠联动')
    exit 1
} finally {
    $env:ELECTRON_RUN_AS_NODE = $previous
    if ($launcherProcess) { $launcherProcess.Dispose() }
}
