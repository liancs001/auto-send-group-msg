/**
 * tasks.js - 发送任务页面（支持多模板关联）
 */
console.log('=== TASKS.JS 文件开始加载 ===');

window.TasksPage = {
  async load() {
    try {
      const tasks = await window.electronAPI.getTasks();
      AppState.tasks = tasks;
      this.render(tasks);
    } catch (e) {
      showToast('加载任务失败: ' + e.message, 'error');
    }
  },

  render(tasks) {
    const container = document.getElementById('tasks-list');
    if (!tasks.length) {
      container.innerHTML = `
        <div class="empty-state glass-card" style="padding:60px 20px">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
            <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
          <p>暂无任务，点击「新建任务」开始</p>
        </div>`;
      return;
    }

    container.innerHTML = tasks.map(t => {
      const groupCount = (t.group_ids?.length || 0) + (t.category_ids?.length > 0 ? '(+分类)' : '');
      const tplCount = (t.template_ids?.length || 0) || (t.template_id ? 1 : (t.message_content ? 1 : 0));
      // 计算预计总发送条数
      const totalGroups = (t.group_ids?.length || 0); // 简化显示，不含分类展开
      const estimatedTotal = tplCount * Math.max(totalGroups, 1);

      const scheduleInfo = t.schedule_type === 'cron'
        ? `⏰ ${t.schedule_cron}`
        : (t.schedule_once_at ? `📅 ${formatDate(t.schedule_once_at)}` : '▶ 手动执行');

      const isRunning = t.status === 'running';

      return `
        <div class="task-item glass-card" data-id="${t.id}">
          <div class="task-status-badge ${t.status}"></div>
          <div class="task-info">
            <div class="task-name">${escapeHtml(t.name)}</div>
            <div class="task-desc">
              ${scheduleInfo}
              &nbsp;·&nbsp; 模板 ${tplCount}
              &nbsp;·&nbsp; 群组 ${groupCount}
              &nbsp;·&nbsp; 共约 ${estimatedTotal} 条
              &nbsp;·&nbsp; 间隔 ${t.interval_min}~${t.interval_max}s
              &nbsp;·&nbsp; 上次: ${timeAgo(t.last_run_at)}
            </div>
          </div>
          <div class="task-meta">
            <span class="task-status-label ${t.status}">${getStatusLabel(t.status)}</span>
            <span>✓ ${t.total_sent}</span>
            ${t.total_failed ? `<span style="color:var(--red)">✗ ${t.total_failed}</span>` : ''}
          </div>
          <div class="task-actions">
            ${isRunning
              ? `<button class="btn btn-sm btn-danger" onclick="TasksPage.stopTask('${t.id}')">停止</button>`
              : `<button class="btn btn-sm btn-success" onclick="TasksPage.startTask('${t.id}')">
                   <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                   执行
                 </button>`
            }
            <button class="icon-btn" onclick="TasksPage.editTask('${t.id}')" title="编辑">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="icon-btn danger" onclick="TasksPage.deleteTask('${t.id}')" title="删除">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
            </button>
          </div>
        </div>`;
    }).join('');
  },

  async startTask(id) {
    const task = AppState.tasks.find(t => t.id === id);
    if (!task) return;
    try {
      showProgress(id, `执行任务「${task.name}」...`);
      addRealtimeLog(`开始执行任务: ${task.name}`, 'info');
      const result = await window.electronAPI.startTask(id);
      if (!result.success) {
        hideProgress();
        showToast('启动失败: ' + (result.error || '未知错误'), 'error');
      }
    } catch (e) {
      hideProgress();
      showToast('启动失败: ' + e.message, 'error');
    }
  },

  async stopTask(id) {
    if (!confirm('确定要停止该任务吗？')) return;
    try {
      await window.electronAPI.stopTask(id);
      showToast('任务已停止', 'warning');
      hideProgress();
      this.load();
    } catch (e) {
      showToast('停止失败: ' + e.message, 'error');
    }
  },

  editTask(id) {
    const task = AppState.tasks.find(t => t.id === id);
    if (task) showTaskModal(task);
  },

  async deleteTask(id) {
    const task = AppState.tasks.find(t => t.id === id);
    if (!task) return;
    if (task.status === 'running') { showToast('请先停止正在运行的任务', 'warning'); return; }
    if (!confirm(`确定删除任务「${task.name}」？`)) return;
    try {
      await window.electronAPI.deleteTask(id);
      showToast('任务已删除', 'success');
      this.load();
    } catch (e) {
      showToast('删除失败: ' + e.message, 'error');
    }
  },
};

// ══════════════════════════════
//  新建任务按钮 — 三层保险
// ══════════════════════════════

// 第一层：直接绑定（DOM 就绪后）
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindTaskButtonEvents);
} else {
  bindTaskButtonEvents();
}

// 第二层：事件委托（document 级别，永远有效）
document.addEventListener('click', (e) => {
  // 检查点击的是否是新建任务按钮或其子元素
  const btn = e.target.closest('#btn-create-task');
  if (btn) {
    console.log('[Tasks-委托] 新建任务按钮被点击（事件委托）');
    e.preventDefault();
    e.stopPropagation();
    handleCreateTaskClick();
  }
}, true); // 捕获阶段，优先于其他处理器

async function handleCreateTaskClick() {
  try {
    console.log('[Tasks] 调用 showTaskModal...');
    const result = await showTaskModal(null);
    console.log('[Tasks] showTaskModal 返回:', result);
  } catch (err) {
    console.error('[Tasks] 新建任务失败:', err);
    showToast('打开新建任务失败: ' + err.message, 'error');
  }
}

function bindTaskButtonEvents() {
  const btn = document.getElementById('btn-create-task');
  console.log('[Tasks] 直接绑定按钮事件, btn=', !!btn, 'readyState=', document.readyState);
  if (!btn) {
    console.warn('[Tasks] ⚠️ 找不到 #btn-create-task 元素！当前页面:', document.querySelector('.page.active')?.id);
    // 延迟重试一次（页面可能还没切换到 tasks）
    setTimeout(() => {
      const retryBtn = document.getElementById('btn-create-task');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => { handleCreateTaskClick(); });
        console.log('[Tasks] 延迟重试绑定成功!');
      }
    }, 500);
    return;
  }
  btn.addEventListener('click', () => { handleCreateTaskClick(); });
  console.log('[Tasks] ✅ 按钮直接绑定成功');
}

// ==============================
//  任务创建/编辑 Modal（多模板版）
// ==============================

// 模板多选器弹窗
function showTemplatePickerModal(currentSelectedIds, onSelectCallback) {
  const templates = AppState.templates || [];

  const content = `
    <div style="margin-bottom:12px">
      <input class="input" id="tpl-search-input" placeholder="搜索模板名称..." 
             style="width:100%" oninput="window._filterTplPickers(this.value)">
    </div>
    <div id="tpl-picker-list" style="max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:6px">
      ${templates.length ? templates.map(t => `
        <div class="tpl-picker-item ${currentSelectedIds.includes(t.id) ? 'selected' : ''}" data-tpl-id="${t.id}" 
             onclick="window._toggleTplPick(this)" style="
               padding:10px 12px;border-radius:8px;border:1px solid var(--border);
               cursor:pointer;display:flex;align-items:center;gap:10px;
               transition:all 0.15s;background:${currentSelectedIds.includes(t.id) ? 'var(--bg-active)' : 'var(--bg-card)'}
             ">
          <div style="
            width:22px;height:22px;border-radius:6px;border:2px solid ${currentSelectedIds.includes(t.id) ? 'var(--primary)' : 'var(--border)'};
            display:flex;align-items:center;justify-content:center;flex-shrink:0;
            background:${currentSelectedIds.includes(t.id) ? 'var(--primary)' : 'transparent'};
            color:${currentSelectedIds.includes(t.id) ? '#fff' : 'transparent'};font-size:12px
          ">${currentSelectedIds.includes(t.id) ? '✓' : ''}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:500;font-size:13px">${escapeHtml(t.name)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.content.substring(0, 60))}${t.content.length > 60 ? '...' : ''}</div>
          </div>
          ${t.images?.length ? `<span style="font-size:11px;color:var(--purple);white-space:nowrap">📷${t.images.length}</span>` : ''}
        </div>
      `).join('') : '<div style="color:var(--text-muted);padding:20px;text-align:center">暂无模板，请先在「消息模板」页面创建</div>'}
    </div>
    <div style="margin-top:12px;display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted)">
      <span>已选 <strong id="tpl-picker-count" style="color:var(--primary)">${currentSelectedIds.length}</strong> 个模板</span>
    </div>
  `;

  showModal('选择消息模板', content, () => {
    // 确认时回调
    const selected = currentSelectedIds.slice(); // 已通过 _toggleTplPick 维护
    if (selected.length === 0) { showToast('请至少选择一个模板', 'warning'); return false; }
    onSelectCallback(selected);
    return true;
  }, { width: 520 });

  setTimeout(() => {
    // 搜索过滤
    window._filterTplPickers = (keyword) => {
      const kw = keyword.toLowerCase().trim();
      document.querySelectorAll('#tpl-picker-list .tpl-picker-item').forEach(el => {
        const name = el.querySelector('div[style*="font-weight"]')?.textContent || '';
        el.style.display = (!kw || name.toLowerCase().includes(kw)) ? '' : 'none';
      });
    };

    // 切换选中状态
    window._toggleTplPick = (el) => {
      const tplId = el.dataset.tplId;
      const idx = currentSelectedIds.indexOf(tplId);
      const checkMark = el.querySelector('div[style*="width:22px"]');

      if (idx >= 0) {
        currentSelectedIds.splice(idx, 1);
        el.classList.remove('selected');
        el.style.background = 'var(--bg-card)';
        checkMark.style.borderColor = 'var(--border)';
        checkMark.style.background = 'transparent';
        checkMark.style.color = 'transparent';
        checkMark.textContent = '';
      } else {
        currentSelectedIds.push(tplId);
        el.classList.add('selected');
        el.style.background = 'var(--bg-active)';
        checkMark.style.borderColor = 'var(--primary)';
        checkMark.style.background = 'var(--primary)';
        checkMark.style.color = '#fff';
        checkMark.textContent = '✓';
      }

      const countEl = document.getElementById('tpl-picker-count');
      if (countEl) countEl.textContent = currentSelectedIds.length;
    };
  }, 50);
}

async function showTaskModal(task) {
  console.log('[showTaskModal] 开始, task=', !!task);
  const isEdit = !!task;

  // 步骤1: 加载数据
  try {
    var [groups, cats, templates] = await Promise.all([
      window.electronAPI.getGroups(),
      window.electronAPI.getCategories(),
      window.electronAPI.getTemplates()
    ]);
    console.log('[showTaskModal] 数据加载完成:', groups.length, '群', templates.length, '模板');
  } catch (dataErr) {
    console.error('[showTaskModal] 数据加载失败:', dataErr);
    showToast('加载数据失败，请重试', 'error');
    throw dataErr;
  }

  // ── 多模板选择（核心改造）──
  let selectedTemplateIds = [];
  if (task?.template_ids?.length) {
    selectedTemplateIds = [...task.template_ids];
  } else if (task?.template_id) {
    // 兼容旧数据：单个 template_id
    selectedTemplateIds = [task.template_id];
  }

  let selectedGroupIds    = [...(task?.group_ids || [])];
  let selectedCategoryIds = [...(task?.category_ids || [])];

  // 渲染已选模板卡片
  function renderSelectedTemplateCards() {
    const selectedTpls = templates.filter(t => selectedTemplateIds.includes(t.id));
    return selectedTpls.map((t, i) => `
      <div class="selected-tpl-card" style="
        display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;
        border:1px solid var(--border);background:var(--bg-input);position:relative
      " data-tpl-idx="${i}">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px">
            <span style="color:var(--primary);font-size:11px;background:var(--primary);color:#fff;padding:1px 6px;border-radius:4px">${i + 1}</span>
            ${escapeHtml(t.name)}
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:380px">
            ${escapeHtml(t.content.substring(0, 80))}${t.content.length > 80 ? '...' : ''}
          </div>
          <div style="display:flex;gap:8px;margin-top:4px;font-size:11px;color:var(--text-muted)">
            ${t.images?.length ? `<span>📷 ${t.images.length}张图片</span>` : '<span>纯文字</span>'}
            <span>使用 ${t.use_count || 0} 次</span>
          </div>
        </div>
        <button class="icon-btn danger" style="flex-shrink:0"
                onclick="event.stopPropagation();window._removeTplFromTask(${i})" title="移除此模板">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `).join('');
  }

  window._removeTplFromTask = (idx) => {
    selectedTemplateIds.splice(idx, 1);
    updateTemplateSection();
  };

  function updateTemplateSection() {
    const cardsContainer = document.getElementById('selected-tpl-cards');
    if (cardsContainer) {
      const html = renderSelectedTemplateCards();
      cardsContainer.innerHTML = html;

      const previewEl = document.getElementById('send-order-preview');
      if (previewEl) {
        const groupTotal = selectedGroupIds.length + (selectedCategoryIds.length ? '+' : '');
        const tplTotal = selectedTemplateIds.length;
        const totalEstimate = tplTotal * Math.max(selectedGroupIds.length, 1);

        if (tplTotal > 0 && (selectedGroupIds.length > 0 || selectedCategoryIds.length > 0)) {
          let orderLines = selectedTemplateIds.map((tid, i) => {
            const tpl = templates.find(t => t.id === tid);
            const tplName = tpl ? tpl.name : `模板${i + 1}`;
            return `  <div style="display:flex;align-items:center;gap:6px;padding:3px 0"><span style="color:var(--primary);font-size:11px">${String(i + 1).padStart(2, '0')}</span>${escapeHtml(tplName)} → 全部群(${groupTotal})</div>`;
          }).join('');

          previewEl.innerHTML = `
            <div style="font-size:12px">${orderLines}</div>
            <div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border);color:var(--primary);font-weight:600;font-size:13px">
              共 ${totalEstimate} 条发送（${tplTotal} 模板 × ${groupTotal} 群）
            </div>
          `;
        } else {
          previewEl.innerHTML = '<span style="color:var(--text-muted);font-size:12px">请先选择模板和群组</span>';
        }
      }
    }

    // 更新添加按钮文字
    const addBtn = document.getElementById('btn-add-template');
    if (addBtn) {
      addBtn.innerHTML = selectedTemplateIds.length > 0
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg> 继续添加模板`
        : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg> 选择要发送的模板`;
    }
  }

  // 群组选择器 HTML
  const groupSelHtml = groups.length
    ? groups.map(g => `
      <div class="group-selector-item">
        <input type="checkbox" id="gs-${g.id}" value="${g.id}" ${selectedGroupIds.includes(g.id) ? 'checked' : ''} onchange="window._taskToggleGroup('${g.id}',this.checked)">
        <label for="gs-${g.id}" style="flex:1;cursor:pointer">${escapeHtml(g.name)} <span style="color:var(--text-muted);font-size:11px">${escapeHtml(g.keyword)}</span></label>
        ${g.category_name ? `<span class="badge badge-purple" style="font-size:10px">${escapeHtml(g.category_name)}</span>` : ''}
      </div>`).join('')
    : '<div style="color:var(--text-muted);font-size:13px;padding:8px">暂无群组，请先在「群组管理」添加</div>';

  // 分类选择器 HTML
  const catSelHtml = cats.length
    ? cats.map(c => `
      <div class="group-selector-item">
        <input type="checkbox" id="cs-${c.id}" value="${c.id}" ${selectedCategoryIds.includes(c.id) ? 'checked' : ''} onchange="window._taskToggleCat('${c.id}',this.checked)">
        <label for="cs-${c.id}" style="flex:1;cursor:pointer;display:flex;align-items:center;gap:8px">
          <span style="width:10px;height:10px;border-radius:50%;background:${c.color};display:inline-block"></span>
          ${escapeHtml(c.name)}
        </label>
      </div>`).join('')
    : '';

  window._taskToggleGroup = (id, checked) => {
    if (checked) { if (!selectedGroupIds.includes(id)) selectedGroupIds.push(id); }
    else selectedGroupIds = selectedGroupIds.filter(x => x !== id);
    updateTemplateSection();
  };
  window._taskToggleCat = (id, checked) => {
    if (checked) { if (!selectedCategoryIds.includes(id)) selectedCategoryIds.push(id); }
    else selectedCategoryIds = selectedCategoryIds.filter(x => x !== id);
    updateTemplateSection();
  };

  const schedType = task?.schedule_type || 'once';
  const cronPresets = [
    { label: '每天9点',  val: '0 9 * * *' },
    { label: '每天18点', val: '0 18 * * *' },
    { label: '周一9点',  val: '0 9 * * 1' },
    { label: '每小时',   val: '0 * * * *' }
  ];

  const content = `
    <!-- 基本信息 -->
    <div class="form-group">
      <label class="form-label">任务名称 <span class="form-required">*</span></label>
      <input class="input" id="m-task-name" placeholder="例如：周会通知发送" value="${escapeHtml(task?.name || '')}">
    </div>

    <!-- ══════════════════ 关联消息模板（新） ══════════════════ -->
    <div class="form-group">
      <label class="form-label">🔖 关联消息模板 <span class="form-required">*</span></label>

      <!-- 添加模板按钮 -->
      <button type="button" class="btn btn-outline" id="btn-add-template" style="width:100%;padding:14px;border-style:dashed;margin-bottom:10px"
              onclick="showTemplatePickerModal(window._getCurrentTplIds(), (ids)=>{window._setTplIds(ids)})">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        ${selectedTemplateIds.length > 0 ? '继续添加模板' : '选择要发送的模板'}
      </button>

      <!-- 已选模板卡片列表 -->
      <div id="selected-tpl-cards" style="display:flex;flex-direction:column;gap:8px">
        ${renderSelectedTemplateCards()}
      </div>

      ${!selectedTemplateIds.length ? '<div style="font-size:12px;color:var(--text-muted);margin-top:6px">点击上方按钮选择一个或多个消息模板，执行时将按顺序依次发送到所有群组</div>' : ''}

      <!-- 发送顺序预览 -->
      <div style="margin-top:12px;padding:10px 12px;border-radius:8px;background:rgba(124,58,237,0.06);border:1px solid rgba(124,58,237,0.15)">
        <div style="font-size:12px;font-weight:600;color:var(--primary);margin-bottom:6px">📋 发送顺序预览：</div>
        <div id="send-order-preview" style="font-size:12px">
          ${(() => {
            const gt = selectedGroupIds.length + (selectedCategoryIds.length ? '+' : '');
            const tt = selectedTemplateIds.length;
            const te = tt * Math.max(selectedGroupIds.length, 1);
            if (tt > 0 && (selectedGroupIds.length > 0 || selectedCategoryIds.length > 0)) {
              return selectedTemplateIds.map((tid, i) => {
                const tp = templates.find(t => t.id === tid);
                return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0"><span style="color:var(--primary);font-size:11px">${String(i+1).padStart(2,'0')}</span>${tp?escapeHtml(tp.name):'模板'+(i+1)} → 全部群(${gt})</div>`;
              }).join('') + `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(124,58,237,0.2);color:var(--primary);font-weight:600;font-size:13px">共 ${te} 条发送（${tt} 模板 × ${gt} 群）</div>`;
            }
            return '<span style="color:var(--text-muted)">请先选择模板和群组</span>';
          })()}
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <!-- 目标群组 -->
    <div class="form-group">
      <label class="form-label">目标群组 <span class="form-required">*</span></label>
      <div style="background:var(--bg-input);border:1px solid var(--border);border-radius:8px;padding:4px;max-height:160px;overflow-y:auto">
        <div class="group-selector">${groupSelHtml}</div>
      </div>
      ${catSelHtml ? `
        <div style="margin-top:8px">
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">或选择整个分类：</div>
          <div style="background:var(--bg-input);border:1px solid var(--border);border-radius:8px;padding:4px">
            <div class="group-selector">${catSelHtml}</div>
          </div>
        </div>` : ''}
    </div>

    <div class="divider"></div>

    <!-- 发送间隔 -->
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">最小间隔 (秒)</label>
        <input class="input" type="number" id="m-task-min" min="1" max="300" value="${task?.interval_min || 5}">
      </div>
      <div class="form-group">
        <label class="form-label">最大间隔 (秒)</label>
        <input class="input" type="number" id="m-task-max" min="1" max="600" value="${task?.interval_max || 15}">
      </div>
      <div style="font-size:11px;color:var(--text-muted);max-width:180px;padding-top:20px">
        ⏱ 群间等待此区间<br>模板间自动 ×2 倍
      </div>
    </div>

    <div class="divider"></div>

    <!-- 执行计划 -->
    <div class="form-group">
      <label class="form-label">执行计划</label>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="radio" name="m-sched-type" value="immediate" ${schedType==='immediate'||schedType==='once'&& !task?.schedule_once_at?'checked':''}>
          <span style="font-size:13px">立即执行</span>
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="radio" name="m-sched-type" value="once" ${schedType==='once'&&task?.schedule_once_at?'checked':''}>
          <span style="font-size:13px">定时执行（一次）</span>
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="radio" name="m-sched-type" value="cron" ${schedType==='cron'?'checked':''}>
          <span style="font-size:13px">周期执行（Cron）</span>
        </label>
      </div>

      <div id="m-sched-once" style="display:${schedType==='once'&&task?.schedule_once_at?'block':'none'}">
        <input class="input" type="datetime-local" id="m-task-once-at" value="${task?.schedule_once_at ? task.schedule_once_at.slice(0,16) : ''}">
      </div>

      <div id="m-sched-cron" style="display:${schedType==='cron'?'block':'none'}">
        <input class="input" id="m-task-cron" placeholder="Cron表达式，如: 0 9 * * 1" value="${task?.schedule_cron || ''}">
        <div class="cron-presets">
          ${cronPresets.map(p => `<span class="cron-preset" onclick="document.getElementById('m-task-cron').value='${p.val}'">${p.label}</span>`).join('')}
        </div>
        <div class="form-hint">格式: 分 时 日 月 周 | 如 <code>0 9 * * 1</code> 表示每周一9点</div>
      </div>
    </div>`;

  // 暴露给模板选择器的 getter/setter
  window._getCurrentTplIds = () => [...selectedTemplateIds];
  window._setTplIds = (ids) => {
    selectedTemplateIds = ids;
    updateTemplateSection();
  };

  // 监听计划类型切换
  const setupRadioListeners = () => {
    document.querySelectorAll('input[name="m-sched-type"]').forEach(r => {
      r.addEventListener('change', () => {
        document.getElementById('m-sched-once').style.display = r.value === 'once' ? 'block' : 'none';
        document.getElementById('m-sched-cron').style.display = r.value === 'cron' ? 'block' : 'none';
      });
    });
  };

  console.log('[showTaskModal] 准备调用 showModal, title=', isEdit ? '编辑任务' : '新建任务');
  try {
    showModal(isEdit ? '编辑任务' : '新建任务', content, async () => {
    const name    = document.getElementById('m-task-name').value.trim();
    const minInt  = parseInt(document.getElementById('m-task-min').value) || 5;
    const maxInt  = parseInt(document.getElementById('m-task-max').value) || 15;
    const schedType = document.querySelector('input[name="m-sched-type"]:checked')?.value || 'immediate';

    if (!name) { showToast('请输入任务名称', 'warning'); return false; }
    if (!selectedTemplateIds.length) { showToast('请至少选择一个消息模板', 'warning'); return false; }
    if (selectedGroupIds.length === 0 && selectedCategoryIds.length === 0) {
      showToast('请至少选择一个群组或分类', 'warning'); return false;
    }

    let schedule_type = 'once';
    let schedule_cron = null;
    let schedule_once_at = null;

    if (schedType === 'cron') {
      schedule_type = 'cron';
      schedule_cron = document.getElementById('m-task-cron').value.trim();
      if (!schedule_cron) { showToast('请输入Cron表达式', 'warning'); return false; }
    } else if (schedType === 'once') {
      schedule_type = 'once';
      schedule_once_at = document.getElementById('m-task-once-at').value;
      if (!schedule_once_at) { showToast('请选择执行时间', 'warning'); return false; }
    }

    try {
      await window.electronAPI.saveTask({
        ...task,
        name,
        group_ids:     selectedGroupIds,
        category_ids:  selectedCategoryIds,
        template_ids:  selectedTemplateIds,   // 新字段：多模板 ID 数组
        interval_min:  minInt,
        interval_max:  maxInt,
        schedule_type,
        schedule_cron,
        schedule_once_at
      });
      showToast(isEdit ? '任务已更新' : '任务已创建', 'success');
      TasksPage.load();
      DashboardPage.loadRecentTasks?.();
    } catch (err) {
      showToast('保存失败: ' + err.message, 'error');
      return false;
    }
  }, { width: 680 });
  console.log('[showTaskModal] showModal 调用完成');
  } catch (modalErr) {
    console.error('[showTaskModal] showModal 抛出异常:', modalErr);
    showToast('打开任务窗口失败: ' + modalErr.message, 'error');
  }

  setTimeout(setupRadioListeners, 60);
}
