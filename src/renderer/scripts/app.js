/**
 * app.js - 应用核心入口
 * 负责：页面路由、全局状态、IPC 事件监听、工具函数
 */

// ================================================
//  全局状态
// ================================================
window.AppState = {
  currentPage: 'dashboard',
  currentTaskId: null,
  groups: [],
  categories: [],
  templates: [],
  tasks: [],
  stats: {},
  settings: {}
};

// ================================================
//  页面切换
// ================================================
function switchPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const page = document.getElementById(`page-${name}`);
  if (page) page.classList.add('active');

  const nav = document.querySelector(`.nav-item[data-page="${name}"]`);
  if (nav) nav.classList.add('active');

  AppState.currentPage = name;

  // 触发页面加载钩子
  const hooks = {
    dashboard: () => window.DashboardPage?.load(),
    groups:    () => window.GroupsPage?.load(),
    templates: () => window.TemplatesPage?.load(),
    tasks:     () => window.TasksPage?.load(),
    schedule:  () => window.SchedulePage?.load(),
    logs:      () => window.LogsPage?.load(),
    settings:  () => window.SettingsPage?.load()
  };
  hooks[name]?.();
}

// 导航按钮绑定
document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
  btn.addEventListener('click', () => switchPage(btn.dataset.page));
});

// ================================================
//  标题栏控制
// ================================================
document.getElementById('btn-minimize')?.addEventListener('click', () => window.electronAPI.windowMinimize());
document.getElementById('btn-maximize')?.addEventListener('click', () => window.electronAPI.windowMaximize());
document.getElementById('btn-close')?.addEventListener('click',   () => window.electronAPI.windowClose());

// ================================================
//  Toast 通知系统
// ================================================
const TOAST_ICONS = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

window.showToast = function(msg, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${TOAST_ICONS[type] || 'ℹ️'}</span>
    <span class="toast-msg">${escapeHtml(msg)}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
};

// ================================================
//  实时日志
// ================================================
window.addRealtimeLog = function(msg, type = 'info') {
  const container = document.getElementById('realtime-log');
  if (!container) return;

  const now = new Date();
  const time = now.toTimeString().split(' ')[0];
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${escapeHtml(msg)}</span>`;
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;

  // 最多保留 200 条
  while (container.children.length > 200) {
    container.removeChild(container.firstChild);
  }
};

document.getElementById('btn-clear-realtime-log')?.addEventListener('click', () => {
  const c = document.getElementById('realtime-log');
  if (c) c.innerHTML = '';
});

// ================================================
//  任务进度浮层
// ================================================
let progressTaskId = null;

window.showProgress = function(taskId, title = '任务执行中...') {
  progressTaskId = taskId;
  AppState.currentTaskId = taskId;
  document.getElementById('progress-title').textContent = title;
  document.getElementById('progress-bar').style.width = '0%';
  document.getElementById('progress-detail').textContent = '准备中...';
  document.getElementById('prog-sent').textContent = '0';
  document.getElementById('prog-failed').textContent = '0';
  document.getElementById('prog-total').textContent = '0';
  document.getElementById('progress-overlay').style.display = 'block';
};

window.hideProgress = function() {
  document.getElementById('progress-overlay').style.display = 'none';
  progressTaskId = null;
  AppState.currentTaskId = null;
};

window.updateProgress = function(data) {
  if (!data) return;
  const { current, total, message, sentCount, failedCount } = data;
  if (current && total) {
    const pct = Math.round((current / total) * 100);
    document.getElementById('progress-bar').style.width = pct + '%';
  }
  if (message) document.getElementById('progress-detail').textContent = message;
  if (sentCount !== undefined) document.getElementById('prog-sent').textContent = sentCount;
  if (failedCount !== undefined) document.getElementById('prog-failed').textContent = failedCount;
  if (total !== undefined) document.getElementById('prog-total').textContent = total;
};

document.getElementById('btn-cancel-task')?.addEventListener('click', async () => {
  if (!progressTaskId) return;
  if (confirm('确定要取消该任务吗？')) {
    await window.electronAPI.stopTask(progressTaskId);
    hideProgress();
    showToast('任务已取消', 'warning');
  }
});

// ================================================
//  全局 IPC 事件处理
// ================================================
window.electronAPI.onTaskProgress((data) => {
  const { taskId, status, message, current, total, sentCount, failedCount, waitSeconds } = data;

  if (status === 'running') {
    if (!document.getElementById('progress-overlay').style.display || document.getElementById('progress-overlay').style.display === 'none') {
      showProgress(taskId, `任务执行中...`);
    }
    updateProgress({ current, total, message, sentCount, failedCount });
  } else if (status === 'waiting') {
    updateProgress({ message: message || `等待 ${waitSeconds}s...` });
  } else if (status === 'stopped' || status === 'paused') {
    hideProgress();
  }

  addRealtimeLog(message || `任务状态: ${status}`, status === 'running' ? 'info' : 'warning');
  
  // 刷新任务列表
  window.TasksPage?.load();
});

window.electronAPI.onTaskComplete((data) => {
  hideProgress();
  const { taskName, sentCount, failedCount, total } = data;
  const msg = `「${taskName}」完成！成功 ${sentCount}/${total}${failedCount ? `，失败 ${failedCount}` : ''}`;
  showToast(msg, failedCount > 0 ? 'warning' : 'success', 5000);
  addRealtimeLog(msg, 'success');
  window.DashboardPage?.loadStats();
  window.TasksPage?.load();
  window.LogsPage?.load();
});

window.electronAPI.onTaskError((data) => {
  const { taskName, error, fatal, groupName } = data;
  if (fatal) {
    hideProgress();
    showToast(`任务「${taskName}」执行失败: ${error}`, 'error', 6000);
    addRealtimeLog(`[错误] 任务「${taskName}」失败: ${error}`, 'error');
  } else {
    addRealtimeLog(`[失败] 发送到「${groupName}」: ${error}`, 'error');
  }
  window.TasksPage?.load();
});

window.electronAPI.onMessageSent((data) => {
  const { groupName, success, sentCount, total } = data;
  if (success) {
    addRealtimeLog(`✓ 已发送到「${groupName}」(${sentCount}/${total})`, 'success');
  }
});

// ================================================
//  工具函数
// ================================================
window.escapeHtml = function(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

window.formatDate = function(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

window.timeAgo = function(dateStr) {
  if (!dateStr) return '从未';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
};

window.getStatusLabel = function(status) {
  const map = {
    pending: '待执行', running: '运行中', scheduled: '已调度',
    paused: '已暂停', completed: '已完成', failed: '失败', stopped: '已停止'
  };
  return map[status] || status;
};

window.getCategoryColor = function(color) {
  const defaults = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6'];
  return color || defaults[0];
};

// ================================================
//  应用初始化
// ================================================
document.addEventListener('DOMContentLoaded', async () => {
  // 加载设置
  await loadAppSettings();

  // 默认加载仪表盘
  switchPage('dashboard');
});

async function loadAppSettings() {
  // 这里可以加载持久化设置
  AppState.settings = {
    minInterval: 5,
    maxInterval: 15
  };
}
