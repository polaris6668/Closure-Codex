param(
    [string] $Version = '0.8.0',
    [string] $ElectronZip = (Join-Path $PSScriptRoot 'work/companion-runtime/electron-mirror.zip'),
    [string] $ElectronDirectory = (Join-Path $PSScriptRoot 'work/companion-runtime/electron'),
    [string] $Destination = (Join-Path $PSScriptRoot 'dist')
)

$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Expected a numeric version such as 0.2.0.' }
$declared = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'outputs/closure-companion/package.json')) | ConvertFrom-Json
if ($declared.version -ne $Version) { throw 'Release version must match outputs/closure-companion/package.json.' }
$manifest = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'tools/electron-v45.4.1-win32-x64.json')) | ConvertFrom-Json
$useZip = Test-Path -LiteralPath $ElectronZip -PathType Leaf
$runtimeFiles = @()
if ($useZip) {
    if ((Get-FileHash -LiteralPath $ElectronZip).Hash -ne $manifest.archiveSha256) { throw 'The official Electron archive checksum does not match.' }
} else {
    if (!(Test-Path -LiteralPath $ElectronDirectory -PathType Container)) { throw 'Supply the official Electron 45.4.1 archive or a verified runtime directory.' }
    $runtimeDirectoryPath = (Resolve-Path -LiteralPath $ElectronDirectory).Path.TrimEnd('\')
    foreach ($entry in $manifest.files.PSObject.Properties) {
        $source = [IO.Path]::GetFullPath((Join-Path $runtimeDirectoryPath $entry.Name))
        if (!$source.StartsWith($runtimeDirectoryPath + '\', [StringComparison]::OrdinalIgnoreCase) -or
            !(Test-Path -LiteralPath $source -PathType Leaf) -or (Get-FileHash -LiteralPath $source).Hash -ne $entry.Value) {
            throw ('Electron runtime validation failed: ' + $entry.Name)
        }
        $runtimeFiles += [pscustomobject]@{ Relative=$entry.Name; Source=$source }
    }
    if ($runtimeFiles.Count -ne 73) { throw 'Incomplete Electron runtime manifest.' }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$destinationPath = (New-Item -ItemType Directory -Path $Destination -Force).FullName
$name = "Closure-Codex-v$Version-win-x64"
$staging = Join-Path $destinationPath ($name + '-' + [Guid]::NewGuid().ToString('N'))
$package = New-Item -ItemType Directory -Path (Join-Path $staging $name)
$packagePath = $package.FullName
try {
    foreach ($file in 'Install.cmd','Uninstall.cmd','Enable-Codex-Theme.vbs','Restore-Codex-Appearance.vbs','Enable-WorkBuddy-Theme.vbs','Restore-WorkBuddy-Appearance.vbs','Start-WorkBuddy-Companion.vbs','Setup.ps1','README.md','CHANGELOG.md','README-macOS.md','CHANGELOG-macOS.md') {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $packagePath
    }
    $guides = New-Item -ItemType Directory -Path (Join-Path $packagePath 'docs')
    foreach ($guide in 'USAGE.md','COMPANION-INTEGRATIONS.md','DSH-THEME.md','WORKBUDDY-THEME.md') {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot "docs/$guide") -Destination $guides.FullName
    }
    $bridgeMetadata = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'plugins/dsh-closure-companion-bridge/package.json') -Raw | ConvertFrom-Json
    $bridgeBuilt = Join-Path $PSScriptRoot "dist/companion-bridge/v$($bridgeMetadata.version)"
    & (Join-Path $PSScriptRoot 'tools/Build-Companion-Bridge.ps1') -Destination $bridgeBuilt
    $bridgeOutput = Join-Path $packagePath 'plugins/dsh-companion'
    New-Item -ItemType Directory -Path $bridgeOutput -Force | Out-Null
    foreach ($file in "$($bridgeMetadata.name)-$($bridgeMetadata.version).tgz",'README.md','SHA256SUMS.txt') {
        Copy-Item -LiteralPath (Join-Path $bridgeBuilt $file) -Destination $bridgeOutput
    }
    $themeMetadata = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'plugins/dsh-closure-codex-theme/package.json') -Raw | ConvertFrom-Json
    $themeBuilt = Join-Path $PSScriptRoot "dist/dsh-theme/v$($themeMetadata.version)"
    & (Join-Path $PSScriptRoot 'tools/Build-Dsh-Theme.ps1') -Destination $themeBuilt
    $themeOutput = Join-Path $packagePath 'plugins/dsh-theme'
    New-Item -ItemType Directory -Path $themeOutput -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $themeBuilt "$($themeMetadata.name)-$($themeMetadata.version).tgz") -Destination $themeOutput
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'plugins/dsh-closure-codex-theme/README.md') -Destination $themeOutput
    $workbuddySource = Join-Path $PSScriptRoot 'plugins/workbuddy-closure-codex-theme'
    & node (Join-Path $workbuddySource 'tools/build.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'WorkBuddy theme build failed.' }
    $workbuddyOutput = Join-Path $packagePath 'plugins/workbuddy-closure-codex-theme'
    New-Item -ItemType Directory -Path $workbuddyOutput -Force | Out-Null
    foreach ($file in 'package.json','README.md','LICENSE','Theme.ps1','Enable-Theme.vbs','Restore-Theme.vbs','lib','src','tools') {
        Copy-Item -LiteralPath (Join-Path $workbuddySource $file) -Destination $workbuddyOutput -Recurse
    }
    $debugTools = New-Item -ItemType Directory -Path (Join-Path $packagePath 'tools')
    foreach ($file in 'Enable-Codex-Theme.cmd','Restore-Codex-Appearance.cmd','Start-WorkBuddy-Companion.ps1') {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot "tools/$file") -Destination $debugTools.FullName
    }
    $outputPath = New-Item -ItemType Directory -Path (Join-Path $packagePath 'outputs')
    foreach ($component in 'closure-autostart','closure-pet','closure-theme','closure-decoration') {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot "outputs/$component") -Destination $outputPath.FullName -Recurse
    }
    $companion = New-Item -ItemType Directory -Path (Join-Path $outputPath.FullName 'closure-companion')
    $macOnly = @('mac-runtime.cjs','mac-theme.cjs','mac-window-tracker.swift','mac-window-tracker')
    foreach ($item in Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'outputs/closure-companion')) {
        if ($item.Name -notin $macOnly) {
            Copy-Item -LiteralPath $item.FullName -Destination $companion.FullName -Recurse
        }
    }
    foreach ($file in 'Start-Closure.cmd',([string][char]0x4F7F + [char]0x7528 + [char]0x8BF4 + [char]0x660E + '.txt')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot "outputs/$file") -Destination $outputPath.FullName
    }
    $runtimePath = New-Item -ItemType Directory -Path (Join-Path $packagePath 'work/companion-runtime/electron') -Force
    if ($useZip) {
        [IO.Compression.ZipFile]::ExtractToDirectory((Resolve-Path -LiteralPath $ElectronZip).Path, $runtimePath.FullName)
    } else {
        foreach ($file in $runtimeFiles) {
            $target = Join-Path $runtimePath.FullName $file.Relative
            [void](New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force)
            Copy-Item -LiteralPath $file.Source -Destination $target
        }
    }

    $zip = Join-Path $destinationPath "$name.zip"
    $temporaryZip = Join-Path $staging "$name.zip"
    [IO.Compression.ZipFile]::CreateFromDirectory($packagePath, $temporaryZip, [IO.Compression.CompressionLevel]::Optimal, $true)
    Move-Item -LiteralPath $temporaryZip -Destination $zip -Force
    $hash = (Get-FileHash -LiteralPath $zip).Hash.ToLowerInvariant()
    Set-Content -LiteralPath (Join-Path $destinationPath 'SHA256SUMS.txt') -Value "$hash *$name.zip" -Encoding Ascii
    Get-Item -LiteralPath $zip
} finally {
    $resolved = (Resolve-Path -LiteralPath $staging).Path
    if ([IO.Path]::GetDirectoryName($resolved) -eq $destinationPath -and [IO.Path]::GetFileName($resolved).StartsWith("$name-")) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
