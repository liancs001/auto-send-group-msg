/**
 * logs.js - 发送日志页面
 */
window.LogsPage = {
  statusFilter: 'all',

  async load() {
    try {
      const logs = await window.electronAPI.getLogs(500);
      this.render(logs);
    } catch (e) {
      showToast('加载日志失败: ' + e.message, 'error');
    }
  },

  render(logs) {
    const tbody = document.getElementById('logs-table-body');
    const statusFilter = this.statusFilter;
    const dateFilter   = document.getElementById('log-date-filter')?.value;

    let list = logs;
    if (statusFilter !== 'all') list = list.filter(l => l.status === statusFilter);
    if (dateFilter) list = list.filter(l => l.sent_at?.slice(0, 10) === dateFilter);

    if (!list.length) {
      tbody.innerHTML = `
        <tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted)">
          暂无日志记录
        </td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(l => `
      <tr>
        <td style="white-space:nowrap;font-size:12px">${formatDate(l.sent_at)}</td>
        <td>
          <span style="font-weight:500">${escapeHtml(l.group_name)}</span>
          ${l.group_keyword ? `<br><span style="font-size:11px;color:var(--text-muted)">${escapeHtml(l.group_keyword)}</span>` : ''}
        </td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${l.has_image ? '📷 ' : ''}${escapeHtml(l.message_content || '--')}
        </td>
        <td style="color:var(--text-muted)">${escapeHtml(l.task_name || '--')}</td>
        <td>
          <span class="log-status-badge ${l.status}">
            ${l.status === 'success' ? '✓ 成功' : '✗ 失败'}
          </span>
          ${l.error_msg ? `<br><span style="font-size:11px;color:var(--red)">${escapeHtml(l.error_msg)}</span>` : ''}
        </td>
        <td style="color:var(--text-muted)">${l.duration ? l.duration + 'ms' : '--'}</td>
      </tr>`).join('');
  }
};

// 状态过滤
document.getElementById('log-status-filter')?.addEventListener('change', (e) => {
  LogsPage.statusFilter = e.target.value;
  LogsPage.load();
});

// 日期过滤
document.getElementById('log-date-filter')?.addEventListener('change', () => LogsPage.load());

// 清空日志
document.getElementById('btn-clear-logs')?.addEventListener('click', async () => {
  if (!confirm('确定清空所有发送日志？此操作不可撤销。')) return;
  try {
    await window.electronAPI.clearLogs();
    showToast('日志已清空', 'success');
    LogsPage.load();
    DashboardPage.loadStats();
  } catch (e) {
    showToast('清空失败: ' + e.message, 'error');
  }
});
