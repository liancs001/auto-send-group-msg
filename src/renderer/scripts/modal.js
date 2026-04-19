/**
 * modal.js - 通用模态框系统
 */

let modalConfirmCallback = null;

/**
 * 显示模态框
 * @param {string} title
 * @param {string} bodyHtml
 * @param {Function} onConfirm - 确认回调，返回 false 则不关闭
 * @param {Object} opts - { width, confirmText, cancelText }
 */
window.showModal = function(title, bodyHtml, onConfirm, opts = {}) {
  const overlay   = document.getElementById('modal-overlay');
  const container = document.getElementById('modal-container');

  if (!overlay || !container) return;

  modalConfirmCallback = onConfirm;

  const { width = 560, confirmText = '确定', cancelText = '取消' } = opts;

  container.style.width = width + 'px';
  container.innerHTML = `
    <div class="modal-header">
      <div class="modal-title">${escapeHtml(title)}</div>
      <button class="modal-close" id="modal-close-btn">×</button>
    </div>
    <div class="modal-body">
      ${bodyHtml}
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="modal-cancel-btn">${cancelText}</button>
      <button class="btn btn-primary" id="modal-confirm-btn">${confirmText}</button>
    </div>`;

  overlay.style.display = 'flex';

  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('modal-confirm-btn').addEventListener('click', async () => {
    const confirmBtn = document.getElementById('modal-confirm-btn');
    if (!confirmBtn) return;
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<div class="spinner spinner-sm"></div>';

    try {
      const result = await modalConfirmCallback?.();
      if (result !== false) {
        closeModal();
      }
    } catch (err) {
      showToast('操作失败: ' + err.message, 'error');
    } finally {
      if (confirmBtn && !confirmBtn.isConnected) return;
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = confirmText;
      }
    }
  });

  // 不再支持点击背景关闭，必须点关闭/取消/确定按钮
  // 不再支持 ESC 键关闭
};

window.closeModal = function() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.style.display = 'none';
  modalConfirmCallback = null;
};

// ESC 不再关闭模态框（必须点按钮）
