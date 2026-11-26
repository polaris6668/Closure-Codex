param([switch] $Stop, [switch] $Probe, [switch] $NoActivity, [switch] $Refresh)

$ErrorActionPreference = 'Stop'
$mutexName = 'Local\ClosureCodexLifecycle.v1'
$stopName = 'Local\ClosureCodexLifecycle.Stop.v1'
$refreshName = 'Local\ClosureCodexLifecycle.Refresh.v1'
if ($Refresh) {
    $refreshSignal = $null
    try { $refreshSignal = [Threading.EventWaitHandle]::OpenExisting($refreshName) }
    catch [Threading.WaitHandleCannotBeOpenedException] { }
    if ($refreshSignal) {
        try { [void]$refreshSignal.Set() } finally { $refreshSignal.Dispose() }
        return
    }
}
if ($Stop) {
    try { $signal = [Threading.EventWaitHandle]::OpenExisting($stopName) }
    catch [Threading.WaitHandleCannotBeOpenedException] { return }
    try { [void]$signal.Set() } finally { $signal.Dispose() }
    return
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class ClosureLifecycleWindows {
    private delegate bool VisitWindow(IntPtr window, IntPtr ignored);
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] private static extern bool EnumWindows(VisitWindow visit, IntPtr ignored);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint relation);
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect bounds);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder result, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder result, int count);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr first, IntPtr second);
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint thread, uint message, IntPtr first, IntPtr second);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CommandLineToArgvW(string line, out int count);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);

    public static int[] OpenWindowProcesses() {
        var processes = new HashSet<int>();
        EnumWindows((window, unused) => {
            if (!IsWindowVisible(window) || GetWindow(window, 4) != IntPtr.Zero || (GetWindowLong(window, -20) & 0x80) != 0) return true;
            var kind = new StringBuilder(48);
            GetClassName(window, kind, kind.Capacity);
            if (kind.ToString() != "Chrome_WidgetWin_1") return true;
            Rect bounds;
            if (!IsIconic(window) && (!GetWindowRect(window, out bounds) || bounds.Right == bounds.Left || bounds.Bottom == bounds.Top)) return true;
            int pid;
            GetWindowThreadProcessId(window, out pid);
            if (pid != 0) processes.Add(pid);
            return true;
        }, IntPtr.Zero);
        var ids = new int[processes.Count];
        processes.CopyTo(ids);
        return ids;
    }

    public static bool CloseHelper(int processId, bool crt) {
        bool sent = false;
        string expected = crt ? "Closure CRT Overlay" : "\u53ef\u9732\u5e0c\u5c14 \u00b7 Codex \u684c\u5ba0";
        EnumWindows((window, unused) => {
            int owner;
            uint thread = GetWindowThreadProcessId(window, out owner);
            if (owner != processId) return true;
            var title = new StringBuilder(64);
            GetWindowText(window, title, title.Capacity);
            if (title.ToString() != expected && (crt || title.ToString() != "\u53ef\u9732\u5e0c\u5c14 \u00b7 \u684c\u5ba0")) return true;
            sent = crt ? PostThreadMessage(thread, 0x0012, IntPtr.Zero, IntPtr.Zero) : PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
            return false;
        }, IntPtr.Zero);
        return sent;
    }

    public static string[] SplitCommandLine(string command) {
        int count;
        IntPtr memory = CommandLineToArgvW(command, out count);
        if (memory == IntPtr.Zero) return new string[0];
        try {
            var args = new string[count];
            for (int i = 0; i < count; i++) args[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory, i * IntPtr.Size));
            return args;
        } finally { LocalFree(memory); }
    }
}
'@

$sessionId = (Get-Process -Id $PID).SessionId
$outputRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workRoot = [IO.Path]::GetFullPath((Join-Path $outputRoot '../work'))
$crtExe = Join-Path $outputRoot 'closure-crt/ClosureCrt.exe'
$petApp = Join-Path $outputRoot 'closure-companion'
$electronExe = Join-Path $workRoot 'companion-runtime/electron/electron.exe'
$knownProcesses = @{}

function Test-CodexOpen {
    $windowProcesses = [ClosureLifecycleWindows]::OpenWindowProcesses()
    foreach ($id in @($knownProcesses.Keys)) {
        if ($id -notin $windowProcesses) { $knownProcesses.Remove($id) }
    }
    foreach ($id in $windowProcesses) {
        if (!$knownProcesses.ContainsKey($id)) {
            $process = Get-Process -Id $id -ErrorAction SilentlyContinue
            $knownProcesses[$id] = $process -and $process.SessionId -eq $sessionId -and
                $process.Path -match '\\WindowsApps\\OpenAI\.Codex_[^\\]+__2p2nqsd0c76g0\\app\\(?:ChatGPT|Codex)\.exe$'
        }
        if ($knownProcesses[$id]) { return $true }
    }
    return $false
}

function Find-OpenHelpers {
    $crt = Get-Process -Name ClosureCrt -ErrorAction SilentlyContinue | Where-Object {
        $_.SessionId -eq $sessionId -and $_.Path -eq $crtExe
    } | Select-Object -First 1
    $pet = $null
    foreach ($process in (Get-CimInstance Win32_Process -Filter "Name='electron.exe' AND SessionId=$sessionId" -ErrorAction SilentlyContinue)) {
        if ($process.ExecutablePath -ne $electronExe -or !$process.CommandLine) { continue }
        $arguments = [ClosureLifecycleWindows]::SplitCommandLine($process.CommandLine)
        if ($arguments.Length -lt 2 -or $arguments -contains '--demo' -or $arguments -contains '--smoke') { continue }
        if (![IO.Path]::IsPathRooted($arguments[1])) { continue }
        if ([IO.Path]::GetFullPath($arguments[1]).TrimEnd('\') -ne $petApp) { continue }
        $pet = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
        if ($pet) { break }
    }
    return @{ Crt = $crt; Pet = $pet }
}

function Start-Helper($key) {
    if ($key -eq 'Crt') {
        throw 'The external CRT overlay has been retired.'
    }
    $env:CLOSURE_STATE_DIR = Join-Path $workRoot 'companion-profile'
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    $arguments = '"' + $petApp + '"'
    # Legacy -NoActivity is accepted on old shortcuts; the saved linkage checkbox now decides activity.
    return Start-Process -FilePath $electronExe -ArgumentList $arguments -WindowStyle Hidden -PassThru
}

function Write-LifecycleLog($message) {
    try {
        $log = Join-Path $workRoot 'lifecycle.log'
        if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -ge 65536) {
            Move-Item -LiteralPath $log -Destination "$log.old" -Force
        }
        Add-Content -LiteralPath $log -Encoding UTF8 -Value "$(Get-Date -Format o) $message"
    } catch { Write-Verbose 'Could not write the lifecycle log.' }
}

function Update-Helpers($children, $recovery, [long] $now, $keys = @('Crt', 'Pet')) {
    foreach ($key in $keys) {
        $state = $recovery[$key]
        $process = $children[$key]
        if ($process) {
            if (!$process.HasExited) {
                if ($now - $state.Started -ge 60000) { $state.Attempts = 0; $state.Due = $now }
                continue
            }
            $code = try { $process.ExitCode } catch [InvalidOperationException] { 'unknown' }
            Write-LifecycleLog "$key exited with code $code."
            $process.Dispose()
            $children[$key] = $null
            if ($key -eq 'Pet' -and $code -eq 0) { $state.Due = [long]::MaxValue }
            else { $state.Due = $now + 1000 }
        }
        if ($state.Attempts -ge 4 -or $now -lt $state.Due) { continue }

        $state.Attempts++
        $state.Started = $now
        try {
            $children[$key] = Start-Helper $key
            Write-LifecycleLog "$key started (attempt $($state.Attempts))."
        } catch {
            Write-LifecycleLog "$key launch failed ($($_.Exception.GetType().Name))."
            $state.Due = $now + 1000
        }
        if ($state.Attempts -eq 4) {
            Write-LifecycleLog "$key reached its launch limit. It resets after a stable run or after closing and reopening Codex."
        }
    }
}

function Stop-Helpers($children, $keys = @('Crt', 'Pet')) {
    foreach ($key in $keys) {
        $process = $children[$key]
        if (!$process) { continue }
        try {
            if (!$process.HasExited) {
                [void][ClosureLifecycleWindows]::CloseHelper($process.Id, $key -eq 'Crt')
                if (!$process.WaitForExit(1600)) { $process.Kill() }
            }
        } catch [InvalidOperationException] { }
        finally { $process.Dispose(); $children[$key] = $null }
    }
}

if ($Probe) {
    $helpers = Find-OpenHelpers
    [pscustomobject]@{ CodexOpen = (Test-CodexOpen); Crt = $helpers.Crt.Id; Pet = $helpers.Pet.Id }
    return
}

$mutex = [Threading.Mutex]::new($false, $mutexName)
$ownsMutex = $false
$signal = $null
$refreshSignal = $null
$children = @{ Crt = $null; Pet = $null }
try {
    try { $ownsMutex = $mutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (!$ownsMutex) { return }
    $signal = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset, $stopName)
    $refreshSignal = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::AutoReset, $refreshName)
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $required = @{ Crt = $false; Pet = $false }
    $recovery = @{}
    $nextLegacyCheck = 0
    do {
        $now = $clock.ElapsedMilliseconds
        # A manually reopened pet asks an existing watcher to resume supervising it.
        if ($refreshSignal.WaitOne(0) -and (!$children.Pet -or $children.Pet.HasExited)) {
            if ($children.Pet) { $children.Pet.Dispose() }
            $children.Pet = (Find-OpenHelpers).Pet
            $recovery.Pet = @{ Attempts = [int][bool]$children.Pet; Started = $now; Due = 0 }
            $required.Pet = $true
        }
        # Keep the old helper slot for upgrade cleanup, but never launch an overlay.
        $needed = @{ Crt = $false; Pet = $true }
        if (!$children.Crt -and $now -ge $nextLegacyCheck) {
            $children.Crt = (Find-OpenHelpers).Crt
            $nextLegacyCheck = $now + 3000
        }
        foreach ($key in 'Crt', 'Pet') {
            if (!$needed[$key]) {
                if ($children[$key]) { Stop-Helpers $children @($key) }
            } else {
                if (!$required[$key]) {
                    if (!$children[$key]) { $children[$key] = (Find-OpenHelpers)[$key] }
                    $recovery[$key] = @{ Attempts = [int][bool]$children[$key]; Started = $now; Due = 0 }
                }
                Update-Helpers $children $recovery $now @($key)
            }
            $required[$key] = $needed[$key]
        }
    } until ($signal.WaitOne(350))
} finally {
    if ($ownsMutex) {
        if (!$children.Pet -or !$children.Crt) {
            $running = Find-OpenHelpers
            foreach ($key in 'Crt', 'Pet') {
                if (!$children[$key]) { $children[$key] = $running[$key] }
            }
        }
        Stop-Helpers $children
        if ($signal) { $signal.Dispose() }
        if ($refreshSignal) { $refreshSignal.Dispose() }
        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
}
