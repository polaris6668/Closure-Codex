param([string] $Destination)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$pluginRoot = Join-Path $projectRoot 'plugins\dsh-closure-codex-theme'
$metadata = Get-Content -Raw -LiteralPath (Join-Path $pluginRoot 'package.json') | ConvertFrom-Json
if (-not $Destination) { $Destination = Join-Path $projectRoot "dist\dsh-theme\v$($metadata.version)" }
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
Push-Location $pluginRoot
try {
    $npm = if ($env:OS -eq 'Windows_NT') { 'npm.cmd' } else { 'npm' }
    & $npm pack --pack-destination $destinationPath
    if ($LASTEXITCODE -ne 0) { throw 'npm pack failed.' }
} finally { Pop-Location }
$archiveName = "$($metadata.name)-$($metadata.version).tgz"
$archive = Join-Path $destinationPath $archiveName
Copy-Item -LiteralPath (Join-Path $pluginRoot 'README.md') -Destination (Join-Path $destinationPath '安装说明.md') -Force
$preview = Join-Path $projectRoot 'work\dsh-theme\verification\desktop-1400x900.png'
if (Test-Path -LiteralPath $preview) { Copy-Item -LiteralPath $preview -Destination (Join-Path $destinationPath 'preview.png') -Force }
$report = Join-Path $projectRoot 'work\dsh-theme\verification\report.json'
if (Test-Path -LiteralPath $report) { Copy-Item -LiteralPath $report -Destination (Join-Path $destinationPath 'verification.json') -Force }
$sum = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $destinationPath 'SHA256SUMS.txt') -Encoding ascii -Value "$sum  $archiveName"
$files = @($archive, (Join-Path $destinationPath '安装说明.md'), (Join-Path $destinationPath 'SHA256SUMS.txt'))
foreach ($name in @('preview.png', 'verification.json')) {
    $file = Join-Path $destinationPath $name
    if (Test-Path -LiteralPath $file) { $files += $file }
}
$zip = Join-Path $destinationPath "Closure-Codex-Theme-DSH-v$($metadata.version).zip"
Compress-Archive -LiteralPath $files -DestinationPath $zip -Force
Write-Output "Plugin: $archive"
Write-Output "Bundle: $zip"
