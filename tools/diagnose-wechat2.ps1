Write-Host "=== 查找微信相关进程 ==="
Get-Process | Where-Object { $_.Name -match "WeChat|wechat|微信" } | ForEach-Object {
  Write-Host "PID=$($_.Id)  Name=$($_.Name)  MainWindowTitle=[$($_.MainWindowTitle)]  MainWindowHandle=$($_.MainWindowHandle)"
}

Write-Host ""
Write-Host "=== 通过进程主窗口句柄查 ==="
$proc = Get-Process -Name "WeChat" -ErrorAction SilentlyContinue
if ($proc) {
  foreach ($p in $proc) {
    Write-Host "Process: $($p.Name) PID=$($p.Id) HWND=$($p.MainWindowHandle) Title=[$($p.MainWindowTitle)]"
  }
} else {
  Write-Host "未找到名为 WeChat 的进程"
}

Write-Host ""
Write-Host "=== 列出所有进程名包含 e 的，看是否有变体 ==="
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne "" } | 
  Select-Object Name, Id, MainWindowTitle | 
  Where-Object { $_.Name -match "(?i)chat|tencent|tx|qq" } |
  Format-Table -AutoSize
