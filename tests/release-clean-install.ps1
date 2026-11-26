param(
    [string] $PackagePath,
    [string] $OutputDirectory = (Join-Path $PSScriptRoot '../work/release-clean-install')
)
$ErrorActionPreference = 'Stop'
$version = ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '../outputs/closure-companion/package.json')) | ConvertFrom-Json).version
if (!$PackagePath) { $PackagePath = Join-Path $PSScriptRoot "../dist/v$version/Closure-Codex-v$version-win-x64.zip" }
$output = (New-Item -ItemType Directory -Path $OutputDirectory -Force).FullName
$runRoot = (New-Item -ItemType Directory -Path (Join-Path $output ('全新安装 & 空格-' + [guid]::NewGuid().ToString('N')))).FullName
$extract = (New-Item -ItemType Directory -Path (Join-Path $runRoot 'extracted')).FullName
$startup = (New-Item -ItemType Directory -Path (Join-Path $runRoot 'startup')).FullName
$report = [ordered]@{ passed=$false; version=$version; scope='Same Windows host, isolated extraction and empty profiles; private Startup folder; external Node excluded from PATH'; installScope='Setup.ps1 with private StartupFolder and SkipStart; actual Windows login was not exercised'; os=[Environment]::OSVersion.VersionString; runRoot=$runRoot; checks=@() }
$original = @{}
foreach ($name in 'PATH','ELECTRON_RUN_AS_NODE','CLOSURE_STATE_DIR','CLOSURE_BUBBLE_PNG','CODEX_HOME','LOCALAPPDATA','CLOSURE_TEST_PACKAGE_ROOT','CLOSURE_TEST_OUTPUT','CLOSURE_WORKBUDDY_EXE','CLOSURE_WB_RENDERER') {
    $original[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$realStartup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Closure Codex Lifecycle.lnk'
$startupHash = if (Test-Path -LiteralPath $realStartup) { (Get-FileHash -LiteralPath $realStartup).Hash } else { $null }
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
function Assert-Check($condition, [string] $label) {
    if (!$condition) { throw $label }
    $script:report.checks += $label
}
function Run-Child([string] $label, [string] $executable, [string] $arguments, [int] $timeout = 30000) {
    $stdout = Join-Path $runRoot ($label + '.stdout.log')
    $stderr = Join-Path $runRoot ($label + '.stderr.log')
    $process = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $runRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    if (!$process.WaitForExit($timeout)) { $process.Kill(); throw ($label + ' timed out; see ' + $stderr) }
    if ($process.ExitCode -ne 0) { throw ($label + ' failed: ' + [IO.File]::ReadAllText($stderr)) }
    $script:report.checks += $label
    return [IO.File]::ReadAllText($stdout)
}
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $resolvedZip = (Resolve-Path -LiteralPath $PackagePath).Path
    $report.package = $resolvedZip
    $report.sha256 = (Get-FileHash -LiteralPath $resolvedZip).Hash.ToLowerInvariant()
    [IO.Compression.ZipFile]::ExtractToDirectory($resolvedZip, $extract)
    $package = Join-Path $extract "Closure-Codex-v$version-win-x64"
    $runtime = Join-Path $package 'work/companion-runtime/electron/electron.exe'
    $profile = Join-Path $package 'work/companion-profile'
    Assert-Check (!(Test-Path -LiteralPath $profile)) 'archive has no preexisting pet profile'
    Assert-Check (Test-Path -LiteralPath $runtime -PathType Leaf) 'archive supplies its Electron runtime'
    $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0;$env:SystemRoot\System32\Wbem"
    $env:CODEX_HOME = (New-Item -ItemType Directory -Path (Join-Path $runRoot 'empty-codex-home')).FullName
    $env:LOCALAPPDATA = (New-Item -ItemType Directory -Path (Join-Path $runRoot 'local-app-data')).FullName
    Assert-Check (!(Get-Command node.exe -ErrorAction SilentlyContinue)) 'external Node is unavailable in test PATH'
    $setup = Join-Path $package 'Setup.ps1'
    $configure = Join-Path $package 'outputs/closure-autostart/Configure.ps1'
    $watcher = Join-Path $package 'outputs/closure-autostart/Watch-Codex.ps1'
    $common = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '
    $null = Run-Child 'fresh-install-registration' $powershell ($common + '"' + $setup + '" -StartupFolder "' + $startup + '" -SkipStart')
    $linkPath = Join-Path $startup 'Closure Codex Lifecycle.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($linkPath)
    Assert-Check ((Test-Path -LiteralPath $linkPath) -and $link.TargetPath -eq $powershell -and $link.Arguments.Contains('"' + $watcher + '"') -and $link.WorkingDirectory -eq (Split-Path $watcher)) 'real Startup shortcut targets the extracted package'
    $probe = Join-Path $runRoot 'probe.cjs'
    $modulePath = ConvertTo-Json (Join-Path $package 'outputs/closure-companion/runtime-settings.cjs') -Compress
    $profileJson = ConvertTo-Json $profile -Compress
    [IO.File]::WriteAllText($probe, @"
const assert=require('node:assert/strict');const{readRuntimeSettings}=require($modulePath);
readRuntimeSettings($profileJson).then(s=>{assert.deepEqual(s,{codexLinked:false,dshLinked:false,workbuddyLinked:false,showOutsideCodex:true,startAtLogin:true});console.log(JSON.stringify({electron:process.versions.electron,node:process.versions.node,defaults:s}))}).catch(e=>{console.error(e);process.exitCode=1})
"@, [Text.UTF8Encoding]::new($false))
    $env:ELECTRON_RUN_AS_NODE = '1'
    $report.runtime = (Run-Child 'bundled-runtime-and-fresh-defaults' $runtime ('"' + $probe + '"')) | ConvertFrom-Json
    $env:ELECTRON_RUN_AS_NODE = $null
    Assert-Check ((Test-Path -LiteralPath (Join-Path $package 'Start-WorkBuddy-Companion.vbs')) -and
        (Test-Path -LiteralPath (Join-Path $package 'tools/Start-WorkBuddy-Companion.ps1')) -and
        (Test-Path -LiteralPath (Join-Path $package 'outputs/closure-companion/workbuddy-launch.cjs'))) 'WorkBuddy companion entry and bundled launcher are present'
    Assert-Check (@(Get-ChildItem -LiteralPath (Join-Path $package 'plugins/dsh-companion') -Filter 'dsh-closure-companion-bridge-*.tgz').Count -eq 1) 'release includes the installable DSH companion plugin'
    $env:CLOSURE_STATE_DIR = $profile
    $env:CLOSURE_BUBBLE_PNG = Join-Path $runRoot 'packaged-webgl.png'
    $webgl = Run-Child 'packaged-webgl-interaction-and-settings' $runtime ('"' + (Join-Path $package 'outputs/closure-companion') + '" --smoke --mute-audio')
    Assert-Check ($webgl.Contains('"bubbleAppearance"') -and $webgl.Contains('"persisted":true') -and $webgl.Contains('"rightClickExit":true')) 'new bubble controls persist and right-click quit completes'
    $env:CLOSURE_STATE_DIR = Join-Path $runRoot 'fresh-canvas-profile'
    $env:CLOSURE_BUBBLE_PNG = Join-Path $runRoot 'packaged-canvas.png'
    $null = Run-Child 'packaged-canvas-fallback' $runtime ('"' + (Join-Path $package 'outputs/closure-companion') + '" --smoke --canvas --mute-audio')
    $env:CLOSURE_STATE_DIR = $null
    $workbuddyExe = Join-Path $runRoot 'fixture WorkBuddy.exe'
    [IO.File]::WriteAllText($workbuddyExe, 'Inspect-only executable fixture; never launched.')
    $env:CLOSURE_WORKBUDDY_EXE = $workbuddyExe
    $workbuddyTheme = Join-Path $package 'plugins/workbuddy-closure-codex-theme/Theme.ps1'
    $null = Run-Child 'workbuddy-theme-bundled-runtime-inspect' $powershell ($common + '"' + $workbuddyTheme + '" -Mode inspect')
    $workbuddyInspection = Get-Content -LiteralPath (Join-Path $env:LOCALAPPDATA 'ClosureWorkBuddyTheme/launcher.log') -Raw | ConvertFrom-Json
    Assert-Check ($workbuddyInspection.ok -and !$workbuddyInspection.target -and !$workbuddyInspection.theme) 'WorkBuddy theme runs with bundled Electron and no external Node or app startup'
    $null = Run-Child 'workbuddy-fresh-restore-vbs' (Join-Path $env:SystemRoot 'System32/cscript.exe') ('//B //Nologo "' + (Join-Path $package 'Restore-WorkBuddy-Appearance.vbs') + '"')
    # Exercise the real VBS -> PowerShell -> bundled Electron entry without launching an app.
    $companionFixture = (New-Item -ItemType Directory -Path (Join-Path $runRoot 'WorkBuddy 入口 & fixture')).FullName
    foreach ($directory in 'tools','outputs/closure-companion','outputs/closure-autostart','work/companion-runtime') {
        New-Item -ItemType Directory -Path (Join-Path $companionFixture $directory) -Force | Out-Null
    }
    Copy-Item -LiteralPath (Join-Path $package 'Start-WorkBuddy-Companion.vbs') -Destination $companionFixture
    Copy-Item -LiteralPath (Join-Path $package 'tools/Start-WorkBuddy-Companion.ps1') -Destination (Join-Path $companionFixture 'tools')
    New-Item -ItemType Junction -Path (Join-Path $companionFixture 'work/companion-runtime/electron') -Target (Split-Path $runtime) | Out-Null
    [IO.File]::WriteAllText((Join-Path $companionFixture 'outputs/closure-companion/workbuddy-launch.cjs'), 'if(process.env.ELECTRON_RUN_AS_NODE!=="1")process.exit(2);console.log(JSON.stringify({ok:true,message:"联动就绪"}));', [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $companionFixture 'outputs/closure-autostart/Watch-Codex.ps1'), 'param([switch]$Refresh); if(!$Refresh){throw "Expected refresh"}; [IO.File]::WriteAllText((Join-Path $PSScriptRoot "entry-passed.txt"), "passed")', [Text.UTF8Encoding]::new($true))
    $null = Run-Child 'workbuddy-companion-vbs-bundled-runtime' (Join-Path $env:SystemRoot 'System32/cscript.exe') ('//B //Nologo "' + (Join-Path $companionFixture 'Start-WorkBuddy-Companion.vbs') + '"')
    Assert-Check (Test-Path -LiteralPath (Join-Path $companionFixture 'outputs/closure-autostart/entry-passed.txt')) 'WorkBuddy companion entry waits for success then refreshes the watcher without a console'
    $theme = Join-Path $package 'outputs/closure-decoration/Theme.ps1'
    $themeRoot = Join-Path $runRoot 'fresh-theme-state'
    $null = Run-Child 'theme-powershell-without-node' $powershell ($common + '"' + $theme + '" -Mode status -StateRoot "' + $themeRoot + '" -NoShortcuts')
    $request = Get-ChildItem -LiteralPath $themeRoot -Filter 'request-*.json' | Select-Object -First 1
    Assert-Check (($request | Get-Content -Raw | ConvertFrom-Json).ok) 'theme entry uses the bundled runtime successfully'
    $null = Run-Child 'fresh-theme-restore-vbs' (Join-Path $env:SystemRoot 'System32/cscript.exe') ('//B //Nologo "' + (Join-Path $package 'Restore-Codex-Appearance.vbs') + '"')
    $null = Run-Child 'upgrade-preserves-disabled-startup' $powershell ($common + '"' + $setup + '" -StartupFolder "' + $startup + '" -SkipStart')
    Assert-Check (!(Test-Path -LiteralPath $linkPath)) 'upgrade preserves the saved disabled startup choice'
    $null = Run-Child 'enable-startup-registration' $powershell ($common + '"' + $configure + '" -StartupFolder "' + $startup + '" -RegistrationOnly')
    Assert-Check (Test-Path -LiteralPath $linkPath) 'startup can be enabled again'
    $null = Run-Child 'uninstall-registration' $powershell ($common + '"' + $setup + '" -StartupFolder "' + $startup + '" -Uninstall -SkipStart')
    Assert-Check (!(Test-Path -LiteralPath $linkPath)) 'uninstall removes the test Startup link'
    Assert-Check (Test-Path -LiteralPath (Join-Path $profile 'runtime-settings.json')) 'uninstall retains saved pet settings'
    $env:CLOSURE_TEST_PACKAGE_ROOT = $package
    $env:CLOSURE_TEST_OUTPUT = Join-Path $runRoot 'packaged-assets'
    $null = Run-Child 'packaged-all-voices-font-and-texture' $runtime ('"' + (Join-Path $PSScriptRoot 'assets-integration.cjs') + '" --mute-audio')
    $env:CLOSURE_WB_RENDERER = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../work/workbuddy-theme/host/renderer/index.html'))
    Assert-Check (Test-Path -LiteralPath $env:CLOSURE_WB_RENDERER) 'isolated installed WorkBuddy renderer is available'
    $env:CLOSURE_TEST_OUTPUT = Join-Path $runRoot 'packaged-workbuddy-theme'
    $null = Run-Child 'packaged-workbuddy-theme-lifecycle' $runtime ('"' + (Join-Path $PSScriptRoot 'workbuddy-theme-integration.cjs') + '" --mute-audio') 60000
    $env:CLOSURE_TEST_OUTPUT = Join-Path $runRoot 'packaged-workbuddy-companion'
    $null = Run-Child 'packaged-workbuddy-companion-sdk' $runtime ('"' + (Join-Path $PSScriptRoot 'workbuddy-companion-integration.cjs') + '" --mute-audio')
    $env:CLOSURE_TEST_OUTPUT = Join-Path $runRoot 'packaged-decoration'
    $null = Run-Child 'packaged-page-decoration' $runtime ('"' + (Join-Path $PSScriptRoot 'decoration-cdp.cjs') + '" --mute-audio')
    $env:CLOSURE_TEST_OUTPUT = Join-Path $runRoot 'packaged-official-theme'
    $env:ELECTRON_RUN_AS_NODE = '1'
    $null = Run-Child 'packaged-official-theme-lifecycle' $runtime ('"' + (Join-Path $PSScriptRoot 'theme-entry-official.cjs') + '"') 180000
    $afterHash = if (Test-Path -LiteralPath $realStartup) { (Get-FileHash -LiteralPath $realStartup).Hash } else { $null }
    Assert-Check ($afterHash -eq $startupHash) 'the current user Startup link is unchanged'
    $report.passed = $true
} catch {
    $report.error = $_.Exception.Message
    throw
} finally {
    # Clean up only helpers whose command line refers to this unique test directory.
    Get-CimInstance Win32_Process | Where-Object {
        $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($runRoot) -and
        $_.Name -in @('powershell.exe','cscript.exe','electron.exe')
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    foreach ($name in $original.Keys) { [Environment]::SetEnvironmentVariable($name, $original[$name], 'Process') }
    $report.completedAt = [DateTimeOffset]::Now.ToString('o')
    $json = $report | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText((Join-Path $output 'report.json'), $json, [Text.UTF8Encoding]::new($false))
    $json
}
