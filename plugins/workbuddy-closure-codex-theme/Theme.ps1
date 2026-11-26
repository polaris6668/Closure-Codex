param([ValidateSet('enable','disable','inspect')][string]$Mode='enable',[switch]$Silent)
$ErrorActionPreference='Stop'
$themeRoot=$PSScriptRoot
$stateRoot=Join-Path $env:LOCALAPPDATA 'ClosureWorkBuddyTheme'
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
$log=Join-Path $stateRoot 'launcher.log'
$originalElectronMode=$env:ELECTRON_RUN_AS_NODE
$launcherProcess=$null
try {
    $runtime=$null
    $bundledNode=Join-Path $themeRoot 'runtime\node.exe'
    if(Test-Path -LiteralPath $bundledNode -PathType Leaf){$runtime=$bundledNode}
    if(-not $runtime){$nodeCommand=Get-Command node.exe -ErrorAction SilentlyContinue;if($nodeCommand){$runtime=$nodeCommand.Source}}
    if(-not $runtime){
        foreach($candidate in @((Join-Path $themeRoot 'runtime\node.exe'),(Join-Path $themeRoot '..\..\work\companion-runtime\electron\electron.exe'))){
            if(Test-Path -LiteralPath $candidate -PathType Leaf){$runtime=[IO.Path]::GetFullPath($candidate);break}
        }
    }
    if(-not $runtime){throw '未找到运行时，请使用完整发行包，或安装 Node.js 22 及以上版本。'}
    if([IO.Path]::GetFileName($runtime) -ieq 'electron.exe'){$env:ELECTRON_RUN_AS_NODE='1'}
    $arguments='"' + (Join-Path $themeRoot 'lib\launcher.cjs') + '" --mode ' + $Mode + ' --root "' + $stateRoot + '"'
    $launcherInfo=[Diagnostics.ProcessStartInfo]::new()
    $launcherInfo.FileName=$runtime
    $launcherInfo.Arguments=$arguments
    $launcherInfo.UseShellExecute=$false
    $launcherInfo.CreateNoWindow=$true
    $launcherInfo.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
    $launcherInfo.RedirectStandardOutput=$true
    $launcherInfo.RedirectStandardError=$true
    $launcherInfo.StandardOutputEncoding=[Text.UTF8Encoding]::new($false)
    $launcherInfo.StandardErrorEncoding=[Text.UTF8Encoding]::new($false)
    $launcherProcess=[Diagnostics.Process]::new()
    $launcherProcess.StartInfo=$launcherInfo
    [void]$launcherProcess.Start()
    $readStdout=$launcherProcess.StandardOutput.ReadToEndAsync()
    $readStderr=$launcherProcess.StandardError.ReadToEndAsync()
    # Wait for the launcher itself. The detached theme helper must keep running.
    $launcherProcess.WaitForExit()
    $launcherExit=$launcherProcess.ExitCode
    $launcherOutput=$readStdout.GetAwaiter().GetResult()+$readStderr.GetAwaiter().GetResult()
    [IO.File]::WriteAllText($log,$launcherOutput,[Text.UTF8Encoding]::new($false))
    if($launcherExit -ne 0){throw "主题启动失败，请查看日志：$log"}
    if(-not $Silent){Get-Content -LiteralPath $log -Raw -Encoding UTF8 | Write-Output}
} catch {
    $_ | Out-File -LiteralPath $log -Append -Encoding utf8
    if($Silent){
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'WorkBuddy 可露希尔主题') | Out-Null
    }else{[Console]::Error.WriteLine($_.Exception.Message)}
    exit 1
} finally {
    $env:ELECTRON_RUN_AS_NODE=$originalElectronMode
    if($launcherProcess){$launcherProcess.Dispose()}
}
