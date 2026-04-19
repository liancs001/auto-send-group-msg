const { contextBridge, ipcRenderer } = require('electron');

// 安全地暴露 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),

  // 群组管理
  getGroups: () => ipcRenderer.invoke('get-groups'),
  saveGroup: (group) => ipcRenderer.invoke('save-group', group),
  deleteGroup: (id) => ipcRenderer.invoke('delete-group', id),
  updateGroup: (group) => ipcRenderer.invoke('update-group', group),

  // 群组分类
  getCategories: () => ipcRenderer.invoke('get-categories'),
  saveCategory: (category) => ipcRenderer.invoke('save-category', category),
  deleteCategory: (id) => ipcRenderer.invoke('delete-category', id),

  // 消息模板
  getTemplates: () => ipcRenderer.invoke('get-templates'),
  saveTemplate: (template) => ipcRenderer.invoke('save-template', template),
  deleteTemplate: (id) => ipcRenderer.invoke('delete-template', id),

  // 发送任务
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  saveTask: (task) => ipcRenderer.invoke('save-task', task),
  deleteTask: (id) => ipcRenderer.invoke('delete-task', id),
  updateTaskStatus: (id, status) => ipcRenderer.invoke('update-task-status', id, status),

  // 发送日志
  getLogs: (limit) => ipcRenderer.invoke('get-logs', limit),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),

  // 统计
  getStats: () => ipcRenderer.invoke('get-stats'),

  // 微信自动化
  findWechat: () => ipcRenderer.invoke('find-wechat'),
  activateWechat: () => ipcRenderer.invoke('activate-wechat'),
  searchGroup: (keyword) => ipcRenderer.invoke('search-group', keyword),
  sendMessage: (params) => ipcRenderer.invoke('send-message', params),
  sendImage: (params) => ipcRenderer.invoke('send-image', params),
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),

  // 任务调度
  startTask: (taskId) => ipcRenderer.invoke('start-task', taskId),
  stopTask: (taskId) => ipcRenderer.invoke('stop-task', taskId),
  pauseTask: (taskId) => ipcRenderer.invoke('pause-task', taskId),
  getSchedulerStatus: () => ipcRenderer.invoke('get-scheduler-status'),

  // 文件操作
  selectImage: () => ipcRenderer.invoke('select-image'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // 监听主进程推送的事件
  onTaskProgress: (callback) => ipcRenderer.on('task-progress', (_, data) => callback(data)),
  onTaskComplete: (callback) => ipcRenderer.on('task-complete', (_, data) => callback(data)),
  onTaskError: (callback) => ipcRenderer.on('task-error', (_, data) => callback(data)),
  onMessageSent: (callback) => ipcRenderer.on('message-sent', (_, data) => callback(data)),
  onSchedulerTick: (callback) => ipcRenderer.on('scheduler-tick', (_, data) => callback(data)),

  // 移除监听
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
