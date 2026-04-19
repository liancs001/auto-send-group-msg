/**
 * settings.js - 设置页面（内联在 app.js 之后加载）
 * 实际上设置逻辑较轻，放在这里统一管理
 */
window.SettingsPage = {
  async load() {
    // 这里可以从主进程获取配置
    // 目前使用本地缓存
    const s = AppState.settings || {};
    const minEl = document.getElementById('setting-min-interval');
    const maxEl = document.getElementById('setting-max-interval');
    if (minEl) minEl.value = s.minInterval || 5;
    if (maxEl) maxEl.value = s.maxInterval || 15;
  }
};

document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
  const min = parseInt(document.getElementById('setting-min-interval')?.value) || 5;
  const max = parseInt(document.getElementById('setting-max-interval')?.value) || 15;

  if (min >= max) {
    showToast('最小间隔必须小于最大间隔', 'warning');
    return;
  }

  AppState.settings = { ...AppState.settings, minInterval: min, maxInterval: max };
  showToast('设置已保存', 'success');
});

document.getElementById('btn-browse-wechat')?.addEventListener('click', async () => {
  // 简单弹出文件选择器（仅用于演示）
  showToast('请将微信路径粘贴到输入框中', 'info');
});
