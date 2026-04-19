Write-Host "=== 获取 Weixin 窗口详细信息 ==="
$proc = Get-Process -Name "Weixin" -ErrorAction SilentlyContinue
if ($null -ne $proc) {
    foreach ($p in $proc) {
        Write-Host "PID=$($p.Id) HWND=$($p.MainWindowHandle) Title=[$($p.MainWindowTitle)]"
    }
} else {
    Write-Host "No Weixin process"
}

Write-Host ""
Write-Host "=== 用 FindWindow 枚举获取类名 ==="
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinInfo2 {
  public delegate bool EnumWndProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWndProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@ -ErrorAction SilentlyContinue

$weixinProc = Get-Process -Name "Weixin" -ErrorAction SilentlyContinue
$targetPids = @()
if ($weixinProc) { $targetPids = $weixinProc | ForEach-Object { $_.Id } }
Write-Host "Target PIDs: $($targetPids -join ',')"

$cb = {
    param([IntPtr]$hwnd, [IntPtr]$lp)
    if ([WinInfo2]::IsWindowVisible($hwnd)) {
        $pid2 = [uint32]0
        [WinInfo2]::GetWindowThreadProcessId($hwnd, [ref]$pid2) | Out-Null
        if ($targetPids -contains [int]$pid2) {
            $title = New-Object System.Text.StringBuilder 256
            $cls   = New-Object System.Text.StringBuilder 256
            [WinInfo2]::GetWindowText($hwnd, $title, 256) | Out-Null
            [WinInfo2]::GetClassName($hwnd, $cls, 256) | Out-Null
            Write-Host "HWND=$($hwnd.ToInt64()) PID=$pid2 CLASS=[$($cls.ToString())] TITLE=[$($title.ToString())]"
        }
    }
    return $true
}
[WinInfo2]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
