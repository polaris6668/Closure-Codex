param([switch] $Probe, [long] $OverlayHandle, [string] $Hosts = 'codex')

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class ClosureWindow {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int capacity);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
    [StructLayout(LayoutKind.Sequential)]
    public struct Point { public int X, Y; }
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindow(string windowClass, string title);
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

    public static Rect ClientBounds(IntPtr hwnd) {
        Rect bounds;
        Point origin = new Point();
        if (!GetClientRect(hwnd, out bounds) || !ClientToScreen(hwnd, ref origin)) return new Rect();
        bounds.Left += origin.X;
        bounds.Top += origin.Y;
        bounds.Right += origin.X;
        bounds.Bottom += origin.Y;
        return bounds;
    }

    public static bool IsMainWindow(IntPtr window) {
        const uint owner = 4; // GW_OWNER
        const int extendedStyle = -20, toolWindow = 0x00000080;
        if (window == IntPtr.Zero || GetWindow(window, owner) != IntPtr.Zero ||
            (GetWindowLong(window, extendedStyle) & toolWindow) != 0) return false;
        var kind = new StringBuilder(48);
        GetClassName(window, kind, kind.Capacity);
        return kind.ToString() == "Chrome_WidgetWin_1";
    }

    public static bool IsAbove(IntPtr window, IntPtr other) {
        if (window == IntPtr.Zero || other == IntPtr.Zero || window == other) return false;
        IntPtr previous = GetWindow(other, 3); // GW_HWNDPREV
        for (int i = 0; previous != IntPtr.Zero && i < 4096; i++) {
            if (previous == window) return true;
            previous = GetWindow(previous, 3);
        }
        return false;
    }

    public static bool RaiseOverlay(IntPtr overlay, IntPtr codex) {
        if (overlay == IntPtr.Zero || !IsWindowVisible(overlay)) return false;
        IntPtr crt = FindWindow(null, "Closure CRT Overlay");
        bool coveredByCrt = IsWindowVisible(crt) && IsAbove(crt, overlay);
        bool topmost = (GetWindowLong(overlay, -20) & 0x00000008) != 0;
        if (topmost && !coveredByCrt && !IsAbove(codex, overlay)) return true;
        const uint orderOnly = 0x0001 | 0x0002 | 0x0010 | 0x0200;
        return SetWindowPos(overlay, new IntPtr(-1), 0, 0, 0, 0, orderOnly); // HWND_TOPMOST
    }
}
'@

[void][ClosureWindow]::SetThreadDpiAwarenessContext([IntPtr](-4))
$overlay = [IntPtr]$OverlayHandle
$target = [IntPtr]::Zero
$last = ''
$lastForeground = [IntPtr]::Zero
$allowedHosts = $Hosts.Split(',')

do {
    $active = [ClosureWindow]::GetForegroundWindow()
    if ($active -ne $lastForeground -or $Probe) {
        $lastForeground = $active
        $owner = [uint32]0
        [void][ClosureWindow]::GetWindowThreadProcessId($active, [ref]$owner)
        $target = [IntPtr]::Zero
        $process = if ($owner -ne 0) { Get-Process -Id $owner -ErrorAction SilentlyContinue }
        $matchesHost = ('codex' -in $allowedHosts -and $process.Path -match '\\OpenAI\.Codex_[^\\]+\\app\\(?:ChatGPT|Codex)\.exe$') -or
            ('dsh' -in $allowedHosts -and $process.Path -eq (Join-Path $env:LOCALAPPDATA 'Programs/DeepSeek Harness/DeepSeek Harness.exe')) -or
            ('workbuddy' -in $allowedHosts -and $process.Path -eq (Join-Path $env:LOCALAPPDATA 'Programs/WorkBuddy/WorkBuddy.exe'))
        if ($matchesHost -and [ClosureWindow]::IsMainWindow($active)) {
            $target = $active
        }
    }

    $event = @{ visible = $false }
    if ($target -ne [IntPtr]::Zero -and [ClosureWindow]::IsWindowVisible($target) -and
        [ClosureWindow]::IsWindowEnabled($target) -and ![ClosureWindow]::IsIconic($target)) {
        $bounds = [ClosureWindow]::ClientBounds($target)
        $width = $bounds.Right - $bounds.Left
        $height = $bounds.Bottom - $bounds.Top
        if ($width -ge 360 -and $height -ge 260) {
            $event = @{ visible = $true; x = $bounds.Left; y = $bounds.Top; width = $width; height = $height }
        }
    }
    $line = ConvertTo-Json -InputObject $event -Compress
    if ($line -ne $last) {
        [Console]::WriteLine($line)
        $last = $line
    }
    if (!$Probe) {
        if ($event.visible) { [void][ClosureWindow]::RaiseOverlay($overlay, $target) }
        Start-Sleep -Milliseconds 75
    }
} while (!$Probe)
