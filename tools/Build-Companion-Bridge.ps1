param([string] $Destination)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$plugin = Join-Path $root 'plugins/dsh-closure-companion-bridge'
$metadata = Get-Content -LiteralPath (Join-Path $plugin 'package.json') -Raw | ConvertFrom-Json
if (!$Destination) { $Destination = Join-Path $root "dist/companion-bridge/v$($metadata.version)" }
$target = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $target -Force | Out-Null
Push-Location $plugin
try {
    $npm = if ($env:OS -eq 'Windows_NT') { 'npm.cmd' } else { 'npm' }
    & $npm pack --pack-destination $target
    if ($LASTEXITCODE -ne 0) { throw 'DSH companion bridge packaging failed.' }
} finally { Pop-Location }
$archiveName = "$($metadata.name)-$($metadata.version).tgz"
$archive = Join-Path $target $archiveName
Copy-Item -LiteralPath (Join-Path $plugin 'README.md') -Destination (Join-Path $target 'README.md') -Force
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $target 'SHA256SUMS.txt') -Value "$hash  $archiveName" -Encoding Ascii
Write-Output "DSH companion plugin: $archive"
