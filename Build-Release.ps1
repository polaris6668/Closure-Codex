param(
    [string] $Version = '0.6.0',
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
    foreach ($file in 'Install.cmd','Uninstall.cmd','Enable-Codex-Theme.vbs','Restore-Codex-Appearance.vbs','Setup.ps1','README.md','CHANGELOG.md','README-macOS.md','CHANGELOG-macOS.md') {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $packagePath
    }
    $debugTools = New-Item -ItemType Directory -Path (Join-Path $packagePath 'tools')
    foreach ($file in 'Enable-Codex-Theme.cmd','Restore-Codex-Appearance.cmd') {
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
