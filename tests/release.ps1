param(
    [string] $PackagePath = (Join-Path $PSScriptRoot '../dist/v0.6.0/Closure-Codex-v0.6.0-win-x64.zip'),
    [string] $TestedPackageRoot
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = ([IO.File]::ReadAllText((Join-Path $projectRoot 'outputs/closure-companion/package.json')) | ConvertFrom-Json).version
if ($version -ne '0.6.0') { throw 'Unexpected release version.' }
$sumPath = Join-Path (Split-Path $PackagePath) 'SHA256SUMS.txt'
$expected = (Get-Content -LiteralPath $sumPath -Raw).Split(' ')[0].Trim()
if ((Get-FileHash -LiteralPath $PackagePath).Hash -ne $expected) { throw 'Package checksum mismatch.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $PackagePath).Path)
$prefix = 'Closure-Codex-v' + $version + '-win-x64/'
$runtimePrefix = $prefix + 'work/companion-runtime/electron/'
$shippedTools = @('tools/Enable-Codex-Theme.cmd','tools/Restore-Codex-Appearance.cmd')
$required = @('Install.cmd','Uninstall.cmd','Enable-Codex-Theme.vbs','Restore-Codex-Appearance.vbs',
    'tools/Enable-Codex-Theme.cmd','tools/Restore-Codex-Appearance.cmd',
    'README.md','CHANGELOG.md','README-macOS.md','CHANGELOG-macOS.md','Setup.ps1','outputs/Start-Closure.cmd','outputs/closure-companion/main.cjs','outputs/closure-companion/runtime-settings.cjs',
    'outputs/closure-decoration/Theme.ps1','outputs/closure-decoration/theme-launcher.cjs','outputs/closure-decoration/attach.cjs',
    'outputs/closure-decoration/palette.cjs','outputs/closure-decoration/renderer-payload.cjs','outputs/closure-decoration/README.md','outputs/closure-theme/closure-dark.txt')
$obsolete = '(?i)(?:/closure-crt/|/tests/|/production/|/companion-profile/|closure-light\.txt$|Copy-(?:Light|Dark)-Theme\.cmd$|launch-with-activity\.cmd$|(?:Start|Stop)-Decorated\.cmd$|Restart-Current\.ps1$|/closure-decoration/(?:launch\.cjs|Launch\.ps1|[Pp]review[^/]*)|/closure-companion/mac-(?:runtime\.cjs|theme\.cjs|window-tracker(?:\.swift)?)$)'
$verified = 0
$testedPayloadFiles = 0
try {
    foreach ($file in $required) { if (!$archive.GetEntry($prefix + $file)) { throw ('Required release file missing: ' + $file) } }
    foreach ($entry in $archive.Entries) {
        if (!$entry.FullName.StartsWith($prefix) -or $entry.FullName.Contains('..') -or $entry.FullName -match $obsolete) { throw ('Unexpected package path: ' + $entry.FullName) }
        if ($entry.FullName.EndsWith('/')) { continue }
        $relative = $entry.FullName.Substring($prefix.Length)
        if (($relative.StartsWith('tools/') -and $relative -notin $shippedTools) -or $relative -in @('Enable-Codex-Theme.cmd','Restore-Codex-Appearance.cmd')) {
            throw ('Unexpected debug entry location: ' + $relative)
        }
        $source = Join-Path $projectRoot $relative
        if (!(Test-Path -LiteralPath $source -PathType Leaf)) { throw ('Package source missing: ' + $relative) }
        $sha = [Security.Cryptography.SHA256]::Create()
        $stream = $entry.Open()
        try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') }
        finally { $stream.Dispose(); $sha.Dispose() }
        if ($hash -ne (Get-FileHash -LiteralPath $source).Hash) { throw ('Package is out of date: ' + $relative) }
        if ($TestedPackageRoot -and $relative -notin @('README.md','CHANGELOG.md','README-macOS.md','CHANGELOG-macOS.md')) {
            $tested = Join-Path $TestedPackageRoot $relative
            if (!(Test-Path -LiteralPath $tested -PathType Leaf) -or $hash -ne (Get-FileHash -LiteralPath $tested).Hash) {
                throw ('Final program or asset differs from the tested package: ' + $relative)
            }
            $testedPayloadFiles++
        }
        if ($relative.StartsWith('work/') -and !$entry.FullName.StartsWith($runtimePrefix)) { throw ('Personal or test data in package: ' + $relative) }
        $verified++
    }
    $readme = [IO.File]::ReadAllText((Join-Path $projectRoot 'README.md'))
    $log = [IO.File]::ReadAllText((Join-Path $projectRoot 'CHANGELOG.md'))
    if (!$readme.Contains('v0.6.0') -or $readme.Contains('v0.5.0') -or !$log.Contains('## v0.6.0')) { throw 'Release documentation version mismatch.' }
    $result = [ordered]@{passed=$true;version=$version;package=(Resolve-Path -LiteralPath $PackagePath).Path;verifiedFiles=$verified;sha256=$expected.ToLowerInvariant();obsoleteEntries=0;personalDataEntries=0}
    if ($TestedPackageRoot) { $result.testedPayloadFiles=$testedPayloadFiles; $result.testedPackageRoot=(Resolve-Path -LiteralPath $TestedPackageRoot).Path }
    $output = Join-Path $projectRoot 'work/release-0.6.0'
    [void](New-Item -ItemType Directory -Path $output -Force)
    [IO.File]::WriteAllText((Join-Path $output 'package-verification.json'),($result | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    $result | ConvertTo-Json
} finally { $archive.Dispose() }
