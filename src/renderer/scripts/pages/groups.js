/**
 * groups.js - 群组管理页面
 */
window.GroupsPage = {
  filterKeyword: '',
  filterCategory: 'all',

  async load() {
    try {
      const [groups, cats] = await Promise.all([
        window.electronAPI.getGroups(),
        window.electronAPI.getCategories()
      ]);
      AppState.groups     = groups;
      AppState.categories = cats;
      this.renderCategoryTabs(cats);
      this.renderGroups(groups, cats);
    } catch (e) {
      showToast('加载群组失败: ' + e.message, 'error');
    }
  },

  renderCategoryTabs(cats) {
    const bar = document.getElementById('category-filter-tabs');
    bar.innerHTML = `<button class="filter-tab ${this.filterCategory === 'all' ? 'active' : ''}" data-category="all">全部</button>`;
    cats.forEach(c => {
      const btn = document.createElement('button');
      btn.className = `filter-tab ${this.filterCategory === c.id ? 'active' : ''}`;
      btn.dataset.category = c.id;
      btn.textContent = c.name;
      btn.style.borderColor = this.filterCategory === c.id ? c.color : '';
      btn.style.color       = this.filterCategory === c.id ? c.color : '';
      bar.appendChild(btn);
    });

    bar.querySelectorAll('.filter-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.filterCategory = btn.dataset.category;
        this.load();
      });
    });
  },

  renderGroups(groups, cats) {
    let list = groups;

    if (this.filterKeyword) {
      const kw = this.filterKeyword.toLowerCase();
      list = list.filter(g => {
        const kwMatch = (g.keywords || []).some(k => k.toLowerCase().includes(kw));
        return g.name.toLowerCase().includes(kw) || kwMatch;
      });
    }
    if (this.filterCategory !== 'all') {
      list = list.filter(g => g.category_id === this.filterCategory);
    }

    const grid = document.getElementById('groups-grid');

    if (!list.length) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
          </svg>
          <p>没有找到群组，点击「添加群组」开始</p>
        </div>`;
      return;
    }

    grid.innerHTML = list.map(g => {
      const initials = (g.name || '?')[0];
      const catColor = g.category_color || '#6366f1';
      const keywords = g.keywords || (g.keyword ? [g.keyword] : []);
      const kwTags = keywords.map(k =>
        `<span class="group-keyword" style="margin:2px 2px 0 0">${escapeHtml(k)}</span>`
      ).join('');
      return `
        <div class="group-card ${g.is_active ? '' : 'inactive'}" data-id="${g.id}">
          <div class="group-actions">
            <button class="icon-btn" onclick="GroupsPage.editGroup('${g.id}',event)" title="编辑">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="icon-btn danger" onclick="GroupsPage.deleteGroup('${g.id}',event)" title="删除">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            </button>
          </div>
          <div class="group-card-header">
            <div class="group-avatar" style="background:linear-gradient(135deg,${catColor}99,${catColor}55)">${escapeHtml(initials)}</div>
            <div style="flex:1;min-width:0">
              <div class="group-name">${escapeHtml(g.name)}</div>
              <div style="display:flex;flex-wrap:wrap;margin-top:4px">${kwTags || '<span style="color:var(--text-muted);font-size:11px">无关键词</span>'}</div>
            </div>
          </div>
          ${g.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${escapeHtml(g.notes)}</div>` : ''}
          <div class="group-meta">
            <div>
              ${g.category_name ? `<span class="group-category-badge" style="background:${catColor}22;color:${catColor}">${escapeHtml(g.category_name)}</span>` : '<span style="color:var(--text-muted);font-size:11px">未分类</span>'}
            </div>
            <div style="display:flex;gap:12px">
              <span>发送 ${g.send_count || 0} 次</span>
              <span>${timeAgo(g.last_sent_at)}</span>
            </div>
          </div>
        </div>`;
    }).join('');
  },

  editGroup(id, e) {
    e?.stopPropagation();
    const group = AppState.groups.find(g => g.id === id);
    if (group) showGroupModal(group);
  },

  async deleteGroup(id, e) {
    e?.stopPropagation();
    const group = AppState.groups.find(g => g.id === id);
    if (!group) return;
    if (!confirm(`确定删除群组「${group.name}」？`)) return;
    try {
      await window.electronAPI.deleteGroup(id);
      showToast('群组已删除', 'success');
      this.load();
    } catch (err) {
      showToast('删除失败: ' + err.message, 'error');
    }
  }
};

// 搜索
document.getElementById('group-search-input')?.addEventListener('input', (e) => {
  GroupsPage.filterKeyword = e.target.value.trim();
  GroupsPage.renderGroups(AppState.groups, AppState.categories);
});

// 添加群组按钮
document.getElementById('btn-add-group')?.addEventListener('click', () => showGroupModal(null));

// 添加分类按钮
document.getElementById('btn-add-category')?.addEventListener('click', () => showCategoryModal(null));

// ==============================
//  群组 Modal
// ==============================
async function showGroupModal(group) {
  const cats = AppState.categories;
  const isEdit = !!group;

  const catOptions = cats.map(c =>
    `<option value="${c.id}" ${group?.category_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
  ).join('');

  // 已有关键词列表
  const initKeywords = group?.keywords?.length
    ? group.keywords
    : (group?.keyword ? [group.keyword] : []);

  const content = `
    <div class="form-group">
      <label class="form-label">群组名称 <span class="form-required">*</span></label>
      <input class="input" id="m-group-name" placeholder="例如：班级群" value="${escapeHtml(group?.name || '')}">
    </div>
    <div class="form-group">
      <label class="form-label">搜索关键词 <span class="form-required">*</span></label>
      <div class="kw-tag-box" id="kw-tag-box">
        ${initKeywords.map((k, i) => `
          <span class="kw-tag" data-idx="${i}">
            ${escapeHtml(k)}
            <span class="kw-tag-del" onclick="removeKwTag(${i})">×</span>
          </span>`).join('')}
        <input class="kw-tag-input" id="kw-tag-input"
               placeholder="${initKeywords.length ? '继续输入关键词，回车添加' : '输入关键词，回车添加'}"
               autocomplete="off">
      </div>
      <div class="form-hint">⚡ 每个关键词独立搜索发送，支持模糊匹配。回车 或 逗号 确认添加。</div>
    </div>
    <div class="form-group">
      <label class="form-label">所属分类</label>
      <select class="select-input" id="m-group-category">
        <option value="">-- 无分类 --</option>
        ${catOptions}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">备注</label>
      <textarea class="textarea" id="m-group-notes" rows="2" placeholder="可选备注...">${escapeHtml(group?.notes || '')}</textarea>
    </div>
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <label class="toggle">
          <input type="checkbox" id="m-group-active" ${group?.is_active !== 0 ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <span class="form-label" style="margin:0">启用该群组</span>
      </label>
    </div>`;

  showModal(isEdit ? '编辑群组' : '添加群组', content, async () => {
    const name     = document.getElementById('m-group-name').value.trim();
    const catId    = document.getElementById('m-group-category').value;
    const notes    = document.getElementById('m-group-notes').value.trim();
    const isActive = document.getElementById('m-group-active').checked ? 1 : 0;

    // 收集关键词：已有 Tag + 输入框当前内容
    const tagEls  = document.querySelectorAll('#kw-tag-box .kw-tag');
    const pending = document.getElementById('kw-tag-input')?.value?.trim();
    let keywords  = Array.from(tagEls).map(el => el.childNodes[0].textContent.trim()).filter(Boolean);
    if (pending) keywords.push(pending);
    keywords = [...new Set(keywords)]; // 去重

    if (!name) { showToast('请输入群组名称', 'warning'); return false; }
    if (!keywords.length) { showToast('请至少输入一个搜索关键词', 'warning'); return false; }

    try {
      await window.electronAPI.saveGroup({
        ...group,
        name,
        keyword: keywords[0],   // 兼容旧字段
        keywords,
        category_id: catId || null,
        notes, is_active: isActive
      });
      showToast(isEdit ? '群组已更新' : '群组已添加', 'success');
      GroupsPage.load();
    } catch (err) {
      showToast('保存失败: ' + err.message, 'error');
      return false;
    }
  });

  // 绑定 Tag 输入框事件（Modal DOM 渲染后执行）
  // 用 requestAnimationFrame + 延迟确保 Modal CSS 动画完成后再聚焦
  const setupTagInput = () => {
    const input = document.getElementById('kw-tag-input');
    if (!input) return;

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = input.value.trim().replace(/,/g, '');
        if (val) { addKwTag(val); input.value = ''; }
      } else if (e.key === 'Backspace' && !input.value) {
        const tags = document.querySelectorAll('#kw-tag-box .kw-tag');
        if (tags.length) removeKwTag(parseInt(tags[tags.length - 1].dataset.idx));
      }
    });

    // 点击 TagBox 区域聚焦 input
    document.getElementById('kw-tag-box')?.addEventListener('click', () => input.focus());
  };

  // 确保 Modal 动画完成后聚焦输入框（首次打开需要更长等待）
  const doFocus = () => {
    setupTagInput();
    // 自动聚焦到群组名称输入框（用户最可能首先填写的字段）
    const nameInput = document.getElementById('m-group-name');
    if (nameInput) nameInput.focus();
  };

  // 首次打开 Modal 时 display:none 切换到 flex，浏览器需要额外时间完成布局
  if (document.getElementById('modal-overlay').style.display === 'none') {
    // 首次：等 display 变更后再延迟聚焦
    requestAnimationFrame(() => requestAnimationFrame(() => doFocus()));
  } else {
    // 后续编辑打开：直接延迟即可
    setTimeout(doFocus, 80);
  }
}

// 全局 Tag 操作函数（被 onclick 调用）
window.addKwTag = function(val) {
  const box = document.getElementById('kw-tag-box');
  const input = document.getElementById('kw-tag-input');
  if (!box || !val.trim()) return;
  const existing = Array.from(box.querySelectorAll('.kw-tag')).map(el => el.childNodes[0].textContent.trim());
  if (existing.includes(val.trim())) return; // 去重
  const idx = existing.length;
  const tag = document.createElement('span');
  tag.className = 'kw-tag';
  tag.dataset.idx = idx;
  tag.innerHTML = `${escapeHtml(val.trim())}<span class="kw-tag-del" onclick="removeKwTag(${idx})">×</span>`;
  box.insertBefore(tag, input);
};

window.removeKwTag = function(idx) {
  const box = document.getElementById('kw-tag-box');
  if (!box) return;
  const tags = box.querySelectorAll('.kw-tag');
  tags.forEach(t => { if (parseInt(t.dataset.idx) === idx) t.remove(); });
  // 重新编号
  box.querySelectorAll('.kw-tag').forEach((t, i) => {
    t.dataset.idx = i;
    const del = t.querySelector('.kw-tag-del');
    if (del) del.setAttribute('onclick', `removeKwTag(${i})`);
  });
};

// ==============================
//  分类 Modal
// ==============================
const CATEGORY_COLORS = ['#6366f1','#8b5cf6','#ec4899','#ef4444','#f59e0b','#10b981','#3b82f6','#14b8a6','#f97316'];

function showCategoryModal(category) {
  const isEdit = !!category;
  const selColor = category?.color || CATEGORY_COLORS[0];

  const content = `
    <div class="form-group">
      <label class="form-label">分类名称 <span class="form-required">*</span></label>
      <input class="input" id="m-cat-name" placeholder="例如：工作群" value="${escapeHtml(category?.name || '')}">
    </div>
    <div class="form-group">
      <label class="form-label">颜色</label>
      <div class="color-picker-row">
        ${CATEGORY_COLORS.map(c => `
          <div class="color-dot ${c === selColor ? 'selected' : ''}"
               data-color="${c}"
               style="background:${c}"
               onclick="this.parentElement.querySelectorAll('.color-dot').forEach(d=>d.classList.remove('selected'));this.classList.add('selected')">
          </div>
        `).join('')}
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">描述</label>
      <input class="input" id="m-cat-desc" placeholder="可选描述" value="${escapeHtml(category?.description || '')}">
    </div>`;

  showModal(isEdit ? '编辑分类' : '新建分类', content, async () => {
    const name  = document.getElementById('m-cat-name').value.trim();
    const desc  = document.getElementById('m-cat-desc').value.trim();
    const color = document.querySelector('.color-dot.selected')?.dataset.color || CATEGORY_COLORS[0];

    if (!name) { showToast('请输入分类名称', 'warning'); return false; }

    try {
      await window.electronAPI.saveCategory({ ...category, name, description: desc, color });
      showToast(isEdit ? '分类已更新' : '分类已创建', 'success');
      GroupsPage.load();
    } catch (err) {
      showToast('保存失败: ' + err.message, 'error');
      return false;
    }
  });
}
