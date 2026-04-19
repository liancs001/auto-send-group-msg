/**
 * dashboard.js - 仪表盘页面
 */
window.DashboardPage = {
  async load() {
    await this.loadStats();
    await this.checkWechat();
    await this.loadRecentTasks();
  },

  async loadStats() {
    try {
      const stats = await window.electronAPI.getStats();
      AppState.stats = stats;
      document.getElementById('stat-groups').textContent     = stats.totalGroups ?? '--';
      document.getElementById('stat-today-sent').textContent = stats.todaySent ?? '--';
      document.getElementById('stat-running').textContent    = stats.runningTasks ?? '--';
      document.getElementById('stat-total-sent').textContent = stats.totalSent ?? '--';
      // 本周新增群组趋势
      const trendEl = document.getElementById('stat-trend-groups');
      if (trendEl) {
        const wk = stats.weekGroups ?? 0;
        trendEl.textContent = wk > 0 ? `+${wk} 本周` : '本周无新增';
        trendEl.className = 'stat-trend' + (wk > 0 ? ' up' : '');
      }
    } catch (e) {
      console.error('加载统计失败:', e);
    }
  },

  async checkWechat() {
    const dot  = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const body = document.getElementById('connection-body');

    dot.className  = 'status-dot checking';
    text.textContent = '正在检测...';
    body.innerHTML = '<div class="connection-checking"><div class="spinner"></div><span>正在检测微信进程...</span></div>';

    try {
      const result = await window.electronAPI.findWechat();
      if (result.found) {
        const { rect } = result;
        dot.className  = 'status-dot connected';
        text.textContent = '微信已连接';
        body.innerHTML = `
          <div class="connection-found">
            <div style="font-size:32px">💬</div>
            <div class="wechat-info">
              <div class="wechat-name">微信 WeChat</div>
              <div class="wechat-pos">窗口位置: ${rect.left},${rect.top}  尺寸: ${rect.width}×${rect.height}</div>
            </div>
            <div class="wechat-badge">
              <span>●</span> 已就绪
            </div>
          </div>`;
      } else {
        dot.className  = 'status-dot error';
        text.textContent = '微信未检测到';
        body.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;color:var(--text-muted)">
            <span style="font-size:28px">⚠️</span>
            <div>
              <div style="font-weight:600;color:var(--amber)">未检测到微信窗口</div>
              <div style="font-size:12px;margin-top:4px">请确保微信已在桌面运行并登录，发送任务时将自动激活微信</div>
            </div>
          </div>`;
      }
    } catch (e) {
      dot.className  = 'status-dot error';
      text.textContent = '检测失败';
      body.innerHTML = `<div style="color:var(--red);font-size:13px">检测失败: ${escapeHtml(e.message)}</div>`;
    }
  },

  async loadRecentTasks() {
    try {
      const tasks   = await window.electronAPI.getTasks();
      AppState.tasks = tasks;
      const container = document.getElementById('recent-tasks');

      if (!tasks.length) {
        container.innerHTML = `
          <div class="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
              <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
            </svg>
            <p>暂无任务，点击「快速发送」创建任务</p>
          </div>`;
        return;
      }

      const recent = tasks.slice(0, 5);
      container.innerHTML = recent.map(t => `
        <div class="task-item glass-card" style="cursor:pointer" onclick="switchPage('tasks')">
          <div class="task-status-badge ${t.status}"></div>
          <div class="task-info">
            <div class="task-name">${escapeHtml(t.name)}</div>
            <div class="task-desc">
              ${t.schedule_type === 'cron' ? `定时: ${t.schedule_cron}` : (t.schedule_once_at ? `执行时间: ${formatDate(t.schedule_once_at)}` : '立即执行')}
              · 上次运行: ${timeAgo(t.last_run_at)}
            </div>
          </div>
          <span class="task-status-label ${t.status}">${getStatusLabel(t.status)}</span>
          <div class="task-meta">
            <span>✓ ${t.total_sent}</span>
            ${t.total_failed ? `<span style="color:var(--red)">✗ ${t.total_failed}</span>` : ''}
          </div>
        </div>
      `).join('');
    } catch (e) {
      console.error('加载最近任务失败:', e);
    }
  }
};

// 绑定检测按钮
document.getElementById('btn-detect-wechat')?.addEventListener('click', () => DashboardPage.checkWechat());

// 快速发送
document.getElementById('btn-quick-send')?.addEventListener('click', () => {
  switchPage('tasks');
  setTimeout(() => document.getElementById('btn-create-task')?.click(), 100);
});
