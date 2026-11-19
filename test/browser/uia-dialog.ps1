# Windows file dialogs of ONE process, driven without mouse, keyboard or focus changes.
# Used by native-dialogs.mjs (C4 manual-review evidence). Only a dialog (#32770) owned by
# -ProcessId is touched, never another application or another Firefox.
# The dialog is located with UI Automation; its controls are driven with Win32 messages
# to the dialog's own child windows (UIA does not expose all controls of this dialog):
# WM_SETTEXT into the file name box (control ID 1001 save / 1148 open), BM_CLICK on the
# default button (ID 1, Save/Open) or Cancel (ID 2).
#   -Action describe|save|open|cancel   -Path <file path for save/open>
param([string]$Action, [int]$ProcessId, [string]$Path = "", [int]$TimeoutMs = 20000)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class CtaWin {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc f, IntPtr p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static List<IntPtr> All(IntPtr h) { var r = new List<IntPtr>(); EnumChildWindows(h, (c, p) => { r.Add(c); return true; }, IntPtr.Zero); return r; }
  public static string Cls(IntPtr h) { var s = new StringBuilder(128); GetClassName(h, s, 128); return s.ToString(); }
  public static string Text(IntPtr h) { var s = new StringBuilder(256); GetWindowText(h, s, 256); return s.ToString(); }
}
"@
$AE = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
$prop = { param($p, $v) New-Object System.Windows.Automation.PropertyCondition($p, $v) }

# Firefox's file dialogs are owned windows: in the UIA tree they are children of the
# Firefox top-level window of -ProcessId (or, on some systems, top-level themselves).
$dialogCond = & $prop $AE::ClassNameProperty "#32770"
function FindDialog {
  foreach ($w in $AE::RootElement.FindAll($Scope::Children, (& $prop $AE::ProcessIdProperty $ProcessId))) {
    if ($w.Current.ClassName -eq "#32770") { return $w }
    $d = $w.FindFirst($Scope::Children, $dialogCond)
    if ($d) { return $d }
  }
  return $null
}
$deadline = (Get-Date).AddMilliseconds($TimeoutMs)
$dlg = $null
while (-not $dlg -and (Get-Date) -lt $deadline) {
  $dlg = FindDialog
  if (-not $dlg) { Start-Sleep -Milliseconds 200 }
}
if (-not $dlg) { @{ found = $false } | ConvertTo-Json -Compress; exit 0 }
$hwnd = [IntPtr]$dlg.Current.NativeWindowHandle

# The dialog window appears before its controls exist: wait for the default button.
function Button($id) { [CtaWin]::All($hwnd) | Where-Object { [CtaWin]::Cls($_) -eq "Button" -and [CtaWin]::GetDlgCtrlID($_) -eq $id } | Select-Object -First 1 }
while (-not (Button 1) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
Start-Sleep -Milliseconds 400
$ok = Button 1; $cancel = Button 2
$result = @{ found = $true; title = $dlg.Current.Name; action = $Action;
  okButton = if ($ok) { [CtaWin]::Text($ok) } else { $null }; cancelButton = if ($cancel) { [CtaWin]::Text($cancel) } else { $null } }
$WM_SETTEXT = 0x000C; $BM_CLICK = 0x00F5

if ($Action -in @("save", "open")) {
  $edit = [CtaWin]::All($hwnd) | Where-Object { [CtaWin]::Cls($_) -eq "Edit" -and [CtaWin]::IsWindowVisible($_) -and
    ((@(1001, 1148) -contains [CtaWin]::GetDlgCtrlID($_)) -or (@(1001, 1148) -contains [CtaWin]::GetDlgCtrlID([CtaWin]::GetParent($_)))) } | Select-Object -First 1
  if (-not $edit -or -not $ok) { $result.error = "file name box or default button not found"; $result | ConvertTo-Json -Compress; exit 0 }
  [void][CtaWin]::SendMessage($edit, $WM_SETTEXT, [IntPtr]::Zero, $Path)
  Start-Sleep -Milliseconds 300
  [void][CtaWin]::SendMessage($ok, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
} elseif ($Action -eq "cancel") {
  if (-not $cancel) { $result.error = "cancel button not found"; $result | ConvertTo-Json -Compress; exit 0 }
  [void][CtaWin]::SendMessage($cancel, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
}
$end = (Get-Date).AddSeconds(5)
while ([CtaWin]::IsWindow($hwnd) -and (Get-Date) -lt $end) { Start-Sleep -Milliseconds 200 }
$result.closed = -not [CtaWin]::IsWindow($hwnd)
$result | ConvertTo-Json -Compress
