Write-Host "=== WeChat Process Info ==="
$proc = Get-Process -Name "WeChat" -ErrorAction SilentlyContinue
if ($null -ne $proc) {
    foreach ($p in $proc) {
        Write-Host "PID=$($p.Id) HWND=$($p.MainWindowHandle) Title=[$($p.MainWindowTitle)]"
    }
} else {
    Write-Host "No WeChat process found"
}

Write-Host ""
Write-Host "=== All Visible Window Processes ==="
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object Name,Id,MainWindowTitle | Format-Table -AutoSize
