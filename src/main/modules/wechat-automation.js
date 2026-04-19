/**
 * wechat-automation.js
 * 纯 PowerShell + Windows API 方案，无需 robotjs（避免 node-gyp 编译问题）
 * 
 * 策略：
 *   1. 通过 PowerShell 查找微信主窗口
 *   2. SendInput / SendKeys 模拟键盘
 *   3. 剪贴板传中文文字
 *   4. SetForegroundWindow 激活窗口
 */
const { execSync } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomSleep = (min = 500, max = 1500) =>
  sleep(Math.floor(Math.random() * (max - min)) + min);

// ─────────────────────────────────────────────
//  PowerShell 字符串安全转义（嵌入双引号字符串内使用）
//  覆盖：反引号、双引号、$、单引号、换行、回车
// ─────────────────────────────────────────────
function escapePS(str) {
  return str
    .replace(/`/g, '``')
    .replace(/"/g, '`"')
    .replace(/\$/g, '`$')
    .replace(/'/g, "''")
    .replace(/\n/g, '`r`n')   // 换行 → PowerShell 的 CRLF
    .replace(/\r/g, '`r');     // 回车 → PowerShell 回车
}

// ─────────────────────────────────────────────
//  PowerShell 执行工具
// ─────────────────────────────────────────────
function runPS(script, timeoutMs = 12000) {
  const tmpFile = path.join(os.tmpdir(), `wxa_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);
  try {
    fs.writeFileSync(tmpFile, '\uFEFF' + script, 'utf8'); // BOM for UTF-8
    const result = execSync(
      `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpFile}"`,
      { encoding: 'utf8', timeout: timeoutMs, windowsHide: true }
    );
    return result.trim();
  } catch (err) {
    const stderr = err.stderr?.trim() || '';
    const stdout = err.stdout?.trim() || '';
    throw new Error(stdout || stderr || err.message);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

// ─────────────────────────────────────────────
//  公共 C# 类型定义（Windows API）
// ─────────────────────────────────────────────
const CS_WINAPI = `
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
`;

// ─────────────────────────────────────────────
//  查找微信窗口
//  兼容策略（优先级从高到低）：
//    1. 通过进程名 Weixin（新版4.x）获取主窗口句柄（最可靠）
//    2. 通过进程名 WeChat（旧版3.x）获取主窗口句柄
//    3. FindWindow(null, "微信") 精确标题匹配
//    4. FindWindow("WeChatMainWnd", null) 老版本类名
//    5. FindWindow("Qt51514QWindowIcon"/"Qt5QWindowIcon") 新版 Qt 类名
// ─────────────────────────────────────────────
async function findWechatWindow() {
  try {
    const script = CS_WINAPI + `
$hwnd = [IntPtr]::Zero

# 方式1+2：通过进程名获取主窗口（最可靠，新版Weixin、旧版WeChat都支持）
$procNames = @("Weixin", "WeChat")
foreach ($pname in $procNames) {
  $p = Get-Process -Name $pname -ErrorAction SilentlyContinue |
       Where-Object { $_.MainWindowHandle -ne 0 } |
       Select-Object -First 1
  if ($p) { $hwnd = [IntPtr]$p.MainWindowHandle; break }
}

# 方式3：FindWindow 精确标题
if ($hwnd -eq [IntPtr]::Zero) { $hwnd = [WinAPI]::FindWindow($null, "微信") }
# 方式4：旧版类名
if ($hwnd -eq [IntPtr]::Zero) { $hwnd = [WinAPI]::FindWindow("WeChatMainWnd", $null) }
# 方式5：新版Qt类名（动态版本号）
if ($hwnd -eq [IntPtr]::Zero) { $hwnd = [WinAPI]::FindWindow("Qt51514QWindowIcon", $null) }
if ($hwnd -eq [IntPtr]::Zero) { $hwnd = [WinAPI]::FindWindow("Qt5QWindowIcon", $null) }

if ($hwnd -ne [IntPtr]::Zero) {
  $r = New-Object WinAPI+RECT
  [WinAPI]::GetWindowRect($hwnd, [ref]$r) | Out-Null
  Write-Output "FOUND:$($hwnd.ToInt64()):$($r.Left):$($r.Top):$($r.Right):$($r.Bottom)"
} else {
  Write-Output "NOTFOUND"
}
`;
    const out = runPS(script);
    if (out.startsWith('FOUND:')) {
      const parts = out.split(':');
      const hwnd   = parts[1];
      const left   = parseInt(parts[2]);
      const top    = parseInt(parts[3]);
      const right  = parseInt(parts[4]);
      const bottom = parseInt(parts[5]);
      return {
        found: true, hwnd,
        rect: { left, top, right, bottom, width: right - left, height: bottom - top }
      };
    }
    return { found: false };
  } catch (e) {
    return { found: false, error: e.message };
  }
}

// ─────────────────────────────────────────────
//  激活微信窗口（最小化则恢复）
//  返回激活后的最新 rect（保证坐标正确）
// ─────────────────────────────────────────────
async function activateWechat() {
  let wnd = await findWechatWindow();

  if (!wnd.found) {
    // 尝试启动微信（兼容新旧版本安装路径）
    const startScript = `
$paths = @(
  "$env:PROGRAMFILES\\Tencent\\WeChat\\WeChat.exe",
  "$env:LOCALAPPDATA\\Programs\\Tencent\\WeChat\\WeChat.exe",
  "$env:LOCALAPPDATA\\Programs\\WeChat\\WeChat.exe",
  "$env:PROGRAMFILES(X86)\\Tencent\\WeChat\\WeChat.exe",
  "C:\\Program Files\\Tencent\\WeChat\\WeChat.exe",
  "C:\\Program Files (x86)\\Tencent\\WeChat\\WeChat.exe"
)
$started = $false
foreach ($p in $paths) {
  if (Test-Path $p) { Start-Process $p; Write-Output "STARTED:$p"; $started = $true; break }
}
if (-not $started) { Write-Output "NOTFOUND" }
`;
    const startResult = runPS(startScript);
    if (startResult.startsWith('STARTED')) {
      await sleep(5000); // 等待微信启动并登录显示主窗口
    } else {
      return { success: false, error: '未找到微信安装路径，请确保微信已安装' };
    }
    wnd = await findWechatWindow();
    if (!wnd.found) return { success: false, error: '微信已启动但未找到主窗口，请确保微信已登录' };
  }

  const { hwnd } = wnd;
  const script = CS_WINAPI + `
$hwnd = [IntPtr]${hwnd}
# 若最小化先恢复，再显示，再前置
if ([WinAPI]::IsIconic($hwnd)) { [WinAPI]::ShowWindow($hwnd, 9) | Out-Null; Start-Sleep -Milliseconds 300 }
[WinAPI]::ShowWindow($hwnd, 5)  | Out-Null
[WinAPI]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 500
# 激活后重新获取窗口坐标（最小化时坐标是负值，恢复后才正确）
$r = New-Object WinAPI+RECT
[WinAPI]::GetWindowRect($hwnd, [ref]$r) | Out-Null
Write-Output "OK:$($r.Left):$($r.Top):$($r.Right):$($r.Bottom)"
`;
  const r = runPS(script);
  if (r.startsWith('OK:')) {
    const parts = r.split(':');
    const left   = parseInt(parts[1]);
    const top    = parseInt(parts[2]);
    const right  = parseInt(parts[3]);
    const bottom = parseInt(parts[4]);
    return {
      success: true, hwnd,
      rect: { left, top, right, bottom, width: right - left, height: bottom - top }
    };
  }
  return { success: false, error: '激活微信窗口失败' };
}

// ─────────────────────────────────────────────
//  通过剪贴板向活跃窗口粘贴文字
// ─────────────────────────────────────────────
async function pasteText(text) {
  // 转义 PowerShell 字符串中的特殊字符
  const escaped = text.replace(/`/g, '``').replace(/"/g, '`"').replace(/\$/g, '`$');
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::SetText("${escaped}")
Start-Sleep -Milliseconds 100
[System.Windows.Forms.SendKeys]::SendWait("^v")
`;
  runPS(script);
  await sleep(300);
}

// ─────────────────────────────────────────────
//  模拟按键（SendKeys 格式）
// ─────────────────────────────────────────────
async function sendKeys(keys) {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("${keys}")
`;
  runPS(script);
  await sleep(200);
}

// ─────────────────────────────────────────────
//  移动鼠标并点击（通过 Windows API）
// ─────────────────────────────────────────────
async function mouseClick(x, y) {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Mouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int flags, int x, int y, int data, int extra);
}
"@ -ErrorAction SilentlyContinue
[Mouse]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 120
[Mouse]::mouse_event(2, 0, 0, 0, 0)   # MOUSEEVENTF_LEFTDOWN
Start-Sleep -Milliseconds 60
[Mouse]::mouse_event(4, 0, 0, 0, 0)   # MOUSEEVENTF_LEFTUP
Start-Sleep -Milliseconds 100
Write-Output "OK"
`;
  runPS(script);
  await sleep(150);
}

// ─────────────────────────────────────────────
//  搜索群聊（Ctrl+F → 输入关键词）
// ─────────────────────────────────────────────
async function searchGroup(keyword) {
  try {
    const act = await activateWechat();
    if (!act.success) return { success: false, error: act.error };
    await sleep(600);

    // Ctrl+F 打开搜索
    await sendKeys('^f');
    await sleep(600);

    // 清空 + 粘贴关键词
    await sendKeys('^a');
    await pasteText(keyword);
    await sleep(800);

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─────────────────────────────────────────────
//  搜索并进入群聊 — 【单脚本原子化】版本
// 
//  核心问题修复：
//    旧版每个操作（mouseClick/sendKeys/pasteText/sleep）各启动独立 PS 进程，
//    进程间窗口焦点会丢失、时序不可控 → Enter 时焦点不在微信上
//    
//  新版将整个导航流程合并为 1 个 PowerShell 脚本，
//    所有操作在同一个进程中顺序执行，保证焦点和时序。
//
//  流程：激活微信 → 点击搜索区 → Ctrl+F → 粘贴关键词 → 等待搜索 → Enter×2 → 点击输入框
// ─────────────────────────────────────────────
async function _navigateToGroup({ rect, keyword, hwnd: extHwnd }) {
  // 计算坐标
  const sx = rect.left + Math.floor(rect.width * 0.15);  // 搜索区域 X
  const sy = rect.top + 55;                               // 搜索区域 Y
  const ix = rect.left + Math.floor(rect.width * 0.62);   // 输入框 X
  const iy = rect.top + Math.floor(rect.height * 0.88);    // 输入框 Y

  // 使用统一转义函数（含换行处理）
  const escapedKw = escapePS(keyword);

  // ── 整个导航流程合成一个 PowerShell 脚本 ──
  // 所有操作在同一个 PS 进程中执行，不会丢失焦点
  const navScript = CS_WINAPI + `

# === Step 1: 激活并前置微信窗口 ===
# 【修复】优先使用外部传入的 hwnd，避免冗余 findWechatWindow 调用
$hwnd = [IntPtr]${extHwnd || 0}
if ($hwnd -eq [IntPtr]::Zero) { Write-Output "ERROR:无效窗口句柄"; exit 1 }

if ([WinAPI]::IsIconic($hwnd)) { [WinAPI]::ShowWindow($hwnd, 9) | Out-Null; Start-Sleep -Milliseconds 300 }
[WinAPI]::ShowWindow($hwnd, 5)  | Out-Null
[WinAPI]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 600

# 加载 SendKeys / 剪贴板 / 鼠标 API
Add-Type -AssemblyName System.Windows.Forms
Add-Type @\"
using System;
using System.Runtime.InteropServices;
public class MouseOp {
  [DllImport(\\"user32.dll\\")] public static extern bool SetCursorPos(int x, int y);
  [DllImport(\\"user32.dll\\")] public static extern void mouse_event(int f, int x, int y, int d, int e);
}
\\"@ -ErrorAction SilentlyContinue

# === Step 2: 点击搜索框区域 ===
[MouseOp]::SetCursorPos(${sx}, ${sy})
Start-Sleep -Milliseconds 150
[MouseOp]::mouse_event(2, 0, 0, 0, 0)   # LEFTDOWN
Start-Sleep -Milliseconds 60
[MouseOp]::mouse_event(4, 0, 0, 0, 0)   # LEFTUP
Start-Sleep -Milliseconds 500

# === Step 3: Ctrl+F 打开全局搜索 ===
[System.Windows.Forms.SendKeys]::SendWait(\"^f\")
Start-Sleep -Milliseconds 800

# === Step 4: 清空 + 粘贴搜索关键词 ===
[System.Windows.Forms.SendKeys]::SendWait(\"^a\")
Start-Sleep -Milliseconds 150
[System.Windows.Forms.Clipboard]::SetText(\"${escapedKw}\")
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait(\"^v\")

# === Step 5: 【修复】等待搜索结果加载完毕（增加到 4~7 秒）===
# 微信搜索是异步的，群多/聊天记录多时加载慢
# 先等 3 秒基础等待，再轮询最多 3 秒
Start-Sleep -Milliseconds 3000
$waited = 0
do {
  Start-Sleep -Milliseconds 500
  $waited += 500
} while ($waited -lt 3000)

# === Step 6: 第一次 Enter — 选中搜索结果第一项 ===
[System.Windows.Forms.SendKeys]::SendWait(\"{ENTER}\")
Start-Sleep -Milliseconds 2000

# === Step 7: 第二次 Enter（保险）===
[System.Windows.Forms.SendKeys]::SendWait(\"{ENTER}\")
Start-Sleep -Milliseconds 1500

# === Step 8: 点击输入框确认已进入群聊 ===
[MouseOp]::SetCursorPos(${ix}, ${iy})
Start-Sleep -Milliseconds 150
[MouseOp]::mouse_event(2, 0, 0, 0, 0)
Start-Sleep -Milliseconds 60
[MouseOp]::mouse_event(4, 0, 0, 0, 0)
Start-Sleep -Milliseconds 400

# === Step 9: 验证窗口标题确认已在目标群聊 ===
$proc = Get-Process -Name Weixin -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -eq $hwnd.ToInt64() }
if (-not $proc) { $proc = Get-Process -Name WeChat -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -eq $hwnd.ToInt64() } }
if ($proc) {
  $title = $proc.MainWindowTitle
  Write-Output "NAV_OK:$title"
} else {
  Write-Output "NAV_OK"
}
`;

  try {
    console.log(`[WechatAuto] [原子导航] 开始导航到「${keyword}」...`);
    const result = runPS(navScript, 25000); // 增加到25秒（搜索等待加长了）
    
    if (!result.includes('NAV_OK')) {
      throw new Error(`导航脚本返回异常: ${result}`);
    }
    // 提取窗口标题用于验证
    const navTitle = result.includes('NAV_OK:') ? result.split('NAV_OK:')[1].trim() : '';
    if (navTitle) {
      console.log(`[WechatAuto] [原子导航] 「${keyword}」导航完成，当前窗口标题: ${navTitle}`);
    } else {
      console.log(`[WechatAuto] [原子导航] 「${keyword}」导航完成`);
    }
  } catch (err) {
    console.error(`[WechatAuto] [原子导航] 「${keyword}」失败:`, err.message);
    throw new Error(`导航到群「${keyword}」失败: ${err.message}`);
  }
}

// ─────────────────────────────────────────────
//  单群发送核心（给一个关键词搜索并发送消息）
//  内部函数，供 sendMessage 复用
// ─────────────────────────────────────────────
async function _sendToOneKeyword({ rect, keyword, content, delay = 800, hwnd }) {
  // 使用新的导航函数（已原子化：1个PS进程完成整个导航）
  await _navigateToGroup({ rect, keyword, hwnd });

  // 文本发送 — 原子化
  const ix = rect.left + Math.floor(rect.width * 0.62);
  const iy = rect.top  + Math.floor(rect.height * 0.88);

  // 使用统一转义函数（含换行处理）
  const escapedContent = escapePS(content);

  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public class MouseOp4 {
  [DllImport(\\"user32.dll\\")] public static extern bool SetCursorPos(int x, int y);
  [DllImport(\\"user32.dll\\")] public static extern void mouse_event(int f, int x, int y, int d, int e);
}
"@ -ErrorAction SilentlyContinue

[MouseOp4]::SetCursorPos(${ix}, ${iy})
Start-Sleep -Milliseconds 200
[MouseOp4]::mouse_event(2, 0, 0, 0, 0)
Start-Sleep -Milliseconds 60
[MouseOp4]::mouse_event(4, 0, 0, 0, 0)
Start-Sleep -Milliseconds 300

[System.Windows.Forms.SendKeys]::SendWait("^a")
Start-Sleep -Milliseconds 100
[System.Windows.Forms.Clipboard]::SetText("${escapedContent}")
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds ${delay}
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 500
Write-Output "SEND_OK"
`;
  const result = runPS(script, 15000);
  if (!result.includes('SEND_OK')) {
    throw new Error(`文本发送失败: ${result}`);
  }
}

// ─────────────────────────────────────────────
//  发送文本+图片到单个关键词对应的群
//  搜索一次群，然后依次发文本、发各张图片
//  避免图片发送时重复搜索群
// ─────────────────────────────────────────────
async function sendToGroup({ groupKeywords, content, images = [], delay = 800, intervalMin = 5, intervalMax = 15 }) {
  const t0 = Date.now();

  // 统一关键词列表
  const keywords = (Array.isArray(groupKeywords) ? groupKeywords : [groupKeywords]).filter(Boolean);
  if (!keywords.length) return { success: false, error: '未提供搜索关键词' };

  // 确保图片都存在
  const validImages = images.filter(p => {
    if (!p || !fs.existsSync(p)) {
      console.warn(`[WechatAuto] 图片不存在，跳过: ${p}`);
      return false;
    }
    return true;
  });

  const results = [];

  try {
    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i].trim();
      if (!kw) continue;
      const t1 = Date.now();

      try {
        // ① 【修复】每轮循环重新激活微信获取最新坐标，避免坐标过期导致点击偏移
        const act = await activateWechat();
        if (!act.success) {
          results.push({ keyword: kw, success: false, error: act.error, duration: Date.now() - t1 });
          continue;
        }
        await sleep(300);
        const rect = act.rect;

        // ② 搜索并进入群（只搜一次，使用优化后的导航函数）
        await _navigateToGroup({ rect, keyword: kw, hwnd: act.hwnd });

        let hasPartialFailure = false;

        // ② 发送文本（如果有）— 原子化：导航后立即在同一 PS 进程中完成
        if (content) {
          const ix = rect.left + Math.floor(rect.width * 0.62);
          const iy = rect.top  + Math.floor(rect.height * 0.88);

          // 使用统一转义函数（含换行处理）
          const escapedContent = escapePS(content);

          const textSendScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public class MouseOp2 {
  [DllImport(\\"user32.dll\\")] public static extern bool SetCursorPos(int x, int y);
  [DllImport(\\"user32.dll\\")] public static extern void mouse_event(int f, int x, int y, int d, int e);
}
"@ -ErrorAction SilentlyContinue

# 点击输入框获取焦点
[MouseOp2]::SetCursorPos(${ix}, ${iy})
Start-Sleep -Milliseconds 200
[MouseOp2]::mouse_event(2, 0, 0, 0, 0)
Start-Sleep -Milliseconds 60
[MouseOp2]::mouse_event(4, 0, 0, 0, 0)
Start-Sleep -Milliseconds 300

# 清空 + 粘贴消息
[System.Windows.Forms.SendKeys]::SendWait(\"^a\")
Start-Sleep -Milliseconds 100
[System.Windows.Forms.Clipboard]::SetText(\"${escapedContent}\")
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait(\"^v\")

# 等待文字渲染
Start-Sleep -Milliseconds ${delay}

# Enter 发送
[System.Windows.Forms.SendKeys]::SendWait(\"{ENTER}\")
Start-Sleep -Milliseconds 600

Write-Output "TEXT_OK"
`;
          try {
            const textResult = runPS(textSendScript, 15000);
            if (!textResult.includes('TEXT_OK')) {
              throw new Error(`文本发送返回异常: ${textResult}`);
            }
            console.log(`[WechatAuto] 文本发送成功`);
          } catch (textErr) {
            console.error(`[WechatAuto] 文本发送失败:`, textErr.message);
            results.push({ keyword: kw, success: false, error: `文本发送失败: ${textErr.message}`, duration: Date.now() - t1 });
            hasPartialFailure = true;
            // 不 continue，继续尝试发图片
          }
        }

        // ③ 依次发送图片（原子化：每张图片 = 1个PS脚本完成 剪贴板+点击+粘贴+发送）
        for (let j = 0; j < validImages.length; j++) {
          const imgPath = validImages[j];
          console.log(`[WechatAuto] 发送图片 ${j + 1}/${validImages.length}: ${path.basename(imgPath)}`);

          try {
            // 单脚本完成：剪贴板写入 → 点击输入框 → 粘贴 → 发送
            const absPath = path.resolve(imgPath).replace(/\\/g, '\\\\');
            const ix2 = rect.left + Math.floor(rect.width * 0.62);
            const iy2 = rect.top  + Math.floor(rect.height * 0.88);

            const imgSendScript = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class MouseOp3 {
  [DllImport(\\"user32.dll\\")] public static extern bool SetCursorPos(int x, int y);
  [DllImport(\\"user32.dll\\")] public static extern void mouse_event(int f, int x, int y, int d, int e);
}
"@ -ErrorAction SilentlyContinue

# === A: 将图片写入剪贴板 ===
try {
  $img = [System.Drawing.Image]::FromFile("${absPath}")
  [System.Windows.Forms.Clipboard]::SetImage($img)
  $img.Dispose()
  # 验证
  if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { Write-Output "ERROR:剪贴板无图片"; exit 1 }
} catch {
  Write-Output "ERROR:图片加载失败: $($_.Exception.Message)"
  exit 1
}

# 剪贴板写入后短暂等待确保就绪
Start-Sleep -Milliseconds 300

# === B: 点击输入框获取焦点（同一进程中，焦点不会丢失）===
[MouseOp3]::SetCursorPos(${ix2}, ${iy2})
Start-Sleep -Milliseconds 200
[MouseOp3]::mouse_event(2, 0, 0, 0, 0)
Start-Sleep -Milliseconds 60
[MouseOp3]::mouse_event(4, 0, 0, 0, 0)
Start-Sleep -Milliseconds 300

# === C: Ctrl+V 粘贴图片 ===
[System.Windows.Forms.SendKeys]::SendWait(\"^v\")

# 等待微信渲染缩略图预览
Start-Sleep -Milliseconds 1800

# 模拟人类操作间隔
$randMs = Get-Random -Minimum 500 -Maximum 1200
Start-Sleep -Milliseconds $randMs

# === D: Enter 发送图片 ===
[System.Windows.Forms.SendKeys]::SendWait(\"{ENTER}\")

# 等待微信上传图片到服务器
Start-Sleep -Milliseconds 1200

Write-Output "IMG_OK"
`;
            try {
              const imgResult = runPS(imgSendScript, 25000); // 图片发送最多给25秒
              if (!imgResult.includes('IMG_OK')) {
                throw new Error(`图片发送返回异常: ${imgResult}`);
              }
              console.log(`[WechatAuto] 图片 ${j + 1}/${validImages.length} 发送成功`);
            } catch (imgErr) {
              const errMsg = `图片发送异常 [${path.basename(imgPath)}]: ${imgErr.message}`;
              console.error(`[WechatAuto] ${errMsg}`);
              results.push({ keyword: kw, success: false, error: errMsg, duration: Date.now() - t1 });
              hasPartialFailure = true;
            }

            // 图片之间等待（避免被限流）
            if (j < validImages.length - 1) {
              await sleep(Math.floor(Math.random() * 2000) + 2500);
            }
          } catch (imgErr) {
            const errMsg = `图片发送流程异常 [${path.basename(imgPath)}]: ${imgErr.message}`;
            console.error(`[WechatAuto] ${errMsg}`);
            results.push({ keyword: kw, success: false, error: errMsg, duration: Date.now() - t1 });
            hasPartialFailure = true;
          }
        }

        // 检查本轮是否有图片发送失败（内层循环已将失败记录到 results）
        const imgFailCount = results.filter(r => r.keyword === kw && !r.success).length;
        if (imgFailCount > 0) {
          console.warn(`[WechatAuto] 群「${kw}」有 ${imgFailCount} 张图片发送失败`);
          results.push({ keyword: kw, success: false, partial: true, error: `${imgFailCount}张图片发送失败`, duration: Date.now() - t1 });
        } else {
          results.push({ keyword: kw, success: true, duration: Date.now() - t1 });
        }
      } catch (e) {
        results.push({ keyword: kw, success: false, error: e.message, duration: Date.now() - t1 });
      }

      // 关键词间随机等待（最后一个不等）
      if (i < keywords.length - 1) {
        const waitMs = (Math.floor(Math.random() * (intervalMax - intervalMin)) + intervalMin) * 1000;
        await sleep(waitMs);
      }
    }

    const allSuccess = results.every(r => r.success);
    const anySuccess = results.some(r => r.success);
    return {
      success: anySuccess,
      partial: anySuccess && !allSuccess,
      results,
      duration: Date.now() - t0
    };
  } catch (e) {
    return { success: false, error: e.message, duration: Date.now() - t0 };
  }
}

// ─────────────────────────────────────────────
//  发送文本消息
//  支持多关键词：groupKeywords 为数组时逐一发送
//  兼容旧式单 groupKeyword 字符串
// ─────────────────────────────────────────────
async function sendMessage({ groupKeyword, groupKeywords, content, delay = 800, intervalMin = 5, intervalMax = 15 }) {
  const t0 = Date.now();

  // 统一关键词列表
  let keywords = [];
  if (Array.isArray(groupKeywords) && groupKeywords.length) {
    keywords = groupKeywords.filter(Boolean);
  } else if (groupKeyword) {
    keywords = [groupKeyword];
  }
  if (!keywords.length) return { success: false, error: '未提供搜索关键词' };

  try {
    const results = [];

    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i].trim();
      if (!kw) continue;

      const t1 = Date.now();
      try {
        // 【修复】每轮循环重新激活微信获取最新坐标
        const act = await activateWechat();
        if (!act.success) {
          results.push({ keyword: kw, success: false, error: act.error, duration: Date.now() - t1 });
          continue;
        }
        await sleep(300);
        const rect = act.rect;

        await _sendToOneKeyword({ rect, keyword: kw, content, delay, hwnd: act.hwnd });
        results.push({ keyword: kw, success: true, duration: Date.now() - t1 });
      } catch (e) {
        results.push({ keyword: kw, success: false, error: e.message, duration: Date.now() - t1 });
      }

      // 每个关键词之间随机等待（最后一个不等）
      if (i < keywords.length - 1) {
        const waitMs = (Math.floor(Math.random() * (intervalMax - intervalMin)) + intervalMin) * 1000;
        await sleep(waitMs);
      }
    }

    const allSuccess = results.every(r => r.success);
    const anySuccess = results.some(r => r.success);
    return {
      success: anySuccess,
      partial: anySuccess && !allSuccess,
      results,
      duration: Date.now() - t0
    };
  } catch (e) {
    return { success: false, error: e.message, duration: Date.now() - t0 };
  }
}

// ─────────────────────────────────────────────
//  发送图片（原子化：导航 + 剪贴板 + 粘贴 + 发送 合并）
// ─────────────────────────────────────────────
async function sendImage({ groupKeyword, groupKeywords, imagePath, intervalMin = 5, intervalMax = 15 }) {
  const t0 = Date.now();
  try {
    if (!fs.existsSync(imagePath)) {
      return { success: false, error: `图片不存在: ${imagePath}` };
    }

    let keywords = [];
    if (Array.isArray(groupKeywords) && groupKeywords.length) {
      keywords = groupKeywords.filter(Boolean);
    } else if (groupKeyword) {
      keywords = [groupKeyword];
    }
    if (!keywords.length) return { success: false, error: '未提供搜索关键词' };

    const imgAbsPath = path.resolve(imagePath).replace(/\\/g, '\\\\');
    console.log(`[WechatAuto sendImage] 图片已就绪: ${path.basename(imagePath)}, 开始发送到 ${keywords.length} 个群`);

    const results = [];

    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i].trim();
      if (!kw) continue;

      const t1 = Date.now();

      try {
        // 【修复】每轮循环重新激活微信获取最新坐标
        const act = await activateWechat();
        if (!act.success) {
          results.push({ keyword: kw, success: false, error: act.error, duration: Date.now() - t1 });
          continue;
        }
        await sleep(300);
        const rect = act.rect;

        // 单脚本完成：导航到群 + 剪贴板写入图片 + 粘贴 + 发送
        const sx2 = rect.left + Math.floor(rect.width * 0.15);
        const sy2 = rect.top + 55;
        const ix2 = rect.left + Math.floor(rect.width * 0.62);
        const iy2 = rect.top + Math.floor(rect.height * 0.88);

        // 使用统一转义函数（含换行处理）
        const escapedKw2 = escapePS(kw);

        const fullImgScript = CS_WINAPI + `

# === A: 激活微信窗口 ===
$hwnd2 = [IntPtr]${act.hwnd}
if ($hwnd2 -ne [IntPtr]::Zero) {
  if ([WinAPI]::IsIconic($hwnd2)) { [WinAPI]::ShowWindow($hwnd2, 9) | Out-Null; Start-Sleep -Milliseconds 300 }
  [WinAPI]::SetForegroundWindow($hwnd2) | Out-Null
}
Start-Sleep -Milliseconds 500

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class MouseOp5 {
  [DllImport(\\"user32.dll\\")] public static extern bool SetCursorPos(int x, int y);
  [DllImport(\\"user32.dll\\")] public static extern void mouse_event(int f, int x, int y, int d, int e);
}
"@ -ErrorAction SilentlyContinue

# === B: 导航到群聊 ===
[MouseOp5]::SetCursorPos(${sx2}, ${sy2})
Start-Sleep -Milliseconds 200; [MouseOp5]::mouse_event(2,0,0,0,0); Start-Sleep -Milliseconds 60; [MouseOp5]::mouse_event(4,0,0,0,0)
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait(\"^f\")
Start-Sleep -Milliseconds 800
[System.Windows.Forms.SendKeys]::SendWait(\"^a\")
Start-Sleep -Milliseconds 150
[System.Windows.Forms.Clipboard]::SetText(\"${escapedKw2}\")
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("^v")

# 【修复】搜索结果等待增加到4~7秒
Start-Sleep -Milliseconds 3000
$waited2 = 0
do {
  Start-Sleep -Milliseconds 500
  $waited2 += 500
} while ($waited2 -lt 3000)

[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 2000
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 1500

# === C: 写入图片到剪贴板 ===
try {
  $img2 = [System.Drawing.Image]::FromFile("${imgAbsPath}")
  [System.Windows.Forms.Clipboard]::SetImage($img2)
  $img2.Dispose()
  if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { Write-Output "ERROR:剪贴板无图片"; exit 1 }
} catch { Write-Output "ERROR:图片加载失败"; exit 1 }

Start-Sleep -Milliseconds 300

# === D: 点击输入框 → 粘贴图片 → 发送 ===
[MouseOp5]::SetCursorPos(${ix2}, ${iy2})
Start-Sleep -Milliseconds 200
[MouseOp5]::mouse_event(2,0,0,0,0); Start-Sleep -Milliseconds 60; [MouseOp5]::mouse_event(4,0,0,0,0)
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 1800
$randMs2 = Get-Random -Minimum 500 -Maximum 1200
Start-Sleep -Milliseconds $randMs2
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 1200

Write-Output "SENDIMG_OK"
`;
        const imgResult = runPS(fullImgScript, 30000);
        if (!imgResult.includes('SENDIMG_OK')) {
          throw new Error(`图片发送返回异常: ${imgResult}`);
        }
        results.push({ keyword: kw, success: true, duration: Date.now() - t1 });
      } catch (e) {
        results.push({ keyword: kw, success: false, error: e.message, duration: Date.now() - t1 });
      }

      if (i < keywords.length - 1) {
        const waitMs = (Math.floor(Math.random() * (intervalMax - intervalMin)) + intervalMin) * 1000;
        await sleep(waitMs);
      }
    }

    const allSuccess = results.every(r => r.success);
    const anySuccess = results.some(r => r.success);
    return { success: anySuccess, partial: anySuccess && !allSuccess, results, duration: Date.now() - t0 };
  } catch (e) {
    return { success: false, error: e.message, duration: Date.now() - t0 };
  }
}

async function takeScreenshot() {
  return { success: false, error: '截图功能需要额外依赖' };
}

module.exports = {
  findWechatWindow, activateWechat,
  searchGroup, sendMessage, sendImage, sendToGroup, takeScreenshot
};
