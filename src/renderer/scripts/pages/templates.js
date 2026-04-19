/**
 * templates.js - 消息模板页面
 */
window.TemplatesPage = {
  async load() {
    try {
      const templates = await window.electronAPI.getTemplates();
      AppState.templates = templates;
      this.render(templates);
    } catch (e) {
      showToast('加载模板失败: ' + e.message, 'error');
    }
  },

  render(templates) {
    const grid = document.getElementById('templates-grid');
    if (!templates.length) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>
          </svg>
          <p>暂无模板，点击「新建模板」创建</p>
        </div>`;
      return;
    }

    grid.innerHTML = templates.map(t => {
      const imgPreviews = (t.images || []).slice(0, 3).map(p =>
        `<img class="template-img-thumb" src="file://${p}" onerror="this.style.display='none'">`
      ).join('');
      return `
        <div class="template-card" onclick="TemplatesPage.editTemplate('${t.id}')">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div class="template-title">${escapeHtml(t.name)}</div>
            <div style="display:flex;gap:6px">
              <button class="icon-btn" onclick="TemplatesPage.editTemplate('${t.id}',event)" title="编辑">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="icon-btn danger" onclick="TemplatesPage.deleteTemplate('${t.id}',event)" title="删除">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
              </button>
            </div>
          </div>
          <div class="template-preview">${escapeHtml(t.content)}</div>
          <div class="template-footer">
            <div class="template-images-preview">${imgPreviews}</div>
            <div style="display:flex;gap:10px;font-size:11px;color:var(--text-muted)">
              ${t.images?.length ? `<span>📷 ${t.images.length}张图片</span>` : ''}
              <span>使用 ${t.use_count || 0} 次</span>
            </div>
          </div>
        </div>`;
    }).join('');
  },

  editTemplate(id, e) {
    e?.stopPropagation();
    const tpl = AppState.templates.find(t => t.id === id);
    if (tpl) showTemplateModal(tpl);
  },

  async deleteTemplate(id, e) {
    e?.stopPropagation();
    const tpl = AppState.templates.find(t => t.id === id);
    if (!tpl) return;
    if (!confirm(`确定删除模板「${tpl.name}」？`)) return;
    try {
      await window.electronAPI.deleteTemplate(id);
      showToast('模板已删除', 'success');
      this.load();
    } catch (err) {
      showToast('删除失败: ' + err.message, 'error');
    }
  }
};

document.getElementById('btn-add-template')?.addEventListener('click', () => showTemplateModal(null));

// ==============================
//  模板 Modal
// ==============================
async function showTemplateModal(tpl) {
  const isEdit = !!tpl;
  let selectedImages = [...(tpl?.images || [])];

  const renderImgPreviews = () => {
    const container = document.getElementById('m-tpl-img-preview');
    if (!container) return;
    container.innerHTML = selectedImages.map((p, i) => `
      <div class="img-preview-item">
        <img src="file://${p}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22><text y=%2215%22 font-size=%2212%22>❌</text></svg>'">
        <button class="img-remove-btn" onclick="window._tplRemoveImg(${i})" title="删除">×</button>
      </div>
    `).join('');
  };

  window._tplRemoveImg = (i) => {
    selectedImages.splice(i, 1);
    renderImgPreviews();
  };

  const content = `
    <div class="form-group">
      <label class="form-label">模板名称 <span class="form-required">*</span></label>
      <input class="input" id="m-tpl-name" placeholder="给模板起个名字" value="${escapeHtml(tpl?.name || '')}">
    </div>
    <div class="form-group">
      <label class="form-label">消息内容 <span class="form-required">*</span></label>
      <textarea class="textarea" id="m-tpl-content" rows="5" placeholder="输入要发送的消息内容...">${escapeHtml(tpl?.content || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">附带图片</label>
      <div class="image-upload-area" id="m-tpl-upload-area">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 8px;display:block;opacity:0.5">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
        </svg>
        <div style="font-size:13px">点击添加图片</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">支持 JPG / PNG / GIF，可多选</div>
      </div>
      <div class="images-preview" id="m-tpl-img-preview"></div>
    </div>
    <div class="form-group">
      <label class="form-label">分类标签</label>
      <input class="input" id="m-tpl-category" placeholder="可选，用于分组管理" value="${escapeHtml(tpl?.category || '')}">
    </div>`;

  showModal(isEdit ? '编辑模板' : '新建模板', content, async () => {
    const name    = document.getElementById('m-tpl-name').value.trim();
    const tplContent = document.getElementById('m-tpl-content').value.trim();
    const category = document.getElementById('m-tpl-category').value.trim();

    if (!name)    { showToast('请输入模板名称', 'warning'); return false; }
    if (!tplContent) { showToast('请输入消息内容', 'warning'); return false; }

    try {
      await window.electronAPI.saveTemplate({
        ...tpl, name, content: tplContent,
        images: selectedImages, category
      });
      showToast(isEdit ? '模板已更新' : '模板已创建', 'success');
      TemplatesPage.load();
    } catch (err) {
      showToast('保存失败: ' + err.message, 'error');
      return false;
    }
  });

  // 绑定图片上传（Modal渲染后）
  setTimeout(() => {
    renderImgPreviews();
    document.getElementById('m-tpl-upload-area')?.addEventListener('click', async () => {
      const paths = await window.electronAPI.selectImage();
      selectedImages.push(...paths);
      renderImgPreviews();
    });
  }, 50);
}
