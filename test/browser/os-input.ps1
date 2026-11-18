# Real OS mouse input for the browser tests (opt-in via --os-input), Windows only.
# Runs as one long-lived process: start it BEFORE the popup opens (spawning processes
# while the popup is open can take focus away and close it). Reads one command per line
# from stdin and answers one line on stdout:
#   focus                 bring the test Firefox (TargetPid) to the foreground (no synthetic keys)
#   probe   X Y           report owner/class of the window at X,Y (no input)
#   hover   X Y           move the pointer to X,Y and leave it there
#   click   X Y           left click at X,Y in the popup panel, then restore the pointer
#   wheel   X Y DELTA     mouse wheel at X,Y in the popup panel, then restore the pointer
#   toolbar X Y           left click at X,Y in the main window (the extension's toolbar button)
# Pointer actions are refused unless the window at X,Y belongs to TargetPid AND has the
# expected class: popup panel (MozillaDropShadowWindowClass), or the main browser window
# (MozillaWindowClass) for 'toolbar'. Other applications are never clicked.
param([Parameter(Mandatory)][int]$TargetPid)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CtaInput {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@
[CtaInput]::SetProcessDPIAware() | Out-Null

function Invoke-Focus {
  $main = (Get-Process -Id $TargetPid).MainWindowHandle
  $fgPid = [uint32]0
  $fgThread = [CtaInput]::GetWindowThreadProcessId([CtaInput]::GetForegroundWindow(), [ref]$fgPid)
  $me = [CtaInput]::GetCurrentThreadId()
  [CtaInput]::AttachThreadInput($me, $fgThread, $true) | Out-Null
  [CtaInput]::BringWindowToTop($main) | Out-Null
  [CtaInput]::SetForegroundWindow($main) | Out-Null
  [CtaInput]::AttachThreadInput($me, $fgThread, $false) | Out-Null
  $nowPid = [uint32]0
  [CtaInput]::GetWindowThreadProcessId([CtaInput]::GetForegroundWindow(), [ref]$nowPid) | Out-Null
  if ($nowPid -eq $TargetPid) { 'OK' } else { "FOCUS-FAILED foreground=$nowPid" }
}

function Invoke-Pointer([string]$Action, [int]$X, [int]$Y, [int]$Delta) {
  $p = New-Object CtaInput+POINT
  $p.X = $X; $p.Y = $Y
  $hwnd = [CtaInput]::WindowFromPoint($p)
  $owner = [uint32]0
  [CtaInput]::GetWindowThreadProcessId($hwnd, [ref]$owner) | Out-Null
  $cls = New-Object System.Text.StringBuilder 256
  [CtaInput]::GetClassName([CtaInput]::GetAncestor($hwnd, 2), $cls, 256) | Out-Null # GA_ROOT
  if ($Action -eq 'probe') { return "PROBE owner=$owner class=$cls" }
  if ($owner -ne $TargetPid) { return "REFUSED window-owner=$owner" }
  $wantClass = if ($Action -eq 'toolbar') { 'MozillaWindowClass' } else { 'MozillaDropShadowWindowClass' }
  if ("$cls" -ne $wantClass) { return "REFUSED class=$cls" }

  $old = New-Object CtaInput+POINT
  [CtaInput]::GetCursorPos([ref]$old) | Out-Null
  [CtaInput]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 60
  switch ($Action) {
    { $_ -in 'click', 'toolbar' } { [CtaInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); [CtaInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) }
    'wheel' { [CtaInput]::mouse_event(0x0800, 0, 0, $Delta, [UIntPtr]::Zero) }
  }
  Start-Sleep -Milliseconds 60
  if ($Action -in 'click', 'wheel') { [CtaInput]::SetCursorPos($old.X, $old.Y) | Out-Null }
  'OK'
}

[Console]::Out.WriteLine('READY')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $a = $line.Trim() -split '\s+'
  if (-not $a[0]) { continue }
  if ($a[0] -eq 'quit') { break }
  try {
    if ($a[0] -eq 'focus') { $r = Invoke-Focus }
    elseif ($a[0] -in 'probe', 'hover', 'click', 'wheel', 'toolbar') {
      $delta = if ($a.Count -gt 3) { [int]$a[3] } else { 0 } # Windows PowerShell 5.1: no ?? operator
      $r = Invoke-Pointer $a[0] ([int]$a[1]) ([int]$a[2]) $delta
    } else { $r = "ERROR unknown action" }
  } catch { $r = "ERROR $($_.Exception.Message)" }
  [Console]::Out.WriteLine($r)
}
