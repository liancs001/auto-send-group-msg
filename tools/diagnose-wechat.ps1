Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinEnum {
  public delegate bool EnumWndProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWndProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@ -ErrorAction SilentlyContinue

Write-Host "=== 枚举所有可见窗口（过滤含 wechat/微信 关键字）==="
$callback = {
  param([IntPtr]$hwnd, [IntPtr]$lp)
  if ([WinEnum]::IsWindowVisible($hwnd)) {
    $title = New-Object System.Text.StringBuilder 256
    $cls   = New-Object System.Text.StringBuilder 256
    [WinEnum]::GetWindowText($hwnd, $title, 256) | Out-Null
    [WinEnum]::GetClassName($hwnd, $cls, 256) | Out-Null
    $t = $title.ToString()
    $c = $cls.ToString()
    if ($t -match "wechat|微信" -or $c -match "wechat|微信") {
      $r = New-Object WinEnum+RECT
      [WinEnum]::GetWindowRect($hwnd, [ref]$r) | Out-Null
      Write-Host "HWND=$($hwnd.ToInt64())  CLASS=[$c]  TITLE=[$t]  RECT=($($r.Left),$($r.Top),$($r.Right),$($r.Bottom))"
    }
  }
  return $true
}
[WinEnum]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

Write-Host ""
Write-Host "=== 直接 FindWindow 测试 ==="
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FW {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);
}
"@ -ErrorAction SilentlyContinue

$h1 = [FW]::FindWindow("WeChatMainWnd", $null)
Write-Host "FindWindow('WeChatMainWnd', null) => $($h1.ToInt64())"

$h2 = [FW]::FindWindow($null, "微信")
Write-Host "FindWindow(null, '微信') => $($h2.ToInt64())"

$h3 = [FW]::FindWindow("WeChat", $null)
Write-Host "FindWindow('WeChat', null) => $($h3.ToInt64())"

$h4 = [FW]::FindWindow($null, "WeChat")
Write-Host "FindWindow(null, 'WeChat') => $($h4.ToInt64())"
