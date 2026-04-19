# 测试修复后的微信窗口查找逻辑
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinAPI {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr child, string cls, string title);
  [DllImport("user32.dll")] public static extern int SendMessage(IntPtr h, uint msg, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@ -ErrorAction SilentlyContinue

$hwnd = [IntPtr]::Zero

Write-Host "=== 方式1: 通过进程主窗口 ==="
$procNames = @("Weixin", "WeChat", "wechat")
foreach ($pname in $procNames) {
  $p = Get-Process -Name $pname -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($p) {
    $hwnd = [IntPtr]$p.MainWindowHandle
    Write-Host "Found via process '$pname': HWND=$($hwnd.ToInt64()) Title=[$($p.MainWindowTitle)]"
    break
  }
}

if ($hwnd -eq [IntPtr]::Zero) {
  Write-Host "方式1 未找到，尝试方式2..."
  $hwnd = [WinAPI]::FindWindow($null, "微信")
  Write-Host "FindWindow(null, '微信') => $($hwnd.ToInt64())"
}

if ($hwnd -ne [IntPtr]::Zero) {
  $r = New-Object WinAPI+RECT
  [WinAPI]::GetWindowRect($hwnd, [ref]$r) | Out-Null
  Write-Host "SUCCESS: FOUND:$($hwnd.ToInt64()):$($r.Left):$($r.Top):$($r.Right):$($r.Bottom)"
  Write-Host "窗口大小: $($r.Right - $r.Left) x $($r.Bottom - $r.Top)"
  
  Write-Host ""
  Write-Host "=== 尝试激活窗口 ==="
  if ([WinAPI]::IsIconic($hwnd)) { [WinAPI]::ShowWindow($hwnd, 9) | Out-Null; Write-Host "已从最小化恢复" }
  [WinAPI]::ShowWindow($hwnd, 5) | Out-Null
  [WinAPI]::SetForegroundWindow($hwnd) | Out-Null
  Write-Host "窗口已激活"
} else {
  Write-Host "NOTFOUND - 所有方式均未找到微信窗口"
}
