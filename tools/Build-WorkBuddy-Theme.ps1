param([string]$Destination,[string]$NodeArchive)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$themeSource=Join-Path $projectRoot 'plugins\workbuddy-closure-codex-theme'
$package=Get-Content -LiteralPath (Join-Path $themeSource 'package.json') -Raw | ConvertFrom-Json
if(-not $Destination){$Destination=Join-Path $projectRoot "dist\workbuddy-theme\v$($package.version)"}
if(-not $NodeArchive){$NodeArchive=Join-Path $env:LOCALAPPDATA 'Programs\WorkBuddy\resources\vendor\node.zip'}
if(-not(Test-Path -LiteralPath $NodeArchive -PathType Leaf)){throw '请通过 -NodeArchive 指定包含 node.exe 与 LICENSE 的官方 Node.js Windows ZIP。'}
$verificationRoot=Join-Path $projectRoot 'work\workbuddy-theme\verification'
$verification=Get-Content -LiteralPath (Join-Path $verificationRoot 'report.json') -Raw | ConvertFrom-Json
if(-not $verification.passed -or $verification.version -ne $package.version){throw '请先运行当前版本的后台集成测试。'}
& node (Join-Path $themeSource 'tools\build.mjs')
if($LASTEXITCODE -ne 0){throw 'Theme build failed'}
$build=Get-Content -LiteralPath (Join-Path $themeSource 'lib\build.json') -Raw | ConvertFrom-Json
if($verification.themeRevision -ne $build.revision){throw '构建与验证报告不一致，请重新运行后台集成测试。'}
$destinationPath=[IO.Path]::GetFullPath($Destination)
$bundleName="Closure-Codex-Theme-WorkBuddy-v$($package.version)-win-x64"
$bundleRoot=Join-Path $destinationPath $bundleName
New-Item -ItemType Directory -Path $bundleRoot -Force | Out-Null
foreach($name in @('package.json','README.md','LICENSE','Theme.ps1','Enable-Theme.vbs','Restore-Theme.vbs','lib','src','tools')){
    Copy-Item -LiteralPath (Join-Path $themeSource $name) -Destination $bundleRoot -Recurse -Force
}
$runtimeRoot=Join-Path $bundleRoot 'runtime'
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($NodeArchive))
try{
    $nodeEntry=@($archive.Entries | Where-Object {$_.FullName -match '^node-v[0-9.]+-win-x64/node.exe$'})
    if($nodeEntry.Count -ne 1){throw 'Node ZIP 必须包含一个官方 Windows x64 node.exe。'}
    $licenseName=($nodeEntry[0].FullName -replace 'node.exe$','LICENSE')
    $licenseEntry=$archive.GetEntry($licenseName)
    if(-not $licenseEntry){throw 'Node ZIP 缺少对应 LICENSE。'}
    [IO.Compression.ZipFileExtensions]::ExtractToFile($nodeEntry[0],(Join-Path $runtimeRoot 'node.exe'),$true)
    [IO.Compression.ZipFileExtensions]::ExtractToFile($licenseEntry,(Join-Path $runtimeRoot 'LICENSE'),$true)
}finally{$archive.Dispose()}
$nodeVersion=& (Join-Path $runtimeRoot 'node.exe') --version
if($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(2[2-9]|[3-9][0-9])\.') {throw 'Node runtime must be version 22 or newer.'}
Copy-Item -LiteralPath (Join-Path $verificationRoot 'desktop-1400x900.png') -Destination (Join-Path $bundleRoot 'preview.png') -Force
Copy-Item -LiteralPath (Join-Path $verificationRoot 'report.json') -Destination (Join-Path $bundleRoot 'verification.json') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\WORKBUDDY-THEME.md') -Destination (Join-Path $bundleRoot 'DEVELOPMENT.md') -Force
$zip=Join-Path $destinationPath "$bundleName.zip"
Compress-Archive -LiteralPath $bundleRoot -DestinationPath $zip -Force
$hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $destinationPath 'SHA256SUMS.txt') -Encoding ascii -Value "$hash  $bundleName.zip"
Write-Output "Bundle: $zip"
Write-Output "Runtime: $nodeVersion"
Write-Output "SHA256: $hash"
