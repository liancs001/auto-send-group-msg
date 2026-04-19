/**
 * 调试 PowerShell 输出格式
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@ -ErrorAction SilentlyContinue

$hwnd = [IntPtr]::Zero

# 方式1: 进程名 Weixin
$p = Get-Process -Name "Weixin" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) { 
  $hwnd = [IntPtr]$p.MainWindowHandle 
  Write-Host "PROC_FOUND: $($p.ProcessName) HWND=$($hwnd.ToInt64())" 
}

if ($hwnd -eq [IntPtr]::Zero) {
  Write-Output "NOTFOUND"
} else {
  Write-Output "FOUND:$($hwnd.ToInt64())"
}
`;

const tmpFile = path.join(os.tmpdir(), `debug_${Date.now()}.ps1`);
fs.writeFileSync(tmpFile, '\uFEFF' + script, 'utf8');

try {
  const result = execSync(
    `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpFile}"`,
    { encoding: 'utf8', timeout: 10000, windowsHide: true }
  );
  console.log('=== RAW OUTPUT ===');
  console.log(JSON.stringify(result));
  console.log('=== TRIMMED ===');
  console.log(JSON.stringify(result.trim()));
  console.log('=== startsWith FOUND: ===', result.trim().startsWith('FOUND:'));
  console.log('=== startsWith NOTFOUND ===', result.trim().startsWith('NOTFOUND'));
  
  // 检查是否有 BOM 或其他前缀
  if (result.length > 0) {
    console.log('=== First 5 char codes ===');
    for (let i = 0; i < Math.min(5, result.length); i++) {
      console.log(`  [${i}]: ${result.charCodeAt(i)} = '${result[i]}'`);
    }
  }
} catch(e) {
  console.log('ERROR:', e.message);
  console.log('STDOUT:', e.stdout);
  console.log('STDERR:', e.stderr);
} finally {
  try { fs.unlinkSync(tmpFile); } catch(_) {}
}
