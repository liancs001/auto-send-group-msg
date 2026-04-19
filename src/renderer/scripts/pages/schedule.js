/**
 * schedule.js - 日程计划页面（日历视图）
 */
window.SchedulePage = {
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(),

  async load() {
    const tasks = await window.electronAPI.getTasks();
    AppState.tasks = tasks;
    this.renderCalendar(tasks);
    this.renderTodaySchedules(tasks);
  },

  renderCalendar(tasks) {
    const container = document.getElementById('schedule-calendar');
    if (!container) return;

    const year  = this.currentYear;
    const month = this.currentMonth;
    const today = new Date();

    // 找出有任务的日期
    const taskDates = new Set();
    tasks.forEach(t => {
      if (t.schedule_once_at) {
        const d = new Date(t.schedule_once_at);
        if (d.getFullYear() === year && d.getMonth() === month) {
          taskDates.add(d.getDate());
        }
      }
      if (t.schedule_type === 'cron' && (t.status === 'scheduled' || t.status === 'running')) {
        // cron 任务标记整个月都有
        for (let i = 1; i <= 31; i++) taskDates.add(i);
      }
    });

    const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    const dayLabels  = ['日','一','二','三','四','五','六'];

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevDays = new Date(year, month, 0).getDate();

    let daysHtml = dayLabels.map(d => `<div class="calendar-day-label">${d}</div>`).join('');

    // 上月补位
    for (let i = firstDay - 1; i >= 0; i--) {
      daysHtml += `<div class="calendar-day other-month">${prevDays - i}</div>`;
    }

    // 本月
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
      const hasTask = taskDates.has(d);
      daysHtml += `<div class="calendar-day ${isToday ? 'today' : ''} ${hasTask ? 'has-task' : ''}" 
                        data-day="${d}" onclick="SchedulePage.onDayClick(${d})" title="${hasTask ? '有任务' : ''}">${d}</div>`;
    }

    // 下月补位
    const total = firstDay + daysInMonth;
    const remaining = total % 7 === 0 ? 0 : 7 - (total % 7);
    for (let i = 1; i <= remaining; i++) {
      daysHtml += `<div class="calendar-day other-month">${i}</div>`;
    }

    container.innerHTML = `
      <div class="calendar-header">
        <button class="icon-btn" onclick="SchedulePage.prevMonth()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span class="calendar-title">${year}年 ${monthNames[month]}</span>
        <button class="icon-btn" onclick="SchedulePage.nextMonth()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
      <div class="calendar-grid">${daysHtml}</div>`;
  },

  renderTodaySchedules(tasks) {
    const container = document.getElementById('today-schedules');
    if (!container) return;

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    const todayTasks = tasks.filter(t => {
      if (t.schedule_type === 'cron' && (t.status === 'scheduled' || t.status === 'running')) return true;
      if (t.schedule_once_at) {
        return t.schedule_once_at.slice(0, 10) === todayStr;
      }
      return false;
    });

    if (!todayTasks.length) {
      container.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:12px 0">今日暂无计划任务</div>`;
      return;
    }

    container.innerHTML = todayTasks.map(t => {
      const timeStr = t.schedule_once_at
        ? new Date(t.schedule_once_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        : (t.schedule_cron || '定时');
      return `
        <div class="schedule-item">
          <span class="schedule-time">${timeStr}</span>
          <div class="schedule-info">
            <div class="schedule-task-name">${escapeHtml(t.name)}</div>
            <div class="schedule-task-groups">${getStatusLabel(t.status)} · ${t.group_ids?.length || 0} 个群组</div>
          </div>
          <span class="task-status-badge ${t.status}" style="flex-shrink:0"></span>
        </div>`;
    }).join('');
  },

  prevMonth() {
    if (this.currentMonth === 0) { this.currentMonth = 11; this.currentYear--; }
    else this.currentMonth--;
    this.renderCalendar(AppState.tasks);
  },

  nextMonth() {
    if (this.currentMonth === 11) { this.currentMonth = 0; this.currentYear++; }
    else this.currentMonth++;
    this.renderCalendar(AppState.tasks);
  },

  onDayClick(day) {
    const tasksDayList = AppState.tasks.filter(t => {
      if (!t.schedule_once_at) return false;
      const d = new Date(t.schedule_once_at);
      return d.getDate() === day && d.getMonth() === this.currentMonth && d.getFullYear() === this.currentYear;
    });
    if (tasksDayList.length) {
      const info = tasksDayList.map(t => `· ${t.name} (${formatDate(t.schedule_once_at)})`).join('\n');
      alert(`${this.currentYear}年${this.currentMonth+1}月${day}日 的任务：\n\n${info}`);
    }
  }
};
